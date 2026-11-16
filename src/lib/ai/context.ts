import { db, type Exercise, type SetEntry, type Workout } from '../../db'
import { bodyPartLabel, equipmentLabel, incrementFor } from '../exercises'
import { formatKg, toDateKey } from '../format'
import { getExerciseSessions, summarizeSession, type ExerciseSession } from '../history'
import { getRecommendation } from '../recommend'
import { bodyPartSets, loadStatsData, weeklyTotals } from '../stats'

/**
 * AI에게 보낼 기록을 글로 만든다. 이름, 날짜, 무게, 횟수, 목표, 운동 메모만 담고 API 키나 기기 정보는 넣지 않는다.
 */

/** 운동 추천에서 종목마다 받는 이전 기록 수 */
export const WORKOUT_HISTORY_SESSIONS = 6
/** 기록 분석에서 보는 기간(주) */
export const REVIEW_WEEKS = 8

const DAY = 24 * 60 * 60 * 1000
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function dateLabel(ts: number): string {
  return `${toDateKey(ts)}(${WEEKDAYS[new Date(ts).getDay()]})`
}

type SetLike = Pick<SetEntry, 'weightKg' | 'reps' | 'isWarmup' | 'isDone'>

function setText(s: SetLike): string {
  const reps = s.reps === null ? '?' : String(s.reps)
  if (s.weightKg === null && s.reps === null) return '빈 세트'
  return (s.weightKg ?? 0) > 0 ? `${formatKg(s.weightKg as number)}kg×${reps}` : `${reps}회`
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

function exerciseHeader(key: string, exercise: Exercise | undefined, target: number | null): string {
  if (!exercise) return `[${key}] 지워진 종목`
  const parts = [`${bodyPartLabel(exercise.bodyPart)}, ${equipmentLabel(exercise.equipment)}`]
  parts.push(target === null ? '목표 횟수 정하지 않음' : `목표 ${target}회`)
  if (exercise.equipment !== 'bodyweight') parts.push(`증량 단위 ${formatKg(incrementFor(exercise))}kg`)
  return `[${key}] ${exercise.name} (${parts.join(' · ')})`
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

/** 진행 중인 운동에 대한 추천 요청 글. 종목이 없으면 items가 비어 있다. */
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

  lines.push('', '오늘 할 종목:')
  const items: WorkoutContextItem[] = []
  for (const [i, we] of wes.entries()) {
    const exercise = exercises[i]
    const key = `E${i + 1}`
    const sets = await db.sets.where('workoutExerciseId').equals(we.id).sortBy('order')
    const target = we.targetReps ?? exercise?.targetReps ?? null
    const history = (await getExerciseSessions(we.exerciseId, { excludeWorkoutId: workoutId, before: workout.startedAt }))
      .slice(-WORKOUT_HISTORY_SESSIONS)
    const rule = exercise ? await getRecommendation(we, exercise) : null
    const todayTop = Math.max(0, ...sets.filter((s) => !s.isWarmup).map((s) => s.weightKg ?? 0))

    lines.push('', exerciseHeader(key, exercise, target))
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
  lines.push('', `주별 기록(최근 ${REVIEW_WEEKS}주, 월요일 시작, 볼륨은 본 세트 중량×횟수 합):`)
  for (const w of weeks) {
    lines.push(`- ${toDateKey(w.start)} 주: 운동 ${w.workouts}회, 본 세트 ${w.sets}개, 볼륨 ${Math.round(w.volume)}kg`)
  }
  const partText = (list: typeof recentParts) => list.map((b) => `${b.label} ${b.sets}`).join(', ')
  lines.push('', `부위별 본 세트 수: 최근 4주 ${partText(recentParts)} / 그 전 4주 ${partText(prevParts)}`)

  if (routines.length > 0) {
    lines.push('', '저장한 루틴:')
    for (const r of routines) {
      const names = r.items.map((it) => {
        const ex = data.exercises.get(it.exerciseId)
        return `${ex?.name ?? '지워진 종목'} ${it.sets}세트${it.reps ? `×${it.reps}회` : ''}`
      })
      lines.push(`- ${r.name}: ${names.join(', ')}`)
    }
  }

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
