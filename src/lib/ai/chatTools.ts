import type AnthropicClient from '@anthropic-ai/sdk'
import { db, type Exercise, type Routine, type Workout } from '../../db'
import { bodyFatPercent, dateKeyToTime, formatComposition, listBodyWeights } from '../bodyWeight'
import { bodyPartLabel, equipmentLabel, nameKey } from '../exercises'
import { formatDuration, formatKg, formatTime, formatVolume, toDateKey } from '../format'
import { computeRecords, formatRecordValue, recordLabel, summarizeSession, workingSets, type ExerciseSession } from '../history'
import { formatSetShort, formatTarget, isCardio, isTimed, setTextOptions, usesAddedWeight, usesAssist } from '../measure'
import { bodyPartSets, loadStatsData, weeklyCardio, weeklyTotals, type StatsData } from '../stats'
import { ASSIST_NOTE, describeDoneSets } from './context'

/**
 * "내 기록에 물어보기"에서 Claude가 부르는 도구. 모두 폰의 DB를 읽기만 하고, 답은 짧은 한국어 글로 돌려준다.
 * Claude는 질문에 필요한 도구만 골라 부르므로, 기록 전체가 아니라 필요한 부분만 Anthropic으로 나간다.
 */

type Tool = AnthropicClient.Beta.BetaTool

const DAY = 24 * 60 * 60 * 1000
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

const nullableString = (description: string) => ({ type: ['string', 'null'], description })
const nullableInteger = (description: string) => ({ type: ['integer', 'null'], description })
const DATE_FROM = 'YYYY-MM-DD. 이날부터(포함). 처음부터면 null'
const DATE_TO = 'YYYY-MM-DD. 이날까지(포함). 오늘까지면 null'

function tool(name: string, description: string, properties: Record<string, unknown>): Tool {
  return {
    name,
    description,
    strict: true,
    input_schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
  }
}

/** 순서를 바꾸면 프롬프트 캐시가 깨지므로 고정해 둔다. */
export const CHAT_TOOLS: Tool[] = [
  tool(
    'find_exercises',
    '종목 이름으로 종목을 찾는다. 종목마다 부위, 기구, 재는 방식, 끝낸 기록 수와 마지막으로 한 날을 준다. 사용자가 말한 종목이 앱의 어느 종목인지 모를 때 먼저 부른다.',
    {
      query: nullableString('찾을 이름 일부(띄어쓰기 무시). 기록이 있는 종목 전체를 보려면 null'),
      only_with_records: { type: 'boolean', description: '기록이 있는 종목만 볼지' },
    },
  ),
  tool(
    'get_exercise_history',
    '한 종목의 기간 안 기록을 날짜별로 준다. 세트(무게×횟수, RPE), 그날 최고 무게, 추정 1RM, 볼륨이 들어 있다.',
    {
      exercise: { type: 'string', description: '종목 이름(find_exercises가 준 이름 그대로가 가장 정확)' },
      from: nullableString(DATE_FROM),
      to: nullableString(DATE_TO),
      limit: nullableInteger('최근 몇 번까지 볼지(1~30). 기본 10'),
    },
  ),
  tool(
    'get_exercise_bests',
    '한 종목의 개인 기록(최고 무게, 최고 추정 1RM, 한 번 운동의 최고 볼륨, 최다 횟수, 최장 시간 등)을 기간 안과 전체 기간으로 나눠 준다. "지난달 벤치 최고" 같은 질문에 쓴다.',
    {
      exercise: { type: 'string', description: '종목 이름' },
      from: nullableString(DATE_FROM),
      to: nullableString(DATE_TO),
    },
  ),
  tool(
    'list_workouts',
    '기간 안에 끝낸 운동을 날짜순으로 준다. 운동마다 시간, 루틴, 종목별 본 세트 수와 최고 세트, 메모가 있다. 최근 것부터 40개까지.',
    { from: nullableString(DATE_FROM), to: nullableString(DATE_TO) },
  ),
  tool(
    'get_training_summary',
    '최근 몇 주의 주별 운동 횟수, 본 세트 수, 볼륨, 유산소 시간과, 최근 4주와 그 전 4주의 부위별 본 세트 수를 준다. 빈도, 균형, 전체 흐름을 볼 때 쓴다.',
    { weeks: nullableInteger('볼 주 수(1~26). 기본 8') },
  ),
  tool(
    'get_body_composition',
    '기간 안의 체중, 골격근량, 체지방량, 체지방률 기록과 그 사이의 변화를 준다. 체성분(골격근량, 체지방량)은 사용자가 측정한 날에만 있다.',
    { from: nullableString(DATE_FROM), to: nullableString(DATE_TO) },
  ),
  tool('get_routines', '사용자가 저장해 둔 루틴(종목, 세트 수, 목표 횟수)을 준다.', {}),
]

/** 도구를 부르는 동안 화면에 보일 짧은 설명. "벤치프레스 기록" */
export function toolActivityLabel(name: string, input: unknown): string {
  const ex = isObj(input) && typeof input.exercise === 'string' ? input.exercise.trim().slice(0, 20) : ''
  switch (name) {
    case 'find_exercises':
      return '종목 찾기'
    case 'get_exercise_history':
      return ex ? `${ex} 기록` : '종목 기록'
    case 'get_exercise_bests':
      return ex ? `${ex} 최고 기록` : '최고 기록'
    case 'list_workouts':
      return '운동 목록'
    case 'get_training_summary':
      return '주별 요약'
    case 'get_body_composition':
      return '체중과 체성분'
    case 'get_routines':
      return '루틴'
    default:
      return '기록'
  }
}

export interface ToolOutput {
  text: string
  isError: boolean
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

class ToolInputError extends Error {}

function dateLabel(ts: number): string {
  return `${toDateKey(ts)}(${WEEKDAYS[new Date(ts).getDay()]})`
}

/** 기간 입력을 [from, to) 시각으로. 날짜 형식이 틀리면 ToolInputError */
function rangeOf(input: Record<string, unknown>): { from: number; to: number; text: string } {
  const one = (v: unknown, name: string): number | null => {
    if (v === null || v === undefined || v === '') return null
    const t = typeof v === 'string' ? dateKeyToTime(v.trim()) : null
    if (t === null) throw new ToolInputError(`${name}은 YYYY-MM-DD 형식의 날짜여야 합니다: ${String(v)}`)
    return t
  }
  const from = one(input.from, 'from')
  const toDay = one(input.to, 'to')
  const to = toDay === null ? Number.POSITIVE_INFINITY : new Date(toDay).setDate(new Date(toDay).getDate() + 1)
  if (from !== null && from >= to) throw new ToolInputError('from이 to보다 늦습니다.')
  const text = `${from === null ? '처음' : toDateKey(from)} ~ ${toDay === null ? '오늘' : toDateKey(toDay)}`
  return { from: from ?? Number.NEGATIVE_INFINITY, to, text }
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def
  return Math.min(max, Math.max(min, Math.round(v)))
}

/** 종목 머리말에 붙일 재는 방식 설명 */
function kindNotes(ex: Exercise): string[] {
  const notes: string[] = []
  if (isCardio(ex)) notes.push('유산소 종목')
  else if (isTimed(ex)) notes.push('시간으로 재는 종목')
  else if (usesAssist(ex)) notes.push(ASSIST_NOTE)
  else if (usesAddedWeight(ex)) notes.push('맨몸 종목(무게는 몸에 더 단 추가 무게)')
  if (ex.archived) notes.push('숨긴 종목')
  return notes
}

function exerciseTitle(ex: Exercise): string {
  return `${ex.name} (${[bodyPartLabel(ex.bodyPart), equipmentLabel(ex.equipment), ...kindNotes(ex)].join(', ')})`
}

/** 이름으로 종목 하나를 고른다. 똑같은 이름, 하나뿐인 부분 일치 순서로 찾고, 여럿이면 후보를 알려 준다. */
function resolveExercise(name: unknown, data: StatsData): Exercise {
  if (typeof name !== 'string' || name.trim() === '') throw new ToolInputError('exercise에 종목 이름을 넣어 주세요.')
  const key = nameKey(name)
  const all = [...data.exercises.values()]
  const exact = all.filter((e) => nameKey(e.name) === key)
  if (exact.length === 1) return exact[0]
  const count = (e: Exercise) => data.sessionsByExercise.get(e.id)?.length ?? 0
  const partial = (exact.length > 0 ? exact : all.filter((e) => nameKey(e.name).includes(key) || key.includes(nameKey(e.name))))
    .sort((a, b) => count(b) - count(a))
  if (partial.length === 1) return partial[0]
  // 기록이 있는 종목이 하나뿐이면 그것으로 본다("벤치" → 기록이 있는 "벤치프레스").
  const withRecords = partial.filter((e) => count(e) > 0)
  if (withRecords.length === 1) return withRecords[0]
  if (partial.length === 0) {
    throw new ToolInputError(`"${name}"과 맞는 종목이 없습니다. find_exercises로 이름을 찾아 주세요.`)
  }
  const list = partial.slice(0, 12).map((e) => `${e.name}(기록 ${count(e)}회)`)
  throw new ToolInputError(`"${name}"과 맞는 종목이 여럿입니다. 이름을 정확히 골라 다시 불러 주세요: ${list.join(', ')}`)
}

function sessionsIn(sessions: ExerciseSession[], range: { from: number; to: number }): ExerciseSession[] {
  return sessions.filter((s) => s.workout.startedAt >= range.from && s.workout.startedAt < range.to)
}

// ───────── 도구들

function findExercises(input: Record<string, unknown>, data: StatsData): string {
  const query = typeof input.query === 'string' ? nameKey(input.query) : ''
  const onlyWithRecords = input.only_with_records === true
  const rows = [...data.exercises.values()]
    .map((e) => ({ e, sessions: data.sessionsByExercise.get(e.id) ?? [] }))
    .filter(({ e, sessions }) => (query === '' || nameKey(e.name).includes(query)) && (!onlyWithRecords || sessions.length > 0))
    .filter(({ e, sessions }) => sessions.length > 0 || !e.archived)
    .sort((a, b) => b.sessions.length - a.sessions.length || a.e.name.localeCompare(b.e.name, 'ko'))
  if (rows.length === 0) return query ? `"${String(input.query)}"이 들어간 종목이 없습니다.` : '조건에 맞는 종목이 없습니다.'
  const shown = rows.slice(0, 60)
  const lines = shown.map(({ e, sessions }) => {
    const last = sessions.at(-1)
    const rec = sessions.length > 0 ? `기록 ${sessions.length}회, 마지막 ${dateLabel(last!.workout.startedAt)}` : '기록 없음'
    return `- ${exerciseTitle(e)} · ${rec}`
  })
  if (rows.length > shown.length) lines.push(`(그 밖에 ${rows.length - shown.length}개. 이름을 좁혀 찾아 주세요.)`)
  return lines.join('\n')
}

function sessionLine(s: ExerciseSession, ex: Exercise): string {
  const opts = setTextOptions(ex)
  const sum = summarizeSession(s.sets, usesAssist(ex))
  const extra: string[] = []
  if (sum.topWeight !== null && !usesAssist(ex)) extra.push(`최고 ${formatKg(sum.topWeight)}kg`)
  if (sum.bestE1rm !== null && !opts.addedWeight && !usesAssist(ex)) extra.push(`추정 1RM ${formatKg(Math.round(sum.bestE1rm * 10) / 10)}kg`)
  if (sum.volume > 0) extra.push(`볼륨 ${formatVolume(sum.volume)}kg`)
  return `- ${dateLabel(s.workout.startedAt)}: ${describeDoneSets(s.sets, opts)}${extra.length > 0 ? ` · ${extra.join(' · ')}` : ''}`
}

function exerciseHistory(input: Record<string, unknown>, data: StatsData): string {
  const ex = resolveExercise(input.exercise, data)
  const range = rangeOf(input)
  const limit = clampInt(input.limit, 10, 1, 30)
  const inRange = sessionsIn(data.sessionsByExercise.get(ex.id) ?? [], range)
  const lines = [exerciseTitle(ex)]
  const target = ex.targetReps ? `목표 ${formatTarget(ex, ex.targetReps)}` : null
  if (target) lines.push(target)
  if (ex.note?.trim()) lines.push(`종목 메모: ${ex.note.trim().replace(/\s+/g, ' ').slice(0, 200)}`)
  if (inRange.length === 0) {
    lines.push(`${range.text}: 기록 없음`)
    return lines.join('\n')
  }
  const shown = inRange.slice(-limit)
  lines.push(
    `${range.text}: 기록 ${inRange.length}회${shown.length < inRange.length ? ` 중 최근 ${shown.length}회` : ''}(오래된 것부터)`,
    ...shown.map((s) => sessionLine(s, ex)),
  )
  return lines.join('\n')
}

function recordLines(sessions: ExerciseSession[], ex: Exercise): string[] {
  const records = computeRecords(sessions, ex)
  const opts = setTextOptions(ex)
  return Object.values(records).map((r) => {
    const set = r.set ? ` · ${formatSetShort(r.set, opts)}` : ''
    return `- ${recordLabel(r.kind, ex)}: ${formatRecordValue(r.kind, r.value, ex)} (${dateLabel(r.at)}${set})`
  })
}

function exerciseBests(input: Record<string, unknown>, data: StatsData): string {
  const ex = resolveExercise(input.exercise, data)
  const range = rangeOf(input)
  const all = data.sessionsByExercise.get(ex.id) ?? []
  const inRange = sessionsIn(all, range)
  const lines = [exerciseTitle(ex)]
  lines.push(`${range.text} (기록 ${inRange.length}회):`)
  const ranged = recordLines(inRange, ex)
  lines.push(...(ranged.length > 0 ? ranged : ['- 기록 없음']))
  if (inRange.length !== all.length) {
    lines.push(`전체 기간 (기록 ${all.length}회):`)
    const total = recordLines(all, ex)
    lines.push(...(total.length > 0 ? total : ['- 기록 없음']))
  }
  return lines.join('\n')
}

function listWorkouts(input: Record<string, unknown>, data: StatsData, routines: Map<string, string>): string {
  const range = rangeOf(input)
  const workouts = data.workouts.filter((w) => w.startedAt >= range.from && w.startedAt < range.to)
  if (workouts.length === 0) return `${range.text}: 끝낸 운동 없음`
  const shown = workouts.slice(-40)
  const byWorkout = new Map<string, ExerciseSession[]>()
  for (const s of data.sessions) {
    const list = byWorkout.get(s.workout.id)
    if (list) list.push(s)
    else byWorkout.set(s.workout.id, [s])
  }
  const lines = [
    `${range.text}: 끝낸 운동 ${workouts.length}회${shown.length < workouts.length ? `, 최근 ${shown.length}회만` : ''}(오래된 것부터)`,
  ]
  for (const w of shown) lines.push(workoutLine(w, byWorkout.get(w.id) ?? [], data, routines))
  return lines.join('\n')
}

function workoutLine(w: Workout, sessions: ExerciseSession[], data: StatsData, routines: Map<string, string>): string {
  const head = [`${dateLabel(w.startedAt)} ${formatTime(w.startedAt)}`]
  if (w.endedAt !== null) head.push(formatDuration(w.endedAt - w.startedAt))
  const routine = w.routineId ? routines.get(w.routineId) : undefined
  if (routine) head.push(`루틴 "${routine}"`)
  const items = [...sessions]
    .sort((a, b) => a.we.order - b.we.order)
    .map((s) => {
      const ex = data.exercises.get(s.we.exerciseId)
      const working = workingSets(s.sets)
      const opts = setTextOptions(ex)
      // 가장 무거운(무게가 없으면 가장 많이 한) 본 세트 하나를 보여 준다.
      const top = [...working].sort((a, b) => (b.weightKg ?? 0) - (a.weightKg ?? 0) || (b.reps ?? 0) - (a.reps ?? 0))[0]
      return `${ex?.name ?? '지워진 종목'} ${working.length}세트${top ? `(${formatSetShort(top, opts)})` : ''}`
    })
  const memo = w.memo.trim() ? ` · 메모: ${w.memo.trim().replace(/\s+/g, ' ').slice(0, 200)}` : ''
  return `- ${head.join(' · ')}: ${items.join(', ') || '완료한 세트 없음'}${memo}`
}

function trainingSummary(input: Record<string, unknown>, data: StatsData, now: number): string {
  const weeks = clampInt(input.weeks, 8, 1, 26)
  const totals = weeklyTotals(data.workouts, data.sessions, { weeks, now, exercises: data.exercises })
  const cardio = weeklyCardio(data.sessions, data.exercises, { weeks, now })
  const lines = [`주별 기록(최근 ${weeks}주, 월요일 시작, 볼륨은 본 세트 중량×횟수 합):`]
  totals.forEach((w, i) => {
    const minutes = Math.round(cardio[i].seconds / 60)
    lines.push(
      `- ${toDateKey(w.start)} 주: 운동 ${w.workouts}회, 본 세트 ${w.sets}개, 볼륨 ${formatVolume(w.volume)}kg${minutes > 0 ? `, 유산소 ${minutes}분` : ''}`,
    )
  })
  const parts = (from: number, to: number) =>
    bodyPartSets(data.sessions, data.exercises, { from, to })
      .map((b) => `${b.label} ${b.sets}`)
      .join(', ')
  lines.push(`부위별 본 세트 수: 최근 4주 ${parts(now - 28 * DAY, now + 1)} / 그 전 4주 ${parts(now - 56 * DAY, now - 28 * DAY)}`)
  lines.push(`끝낸 운동 전체 ${data.workouts.length}회${data.workouts[0] ? `, 첫 운동 ${dateLabel(data.workouts[0].startedAt)}` : ''}`)
  return lines.join('\n')
}

async function bodyComposition(input: Record<string, unknown>): Promise<string> {
  const range = rangeOf(input)
  const entries = (await listBodyWeights()).filter((e) => {
    const t = dateKeyToTime(e.date) ?? 0
    return t >= range.from && t < range.to
  })
  if (entries.length === 0) return `${range.text}: 체중 기록 없음`
  const shown = entries.slice(-60)
  const lines = [
    `${range.text}: 기록 ${entries.length}개${shown.length < entries.length ? `, 최근 ${shown.length}개만` : ''}(오래된 것부터)`,
    ...shown.map((e) => {
      const comp = formatComposition(e)
      return `- ${e.date}: 체중 ${formatKg(e.weightKg)}kg${comp ? ` · ${comp}` : ''}`
    }),
  ]
  const change = (name: string, pick: (e: (typeof entries)[number]) => number | null, unit: string) => {
    const withValue = entries.filter((e) => pick(e) !== null)
    if (withValue.length < 2) return
    const first = withValue[0]
    const last = withValue.at(-1)!
    const diff = Math.round(((pick(last) as number) - (pick(first) as number)) * 10) / 10
    lines.push(
      `- ${name}: ${formatKg(pick(first) as number)}${unit}(${first.date}) → ${formatKg(pick(last) as number)}${unit}(${last.date}), ${diff > 0 ? '+' : ''}${formatKg(diff)}${unit}`,
    )
  }
  const num = (v: number | null | undefined) => (typeof v === 'number' && v > 0 ? v : null)
  lines.push('기간 안의 변화(처음 잰 날 → 마지막으로 잰 날):')
  const before = lines.length
  change('체중', (e) => e.weightKg, 'kg')
  change('골격근량', (e) => num(e.muscleKg), 'kg')
  change('체지방량', (e) => num(e.bodyFatKg), 'kg')
  change('체지방률', (e) => bodyFatPercent(e), '%')
  if (lines.length === before) lines.pop()
  if (!entries.some((e) => num(e.muscleKg) !== null || num(e.bodyFatKg) !== null)) {
    lines.push('이 기간에는 골격근량과 체지방량 기록이 없습니다(체중만 있음).')
  }
  return lines.join('\n')
}

function routinesText(routines: Routine[], data: StatsData): string {
  if (routines.length === 0) return '저장한 루틴이 없습니다.'
  return routines
    .map((r) => {
      const items = r.items.map((it) => {
        const ex = data.exercises.get(it.exerciseId)
        return `${ex?.name ?? '지워진 종목'} ${it.sets}세트${it.reps ? `×${formatTarget(ex, it.reps)}` : ''}`
      })
      const used = r.lastUsedAt ? ` · 마지막으로 쓴 날 ${dateLabel(r.lastUsedAt)}` : ''
      return `- ${r.name}${used}: ${items.join(', ')}`
    })
    .join('\n')
}

/** 결과 글이 너무 길면 자른다(토큰과 요금을 아끼려고). */
const MAX_RESULT_CHARS = 12_000

/**
 * 도구 하나를 실행한다. 입력이 잘못됐거나 종목을 못 찾으면 isError로 그 까닭을 돌려줘 Claude가 고쳐 부르게 한다.
 * data는 한 질문 동안 같은 것을 쓰도록 밖에서 넘긴다.
 */
export async function runChatTool(name: string, input: unknown, ctx: { data: StatsData; now: number }): Promise<ToolOutput> {
  const args = isObj(input) ? input : {}
  try {
    let text: string
    switch (name) {
      case 'find_exercises':
        text = findExercises(args, ctx.data)
        break
      case 'get_exercise_history':
        text = exerciseHistory(args, ctx.data)
        break
      case 'get_exercise_bests':
        text = exerciseBests(args, ctx.data)
        break
      case 'list_workouts': {
        const routines = await db.routines.toArray()
        text = listWorkouts(args, ctx.data, new Map(routines.map((r) => [r.id, r.name])))
        break
      }
      case 'get_training_summary':
        text = trainingSummary(args, ctx.data, ctx.now)
        break
      case 'get_body_composition':
        text = await bodyComposition(args)
        break
      case 'get_routines':
        text = routinesText(await db.routines.toArray(), ctx.data)
        break
      default:
        return { text: `모르는 도구입니다: ${name}`, isError: true }
    }
    if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n(너무 길어 잘랐습니다. 기간을 좁혀 다시 불러 주세요.)`
    return { text, isError: false }
  } catch (e) {
    if (e instanceof ToolInputError) return { text: e.message, isError: true }
    return { text: '기록을 읽는 중에 문제가 생겼습니다.', isError: true }
  }
}

/** 한 질문 동안 도구들이 함께 쓰는 기록 */
export function loadChatData(): Promise<StatsData> {
  return loadStatsData()
}
