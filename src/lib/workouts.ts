import { db, type Exercise, type SetEntry, type Workout, type WorkoutExercise } from '../db'
import { startOfWeek, toDateKey } from './format'
import { newId } from './id'
import { isSetEntered, isTimed, setSeconds } from './measure'

/** 지난 기록이 없는 종목을 추가할 때 만드는 빈 세트 수 */
export const DEFAULT_SET_COUNT = 3

/** 고를 수 있는 힘든 정도(RPE). 6부터 10까지 0.5 단위. */
export const RPE_VALUES: readonly number[] = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]

/** 저장해도 되는 RPE 값인지 */
export function isValidRpe(value: unknown): value is number {
  return typeof value === 'number' && RPE_VALUES.includes(value)
}

export interface WorkoutItem {
  we: WorkoutExercise
  /** 종목이 지워졌으면 undefined */
  exercise: Exercise | undefined
  sets: SetEntry[]
  /** 이 종목을 마지막으로 했을 때의 완료 세트(요청했을 때만 채운다) */
  lastSets: SetEntry[]
}

export interface WorkoutDetail {
  workout: Workout
  items: WorkoutItem[]
}

export interface WorkoutSummary {
  workout: Workout
  exerciseNames: string[]
  setCount: number
  volume: number
}

/**
 * 볼륨(중량×횟수). 완료한 본 세트만 센다.
 * 맨몸 종목은 추가 무게×횟수만 들어가고(체중은 모른다), 시간 세트는 횟수가 없어 0이다.
 */
export function setVolume(s: Pick<SetEntry, 'weightKg' | 'reps' | 'isWarmup' | 'isDone'>): number {
  if (!s.isDone || s.isWarmup) return 0
  return (s.weightKg ?? 0) * (s.reps ?? 0)
}

export function totalVolume(sets: Pick<SetEntry, 'weightKg' | 'reps' | 'isWarmup' | 'isDone'>[]): number {
  return sets.reduce((sum, s) => sum + setVolume(s), 0)
}

/** 진행 중인 운동(가장 최근 것). 없으면 undefined. */
export async function getActiveWorkout(): Promise<Workout | undefined> {
  const active = await db.workouts.filter((w) => w.endedAt === null).toArray()
  return active.sort((a, b) => b.startedAt - a.startedAt)[0]
}

/** 운동을 시작한다. 이미 진행 중인 운동이 있으면 그 운동의 id를 돌려준다. */
export async function startWorkout(now: number = Date.now()): Promise<string> {
  return db.transaction('rw', db.workouts, async () => {
    const active = await getActiveWorkout()
    if (active) return active.id
    const id = newId()
    await db.workouts.add({ id, date: toDateKey(now), startedAt: now, endedAt: null, memo: '' })
    return id
  })
}

/**
 * 이 종목을 마지막으로 한(끝난) 운동의 완료 세트를 순서대로 돌려준다.
 * 지난 기록이 없으면 빈 배열.
 */
export async function getLastSets(exerciseId: string, excludeWorkoutId?: string): Promise<SetEntry[]> {
  const wes = await db.workoutExercises.where('exerciseId').equals(exerciseId).toArray()
  if (wes.length === 0) return []

  const workouts = await db.workouts.bulkGet(wes.map((we) => we.workoutId))
  const candidates: { we: WorkoutExercise; startedAt: number }[] = []
  wes.forEach((we, i) => {
    const w = workouts[i]
    if (w && w.endedAt !== null && w.id !== excludeWorkoutId) candidates.push({ we, startedAt: w.startedAt })
  })
  candidates.sort((a, b) => b.startedAt - a.startedAt)

  for (const c of candidates) {
    const sets = await db.sets.where('workoutExerciseId').equals(c.we.id).sortBy('order')
    const done = sets.filter((s) => s.isDone)
    if (done.length > 0) return done
  }
  return []
}

export interface PrefillOptions {
  /**
   * 본 세트 수. 주면 지난 기록의 웜업 세트는 그대로 두고 본 세트를 이 개수에 맞춘다
   * (모자라면 마지막 본 세트 값을 되풀이하고, 남으면 뒤를 버린다). 루틴으로 시작할 때 쓴다.
   */
  setCount?: number
  /** 이 운동에서의 목표 횟수(WorkoutExercise.targetReps). 시간 종목이면 목표 시간(초) */
  targetReps?: number | null
}

type SetTemplate = Pick<SetEntry, 'weightKg' | 'reps' | 'isWarmup' | 'durationSec'>

const EMPTY_SET: SetTemplate = { weightKg: null, reps: null, isWarmup: false }

/**
 * 지난 세트로 새 세트의 틀을 만든다.
 * 무게, 횟수(시간 세트면 시간), 웜업 여부만 따라간다. RPE는 그날 그 세트가 어땠는지를 적은 값이라 가져오지 않는다.
 * timed: 시간 종목인지. 지난 기록이 없을 때 목표 값을 횟수와 시간 중 어디에 채울지 정한다.
 */
export function prefillTemplate(
  last: SetEntry[],
  setCount?: number,
  targetReps?: number | null,
  timed = false,
): SetTemplate[] {
  const toTemplate = (s: SetEntry): SetTemplate => {
    const seconds = setSeconds(s)
    // 횟수 세트에는 durationSec 칸을 만들지 않는다(시간 종목이 생기기 전의 세트와 같은 모양으로 둔다).
    return seconds > 0
      ? { weightKg: s.weightKg, reps: null, durationSec: seconds, isWarmup: s.isWarmup }
      : { weightKg: s.weightKg, reps: s.reps, isWarmup: s.isWarmup }
  }
  // 지난 기록이 없을 때 빈 세트. 루틴에 목표 횟수(시간 종목은 목표 시간)가 있으면 그 값만 미리 채운다.
  const empty: SetTemplate = timed
    ? { ...EMPTY_SET, durationSec: targetReps ?? null }
    : { ...EMPTY_SET, reps: targetReps ?? null }
  if (setCount === undefined) {
    return last.length > 0 ? last.map(toTemplate) : Array.from({ length: DEFAULT_SET_COUNT }, () => ({ ...empty }))
  }
  const warmups = last.filter((s) => s.isWarmup).map(toTemplate)
  const working = last.filter((s) => !s.isWarmup).map(toTemplate)
  const count = Math.max(1, Math.round(setCount))
  const main = Array.from({ length: count }, (_, i) => ({ ...(working[i] ?? working.at(-1) ?? empty) }))
  return [...warmups, ...main]
}

/**
 * 운동에 종목 하나를 넣고 세트를 지난번 값으로 미리 채운다. 넣은 WorkoutExercise의 id를 돌려준다.
 * 트랜잭션 안에서 불러야 한다(workoutExercises, sets, workouts, exercises 테이블).
 */
export async function addExerciseWithPrefill(
  workoutId: string,
  exerciseId: string,
  order: number,
  opts: PrefillOptions = {},
): Promise<string> {
  const weId = newId()
  const we: WorkoutExercise = { id: weId, workoutId, exerciseId, order, memo: '' }
  if (opts.targetReps !== undefined) we.targetReps = opts.targetReps
  await db.workoutExercises.add(we)

  const last = await getLastSets(exerciseId, workoutId)
  const timed = isTimed(await db.exercises.get(exerciseId))
  const template = prefillTemplate(last, opts.setCount, opts.targetReps, timed)
  await db.sets.bulkAdd(
    template.map((t, i) => ({ id: newId(), workoutExerciseId: weId, order: i, ...t, isDone: false })),
  )
  return weId
}

/**
 * 운동에 종목을 추가한다. 세트는 지난번에 한 값으로 미리 채운다.
 * 이미 들어 있는 종목은 건너뛴다.
 */
export async function addExercisesToWorkout(workoutId: string, exerciseIds: string[]): Promise<void> {
  await db.transaction('rw', db.workouts, db.workoutExercises, db.sets, db.exercises, async () => {
    const existing = await db.workoutExercises.where('workoutId').equals(workoutId).toArray()
    const have = new Set(existing.map((we) => we.exerciseId))
    let order = existing.reduce((max, we) => Math.max(max, we.order), -1) + 1
    for (const exerciseId of exerciseIds) {
      if (have.has(exerciseId)) continue
      have.add(exerciseId)
      await addExerciseWithPrefill(workoutId, exerciseId, order++)
    }
  })
}

/** 운동에서 종목과 그 세트를 뺀다. */
export async function removeWorkoutExercise(workoutExerciseId: string): Promise<void> {
  await db.transaction('rw', db.workoutExercises, db.sets, async () => {
    await db.sets.where('workoutExerciseId').equals(workoutExerciseId).delete()
    await db.workoutExercises.delete(workoutExerciseId)
  })
}

/**
 * 운동 안에서 종목을 한 칸 위(-1)나 아래(1)로 옮긴다. 순서 값은 0부터 빈틈없이 다시 매긴다.
 * 맨 위에서 위로, 맨 아래에서 아래로는 아무것도 바꾸지 않고 false를 돌려준다.
 */
export async function moveWorkoutExercise(workoutExerciseId: string, direction: -1 | 1): Promise<boolean> {
  return db.transaction('rw', db.workoutExercises, async () => {
    const we = await db.workoutExercises.get(workoutExerciseId)
    if (!we) return false
    const list = await db.workoutExercises.where('workoutId').equals(we.workoutId).sortBy('order')
    const from = list.findIndex((x) => x.id === workoutExerciseId)
    const to = from + direction
    if (from < 0 || to < 0 || to >= list.length) return false

    const [moved] = list.splice(from, 1)
    list.splice(to, 0, moved)
    const changed = list.flatMap((x, i) => (x.order === i ? [] : [{ key: x.id, changes: { order: i } }]))
    await db.workoutExercises.bulkUpdate(changed)
    return true
  })
}

/** 세트를 하나 더한다. 무게와 횟수(시간 세트면 시간)는 바로 앞 세트를 따라간다(RPE는 따라가지 않는다). */
export async function addSet(workoutExerciseId: string, opts: { done?: boolean } = {}): Promise<void> {
  await db.transaction('rw', db.sets, async () => {
    const sets = await db.sets.where('workoutExerciseId').equals(workoutExerciseId).sortBy('order')
    const last = sets.at(-1)
    const set: SetEntry = {
      id: newId(),
      workoutExerciseId,
      order: last ? last.order + 1 : 0,
      weightKg: last?.weightKg ?? null,
      reps: last?.reps ?? null,
      isWarmup: false,
      isDone: opts.done ?? false,
    }
    if (last && setSeconds(last) > 0) set.durationSec = setSeconds(last)
    await db.sets.add(set)
  })
}

/** 세트 하나를 지우고, 남은 세트의 순서를 0부터 빈틈없이 다시 매긴다. 어느 세트든 지울 수 있다. */
export async function removeSet(setId: string): Promise<void> {
  await db.transaction('rw', db.sets, async () => {
    const set = await db.sets.get(setId)
    if (!set) return
    await db.sets.delete(setId)
    const rest = await db.sets.where('workoutExerciseId').equals(set.workoutExerciseId).sortBy('order')
    const changed = rest.flatMap((s, i) => (s.order === i ? [] : [{ key: s.id, changes: { order: i } }]))
    await db.sets.bulkUpdate(changed)
  })
}

/** 세트 값을 고친다. RPE는 6~10의 0.5 단위만 받고, 그 밖의 값은 "적지 않음"(null)으로 저장한다. */
export async function updateSet(
  id: string,
  patch: Partial<Pick<SetEntry, 'weightKg' | 'reps' | 'durationSec' | 'isWarmup' | 'isDone' | 'rpe'>>,
): Promise<void> {
  const invalidRpe = patch.rpe !== undefined && patch.rpe !== null && !isValidRpe(patch.rpe)
  await db.sets.update(id, invalidRpe ? { ...patch, rpe: null } : patch)
}

/**
 * 세트를 완료로 표시한다. 저장된 횟수(시간 세트면 시간)가 없으면 표시하지 않고 false를 돌려준다.
 * 화면에 그려진 값이 아니라 저장된 값으로 판단하므로, 방금 입력한 횟수가 화면에 돌아오기 전에 불러도 맞게 동작한다.
 */
export async function completeSet(id: string): Promise<boolean> {
  return db.transaction('rw', db.sets, async () => {
    const set = await db.sets.get(id)
    if (!set || !isSetEntered(set)) return false
    if (!set.isDone) await db.sets.update(id, { isDone: true })
    return true
  })
}

export async function updateWorkoutMemo(workoutId: string, memo: string): Promise<void> {
  await db.workouts.update(workoutId, { memo })
}

async function setsOfWorkout(workoutId: string): Promise<{ wes: WorkoutExercise[]; sets: SetEntry[] }> {
  const wes = await db.workoutExercises.where('workoutId').equals(workoutId).toArray()
  const sets =
    wes.length === 0
      ? []
      : await db.sets
          .where('workoutExerciseId')
          .anyOf(wes.map((we) => we.id))
          .toArray()
  return { wes, sets }
}

/** 횟수나 시간을 적었지만 완료 체크를 하지 않은 세트를 모두 완료로 바꾼다. 바꾼 개수를 돌려준다. */
export async function markEnteredSetsDone(workoutId: string): Promise<number> {
  return db.transaction('rw', db.workoutExercises, db.sets, async () => {
    const { sets } = await setsOfWorkout(workoutId)
    const targets = sets.filter((s) => !s.isDone && isSetEntered(s))
    await db.sets.bulkUpdate(targets.map((s) => ({ key: s.id, changes: { isDone: true } })))
    return targets.length
  })
}

/**
 * 운동을 마친다. 완료하지 않은 세트와, 완료 세트가 하나도 없는 종목은 기록에서 뺀다.
 * 완료한 세트가 하나도 없으면 아무것도 바꾸지 않고 false를 돌려준다.
 */
export async function finishWorkout(
  workoutId: string,
  opts: { memo?: string; endedAt?: number } = {},
): Promise<boolean> {
  return db.transaction('rw', db.workouts, db.workoutExercises, db.sets, async () => {
    const { wes, sets } = await setsOfWorkout(workoutId)
    const done = sets.filter((s) => s.isDone)
    if (done.length === 0) return false

    const keptWe = new Set(done.map((s) => s.workoutExerciseId))
    await db.sets.bulkDelete(sets.filter((s) => !s.isDone).map((s) => s.id))
    await db.workoutExercises.bulkDelete(wes.filter((we) => !keptWe.has(we.id)).map((we) => we.id))

    const changes: Partial<Workout> = { endedAt: opts.endedAt ?? Date.now() }
    if (opts.memo !== undefined) changes.memo = opts.memo.trim()
    await db.workouts.update(workoutId, changes)
    return true
  })
}

/** 운동과 그 안의 종목, 세트를 모두 지운다. */
export async function deleteWorkout(workoutId: string): Promise<void> {
  await db.transaction('rw', [db.workouts, db.workoutExercises, db.sets, db.aiAdvice], async () => {
    const { wes, sets } = await setsOfWorkout(workoutId)
    await db.sets.bulkDelete(sets.map((s) => s.id))
    await db.workoutExercises.bulkDelete(wes.map((we) => we.id))
    await db.workouts.delete(workoutId)
    await db.aiAdvice.where('workoutId').equals(workoutId).delete()
  })
}

/**
 * 지난 운동과 같은 종목으로 새 운동을 시작한다.
 * 진행 중인 운동이 있으면 새로 만들지 않고 그 운동을 돌려준다.
 */
export async function repeatWorkout(
  sourceWorkoutId: string,
  now: number = Date.now(),
): Promise<{ id: string; created: boolean }> {
  return db.transaction('rw', db.workouts, db.workoutExercises, db.sets, db.exercises, async () => {
    const active = await getActiveWorkout()
    if (active) return { id: active.id, created: false }

    const id = newId()
    await db.workouts.add({ id, date: toDateKey(now), startedAt: now, endedAt: null, memo: '' })
    const source = await db.workoutExercises.where('workoutId').equals(sourceWorkoutId).sortBy('order')
    let order = 0
    for (const we of source) {
      // 목표 횟수(루틴에서 온 값)도 그대로 따라간다.
      const opts: PrefillOptions = we.targetReps === undefined ? {} : { targetReps: we.targetReps }
      await addExerciseWithPrefill(id, we.exerciseId, order++, opts)
    }
    return { id, created: true }
  })
}

/** 화면에 그릴 운동 한 건. 없으면 null. */
export async function loadWorkoutDetail(
  workoutId: string,
  opts: { withLastSets?: boolean } = {},
): Promise<WorkoutDetail | null> {
  const workout = await db.workouts.get(workoutId)
  if (!workout) return null

  const wes = await db.workoutExercises.where('workoutId').equals(workoutId).sortBy('order')
  const exercises = await db.exercises.bulkGet(wes.map((we) => we.exerciseId))
  const items: WorkoutItem[] = []
  for (const [i, we] of wes.entries()) {
    const sets = await db.sets.where('workoutExerciseId').equals(we.id).sortBy('order')
    const lastSets = opts.withLastSets ? await getLastSets(we.exerciseId, workoutId) : []
    items.push({ we, exercise: exercises[i], sets, lastSets })
  }
  return { workout, items }
}

/** 끝난 운동 목록(최근 것부터)과 요약 값. */
export async function loadWorkoutSummaries(): Promise<WorkoutSummary[]> {
  const workouts = (await db.workouts.orderBy('startedAt').reverse().toArray()).filter((w) => w.endedAt !== null)
  if (workouts.length === 0) return []

  const wes = await db.workoutExercises.toArray()
  const sets = await db.sets.toArray()
  const exercises = await db.exercises.toArray()
  const nameOf = new Map(exercises.map((e) => [e.id, e.name]))

  const setsByWe = new Map<string, SetEntry[]>()
  for (const s of sets) {
    const list = setsByWe.get(s.workoutExerciseId)
    if (list) list.push(s)
    else setsByWe.set(s.workoutExerciseId, [s])
  }
  const wesByWorkout = new Map<string, WorkoutExercise[]>()
  for (const we of wes) {
    const list = wesByWorkout.get(we.workoutId)
    if (list) list.push(we)
    else wesByWorkout.set(we.workoutId, [we])
  }

  return workouts.map((workout) => {
    const own = (wesByWorkout.get(workout.id) ?? []).sort((a, b) => a.order - b.order)
    const ownSets = own.flatMap((we) => setsByWe.get(we.id) ?? [])
    return {
      workout,
      exerciseNames: own.map((we) => nameOf.get(we.exerciseId) ?? '지워진 종목'),
      setCount: ownSets.filter((s) => s.isDone).length,
      volume: totalVolume(ownSets),
    }
  })
}

/** 이번 주(월~일)에 운동한 날. 월요일이 0. */
export function daysWorkedThisWeek(workouts: Pick<Workout, 'startedAt' | 'endedAt'>[], now: number = Date.now()): boolean[] {
  const start = startOfWeek(now).getTime()
  const days = Array.from({ length: 7 }, () => false)
  for (const w of workouts) {
    if (w.endedAt === null || w.startedAt < start) continue
    const index = (new Date(w.startedAt).getDay() + 6) % 7
    if (startOfWeek(w.startedAt).getTime() === start) days[index] = true
  }
  return days
}

/** 이번 주(월~일)에 끝낸 운동 횟수. */
export function countThisWeek(workouts: Pick<Workout, 'startedAt' | 'endedAt'>[], now: number = Date.now()): number {
  const start = startOfWeek(now).getTime()
  return workouts.filter((w) => w.endedAt !== null && startOfWeek(w.startedAt).getTime() === start).length
}
