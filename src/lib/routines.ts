import { db, type Exercise, type Routine, type RoutineItem } from '../db'
import { TARGET_REPS_RANGE } from './exercises'
import { toDateKey } from './format'
import { newId } from './id'
import { isCardio, isTimed, setSeconds, TARGET_SECONDS_RANGE } from './measure'
import { DEFAULT_SET_COUNT, addExerciseWithPrefill, getActiveWorkout } from './workouts'

/**
 * 루틴(종목 묶음). "밀기 날", "하체 날"처럼 자주 하는 구성을 저장해 두고 한 번에 운동을 시작한다. (2단계)
 */

/** 루틴 이름의 최대 길이 */
export const ROUTINE_NAME_MAX = 30
/** 목표 세트 수로 받을 수 있는 범위 */
export const ROUTINE_SETS_RANGE = { min: 1, max: 10 } as const
/** 목표 횟수로 받을 수 있는 범위(종목의 목표 횟수와 같다) */
export const ROUTINE_REPS_RANGE = TARGET_REPS_RANGE
/**
 * 시간 종목의 목표 시간으로 받을 수 있는 범위(초).
 * 루틴 종목(RoutineItem)에는 reps 칸 하나뿐이라, 시간 종목이면 그 칸을 목표 시간(초)으로 쓴다(lib/measure.ts).
 */
export const ROUTINE_SECONDS_RANGE = TARGET_SECONDS_RANGE
/** 루틴에 새로 넣는 종목의 기본 세트 수 */
export const ROUTINE_DEFAULT_SETS = DEFAULT_SET_COUNT

/** 지워진 종목을 화면에 보일 때 쓰는 이름 */
export const MISSING_EXERCISE_NAME = '지워진 종목'

export interface RoutineInput {
  name: string
  items: RoutineItem[]
}

/**
 * 입력을 다듬고 확인한다. 이름의 앞뒤 공백을 지우고, 같은 종목이 두 번 있으면 처음 것만 남긴다.
 * 맞지 않는 값이 있으면 이유를 담아 오류를 던진다.
 * timedIds: 시간 종목의 id. 이 종목들의 reps는 목표 시간(초)으로 보고 범위를 확인한다.
 */
export function normalizeRoutineInput(input: RoutineInput, timedIds: ReadonlySet<string> = new Set()): RoutineInput {
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (name === '') throw new Error('루틴 이름을 입력해 주세요.')
  if (name.length > ROUTINE_NAME_MAX) throw new Error(`루틴 이름은 ${ROUTINE_NAME_MAX}자까지 쓸 수 있습니다.`)

  const seen = new Set<string>()
  const items: RoutineItem[] = []
  for (const item of input.items) {
    if (typeof item.exerciseId !== 'string' || item.exerciseId === '') throw new Error('종목이 올바르지 않습니다.')
    if (seen.has(item.exerciseId)) continue
    seen.add(item.exerciseId)
    const { sets, reps } = item
    if (!(Number.isInteger(sets) && sets >= ROUTINE_SETS_RANGE.min && sets <= ROUTINE_SETS_RANGE.max)) {
      throw new Error(`세트 수는 ${ROUTINE_SETS_RANGE.min}~${ROUTINE_SETS_RANGE.max}세트로 정해 주세요.`)
    }
    const timed = timedIds.has(item.exerciseId)
    const range = timed ? ROUTINE_SECONDS_RANGE : ROUTINE_REPS_RANGE
    if (reps !== null && !(Number.isInteger(reps) && reps >= range.min && reps <= range.max)) {
      throw new Error(
        timed
          ? `목표 시간은 ${range.min}~${range.max}초로 정하거나 비워 두세요.`
          : `목표 횟수는 ${range.min}~${range.max}회로 정하거나 비워 두세요.`,
      )
    }
    items.push({ exerciseId: item.exerciseId, sets, reps })
  }
  if (items.length === 0) throw new Error('종목을 하나 이상 넣어 주세요.')
  return { name, items }
}

/**
 * 지워진 종목을 빼고, 남은 종목 중 시간 종목의 id를 함께 돌려준다.
 * (루틴을 고치는 동안 종목 선택에서 종목을 지웠을 때 없는 종목이 루틴에 다시 들어가지 않게.)
 * 유산소 종목에는 목표가 없으므로 reps를 비운다(세트 수만 저장한다).
 */
async function withExistingExercises(input: RoutineInput): Promise<{ input: RoutineInput; timedIds: Set<string> }> {
  const valid = (id: unknown): id is string => typeof id === 'string' && id !== ''
  const ids = input.items.map((item) => item.exerciseId).filter(valid)
  const exercises = (await db.exercises.bulkGet(ids)).flatMap((e) => (e ? [e] : []))
  const existing = new Set(exercises.map((e) => e.id))
  const cardioIds = new Set(exercises.filter(isCardio).map((e) => e.id))
  const withoutCardioReps = (item: RoutineItem) =>
    cardioIds.has(item.exerciseId) && item.reps !== null ? { ...item, reps: null } : item
  return {
    // id가 올바르지 않은 항목은 남겨서 normalizeRoutineInput이 이유를 알려 주게 한다.
    input: {
      ...input,
      items: input.items.filter((item) => !valid(item.exerciseId) || existing.has(item.exerciseId)).map(withoutCardioReps),
    },
    timedIds: new Set(exercises.filter(isTimed).map((e) => e.id)),
  }
}

/**
 * 루틴을 고치는 동안 종목이 바뀌었을 때 고치던 내용을 맞춘다.
 * 지워진 종목은 빼고, 횟수와 시간이 바뀐 종목은 단위가 달라졌으니 목표를 비운다. 바뀐 것이 없으면 받은 배열을 그대로 돌려준다.
 */
export function syncRoutineDraft(items: RoutineItem[], before: Exercise[], now: Exercise[]): RoutineItem[] {
  const was = new Map(before.map((e) => [e.id, isTimed(e)]))
  const is = new Map(now.map((e) => [e.id, isTimed(e)]))
  let changed = false
  const next: RoutineItem[] = []
  for (const item of items) {
    const timed = is.get(item.exerciseId)
    if (timed === undefined) {
      changed = true
      continue
    }
    const wasTimed = was.get(item.exerciseId)
    if (wasTimed !== undefined && wasTimed !== timed && item.reps !== null) {
      changed = true
      next.push({ ...item, reps: null })
    } else {
      next.push(item)
    }
  }
  return changed ? next : items
}

/** 루틴을 만든다. 만든 루틴의 id를 돌려준다. */
export async function createRoutine(input: RoutineInput, now: number = Date.now()): Promise<string> {
  const existing = await withExistingExercises(input)
  const { name, items } = normalizeRoutineInput(existing.input, existing.timedIds)
  const id = newId()
  await db.routines.add({ id, name, items, createdAt: now, updatedAt: now, lastUsedAt: null })
  return id
}

/** 루틴의 이름과 종목을 바꾼다. 만든 시각과 마지막으로 쓴 시각은 그대로 둔다. */
export async function updateRoutine(id: string, input: RoutineInput, now: number = Date.now()): Promise<void> {
  const existing = await withExistingExercises(input)
  const { name, items } = normalizeRoutineInput(existing.input, existing.timedIds)
  const updated = await db.routines.update(id, { name, items, updatedAt: now })
  if (updated === 0 && !(await db.routines.get(id))) throw new Error('루틴을 찾을 수 없습니다.')
}

/** 루틴을 지운다. 이 루틴으로 한 운동 기록은 그대로 남는다. */
export async function deleteRoutine(id: string): Promise<void> {
  await db.routines.delete(id)
}

export async function getRoutine(id: string): Promise<Routine | undefined> {
  return db.routines.get(id)
}

/** 최근에 쓰거나 만들거나 고친 루틴부터 늘어놓는다. 새로 만든 루틴이 홈 위쪽에 보이도록. */
export function sortRoutines(routines: Routine[]): Routine[] {
  const touched = (r: Routine) => Math.max(r.lastUsedAt ?? 0, r.updatedAt)
  return [...routines].sort((a, b) => touched(b) - touched(a))
}

/** 루틴 목록. 최근에 쓰거나 만들거나 고친 것부터. */
export async function listRoutines(): Promise<Routine[]> {
  return sortRoutines(await db.routines.toArray())
}

/** 화면에 그릴 루틴 한 건 */
export interface RoutineView {
  routine: Routine
  entries: { item: RoutineItem; exercise: Exercise | undefined }[]
  /** 종목 이름을 순서대로. 지워진 종목은 '지워진 종목' */
  names: string[]
  /** 지워진 종목 수. 운동을 시작할 때 이 종목들은 건너뛴다. */
  missingCount: number
}

export function toRoutineView(routine: Routine, exercises: Map<string, Exercise>): RoutineView {
  const entries = routine.items.map((item) => ({ item, exercise: exercises.get(item.exerciseId) }))
  return {
    routine,
    entries,
    names: entries.map((e) => e.exercise?.name ?? MISSING_EXERCISE_NAME),
    missingCount: entries.filter((e) => e.exercise === undefined).length,
  }
}

/** 루틴 목록(최근에 쓴 것부터)과 종목 이름. */
export async function loadRoutineViews(): Promise<RoutineView[]> {
  const routines = await listRoutines()
  if (routines.length === 0) return []
  const exercises = new Map((await db.exercises.toArray()).map((e) => [e.id, e]))
  return routines.map((r) => toRoutineView(r, exercises))
}

/** "스쿼트, 레그 프레스 외 2개" */
export function summarizeNames(names: string[], max = 2): string {
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} 외 ${names.length - max}개`
}

/**
 * 루틴으로 운동을 시작한다. 세트는 지난번 값으로 미리 채우고, 본 세트 수와 목표 횟수(시간 종목은 목표 시간)는 루틴을 따른다.
 * 지워진 종목은 건너뛴다. 진행 중인 운동이 있으면 아무것도 만들지 않고 그 운동을 돌려준다.
 */
export async function startWorkoutFromRoutine(
  routineId: string,
  now: number = Date.now(),
): Promise<{ id: string; created: boolean }> {
  return db.transaction(
    'rw',
    [db.workouts, db.workoutExercises, db.sets, db.routines, db.exercises],
    async () => {
      const active = await getActiveWorkout()
      if (active) return { id: active.id, created: false }

      const routine = await db.routines.get(routineId)
      if (!routine) throw new Error('루틴을 찾을 수 없습니다.')
      const exercises = await db.exercises.bulkGet(routine.items.map((item) => item.exerciseId))
      const items = routine.items.filter((_, i) => exercises[i] !== undefined)
      if (items.length === 0) throw new Error('이 루틴에 남아 있는 종목이 없습니다.')

      const id = newId()
      await db.workouts.add({ id, date: toDateKey(now), startedAt: now, endedAt: null, memo: '', routineId })
      let order = 0
      for (const item of items) {
        await addExerciseWithPrefill(id, item.exerciseId, order++, { setCount: item.sets, targetReps: item.reps })
      }
      await db.routines.update(routineId, { lastUsedAt: now })
      return { id, created: true }
    },
  )
}

function clamp(n: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, n))
}

/**
 * 운동 기록을 루틴으로 저장한다. 새 루틴의 id를 돌려준다.
 * 종목은 기록의 순서대로 넣고, 세트 수는 완료한 본 세트(웜업 제외) 수(최소 1),
 * 목표 횟수는 그 운동의 목표 횟수, 없으면 첫 완료 본 세트의 횟수로 정한다. 지워진 종목은 뺀다.
 * 시간 종목은 같은 방식으로 목표 시간(초)을 정한다(그 운동의 목표 시간, 없으면 첫 완료 본 세트의 시간).
 */
export async function saveWorkoutAsRoutine(workoutId: string, name: string, now: number = Date.now()): Promise<string> {
  const items = await db.transaction('r', [db.workouts, db.workoutExercises, db.sets, db.exercises], async () => {
    if (!(await db.workouts.get(workoutId))) throw new Error('운동 기록을 찾을 수 없습니다.')
    const wes = await db.workoutExercises.where('workoutId').equals(workoutId).sortBy('order')
    const exercises = await db.exercises.bulkGet(wes.map((we) => we.exerciseId))
    const result: RoutineItem[] = []
    for (const [i, we] of wes.entries()) {
      if (!exercises[i]) continue
      const timed = isTimed(exercises[i])
      const sets = await db.sets.where('workoutExerciseId').equals(we.id).sortBy('order')
      const working = sets.filter((s) => s.isDone && !s.isWarmup)
      const first = working[0]
      const firstAmount = first === undefined ? null : timed ? setSeconds(first) : first.reps
      const reps =
        typeof we.targetReps === 'number'
          ? we.targetReps
          : typeof firstAmount === 'number' && firstAmount > 0
            ? firstAmount
            : null
      result.push({
        exerciseId: we.exerciseId,
        sets: clamp(working.length, ROUTINE_SETS_RANGE),
        reps: reps === null ? null : clamp(Math.round(reps), timed ? ROUTINE_SECONDS_RANGE : ROUTINE_REPS_RANGE),
      })
    }
    return result
  })
  if (items.length === 0) throw new Error('루틴으로 저장할 종목이 없습니다.')
  return createRoutine({ name, items }, now)
}

/** 운동 기록을 루틴으로 저장할 때 미리 넣어 줄 이름. 종목 이름이 길면 날짜로 정한다. */
export function defaultRoutineName(exerciseNames: string[], startedAt: number): string {
  const byNames = summarizeNames(exerciseNames)
  if (byNames !== '' && byNames.length <= ROUTINE_NAME_MAX) return byNames
  const d = new Date(startedAt)
  return `${d.getMonth() + 1}월 ${d.getDate()}일 운동`
}
