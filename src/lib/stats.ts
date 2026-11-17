import { db, type BodyPart, type Exercise, type SetEntry, type Workout } from '../db'
import { BODY_PARTS } from './exercises'
import { formatDay, formatKg, startOfWeek } from './format'
import {
  computeRecords,
  getAllExerciseSessions,
  summarizeSession,
  workingSets,
  type ExerciseSession,
  type RecordExercise,
} from './history'
import {
  cardioMetricOf,
  formatCardioTime,
  formatDistance,
  formatFloors,
  formatSeconds,
  formatSetShort,
  formatWeight,
  isCardio,
  isTimed,
  setSeconds,
  usesAddedWeight,
  type SetTextOptions,
} from './measure'
import { totalVolume } from './workouts'

/**
 * 성장 통계. (2단계)
 * 통계는 저장하지 않고 세트 데이터에서 그때그때 계산한다. 끝난 운동의 완료한 본 세트(웜업 제외)만 센다.
 * 시간 종목과 유산소 종목의 세트는 세트 수에는 들어가고 볼륨에는 들어가지 않는다. 맨몸 종목은 추가 무게×횟수만 볼륨에 들어간다.
 * 날짜는 모두 로컬 시간 기준이고, 한 주는 월요일에 시작한다.
 */

type WorkoutLike = Pick<Workout, 'id' | 'startedAt' | 'endedAt'>

/** 통계 화면이 한 번에 읽는 데이터 */
export interface StatsData {
  /** 끝난 운동, 오래된 것부터 */
  workouts: Workout[]
  /** 모든 종목의 끝난 기록, 오래된 것부터 */
  sessions: ExerciseSession[]
  /** 종목 id별 끝난 기록, 각각 오래된 것부터 */
  sessionsByExercise: Map<string, ExerciseSession[]>
  exercises: Map<string, Exercise>
}

export async function loadStatsData(): Promise<StatsData> {
  const [workouts, sessionsByExercise, exercises] = await Promise.all([
    db.workouts.toArray(),
    getAllExerciseSessions(),
    db.exercises.toArray(),
  ])
  const sessions = [...sessionsByExercise.values()].flat().sort((a, b) => a.workout.startedAt - b.workout.startedAt)
  return {
    workouts: workouts.filter((w) => w.endedAt !== null).sort((a, b) => a.startedAt - b.startedAt),
    sessions,
    sessionsByExercise,
    exercises: new Map(exercises.map((e) => [e.id, e])),
  }
}

// ───────── 주별 합계

/** 날짜에 일수를 더한다(로컬 시간). 서머타임이 있어도 0시는 0시로 남는다. */
function addDays(ts: number, days: number): number {
  const d = new Date(ts)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** 한 주의 합계 */
export interface WeekTotal {
  /** 그 주 월요일 0시(로컬 시간) */
  start: number
  /** 다음 주 월요일 0시 */
  end: number
  /** 끝낸 운동 횟수 */
  workouts: number
  /** 볼륨(본 세트의 중량×횟수 합) */
  volume: number
  /** 완료한 본 세트 수 */
  sets: number
}

/**
 * 이번 주까지 최근 weeks주의 합계를 오래된 주부터 돌려준다. 운동하지 않은 주도 0으로 넣는다.
 * 운동은 시작한 시각으로 주를 정한다(일요일 밤에 시작해 월요일에 끝나도 시작한 주).
 */
export function weeklyTotals(
  workouts: WorkoutLike[],
  sessions: ExerciseSession[],
  opts: { weeks: number; now: number },
): WeekTotal[] {
  const thisWeek = startOfWeek(opts.now).getTime()
  const count = Math.max(0, Math.floor(opts.weeks))
  const result: WeekTotal[] = []
  const index = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const start = addDays(thisWeek, -7 * (count - 1 - i))
    index.set(start, i)
    result.push({ start, end: addDays(start, 7), workouts: 0, volume: 0, sets: 0 })
  }
  const bucket = (ts: number) => {
    const i = index.get(startOfWeek(ts).getTime())
    return i === undefined ? undefined : result[i]
  }
  for (const w of workouts) {
    if (w.endedAt === null) continue
    const b = bucket(w.startedAt)
    if (b) b.workouts++
  }
  for (const s of sessions) {
    if (s.workout.endedAt === null) continue
    const b = bucket(s.workout.startedAt)
    if (!b) continue
    b.volume += totalVolume(s.sets)
    b.sets += workingSets(s.sets).length
  }
  return result
}

/** 한 주의 유산소 시간 */
export interface CardioWeek {
  /** 그 주 월요일 0시(로컬 시간) */
  start: number
  /** 다음 주 월요일 0시 */
  end: number
  /** 유산소 종목의 완료한 본 세트 시간 합(초) */
  seconds: number
}

/** 이 기록에서 한 유산소 시간(초). 유산소 종목의 완료한 본 세트만 더한다. 유산소 종목이 아니면 0 */
function cardioSecondsOf(s: ExerciseSession, exercises: Map<string, Pick<Exercise, 'measure'>>): number {
  if (!isCardio(exercises.get(s.we.exerciseId))) return 0
  return workingSets(s.sets).reduce((sum, set) => sum + setSeconds(set), 0)
}

/**
 * 이번 주까지 최근 weeks주의 유산소 시간을 오래된 주부터 돌려준다. 유산소를 하지 않은 주도 0으로 넣는다.
 * 주를 나누는 방법은 weeklyTotals와 같다(운동을 시작한 시각, 월요일 시작).
 */
export function weeklyCardio(
  sessions: ExerciseSession[],
  exercises: Map<string, Pick<Exercise, 'measure'>>,
  opts: { weeks: number; now: number },
): CardioWeek[] {
  const thisWeek = startOfWeek(opts.now).getTime()
  const count = Math.max(0, Math.floor(opts.weeks))
  const result: CardioWeek[] = []
  const index = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const start = addDays(thisWeek, -7 * (count - 1 - i))
    index.set(start, i)
    result.push({ start, end: addDays(start, 7), seconds: 0 })
  }
  for (const s of sessions) {
    if (s.workout.endedAt === null) continue
    const i = index.get(startOfWeek(s.workout.startedAt).getTime())
    if (i !== undefined) result[i].seconds += cardioSecondsOf(s, exercises)
  }
  return result
}

/** 끝난 기록 중에 유산소가 하나라도 있는지. 없으면 통계 화면에서 유산소 칸을 숨긴다. */
export function hasCardioSessions(sessions: ExerciseSession[], exercises: Map<string, Pick<Exercise, 'measure'>>): boolean {
  return sessions.some((s) => s.workout.endedAt !== null && cardioSecondsOf(s, exercises) > 0)
}

/** "11월 9일 ~ 15일", 달이 바뀌면 "10월 26일 ~ 11월 1일" */
export function formatWeekRange(start: number): string {
  const a = new Date(start)
  const b = new Date(addDays(start, 6))
  const head = `${a.getMonth() + 1}월 ${a.getDate()}일`
  return a.getMonth() === b.getMonth()
    ? `${head} ~ ${b.getDate()}일`
    : `${head} ~ ${b.getMonth() + 1}월 ${b.getDate()}일`
}

/** "11월 16일". now와 해가 다르면 "2025년 3월 7일" */
export function formatMonthDay(ts: number, now: number = Date.now()): string {
  const d = new Date(ts)
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일`
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}년 ${md}`
}

/** "11월 16일 (월)". now와 해가 다르면 "2025년 3월 7일 (금)" */
export function formatDayOfYear(ts: number, now: number = Date.now()): string {
  const y = new Date(ts).getFullYear()
  return y === new Date(now).getFullYear() ? formatDay(ts) : `${y}년 ${formatDay(ts)}`
}

// ───────── 부위별 세트

/** 오늘을 포함한 최근 days일. from은 첫날 0시, to는 내일 0시(로컬 시간). */
export function lastDays(days: number, now: number): { from: number; to: number } {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const t = today.getTime()
  return { from: addDays(t, -(days - 1)), to: addDays(t, 1) }
}

export interface BodyPartCount {
  bodyPart: BodyPart
  label: string
  /** 완료한 본 세트 수 */
  sets: number
}

/**
 * 기간 [from, to) 안에 시작한 운동의 부위별 본 세트 수. 많은 것부터, 같으면 부위 목록 순서.
 * 세트가 없는 부위도 0으로 넣는다(기타는 세트가 있을 때만). 지워진 종목은 기타로 센다.
 * 유산소로 재는 종목은 근육 부위가 아니라 여기서 세지 않는다(부위를 다른 것으로 바꿔 두었어도).
 * 유산소로 재지 않는데 부위만 유산소인 종목(버피 등)은 기타로 센다.
 */
export function bodyPartSets(
  sessions: ExerciseSession[],
  exercises: Map<string, Pick<Exercise, 'bodyPart' | 'measure'>>,
  range: { from: number; to: number },
): BodyPartCount[] {
  const counts = new Map<BodyPart, number>()
  for (const s of sessions) {
    const t = s.workout.startedAt
    if (s.workout.endedAt === null || t < range.from || t >= range.to) continue
    const exercise = exercises.get(s.we.exerciseId)
    if (exercise?.measure === 'cardio') continue
    const part = !exercise || exercise.bodyPart === 'cardio' ? 'other' : exercise.bodyPart
    counts.set(part, (counts.get(part) ?? 0) + workingSets(s.sets).length)
  }
  return BODY_PARTS.filter((b) => b.key !== 'cardio')
    .map((b) => ({ bodyPart: b.key, label: b.label, sets: counts.get(b.key) ?? 0 }))
    .filter((b) => b.bodyPart !== 'other' || b.sets > 0)
    .sort((a, b) => b.sets - a.sets)
}

// ───────── 운동 달력

/** 달. month는 0(1월)~11(12월) */
export interface YearMonth {
  year: number
  month: number
}

export function monthOf(ts: number): YearMonth {
  const d = new Date(ts)
  return { year: d.getFullYear(), month: d.getMonth() }
}

/** 달을 더하거나 뺀다. */
export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const d = new Date(year, month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export function sameMonth(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month
}

/**
 * 그 달에 운동을 끝낸 날과 그날의 운동 id(시작한 순서대로). 키는 날짜(1~31).
 * 운동은 시작한 날로 센다.
 */
export function workoutDaysInMonth(workouts: WorkoutLike[], { year, month }: YearMonth): Map<number, string[]> {
  const from = new Date(year, month, 1).getTime()
  const to = new Date(year, month + 1, 1).getTime()
  const inMonth = workouts
    .filter((w) => w.endedAt !== null && w.startedAt >= from && w.startedAt < to)
    .sort((a, b) => a.startedAt - b.startedAt)
  const days = new Map<number, string[]>()
  for (const w of inMonth) {
    const day = new Date(w.startedAt).getDate()
    const list = days.get(day)
    if (list) list.push(w.id)
    else days.set(day, [w.id])
  }
  return days
}

/** 그 달에 끝낸 운동 횟수 */
export function countInMonth(workouts: WorkoutLike[], ym: YearMonth): number {
  let n = 0
  for (const ids of workoutDaysInMonth(workouts, ym).values()) n += ids.length
  return n
}

/** 월요일부터 시작하는 달력 칸. 한 줄이 한 주이고, 그 달이 아닌 칸은 null. */
export function monthGrid({ year, month }: YearMonth): (number | null)[][] {
  const first = new Date(year, month, 1)
  const lead = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

// ───────── 종목별 추이

/** 종목 기록 한 번의 요약 값 */
export interface SessionPoint {
  workoutId: string
  /** 운동을 시작한 시각 */
  at: number
  /** 가장 무거운 본 세트. 무게를 단 세트가 없으면 null */
  topWeight: number | null
  /** 가장 높은 추정 1RM(12회 이하 세트). 없으면 null */
  bestE1rm: number | null
  /** 볼륨(본 세트의 중량×횟수 합) */
  volume: number
  /** 맨몸 세트의 가장 많은 횟수. 없으면 null */
  maxReps: number | null
  /** 시간 세트의 가장 오래 버틴 시간(초). 없으면 null */
  maxDuration: number | null
  /** 시간 세트의 시간 합(초). 시간 세트가 없으면 0 */
  totalDuration: number
  /** 유산소 세트의 거리 합(km). 없으면 0 */
  totalDistance: number
  /** 유산소 세트의 층수 합. 없으면 0 */
  totalFloors: number
  /** 완료한 본 세트, 순서대로 */
  sets: SetEntry[]
}

/** 종목의 기록마다 요약 값을 오래된 것부터 돌려준다. */
export function exerciseSeries(sessions: ExerciseSession[]): SessionPoint[] {
  return [...sessions]
    .sort((a, b) => a.workout.startedAt - b.workout.startedAt)
    .map((s) => {
      const { topWeight, bestE1rm, volume, maxReps, maxDuration, totalDuration, totalDistance, totalFloors } =
        summarizeSession(s.sets)
      return {
        workoutId: s.workout.id,
        at: s.workout.startedAt,
        topWeight,
        bestE1rm,
        volume,
        maxReps,
        maxDuration,
        totalDuration,
        totalDistance,
        totalFloors,
        sets: workingSets(s.sets),
      }
    })
}

/** 추이 그래프로 볼 수 있는 값 */
export type ProgressMetric =
  | 'bestE1rm'
  | 'topWeight'
  | 'volume'
  | 'maxReps'
  | 'maxDuration'
  | 'totalDuration'
  | 'totalDistance'
  | 'totalFloors'

export const METRIC_LABELS: Record<ProgressMetric, string> = {
  bestE1rm: '추정 1RM',
  topWeight: '최고 중량',
  volume: '볼륨',
  maxReps: '횟수',
  maxDuration: '최장 시간',
  totalDuration: '총 시간',
  totalDistance: '거리',
  totalFloors: '층수',
}

const METRIC_ORDER: ProgressMetric[] = [
  'bestE1rm',
  'topWeight',
  'volume',
  'maxReps',
  'maxDuration',
  'totalDuration',
  'totalDistance',
  'totalFloors',
]

/**
 * 이 종목에서 볼 값과 순서.
 * 시간 종목은 최장 시간과 총 시간, 맨몸 종목은 횟수와 추가 무게를 본다
 * (체중을 모르니 추가 무게만으로 낸 추정 1RM과 볼륨은 그리지 않는다). 종목을 모르면 세트에 있는 대로 모두 본다.
 * 유산소 종목은 그날 운동한 시간과, 함께 적는 값에 따라 그날의 거리나 층수를 본다.
 */
function metricsFor(exercise: RecordExercise): ProgressMetric[] {
  if (isCardio(exercise)) {
    const metric = cardioMetricOf(exercise)
    return metric === 'distance'
      ? ['totalDuration', 'totalDistance']
      : metric === 'floors'
        ? ['totalDuration', 'totalFloors']
        : ['totalDuration']
  }
  if (isTimed(exercise)) return ['maxDuration', 'totalDuration']
  if (usesAddedWeight(exercise)) return ['maxReps', 'topWeight']
  return exercise ? ['bestE1rm', 'topWeight', 'volume', 'maxReps'] : METRIC_ORDER
}

/** 그래프로 볼 값의 이름. 맨몸 종목의 최고 중량은 "추가 무게", 유산소 종목의 총 시간은 "시간" */
export function metricLabel(metric: ProgressMetric, exercise?: RecordExercise): string {
  if (metric === 'topWeight' && usesAddedWeight(exercise)) return '추가 무게'
  if (metric === 'totalDuration' && isCardio(exercise)) return '시간'
  return METRIC_LABELS[metric]
}

/** 그 기록에서의 값. 그 기록에 해당하는 세트가 없으면 null(볼륨과 총 시간, 거리, 층수는 0도 null). */
export function metricValue(p: SessionPoint, metric: ProgressMetric): number | null {
  if (metric === 'volume' || metric === 'totalDuration' || metric === 'totalDistance' || metric === 'totalFloors') {
    return p[metric] > 0 ? p[metric] : null
  }
  return p[metric]
}

/**
 * 기록이 하나라도 있는 값들. 무게를 단 종목은 추정 1RM, 최고 중량, 볼륨, 맨몸 종목은 횟수와 추가 무게,
 * 시간 종목은 최장 시간과 총 시간, 유산소 종목은 시간과 거리나 층수.
 */
export function availableMetrics(points: SessionPoint[], exercise?: RecordExercise): ProgressMetric[] {
  return metricsFor(exercise).filter((m) => points.some((p) => metricValue(p, m) !== null))
}

/**
 * 값을 단위와 함께. "80.5kg"(추정 1RM은 소수 첫째 자리), "1,530kg", "12회", "90초", 맨몸 종목의 추가 무게는 "+10kg".
 * 유산소 종목은 "30분", "5.2km", "120층"
 */
export function formatMetric(metric: ProgressMetric, value: number, exercise?: RecordExercise): string {
  if (metric === 'maxReps') return `${Math.round(value)}회`
  if (metric === 'maxDuration' || metric === 'totalDuration') {
    return isCardio(exercise) ? formatCardioTime(value) : formatSeconds(value)
  }
  if (metric === 'totalDistance') return formatDistance(value)
  if (metric === 'totalFloors') return formatFloors(value)
  if (metric === 'volume') return `${Math.round(value).toLocaleString('ko-KR')}kg`
  if (metric === 'bestE1rm') return `${formatKg(Math.round(value * 10) / 10)}kg`
  return formatWeight(value, usesAddedWeight(exercise))
}

/**
 * 본 세트를 짧게. "60×8 · 62.5×6". 같은 세트가 이어지면 묶어서 "60×8×3"(60kg 8회 3세트).
 * 맨몸 세트는 "12회", 시간 세트는 "60초", 맨몸 종목(opts.addedWeight)의 추가 무게는 "+10×8".
 * 유산소 종목(opts.cardio)은 "30분 120층". 웜업과 완료하지 않은 세트는 뺀다.
 */
export function formatSetsSummary(
  sets: Pick<SetEntry, 'weightKg' | 'reps' | 'isWarmup' | 'isDone' | 'durationSec' | 'distanceKm' | 'floors'>[],
  opts: SetTextOptions = {},
): string {
  const groups: { text: string; count: number }[] = []
  for (const s of workingSets(sets)) {
    const text = formatSetShort(s, opts)
    const last = groups.at(-1)
    if (last && last.text === text) last.count++
    else groups.push({ text, count: 1 })
  }
  return groups.map((g) => (g.count > 1 ? `${g.text}×${g.count}` : g.text)).join(' · ')
}

// ───────── 종목 목록

export interface ExerciseOverview {
  exerciseId: string
  /** 마지막으로 한 운동의 시작 시각 */
  lastAt: number
  /** 끝낸 기록 수 */
  sessionCount: number
  /** 가장 높은 추정 1RM. 없으면 null */
  bestE1rm: number | null
  /** 가장 무거운 본 세트. 없으면 null(13회 이상만 한 종목은 1RM이 없어 이 값을 쓴다) */
  maxWeight: number | null
  /** 맨몸 세트의 가장 많은 횟수. 없으면 null */
  maxReps: number | null
  /** 시간 세트의 가장 오래 버틴 시간(초). 유산소는 한 세트의 가장 긴 운동 시간. 없으면 null */
  maxDuration: number | null
}

/**
 * 기록이 있는 종목들. 최근에 한 것부터.
 * exercises를 주면 종목마다 그 종목에서 세는 기록만 담는다(맨몸 종목은 추정 1RM 없이 추가 무게와 횟수).
 */
export function exerciseOverviews(
  sessionsByExercise: Map<string, ExerciseSession[]>,
  exercises?: Map<string, Pick<Exercise, 'equipment' | 'measure' | 'cardioMetric'>>,
): ExerciseOverview[] {
  const result: ExerciseOverview[] = []
  for (const [exerciseId, sessions] of sessionsByExercise) {
    if (sessions.length === 0) continue
    const records = computeRecords(sessions, exercises?.get(exerciseId))
    result.push({
      exerciseId,
      lastAt: Math.max(...sessions.map((s) => s.workout.startedAt)),
      sessionCount: sessions.length,
      bestE1rm: records.bestE1rm?.value ?? null,
      maxWeight: records.maxWeight?.value ?? null,
      maxReps: records.maxReps?.value ?? null,
      maxDuration: records.maxDuration?.value ?? null,
    })
  }
  return result.sort((a, b) => b.lastAt - a.lastAt)
}
