import { db, type WorkoutExercise } from '../db'
import { newId } from './id'
import type { WorkoutItem } from './workouts'

/**
 * 슈퍼세트: 쉬지 않고 번갈아 하는 종목 묶음. (5단계)
 * 순서가 이어진 종목 둘 이상이 같은 supersetId를 가지면 한 묶음이다(셋 이상도 된다).
 * 혼자만 가진 id는 아무 뜻이 없어서, 저장할 때마다 지운다.
 * 운동의 종목(WorkoutExercise)과 루틴의 종목(RoutineItem)이 같은 규칙을 쓴다.
 */

/** 슈퍼세트로 묶을 수 있는 것(운동의 종목, 루틴의 종목) */
export interface Linkable {
  supersetId?: string | null
}

/** 순서대로 늘어선 종목들의 supersetId. 묶지 않은 종목은 null이나 undefined */
type Ids = readonly unknown[]

/** 묶음 안에서의 자리. 묶지 않은 종목은 'none' */
export type SupersetPosition = 'none' | 'first' | 'middle' | 'last'

const isId = (v: unknown): v is string => typeof v === 'string' && v !== ''

/** index에서 시작해 같은 id가 이어지는 마지막 자리. 묶음이 아니면 index 그대로 */
function runEnd(ids: Ids, index: number): number {
  const id = ids[index]
  let end = index
  if (isId(id)) while (end + 1 < ids.length && ids[end + 1] === id) end++
  return end
}

/**
 * 저장해도 되는 값으로 다듬는다.
 * 혼자 남은 id는 지우고(null), 떨어져 있는 두 묶음이 같은 id를 쓰면 뒤 묶음에 새 id를 준다
 * (사이의 종목이 빠졌을 때 두 묶음이 저절로 하나로 합쳐지지 않게).
 * fresh: 모든 묶음에 새 id를 준다(루틴이나 지난 운동의 묶음을 새 운동으로 옮길 때).
 */
export function cleanSupersetIds(
  ids: Ids,
  opts: { fresh?: boolean; makeId?: () => string } = {},
): (string | null)[] {
  const makeId = opts.makeId ?? newId
  const out: (string | null)[] = ids.map(() => null)
  const used = new Set<string>()
  for (let i = 0; i < ids.length; i++) {
    const end = runEnd(ids, i)
    if (end === i) continue
    const id = ids[i] as string
    const keep = opts.fresh || used.has(id) ? makeId() : id
    used.add(keep)
    out.fill(keep, i, end + 1)
    i = end
  }
  return out
}

/** 종목마다 묶음 안에서의 자리(화면에서 묶음을 그릴 때 쓴다). 혼자 남은 id는 묶음으로 치지 않는다. */
export function supersetPositions(items: readonly Linkable[]): SupersetPosition[] {
  const ids = items.map((item) => item.supersetId)
  const out: SupersetPosition[] = items.map(() => 'none')
  for (let i = 0; i < ids.length; i++) {
    const end = runEnd(ids, i)
    if (end === i) continue
    out.fill('middle', i, end + 1)
    out[i] = 'first'
    out[end] = 'last'
    i = end
  }
  return out
}

/** index번째 종목을 바로 다음 종목과 묶는다. 어느 한쪽이 이미 묶음이면 그 묶음에 들어가고, 둘 다 묶음이면 하나로 합친다. */
export function linkSupersetIds(ids: Ids, index: number, makeId: () => string = newId): (string | null)[] {
  const out = cleanSupersetIds(ids, { makeId })
  if (index < 0 || index + 1 >= out.length) return out
  const a = out[index]
  const b = out[index + 1]
  if (a !== null && a === b) return out
  const id = a ?? b ?? makeId()
  return out.map((cur, i) => (i === index || i === index + 1 || (cur !== null && (cur === a || cur === b)) ? id : cur))
}

/**
 * index번째 종목과 바로 다음 종목 사이를 푼다. 묶음은 그 자리에서 둘로 나뉘고,
 * 나뉜 쪽에 종목이 하나만 남으면 그 종목은 묶음에서 빠진다.
 */
export function unlinkSupersetIds(ids: Ids, index: number, makeId: () => string = newId): (string | null)[] {
  const out = cleanSupersetIds(ids, { makeId })
  if (index < 0 || index + 1 >= out.length) return out
  const id = out[index]
  if (id === null || out[index + 1] !== id) return out
  const below = makeId()
  for (let i = index + 1; i < out.length && out[i] === id; i++) out[i] = below
  return cleanSupersetIds(out, { makeId })
}

/**
 * from번째 종목을 한 칸 위(-1)나 아래(1)로 옮긴다. 옮길 수 없으면 null.
 * - 같은 묶음 안에서는 자리만 바뀌고 묶음은 그대로다.
 * - 묶음의 끝에서 바깥으로 나가면 그 종목은 묶음에서 빠진다(종목이 하나만 남은 묶음은 풀린다).
 * - 옆에 다른 묶음이 있으면 그 묶음을 통째로 건너뛴다. 옮기는 것만으로 묶음에 끼어들거나 묶음을 가르지 않는다.
 */
export function moveWithSupersets<T extends Linkable>(
  items: readonly T[],
  from: number,
  direction: -1 | 1,
  makeId: () => string = newId,
): { items: T[]; ids: (string | null)[] } | null {
  const ids = cleanSupersetIds(
    items.map((item) => item.supersetId),
    { makeId },
  )
  let to = from + direction
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return null
  const own = ids[from]
  const neighbour = ids[to]
  const staysInGroup = own !== null && neighbour === own
  if (!staysInGroup && neighbour !== null) {
    while (ids[to + direction] === neighbour) to += direction
  }

  const order = items.map((_, i) => i)
  order.splice(from, 1)
  order.splice(to, 0, from)
  const moved = order.map((i) => ids[i])
  if (!staysInGroup) moved[to] = null
  return { items: order.map((i) => items[i]), ids: cleanSupersetIds(moved, { makeId }) }
}

/** 종목들에 다듬은 supersetId를 입힌다. 묶지 않은 종목에는 칸을 두지 않고, 바뀌지 않은 종목은 받은 것을 그대로 돌려준다. */
export function withSupersetIds<T extends Linkable>(items: readonly T[], ids: readonly (string | null)[]): T[] {
  return items.map((item, i) => {
    const id = ids[i] ?? null
    if (id === null ? !('supersetId' in item) : item.supersetId === id) return item
    const next = { ...item }
    delete next.supersetId
    if (id !== null) next.supersetId = id
    return next
  })
}

/** 세트를 완료한 뒤에 할 일 */
export type AfterSetDone =
  /** 쉰다. restSeconds는 방금 세트를 끝낸 종목에 정해 둔 휴식 시간(없으면 설정의 기본값을 쓴다). */
  | { kind: 'rest'; restSeconds: number | null | undefined }
  /** 쉬지 않고 같은 묶음의 다음 종목으로 넘어간다. */
  | { kind: 'next'; workoutExerciseId: string }
  /** 아무것도 하지 않는다(유산소는 세트 사이에 쉬는 운동이 아니다). */
  | { kind: 'none' }

/**
 * 세트를 완료했을 때 휴식 타이머를 시작할지 정한다.
 * 슈퍼세트에서는 한 바퀴가 끝났을 때만 쉰다: 묶음의 마지막 종목이거나, 뒤쪽 종목에 아직 하지 않은 세트가 없을 때.
 * 그렇지 않으면 쉬지 않고, 아직 할 세트가 남은 바로 다음 종목으로 넘어간다.
 * 방금 완료한 세트가 items에 아직 반영되지 않았어도 된다(뒤쪽 종목의 세트만 본다).
 */
export function afterSetDone(
  items: readonly Pick<WorkoutItem, 'we' | 'exercise' | 'sets'>[],
  workoutExerciseId: string,
): AfterSetDone {
  const index = items.findIndex((item) => item.we.id === workoutExerciseId)
  if (index < 0) return { kind: 'rest', restSeconds: undefined }
  const positions = supersetPositions(items.map((item) => item.we))
  // 묶음의 첫 종목이나 가운데 종목이면 바로 뒤 종목도 같은 묶음이다.
  for (let i = index; positions[i] === 'first' || positions[i] === 'middle'; i++) {
    const later = items[i + 1]
    if (later.sets.some((s) => !s.isDone)) return { kind: 'next', workoutExerciseId: later.we.id }
  }
  const exercise = items[index].exercise
  if (exercise?.measure === 'cardio') return { kind: 'none' }
  return { kind: 'rest', restSeconds: exercise?.restSeconds }
}

/** 순서대로 읽은 운동의 종목들에서 supersetId가 달라진 것만 저장한다. 트랜잭션 안에서 부른다(workoutExercises). */
export async function writeSupersetIds(list: readonly WorkoutExercise[], ids: readonly (string | null)[]): Promise<void> {
  const changed = list.flatMap((we, i) =>
    (we.supersetId ?? null) === ids[i] ? [] : [{ key: we.id, changes: { supersetId: ids[i] } }],
  )
  if (changed.length > 0) await db.workoutExercises.bulkUpdate(changed)
}

/**
 * 운동의 슈퍼세트 묶음을 다듬어 저장한다(혼자 남은 id 지우기). 종목을 빼거나 더한 뒤에 부른다.
 * 트랜잭션 안에서 불러도 된다(workoutExercises).
 */
export async function cleanWorkoutSupersets(workoutId: string): Promise<void> {
  await db.transaction('rw', db.workoutExercises, async () => {
    const list = await db.workoutExercises.where('workoutId').equals(workoutId).sortBy('order')
    await writeSupersetIds(list, cleanSupersetIds(list.map((we) => we.supersetId)))
  })
}

async function changeWorkoutLink(
  workoutExerciseId: string,
  change: (ids: Ids, index: number) => (string | null)[],
): Promise<void> {
  await db.transaction('rw', db.workoutExercises, async () => {
    const we = await db.workoutExercises.get(workoutExerciseId)
    if (!we) return
    const list = await db.workoutExercises.where('workoutId').equals(we.workoutId).sortBy('order')
    const index = list.findIndex((x) => x.id === workoutExerciseId)
    await writeSupersetIds(
      list,
      change(
        list.map((x) => x.supersetId),
        index,
      ),
    )
  })
}

/** 운동에서 이 종목을 바로 다음 종목과 슈퍼세트로 묶는다. */
export function linkWithNextExercise(workoutExerciseId: string): Promise<void> {
  return changeWorkoutLink(workoutExerciseId, linkSupersetIds)
}

/** 운동에서 이 종목과 바로 다음 종목 사이의 묶음을 푼다. */
export function unlinkFromNextExercise(workoutExerciseId: string): Promise<void> {
  return changeWorkoutLink(workoutExerciseId, unlinkSupersetIds)
}
