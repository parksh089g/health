import { db, type Exercise, type Routine, type SetEntry, type Workout } from '../../db'
import { BODY_PARTS, bodyPartLabel, equipmentLabel, incrementFor } from '../exercises'
import { formatDuration, formatKg, formatVolume, toDateKey } from '../format'
import {
  RECORD_LABELS,
  findNewRecords,
  formatRecordValue,
  getExerciseSessions,
  summarizeSession,
  workingSets,
  type ExerciseSession,
} from '../history'
import { getRecommendation } from '../recommend'
import { getAiProfile } from '../settings'
import { bodyPartSets, loadStatsData, weeklyTotals } from '../stats'
import { profileLines } from './profile'

/**
 * AI에게 보낼 기록을 글로 만든다. 종목 이름과 메모, 날짜, 무게, 횟수, 힘든 정도(RPE), 목표, 운동 메모, 체중,
 * 설정에 적은 내 정보만 담고 API 키나 기기 정보는 넣지 않는다.
 */

/** 운동 추천에서 종목마다 받는 이전 기록 수 */
export const WORKOUT_HISTORY_SESSIONS = 6
/** 기록 분석에서 보는 기간(주) */
export const REVIEW_WEEKS = 8
/** 운동 피드백에서 종목마다 비교하는 이전 기록 수 */
export const FEEDBACK_HISTORY_SESSIONS = 4
/** 체중 변화를 볼 때 기준으로 삼는 날 수(약 4주)와, 그 기준에서 앞뒤로 받아 주는 범위 */
const WEIGHT_COMPARE_DAYS = 28
const WEIGHT_COMPARE_SLACK = 14

const DAY = 24 * 60 * 60 * 1000
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function dateLabel(ts: number): string {
  return `${toDateKey(ts)}(${WEEKDAYS[new Date(ts).getDay()]})`
}

type SetLike = Pick<SetEntry, 'weightKg' | 'reps' | 'isWarmup' | 'isDone'> & Pick<Partial<SetEntry>, 'rpe' | 'durationSec'>

/** "60kg×8", "10회", 시간으로 재는 세트는 "45초". 힘든 정도를 적었으면 "60kg×8(RPE 8.5)" */
function setText(s: SetLike): string {
  const seconds = typeof s.durationSec === 'number' && s.durationSec > 0 ? Math.round(s.durationSec) : null
  if (s.weightKg === null && s.reps === null && seconds === null) return '빈 세트'
  const weighted = (s.weightKg ?? 0) > 0
  const reps = s.reps === null ? '?' : String(s.reps)
  const amount = seconds !== null ? `${seconds}초` : weighted ? reps : `${reps}회`
  const rpe = typeof s.rpe === 'number' && s.rpe >= 1 && s.rpe <= 10 ? `(RPE ${formatKg(s.rpe)})` : ''
  return `${weighted ? `${formatKg(s.weightKg as number)}kg×` : ''}${amount}${rpe}`
}

/** 완료한 세트를 "웜업 40kg×10 / 60kg×8, 60kg×8, 62.5kg×6"처럼 */
export function describeDoneSets(sets: SetLike[]): string {
  const done = sets.filter((s) => s.isDone)
  const warm = done.filter((s) => s.isWarmup).map(setText)
  const work = done.filter((s) => !s.isWarmup).map(setText)
  const parts = []
  if (warm.length > 0) parts.push(`웜업 ${warm.join(', ')}`)
  parts.push(work.length > 0 ? work.join(', ') : '본 세트 없음')
  return parts.join(' / ')
}

/** 오늘 세트를 순서대로. 완료한 세트에는 "(완료)"를 붙인다. */
export function describePlannedSets(sets: SetLike[]): string {
  if (sets.length === 0) return '세트 없음'
  return sets.map((s) => `${s.isWarmup ? '웜업 ' : ''}${setText(s)}${s.isDone ? '(완료)' : ''}`).join(', ')
}

function e1rmText(sets: SetLike[]): string {
  const sum = summarizeSession(sets)
  return sum.bestE1rm === null ? '' : ` · 추정 1RM ${formatKg(Math.round(sum.bestE1rm * 10) / 10)}kg`
}

function sessionLine(s: ExerciseSession): string {
  return `- ${dateLabel(s.workout.startedAt)}: ${describeDoneSets(s.sets)}${e1rmText(s.sets)}`
}

function memoLines(workouts: Workout[], limit: number): string[] {
  return workouts
    .filter((w) => w.memo.trim() !== '')
    .slice(-limit)
    .map((w) => `- ${dateLabel(w.startedAt)}: ${w.memo.trim().replace(/\s+/g, ' ')}`)
}

/** 시간으로 재는 종목(플랭크 등)인지. 이런 종목은 횟수 추천을 받지 않는다. */
const isTimed = (exercise: Pick<Exercise, 'measure'> | undefined) => exercise?.measure === 'time'

function exerciseHeader(key: string, exercise: Exercise | undefined, target: number | null): string {
  if (!exercise) return `[${key}] 지워진 종목`
  const parts = [`${bodyPartLabel(exercise.bodyPart)}, ${equipmentLabel(exercise.equipment)}`]
  if (isTimed(exercise)) {
    parts.push('시간으로 재는 종목')
  } else {
    parts.push(target === null ? '목표 횟수 정하지 않음' : `목표 ${target}회`)
    if (exercise.equipment !== 'bodyweight') parts.push(`증량 단위 ${formatKg(incrementFor(exercise))}kg`)
  }
  return `[${key}] ${exercise.name} (${parts.join(' · ')})`
}

/** 종목에 적어 둔 메모(시트 높이, 그립 같은 세팅). 없으면 빈 글. */
function noteText(exercise: Pick<Exercise, 'note'> | undefined): string {
  return typeof exercise?.note === 'string' ? exercise.note.trim().replace(/\s+/g, ' ').slice(0, 200) : ''
}

function dateKeyToTime(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

/**
 * 가장 최근 체중과 약 4주 사이의 변화. "체중: 72.4kg(2026-11-15 기록), 약 4주 전 73.6kg(2026-10-18)에서 -1.2kg"
 * 4주 전 앞뒤 2주 안에 기록이 없으면 최근 체중만 적는다. 체중 기록이 없으면 null.
 */
export async function bodyWeightLine(now: number = Date.now()): Promise<string | null> {
  const today = toDateKey(now)
  const rows = (await db.bodyWeights.toArray())
    .filter((r) => typeof r.weightKg === 'number' && r.weightKg > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date))
  const latest = rows.at(-1)
  if (!latest) return null
  const latestAt = dateKeyToTime(latest.date)
  let base: { date: string; weightKg: number; off: number } | null = null
  for (const r of rows) {
    const off = Math.abs(Math.round((latestAt - dateKeyToTime(r.date)) / DAY) - WEIGHT_COMPARE_DAYS)
    if (off <= WEIGHT_COMPARE_SLACK && (base === null || off < base.off)) base = { date: r.date, weightKg: r.weightKg, off }
  }
  const head = `체중: ${formatKg(latest.weightKg)}kg(${latest.date} 기록)`
  if (!base) return head
  const diff = Math.round((latest.weightKg - base.weightKg) * 10) / 10
  const change = diff === 0 ? '변화 없음' : `${diff > 0 ? '+' : ''}${formatKg(diff)}kg`
  return `${head}, 약 4주 전 ${formatKg(base.weightKg)}kg(${base.date})에서 ${change}`
}

/** 모든 요청 글에 함께 넣는 "내 정보"(설정에 적은 목표와 상황, 최근 체중). 넣을 것이 없으면 빈 배열. */
async function aboutMeLines(now: number): Promise<string[]> {
  const lines = profileLines(await getAiProfile())
  const weight = await bodyWeightLine(now)
  if (weight) lines.push(`- ${weight}`)
  return lines.length > 0 ? ['내 정보:', ...lines] : []
}

function routineLines(routines: Routine[], exercises: Map<string, Exercise>): string[] {
  return routines.map((r) => {
    const names = r.items.map((it) => {
      const ex = exercises.get(it.exerciseId)
      return `${ex?.name ?? '지워진 종목'} ${it.sets}세트${it.reps ? `×${it.reps}회` : ''}`
    })
    return `- ${r.name}: ${names.join(', ')}`
  })
}

/** 운동 추천 요청의 한 종목 */
export interface WorkoutContextItem {
  /** 답에서 종목을 가리키는 짧은 이름("E1", "E2" …) */
  key: string
  workoutExerciseId: string
  /** 적용할 때 바꿀 세트의 무게: 규칙 추천이 본 지난번 최고 무게, 없으면 오늘 세트 중 가장 무거운 무게 */
  fromWeightKg: number | null
  bodyweight: boolean
}

export interface WorkoutContext {
  prompt: string
  items: WorkoutContextItem[]
}

/** 추천을 받지 않는 종목(시간으로 재는 종목)의 머리말에 key 대신 붙이는 글 */
export const NO_ADVICE_KEY = '추천 안 함'

/**
 * AI 추천을 적용할 때 바꿀 세트의 무게(지금 세트 기준). 규칙의 기준 무게(지난번 최고 무게)가 아직 남은 본 세트에 있으면
 * 그 무게를, 없으면(이미 한 번 적용했거나 직접 바꾼 경우) 남은 본 세트 중 가장 무거운 무게를 쓴다.
 * 그래야 다시 받은 추천을 적용해도 피라미드의 가벼운 세트까지 바뀌지 않는다.
 */
export function applyFromWeight(
  sets: Pick<SetEntry, 'weightKg' | 'isWarmup' | 'isDone'>[],
  ruleFrom: number | null,
  todayTop: number,
): number | null {
  const pending = sets
    .filter((s) => !s.isWarmup && !s.isDone && s.weightKg !== null && s.weightKg > 0)
    .map((s) => s.weightKg as number)
  if (ruleFrom !== null && pending.some((w) => Math.abs(w - ruleFrom) < 1e-6)) return ruleFrom
  if (pending.length > 0) return Math.max(...pending)
  return ruleFrom ?? (todayTop > 0 ? todayTop : null)
}

/** 진행 중인 운동에 대한 추천 요청 글. 추천할 종목이 없으면 items가 비어 있다. */
export async function buildWorkoutContext(workoutId: string, now: number = Date.now()): Promise<WorkoutContext> {
  const workout = await db.workouts.get(workoutId)
  if (!workout) return { prompt: '', items: [] }
  const wes = await db.workoutExercises.where('workoutId').equals(workoutId).sortBy('order')
  const exercises = await db.exercises.bulkGet(wes.map((we) => we.exerciseId))
  const routine = workout.routineId ? await db.routines.get(workout.routineId) : undefined
  const finished = (await db.workouts.toArray())
    .filter((w) => w.endedAt !== null && w.id !== workoutId && w.startedAt < workout.startedAt)
    .sort((a, b) => a.startedAt - b.startedAt)
  const last = finished.at(-1)
  const recent28 = finished.filter((w) => w.startedAt >= now - 28 * DAY)

  const lines: string[] = []
  lines.push(`오늘: ${dateLabel(now)}`)
  lines.push(
    last
      ? `지난 운동: ${dateLabel(last.startedAt)}, ${Math.max(0, Math.round((startOfDay(now) - startOfDay(last.startedAt)) / DAY))}일 전`
      : '지난 운동: 없음(이 앱에서 처음 하는 운동)',
  )
  lines.push(`최근 4주 운동 횟수: ${recent28.length}회`)
  if (routine) lines.push(`오늘 시작한 루틴: ${routine.name}`)
  const memos = memoLines(finished, 3)
  if (memos.length > 0) lines.push('최근 운동 메모:', ...memos)
  if (workout.memo.trim() !== '') lines.push(`오늘 메모: ${workout.memo.trim()}`)
  const me = await aboutMeLines(now)
  if (me.length > 0) lines.push('', ...me)

  lines.push('', '오늘 할 종목:')
  const items: WorkoutContextItem[] = []
  for (const [i, we] of wes.entries()) {
    const exercise = exercises[i]
    // 시간으로 재는 종목은 기록만 보여 주고 추천은 받지 않는다(무게×횟수 추천을 세트에 채울 수 없다).
    const timed = isTimed(exercise)
    const key = timed ? NO_ADVICE_KEY : `E${items.length + 1}`
    const sets = await db.sets.where('workoutExerciseId').equals(we.id).sortBy('order')
    const target = we.targetReps ?? exercise?.targetReps ?? null
    const history = (await getExerciseSessions(we.exerciseId, { excludeWorkoutId: workoutId, before: workout.startedAt }))
      .slice(-WORKOUT_HISTORY_SESSIONS)
    const rule = exercise && !timed ? await getRecommendation(we, exercise) : null
    const todayTop = Math.max(0, ...sets.filter((s) => !s.isWarmup).map((s) => s.weightKg ?? 0))

    lines.push('', exerciseHeader(key, exercise, target))
    const note = noteText(exercise)
    if (note !== '') lines.push(`  종목 메모: ${note}`)
    lines.push(`  오늘 세트: ${describePlannedSets(sets)}`)
    if (rule) {
      const value = rule.weightKg === null ? `${rule.reps}회` : `${formatKg(rule.weightKg)}kg × ${rule.reps}`
      lines.push(`  앱의 규칙 추천: ${value} (${rule.reason})`)
    }
    if (history.length === 0) {
      lines.push('  지난 기록: 없음(처음 하는 종목)')
    } else {
      lines.push('  지난 기록(오래된 것부터):', ...history.map((s) => `  ${sessionLine(s)}`))
    }
    if (timed) continue

    items.push({
      key,
      workoutExerciseId: we.id,
      fromWeightKg: applyFromWeight(sets, rule?.fromWeightKg ?? null, todayTop),
      bodyweight: exercise?.equipment === 'bodyweight',
    })
  }
  return { prompt: lines.join('\n'), items }
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 기록 분석 요청 글. 끝낸 운동이 없으면 null */
export async function buildReviewContext(now: number = Date.now()): Promise<string | null> {
  const data = await loadStatsData()
  if (data.workouts.length === 0) return null
  const from = now - REVIEW_WEEKS * 7 * DAY
  const weeks = weeklyTotals(data.workouts, data.sessions, { weeks: REVIEW_WEEKS, now })
  const recentParts = bodyPartSets(data.sessions, data.exercises, { from: now - 28 * DAY, to: now + 1 })
  const prevParts = bodyPartSets(data.sessions, data.exercises, { from: now - 56 * DAY, to: now - 28 * DAY })
  const routines = await db.routines.toArray()

  const lines: string[] = []
  lines.push(`오늘: ${dateLabel(now)}`)
  lines.push(`이 앱의 첫 운동: ${dateLabel(data.workouts[0].startedAt)}, 끝낸 운동 모두 ${data.workouts.length}회`)
  const me = await aboutMeLines(now)
  if (me.length > 0) lines.push('', ...me)
  lines.push('', `주별 기록(최근 ${REVIEW_WEEKS}주, 월요일 시작, 볼륨은 본 세트 중량×횟수 합):`)
  for (const w of weeks) {
    lines.push(`- ${toDateKey(w.start)} 주: 운동 ${w.workouts}회, 본 세트 ${w.sets}개, 볼륨 ${Math.round(w.volume)}kg`)
  }
  const partText = (list: typeof recentParts) => list.map((b) => `${b.label} ${b.sets}`).join(', ')
  lines.push('', `부위별 본 세트 수: 최근 4주 ${partText(recentParts)} / 그 전 4주 ${partText(prevParts)}`)

  if (routines.length > 0) lines.push('', '저장한 루틴:', ...routineLines(routines, data.exercises))

  lines.push('', `종목별 기록(최근 ${REVIEW_WEEKS}주에 한 종목, 최근 것은 3번까지):`)
  const recentByExercise = [...data.sessionsByExercise.entries()]
    .map(([id, sessions]) => ({ id, sessions: sessions.filter((s) => s.workout.startedAt >= from) }))
    .filter((e) => e.sessions.length > 0)
    .sort((a, b) => b.sessions.length - a.sessions.length)
  for (const { id, sessions } of recentByExercise) {
    const ex = data.exercises.get(id)
    const all = data.sessionsByExercise.get(id) ?? []
    const target = ex?.targetReps ? ` · 목표 ${ex.targetReps}회` : ''
    lines.push(
      `${ex?.name ?? '지워진 종목'} (${ex ? bodyPartLabel(ex.bodyPart) : '기타'}${target}) · 최근 ${REVIEW_WEEKS}주 ${sessions.length}회, 전체 ${all.length}회`,
    )
    const note = noteText(ex)
    if (note !== '') lines.push(`  종목 메모: ${note}`)
    const first = sessions[0]
    if (sessions.length > 3) lines.push(`  ${sessionLine(first)}`, '  …')
    lines.push(...sessions.slice(-3).map((s) => `  ${sessionLine(s)}`))
  }

  const memos = memoLines(
    data.workouts.filter((w) => w.startedAt >= from),
    5,
  )
  if (memos.length > 0) lines.push('', '최근 운동 메모:', ...memos)
  return lines.join('\n')
}

/** 끝난 운동 한 번에 대한 피드백 요청 글. 운동이 없거나 아직 끝나지 않았거나 완료한 세트가 없으면 null */
export async function buildFeedbackContext(workoutId: string, now: number = Date.now()): Promise<string | null> {
  const workout = await db.workouts.get(workoutId)
  if (!workout || workout.endedAt === null) return null
  const wes = await db.workoutExercises.where('workoutId').equals(workoutId).sortBy('order')
  const exercises = await db.exercises.bulkGet(wes.map((we) => we.exerciseId))
  const routine = workout.routineId ? await db.routines.get(workout.routineId) : undefined
  const earlier = (await db.workouts.toArray())
    .filter((w) => w.endedAt !== null && w.id !== workoutId && w.startedAt < workout.startedAt)
    .sort((a, b) => a.startedAt - b.startedAt)
  const last = earlier.at(-1)
  const records = await findNewRecords(workoutId)

  const blocks: string[] = []
  const allSets: SetEntry[] = []
  let count = 0
  for (const [i, we] of wes.entries()) {
    const exercise = exercises[i]
    const sets = (await db.sets.where('workoutExerciseId').equals(we.id).sortBy('order')).filter((s) => s.isDone)
    if (sets.length === 0) continue
    allSets.push(...sets)
    const history = (await getExerciseSessions(we.exerciseId, { excludeWorkoutId: workoutId, before: workout.startedAt }))
      .slice(-FEEDBACK_HISTORY_SESSIONS)

    blocks.push('', exerciseHeader(String(++count), exercise, we.targetReps ?? exercise?.targetReps ?? null))
    const note = noteText(exercise)
    if (note !== '') blocks.push(`  종목 메모: ${note}`)
    blocks.push(`  이번 운동: ${describeDoneSets(sets)}${e1rmText(sets)}`)
    const mine = records.filter((r) => r.exerciseId === we.exerciseId)
    if (mine.length > 0) {
      const text = mine.map((r) => `${RECORD_LABELS[r.kind]} ${formatRecordValue(r.kind, r.value)}(이전 ${formatRecordValue(r.kind, r.previous)})`)
      blocks.push(`  이번에 세운 새 기록: ${text.join(', ')}`)
    }
    if (history.length === 0) {
      blocks.push('  지난 기록: 없음(처음 한 종목)')
    } else {
      blocks.push('  지난 기록(오래된 것부터):', ...history.map((s) => `  ${sessionLine(s)}`))
    }
  }
  if (allSets.length === 0) return null

  const lines: string[] = []
  lines.push(`오늘: ${dateLabel(now)}`)
  lines.push(
    `피드백을 받을 운동: ${dateLabel(workout.startedAt)}, ${formatDuration(workout.endedAt - workout.startedAt)}${routine ? `, 루틴 "${routine.name}"` : ''}`,
  )
  lines.push(`이 운동의 합계: 본 세트 ${workingSets(allSets).length}개, 볼륨 ${formatVolume(summarizeSession(allSets).volume)}kg`)
  lines.push(
    last
      ? `그 전 운동: ${dateLabel(last.startedAt)}, ${Math.max(0, Math.round((startOfDay(workout.startedAt) - startOfDay(last.startedAt)) / DAY))}일 전`
      : '그 전 운동: 없음(이 앱에서 처음 한 운동)',
  )
  lines.push(`그 전 4주 운동 횟수: ${earlier.filter((w) => w.startedAt >= workout.startedAt - 28 * DAY).length}회`)
  if (workout.memo.trim() !== '') lines.push(`이 운동의 메모: ${workout.memo.trim().replace(/\s+/g, ' ')}`)
  const me = await aboutMeLines(now)
  if (me.length > 0) lines.push('', ...me)
  lines.push('', '이 운동에서 한 종목(한 순서대로):', ...blocks)
  return lines.join('\n')
}

/** 루틴 제안 요청에서 고를 수 있는 종목 하나 */
export interface RoutineCandidate {
  /** 답에서 종목을 가리키는 짧은 이름("E1", "E2" …) */
  key: string
  exerciseId: string
  /** 시간으로 재는 종목. 목표 횟수를 두지 않는다. */
  timed: boolean
}

export interface RoutineContext {
  prompt: string
  candidates: RoutineCandidate[]
}

/**
 * AI 루틴 제안 요청 글. 사용자가 적은 요청, 내 정보, 최근 훈련 요약, 고를 수 있는 종목 목록을 담는다.
 * 숨긴 종목은 고를 수 있는 종목에서 뺀다(기록은 그대로 요약에 들어간다).
 */
export async function buildRoutineContext(request: string, now: number = Date.now()): Promise<RoutineContext> {
  const data = await loadStatsData()
  const routines = await db.routines.toArray()
  const from = now - REVIEW_WEEKS * 7 * DAY
  const recentParts = bodyPartSets(data.sessions, data.exercises, { from: now - 28 * DAY, to: now + 1 })

  const lines: string[] = []
  lines.push(`오늘: ${dateLabel(now)}`)
  if (data.workouts.length === 0) {
    lines.push('운동 기록: 아직 없음')
  } else {
    lines.push(`이 앱의 첫 운동: ${dateLabel(data.workouts[0].startedAt)}, 끝낸 운동 모두 ${data.workouts.length}회`)
    lines.push(`최근 4주 운동 횟수: ${data.workouts.filter((w) => w.startedAt >= now - 28 * DAY).length}회`)
    lines.push(`최근 4주 부위별 본 세트 수: ${recentParts.map((b) => `${b.label} ${b.sets}`).join(', ')}`)
  }
  const me = await aboutMeLines(now)
  if (me.length > 0) lines.push('', ...me)
  if (routines.length > 0) lines.push('', '이미 저장한 루틴:', ...routineLines(routines, data.exercises))

  const partOrder = new Map(BODY_PARTS.map((b, i) => [b.key, i]))
  const available = [...data.exercises.values()]
    .filter((e) => e.archived !== true)
    .sort(
      (a, b) =>
        (partOrder.get(a.bodyPart) ?? 99) - (partOrder.get(b.bodyPart) ?? 99) || a.name.localeCompare(b.name, 'ko'),
    )
  lines.push('', '고를 수 있는 종목(최근에 한 종목에는 한 횟수와 마지막으로 한 본 세트를 붙임):')
  const candidates: RoutineCandidate[] = []
  for (const [i, ex] of available.entries()) {
    const key = `E${i + 1}`
    const timed = isTimed(ex)
    const recent = (data.sessionsByExercise.get(ex.id) ?? []).filter((s) => s.workout.startedAt >= from)
    const parts = [`${key} ${ex.name} (${bodyPartLabel(ex.bodyPart)}, ${equipmentLabel(ex.equipment)})`]
    if (timed) parts.push('시간으로 재는 종목')
    const lastSets = workingSets(recent.at(-1)?.sets ?? [])
    if (recent.length > 0) {
      parts.push(`최근 ${REVIEW_WEEKS}주 ${recent.length}회${lastSets.length > 0 ? `, 마지막 ${lastSets.map(setText).join(', ')}` : ''}`)
    }
    const note = noteText(ex)
    if (note !== '') parts.push(`메모: ${note}`)
    lines.push(parts.join(' · '))
    candidates.push({ key, exerciseId: ex.id, timed })
  }

  lines.push('', `요청: ${request.trim().replace(/\s+/g, ' ')}`)
  return { prompt: lines.join('\n'), candidates }
}
