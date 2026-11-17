import { db, type Exercise, type SetEntry, type Workout, type WorkoutExercise } from '../db'
import { formatKg, formatVolume } from './format'
import {
  cardioMetricOf,
  formatCardioTime,
  formatDistance,
  formatFloors,
  formatSeconds,
  formatWeight,
  isCardio,
  isTimed,
  setDistance,
  setFloors,
  setSeconds,
  usesAddedWeight,
  usesAssist,
} from './measure'

/**
 * 종목별 지난 기록을 꺼내고, 추정 1RM과 개인 기록(PR)을 계산한다. (2단계)
 * 통계와 PR은 저장하지 않고 세트 데이터에서 그때그때 계산한다.
 */

/** 끝난 운동 하나에서 한 종목을 한 기록 */
export interface ExerciseSession {
  workout: Workout
  we: WorkoutExercise
  /** 완료한 세트(웜업 포함), 순서대로. 비어 있지 않다. */
  sets: SetEntry[]
}

type SetLike = Pick<SetEntry, 'weightKg' | 'reps' | 'isWarmup' | 'isDone' | 'durationSec' | 'distanceKm' | 'floors'>

/** 추정 1RM을 계산할 때 믿을 만한 최대 횟수. 이보다 많이 한 세트는 1RM 계산에서 뺀다. */
export const E1RM_MAX_REPS = 12

/** 추정 1RM(Epley 공식: 중량 × (1 + 횟수/30)). 1회면 그 중량. 계산할 수 없으면 0. */
export function estimate1RM(weightKg: number, reps: number): number {
  if (!(weightKg > 0) || !(reps > 0)) return 0
  if (reps === 1) return weightKg
  return weightKg * (1 + reps / 30)
}

/** 완료한 본 세트(웜업 제외) */
export function workingSets<T extends SetLike>(sets: T[]): T[] {
  return sets.filter((s) => s.isDone && !s.isWarmup)
}

/** 무게를 단 세트인지(맨몸 운동이 아닌지) */
export function isWeighted(s: Pick<SetEntry, 'weightKg'>): boolean {
  return (s.weightKg ?? 0) > 0
}

export interface SessionSummary {
  /** 가장 무거운 본 세트의 중량. 무게를 단 세트가 없으면 null */
  topWeight: number | null
  /** 본 세트 중 가장 높은 추정 1RM. 없으면 null */
  bestE1rm: number | null
  /** 볼륨(본 세트의 중량×횟수 합) */
  volume: number
  /** 맨몸 세트 중 가장 많은 횟수. 맨몸 세트가 없으면 null */
  maxReps: number | null
  /** 시간 세트 중 가장 오래 버틴 시간(초). 시간 세트가 없으면 null */
  maxDuration: number | null
  /** 시간 세트의 시간 합(초). 시간 세트가 없으면 0 */
  totalDuration: number
  /** 유산소 세트의 거리 합(km). 없으면 0 */
  totalDistance: number
  /** 유산소 세트의 층수 합. 없으면 0 */
  totalFloors: number
  /** 본 세트 수 */
  workingSetCount: number
}

/**
 * 한 번의 기록을 요약한다. 완료한 본 세트만 본다. 시간 세트는 시간만 세고 볼륨과 추정 1RM에는 넣지 않는다.
 * 유산소 세트도 시간 세트라서 시간과 거리, 층수만 더한다.
 */
export function summarizeSession(sets: SetLike[], assist = false): SessionSummary {
  const working = workingSets(sets)
  let topWeight: number | null = null
  let bestE1rm: number | null = null
  let maxReps: number | null = null
  let maxDuration: number | null = null
  let totalDuration = 0
  let totalDistance = 0
  let totalFloors = 0
  let volume = 0
  for (const s of working) {
    const seconds = setSeconds(s)
    if (seconds > 0) {
      totalDuration += seconds
      totalDistance += setDistance(s)
      totalFloors += setFloors(s)
      if (maxDuration === null || seconds > maxDuration) maxDuration = seconds
      continue
    }
    const reps = s.reps ?? 0
    if (reps <= 0) continue
    // 보조 머신의 무게는 덜어 준 무게라 볼륨과 1RM에 넣지 않고 횟수만 센다.
    if (isWeighted(s) && !assist) {
      const w = s.weightKg as number
      volume += w * reps
      if (topWeight === null || w > topWeight) topWeight = w
      if (reps <= E1RM_MAX_REPS) {
        const e = estimate1RM(w, reps)
        if (bestE1rm === null || e > bestE1rm) bestE1rm = e
      }
    } else if (maxReps === null || reps > maxReps) {
      maxReps = reps
    }
  }
  return {
    topWeight,
    bestE1rm,
    volume,
    maxReps,
    maxDuration,
    totalDuration,
    // 0.1 + 0.2 같은 소수 오차가 화면에 보이지 않게 맞춘다.
    totalDistance: Math.round(totalDistance * 100) / 100,
    totalFloors,
    workingSetCount: working.length,
  }
}

/**
 * 한 종목의 끝난 기록을 오래된 것부터 돌려준다. 완료한 세트가 없는 기록은 뺀다.
 * excludeWorkoutId: 이 운동은 빼고 본다. before: 이 시각보다 먼저 시작한 운동만 본다.
 */
export async function getExerciseSessions(
  exerciseId: string,
  opts: { excludeWorkoutId?: string; before?: number } = {},
): Promise<ExerciseSession[]> {
  const wes = await db.workoutExercises.where('exerciseId').equals(exerciseId).toArray()
  if (wes.length === 0) return []
  const workouts = await db.workouts.bulkGet(wes.map((we) => we.workoutId))
  const sets = await db.sets
    .where('workoutExerciseId')
    .anyOf(wes.map((we) => we.id))
    .toArray()
  return buildSessions(wes, workouts, sets, opts)
}

/** 모든 종목의 끝난 기록을 종목 id별로, 각각 오래된 것부터 돌려준다. 통계 화면처럼 한꺼번에 볼 때 쓴다. */
export async function getAllExerciseSessions(): Promise<Map<string, ExerciseSession[]>> {
  const [wes, workouts, sets] = await Promise.all([
    db.workoutExercises.toArray(),
    db.workouts.toArray(),
    db.sets.toArray(),
  ])
  const byId = new Map(workouts.map((w) => [w.id, w]))
  const sessions = buildSessions(
    wes,
    wes.map((we) => byId.get(we.workoutId)),
    sets,
    {},
  )
  const result = new Map<string, ExerciseSession[]>()
  for (const s of sessions) {
    const list = result.get(s.we.exerciseId)
    if (list) list.push(s)
    else result.set(s.we.exerciseId, [s])
  }
  return result
}

function buildSessions(
  wes: WorkoutExercise[],
  workouts: (Workout | undefined)[],
  sets: SetEntry[],
  opts: { excludeWorkoutId?: string; before?: number },
): ExerciseSession[] {
  const setsByWe = new Map<string, SetEntry[]>()
  for (const s of sets) {
    if (!s.isDone) continue
    const list = setsByWe.get(s.workoutExerciseId)
    if (list) list.push(s)
    else setsByWe.set(s.workoutExerciseId, [s])
  }
  const result: ExerciseSession[] = []
  wes.forEach((we, i) => {
    const workout = workouts[i]
    if (!workout || workout.endedAt === null) return
    if (opts.excludeWorkoutId !== undefined && workout.id === opts.excludeWorkoutId) return
    if (opts.before !== undefined && workout.startedAt >= opts.before) return
    const done = setsByWe.get(we.id)
    if (!done || done.length === 0) return
    result.push({ workout, we, sets: [...done].sort((a, b) => a.order - b.order) })
  })
  return result.sort((a, b) => a.workout.startedAt - b.workout.startedAt)
}

/**
 * 개인 기록의 종류.
 * maxWeight: 가장 무거운 본 세트, bestE1rm: 가장 높은 추정 1RM(12회 이하 세트),
 * maxReps: 맨몸 세트의 가장 많은 횟수, sessionVolume: 한 번의 운동에서 이 종목의 가장 큰 볼륨,
 * maxDuration: 시간 세트의 가장 오래 버틴 시간(유산소는 한 세트의 가장 긴 운동 시간),
 * maxDistance: 유산소 한 세트의 가장 긴 거리, maxFloors: 유산소 한 세트의 가장 많은 층수.
 */
export type RecordKind =
  | 'maxWeight'
  | 'bestE1rm'
  | 'maxReps'
  | 'sessionVolume'
  | 'maxDuration'
  | 'maxDistance'
  | 'maxFloors'

export const RECORD_LABELS: Record<RecordKind, string> = {
  maxWeight: '최고 중량',
  bestE1rm: '추정 1RM',
  maxReps: '최다 횟수',
  sessionVolume: '최고 볼륨',
  maxDuration: '최장 시간',
  maxDistance: '최장 거리',
  maxFloors: '최다 층수',
}

/** 기록 종류를 정할 때 보는 종목 정보. 종목을 모르면(지워진 종목) 세트에 있는 대로 모두 센다. */
export type RecordExercise = Pick<Exercise, 'equipment' | 'measure' | 'cardioMetric'> | null | undefined

/**
 * 이 종목에서 세는 기록의 종류.
 * 시간 종목은 최장 시간만, 맨몸 종목은 맨몸 최다 횟수와 최고 추가 무게만 센다
 * (체중을 모르니 추가 무게만으로 낸 추정 1RM과 볼륨은 기록으로 삼지 않는다).
 * 유산소 종목은 최장 시간과, 함께 적는 값에 따라 최장 거리나 최다 층수를 센다(추정 1RM과 볼륨은 없다).
 */
export function recordKindsFor(exercise: RecordExercise): RecordKind[] {
  if (isCardio(exercise)) {
    const metric = cardioMetricOf(exercise)
    return metric === 'distance'
      ? ['maxDuration', 'maxDistance']
      : metric === 'floors'
        ? ['maxDuration', 'maxFloors']
        : ['maxDuration']
  }
  if (isTimed(exercise)) return ['maxDuration']
  if (usesAddedWeight(exercise)) return ['maxWeight', 'maxReps']
  // 보조 머신은 보조 무게가 낮을수록 어려워 무게 기록이 거꾸로 되므로 최다 횟수만 센다.
  if (usesAssist(exercise)) return ['maxReps']
  return ['maxWeight', 'bestE1rm', 'maxReps', 'sessionVolume']
}

/** 기록의 이름. 맨몸 종목의 최고 중량은 "최고 추가 무게" */
export function recordLabel(kind: RecordKind, exercise?: RecordExercise): string {
  return kind === 'maxWeight' && usesAddedWeight(exercise) ? '최고 추가 무게' : RECORD_LABELS[kind]
}

/**
 * 기록 값을 화면에 쓰는 글자로. "105kg", "80.5kg"(추정 1RM은 소수 첫째 자리), "12회", "1,530kg", "90초".
 * 맨몸 종목의 최고 추가 무게는 "+10kg". 유산소는 "30분", "5.2km", "120층"
 */
export function formatRecordValue(kind: RecordKind, value: number, exercise?: RecordExercise): string {
  if (kind === 'maxReps') return `${Math.round(value)}회`
  if (kind === 'maxDuration') return isCardio(exercise) ? formatCardioTime(value) : formatSeconds(value)
  if (kind === 'maxDistance') return formatDistance(value)
  if (kind === 'maxFloors') return formatFloors(value)
  if (kind === 'sessionVolume') return `${formatVolume(value)}kg`
  if (kind === 'bestE1rm') return `${formatKg(Math.round(value * 10) / 10)}kg`
  return formatWeight(value, usesAddedWeight(exercise))
}

export interface RecordEntry {
  kind: RecordKind
  value: number
  workoutId: string
  /** 그 운동을 시작한 시각 */
  at: number
  /** 세트 하나로 정해지는 기록이면 그 세트(최고 볼륨은 없음) */
  set?: SetEntry
}

export type ExerciseRecords = Partial<Record<RecordKind, RecordEntry>>

/** 같은 값으로 볼 차이(소수 계산 오차) */
const EPSILON = 1e-6

/**
 * 기록들에서 종목의 개인 기록을 계산한다. 같은 값이면 먼저 세운 기록을 남긴다.
 * exercise를 주면 그 종목에서 세는 종류(recordKindsFor)만 남긴다.
 */
export function computeRecords(sessions: ExerciseSession[], exercise?: RecordExercise): ExerciseRecords {
  const records: ExerciseRecords = {}
  const kinds = new Set(recordKindsFor(exercise))
  const consider = (kind: RecordKind, value: number, session: ExerciseSession, set?: SetEntry) => {
    // 종목을 모르면 가리지 않는다.
    if (exercise && !kinds.has(kind)) return
    if (!(value > 0)) return
    const cur = records[kind]
    if (cur && value <= cur.value + EPSILON) return
    records[kind] = { kind, value, workoutId: session.workout.id, at: session.workout.startedAt, set }
  }
  const ordered = [...sessions].sort((a, b) => a.workout.startedAt - b.workout.startedAt)
  const assist = usesAssist(exercise)
  for (const session of ordered) {
    let volume = 0
    for (const s of workingSets(session.sets)) {
      const seconds = setSeconds(s)
      if (seconds > 0) {
        consider('maxDuration', seconds, session, s)
        consider('maxDistance', setDistance(s), session, s)
        consider('maxFloors', setFloors(s), session, s)
        continue
      }
      const reps = s.reps ?? 0
      if (reps <= 0) continue
      if (isWeighted(s) && !assist) {
        const w = s.weightKg as number
        volume += w * reps
        consider('maxWeight', w, session, s)
        if (reps <= E1RM_MAX_REPS) consider('bestE1rm', estimate1RM(w, reps), session, s)
      } else {
        consider('maxReps', reps, session, s)
      }
    }
    consider('sessionVolume', volume, session)
  }
  return records
}

export interface NewRecord {
  exerciseId: string
  kind: RecordKind
  value: number
  /** 이전 기록 */
  previous: number
  /** 기록을 세운 세트(최고 볼륨은 없음) */
  setId?: string
}

/**
 * 이 운동에서 새로 세운 개인 기록. 이 운동보다 먼저 시작한 끝난 운동들과 비교한다.
 * 진행 중인 운동에도 쓸 수 있다(완료한 세트만 본다). 처음 하는 종목은 비교할 기록이 없어 새 기록으로 치지 않는다.
 */
export async function findNewRecords(workoutId: string): Promise<NewRecord[]> {
  const workout = await db.workouts.get(workoutId)
  if (!workout) return []
  const wes = await db.workoutExercises.where('workoutId').equals(workoutId).sortBy('order')
  const exercises = await db.exercises.bulkGet(wes.map((we) => we.exerciseId))
  const result: NewRecord[] = []
  for (const [i, we] of wes.entries()) {
    const exercise = exercises[i]
    const sets = (await db.sets.where('workoutExerciseId').equals(we.id).sortBy('order')).filter((s) => s.isDone)
    if (sets.length === 0) continue
    const prior = await getExerciseSessions(we.exerciseId, { excludeWorkoutId: workoutId, before: workout.startedAt })
    if (prior.length === 0) continue
    const before = computeRecords(prior, exercise)
    const mineNow: ExerciseSession = { workout: { ...workout, endedAt: workout.endedAt ?? workout.startedAt }, we, sets }
    const now = computeRecords([mineNow], exercise)
    for (const kind of Object.keys(RECORD_LABELS) as RecordKind[]) {
      const mine = now[kind]
      const old = before[kind]
      if (!mine || !old) continue
      if (mine.value > old.value + EPSILON) {
        result.push({ exerciseId: we.exerciseId, kind, value: mine.value, previous: old.value, setId: mine.set?.id })
      }
    }
  }
  return result
}
