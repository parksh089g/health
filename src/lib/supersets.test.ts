import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Exercise, type SetEntry, type WorkoutExercise } from '../db'
import {
  createRoutine,
  getRoutine,
  normalizeRoutineInput,
  saveWorkoutAsRoutine,
  startWorkoutFromRoutine,
  syncRoutineDraft,
  updateRoutine,
} from './routines'
import {
  afterSetDone,
  cleanSupersetIds,
  linkSupersetIds,
  linkWithNextExercise,
  moveWithSupersets,
  supersetPositions,
  unlinkFromNextExercise,
  unlinkSupersetIds,
  withSupersetIds,
} from './supersets'
import {
  addExercisesToWorkout,
  deleteWorkout,
  finishWorkout,
  loadWorkoutDetail,
  moveWorkoutExercise,
  removeWorkoutExercise,
  repeatWorkout,
  startWorkout,
  updateSet,
} from './workouts'

/** 새 id를 n1, n2, ... 순서로 만든다(어디에 새 id가 쓰였는지 보이게). */
function counter() {
  let n = 0
  return () => `n${++n}`
}

const of = (ids: (string | null)[]) => ids.map((supersetId) => ({ supersetId }))

describe('묶음 찾기', () => {
  it('이어진 종목 둘 이상이 같은 id를 가지면 한 묶음이다', () => {
    expect(supersetPositions(of([null, 'a', 'a', null, 'b', 'b', 'b']))).toEqual([
      'none',
      'first',
      'last',
      'none',
      'first',
      'middle',
      'last',
    ])
    expect(supersetPositions([])).toEqual([])
    expect(supersetPositions([{}, { supersetId: undefined }, { supersetId: '' }])).toEqual(['none', 'none', 'none'])
  })

  it('혼자만 가진 id와 떨어져 있는 같은 id는 묶음이 아니다', () => {
    expect(supersetPositions(of(['a', null, 'a']))).toEqual(['none', 'none', 'none'])
    expect(supersetPositions(of(['a', 'b', 'a']))).toEqual(['none', 'none', 'none'])
    expect(supersetPositions(of(['a', 'a', null, 'a']))).toEqual(['first', 'last', 'none', 'none'])
  })
})

describe('id 다듬기', () => {
  it('혼자 남은 id는 지우고 묶음의 id는 그대로 둔다', () => {
    const makeId = counter()
    expect(cleanSupersetIds(['a', null, 'b', 'b', 'c', undefined], { makeId })).toEqual([
      null,
      null,
      'b',
      'b',
      null,
      null,
    ])
    expect(cleanSupersetIds([], { makeId })).toEqual([])
  })

  it('떨어져 있는 두 묶음이 같은 id를 쓰면 뒤 묶음에 새 id를 준다', () => {
    expect(cleanSupersetIds(['a', 'a', null, 'a', 'a'], { makeId: counter() })).toEqual(['a', 'a', null, 'n1', 'n1'])
    // 혼자 남은 id는 묶음으로 치지 않으니 뒤 묶음이 id를 그대로 쓴다.
    expect(cleanSupersetIds(['a', null, 'a', 'a'], { makeId: counter() })).toEqual([null, null, 'a', 'a'])
  })

  it('fresh면 모든 묶음에 새 id를 준다', () => {
    expect(cleanSupersetIds(['a', 'a', 'x', 'b', 'b', 'b'], { fresh: true, makeId: counter() })).toEqual([
      'n1',
      'n1',
      null,
      'n2',
      'n2',
      'n2',
    ])
  })

  it('문자열이 아닌 값은 묶지 않은 것으로 본다', () => {
    expect(cleanSupersetIds([1, 1, {}, true, true], { makeId: counter() })).toEqual([null, null, null, null, null])
  })

  it('종목에 입힐 때 묶지 않은 종목에는 칸을 두지 않고, 바뀌지 않은 종목은 그대로 돌려준다', () => {
    type Named = { name: string; supersetId?: string | null }
    const a: Named = { name: 'a', supersetId: 'x' }
    const b: Named = { name: 'b' }
    const c: Named = { name: 'c', supersetId: null }
    const out = withSupersetIds([a, b, c], ['x', 'x', null])
    expect(out).toEqual([{ name: 'a', supersetId: 'x' }, { name: 'b', supersetId: 'x' }, { name: 'c' }])
    expect(out[0]).toBe(a)
    expect(b).toEqual({ name: 'b' })
    expect(withSupersetIds([b], [null])[0]).toBe(b)
  })
})

describe('묶기와 풀기', () => {
  it('두 종목을 묶으면 같은 새 id를 가진다', () => {
    expect(linkSupersetIds([null, null, null], 1, counter())).toEqual([null, 'n1', 'n1'])
  })

  it('묶음 옆의 종목을 묶으면 그 묶음에 들어간다(셋이 한 묶음)', () => {
    expect(linkSupersetIds(['a', 'a', null], 1, counter())).toEqual(['a', 'a', 'a'])
    expect(linkSupersetIds([null, 'a', 'a'], 0, counter())).toEqual(['a', 'a', 'a'])
  })

  it('두 묶음 사이를 묶으면 하나로 합쳐진다', () => {
    expect(linkSupersetIds(['a', 'a', 'b', 'b', null], 1, counter())).toEqual(['a', 'a', 'a', 'a', null])
  })

  it('이미 묶인 사이, 맨 끝, 없는 자리는 그대로다', () => {
    expect(linkSupersetIds(['a', 'a', null], 0, counter())).toEqual(['a', 'a', null])
    expect(linkSupersetIds(['a', 'a', null], 2, counter())).toEqual(['a', 'a', null])
    expect(linkSupersetIds(['a', 'a', null], -1, counter())).toEqual(['a', 'a', null])
  })

  it('혼자 남아 있던 id는 묶을 때 쓰지 않는다', () => {
    // 첫 종목의 'a'는 뜻이 없는 값이다. 둘째와 셋째를 묶어도 첫 종목이 따라 들어오지 않는다.
    expect(linkSupersetIds(['a', 'b', null], 1, counter())).toEqual([null, 'n1', 'n1'])
  })

  it('둘을 풀면 둘 다 묶음에서 빠진다', () => {
    expect(unlinkSupersetIds(['a', 'a', null], 0, counter())).toEqual([null, null, null])
  })

  it('셋 가운데 한쪽 사이를 풀면 그쪽 종목만 빠지고 나머지 둘은 묶음으로 남는다', () => {
    expect(supersetPositions(of(unlinkSupersetIds(['a', 'a', 'a'], 0, counter())))).toEqual(['none', 'first', 'last'])
    expect(supersetPositions(of(unlinkSupersetIds(['a', 'a', 'a'], 1, counter())))).toEqual(['first', 'last', 'none'])
  })

  it('셋의 가운데 종목을 빼내려고 양쪽 사이를 풀면 셋 다 풀린다', () => {
    const makeId = counter()
    const once = unlinkSupersetIds(['a', 'a', 'a'], 0, makeId)
    expect(unlinkSupersetIds(once, 1, makeId)).toEqual([null, null, null])
  })

  it('넷의 가운데 사이를 풀면 서로 다른 두 묶음이 된다', () => {
    const out = unlinkSupersetIds(['a', 'a', 'a', 'a'], 1, counter())
    expect(out).toEqual(['a', 'a', 'n1', 'n1'])
    expect(supersetPositions(of(out))).toEqual(['first', 'last', 'first', 'last'])
  })

  it('묶이지 않은 사이를 풀어도 그대로다', () => {
    expect(unlinkSupersetIds(['a', 'a', null, 'b', 'b'], 1, counter())).toEqual(['a', 'a', null, 'b', 'b'])
    expect(unlinkSupersetIds(['a', 'a'], 1, counter())).toEqual(['a', 'a'])
  })
})

describe('옮기기', () => {
  /** 이름과 묶음을 '이름:id'로 적은 목록을 옮기고 같은 모양으로 돌려준다. */
  function move(list: string[], name: string, direction: -1 | 1) {
    const items = list.map((entry) => {
      const [label, supersetId = null] = entry.split(':')
      return { label, supersetId }
    })
    const moved = moveWithSupersets(
      items,
      items.findIndex((item) => item.label === name),
      direction,
      counter(),
    )
    return moved && moved.items.map((item, i) => (moved.ids[i] === null ? item.label : `${item.label}:${moved.ids[i]}`))
  }

  it('묶음이 없으면 한 칸 옮긴다', () => {
    expect(move(['A', 'B', 'C'], 'A', 1)).toEqual(['B', 'A', 'C'])
    expect(move(['A', 'B', 'C'], 'C', -1)).toEqual(['A', 'C', 'B'])
  })

  it('맨 위에서 위로, 맨 아래에서 아래로, 없는 자리는 옮기지 않는다', () => {
    expect(move(['A', 'B'], 'A', -1)).toBeNull()
    expect(move(['A', 'B'], 'B', 1)).toBeNull()
    expect(move(['A', 'B'], '없음', 1)).toBeNull()
  })

  it('같은 묶음 안에서는 자리만 바뀐다', () => {
    expect(move(['A:g', 'B:g', 'C:g', 'D'], 'A', 1)).toEqual(['B:g', 'A:g', 'C:g', 'D'])
    expect(move(['A:g', 'B:g', 'C:g', 'D'], 'C', -1)).toEqual(['A:g', 'C:g', 'B:g', 'D'])
  })

  it('묶음 밖으로 나가면 그 종목만 빠진다', () => {
    expect(move(['A:g', 'B:g', 'C:g', 'D'], 'C', 1)).toEqual(['A:g', 'B:g', 'D', 'C'])
    expect(move(['X', 'A:g', 'B:g', 'C:g'], 'A', -1)).toEqual(['A', 'X', 'B:g', 'C:g'])
  })

  it('둘뿐인 묶음에서 하나가 나가면 묶음이 풀린다', () => {
    expect(move(['A:g', 'B:g', 'C'], 'B', 1)).toEqual(['A', 'C', 'B'])
  })

  it('묶이지 않은 종목은 옆 묶음을 통째로 건너뛴다(묶음에 끼어들거나 묶음을 가르지 않는다)', () => {
    expect(move(['X', 'A:g', 'B:g', 'C:g', 'Y'], 'X', 1)).toEqual(['A:g', 'B:g', 'C:g', 'X', 'Y'])
    expect(move(['X', 'A:g', 'B:g', 'C:g', 'Y'], 'Y', -1)).toEqual(['X', 'Y', 'A:g', 'B:g', 'C:g'])
  })

  it('묶음에서 나가는 종목도 옆의 다른 묶음은 통째로 건너뛴다', () => {
    expect(move(['A:g', 'B:g', 'C:h', 'D:h'], 'B', 1)).toEqual(['A', 'C:h', 'D:h', 'B'])
    expect(move(['A:g', 'B:g', 'B2:g', 'C:h', 'D:h'], 'C', -1)).toEqual(['C', 'A:g', 'B:g', 'B2:g', 'D'])
  })

  it('혼자 남아 있던 id는 옮기면서 지운다', () => {
    expect(move(['A:g', 'B', 'C:g'], 'A', 1)).toEqual(['B', 'A', 'C'])
  })
})

describe('세트를 완료한 뒤 휴식', () => {
  const exercise = (id: string, patch: Partial<Exercise> = {}): Exercise => ({
    id,
    name: id,
    bodyPart: 'chest',
    equipment: 'barbell',
    isCustom: false,
    createdAt: 0,
    ...patch,
  })
  /** done: 세트마다 완료했는지 */
  const item = (id: string, supersetId: string | null, done: boolean[], patch: Partial<Exercise> = {}) => ({
    we: { id, workoutId: 'w', exerciseId: id, order: 0, memo: '', supersetId } satisfies WorkoutExercise,
    exercise: exercise(id, patch),
    sets: done.map(
      (isDone, order): SetEntry => ({
        id: `${id}-${order}`,
        workoutExerciseId: id,
        order,
        weightKg: 50,
        reps: 10,
        isWarmup: false,
        isDone,
      }),
    ),
  })

  it('묶지 않은 종목은 늘 쉬고, 그 종목의 휴식 시간을 쓴다', () => {
    const items = [item('A', null, [false, false], { restSeconds: 150 }), item('B', null, [false])]
    expect(afterSetDone(items, 'A')).toEqual({ kind: 'rest', restSeconds: 150 })
    expect(afterSetDone(items, 'B')).toEqual({ kind: 'rest', restSeconds: undefined })
  })

  it('슈퍼세트의 앞 종목은 쉬지 않고 다음 종목으로 넘어간다', () => {
    const items = [item('A', 'g', [false, false]), item('B', 'g', [false, false])]
    expect(afterSetDone(items, 'A')).toEqual({ kind: 'next', workoutExerciseId: 'B' })
  })

  it('마지막 종목의 세트를 완료하면 한 바퀴가 끝나 쉰다(그 종목의 휴식 시간으로)', () => {
    const items = [
      item('A', 'g', [true, false], { restSeconds: 60 }),
      item('B', 'g', [false, false], { restSeconds: 120 }),
    ]
    expect(afterSetDone(items, 'B')).toEqual({ kind: 'rest', restSeconds: 120 })
  })

  it('뒤쪽 종목에 할 세트가 남아 있지 않으면 앞 종목에서도 쉰다', () => {
    // B는 두 세트를 다 했고 A만 한 세트 더 한다.
    const items = [item('A', 'g', [true, true, false], { restSeconds: 60 }), item('B', 'g', [true, true])]
    expect(afterSetDone(items, 'A')).toEqual({ kind: 'rest', restSeconds: 60 })
  })

  it('셋을 묶었으면 할 세트가 남은 바로 다음 종목으로 넘어간다', () => {
    const items = [item('A', 'g', [false]), item('B', 'g', [true]), item('C', 'g', [false]), item('D', null, [false])]
    // B는 이미 다 해서 C로 간다.
    expect(afterSetDone(items, 'A')).toEqual({ kind: 'next', workoutExerciseId: 'C' })
    expect(afterSetDone(items, 'B')).toEqual({ kind: 'next', workoutExerciseId: 'C' })
    expect(afterSetDone(items, 'C')).toEqual({ kind: 'rest', restSeconds: undefined })
  })

  it('묶음 밖의 종목에 남은 세트는 보지 않는다', () => {
    const items = [item('A', 'g', [false]), item('B', 'g', [true]), item('C', null, [false])]
    expect(afterSetDone(items, 'A')).toEqual({ kind: 'rest', restSeconds: undefined })
  })

  it('방금 완료한 세트가 아직 반영되지 않았어도 같은 답을 낸다', () => {
    const before = [item('A', 'g', [false]), item('B', 'g', [false])]
    const after = [item('A', 'g', [true]), item('B', 'g', [false])]
    expect(afterSetDone(before, 'A')).toEqual(afterSetDone(after, 'A'))
  })

  it('유산소는 쉬지 않는다. 슈퍼세트 안에서는 다음 종목으로는 넘어간다', () => {
    const cardio = { bodyPart: 'cardio', measure: 'cardio' } as const
    expect(afterSetDone([item('A', null, [false], cardio)], 'A')).toEqual({ kind: 'none' })
    const items = [item('A', 'g', [false], cardio), item('B', 'g', [false]), item('C', 'g', [true], cardio)]
    expect(afterSetDone(items, 'A')).toEqual({ kind: 'next', workoutExerciseId: 'B' })
    expect(afterSetDone(items, 'C')).toEqual({ kind: 'none' })
    // B 뒤에는 할 세트가 남은 종목이 없어서 B의 휴식을 시작한다.
    expect(afterSetDone(items, 'B')).toEqual({ kind: 'rest', restSeconds: undefined })
  })

  it('혼자 남은 id는 묶음이 아니고, 없는 종목이면 그냥 쉰다', () => {
    const items = [item('A', 'g', [false]), item('B', null, [false]), item('C', 'g', [false])]
    expect(afterSetDone(items, 'A')).toEqual({ kind: 'rest', restSeconds: undefined })
    expect(afterSetDone(items, '없음')).toEqual({ kind: 'rest', restSeconds: undefined })
  })
})

describe('운동에서 묶고 옮기고 빼기', () => {
  const [A, B, C, D] = ['ex-a', 'ex-b', 'ex-c', 'ex-d']

  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.exercises.bulkAdd(
      [A, B, C, D].map((id) => ({
        id,
        name: id,
        bodyPart: 'chest' as const,
        equipment: 'barbell' as const,
        isCustom: false,
        createdAt: 0,
      })),
    )
  })

  async function weIdOf(workoutId: string, exerciseId: string) {
    const item = (await loadWorkoutDetail(workoutId))?.items.find((i) => i.we.exerciseId === exerciseId)
    if (!item) throw new Error('운동에 그 종목이 없습니다.')
    return item.we.id
  }

  /** 종목을 순서대로, 같은 묶음끼리 [ ]로 묶어 적는다. 예: '[ex-a ex-b] ex-c' */
  async function layout(workoutId: string) {
    const items = (await loadWorkoutDetail(workoutId))!.items
    const positions = supersetPositions(items.map((i) => i.we))
    return items
      .map((i, n) => `${positions[n] === 'first' ? '[' : ''}${i.we.exerciseId}${positions[n] === 'last' ? ']' : ''}`)
      .join(' ')
  }

  /** 저장된 supersetId 가운데 묶음에 쓰이지 않는(혼자 남은) 것의 수 */
  async function strayIds(workoutId: string) {
    const items = (await loadWorkoutDetail(workoutId))!.items
    const positions = supersetPositions(items.map((i) => i.we))
    return items.filter((i, n) => i.we.supersetId != null && positions[n] === 'none').length
  }

  async function started(exerciseIds: string[]) {
    const id = await startWorkout(1_000)
    await addExercisesToWorkout(id, exerciseIds)
    return id
  }

  it('다음 종목과 묶고, 셋까지 이어 묶고, 푼다', async () => {
    const id = await started([A, B, C, D])
    await linkWithNextExercise(await weIdOf(id, A))
    expect(await layout(id)).toBe('[ex-a ex-b] ex-c ex-d')
    await linkWithNextExercise(await weIdOf(id, B))
    expect(await layout(id)).toBe('[ex-a ex-b ex-c] ex-d')

    // 가운데 종목의 위쪽 사이를 풀면 첫 종목만 빠진다.
    await unlinkFromNextExercise(await weIdOf(id, A))
    expect(await layout(id)).toBe('ex-a [ex-b ex-c] ex-d')
    await unlinkFromNextExercise(await weIdOf(id, B))
    expect(await layout(id)).toBe('ex-a ex-b ex-c ex-d')
    expect(await strayIds(id)).toBe(0)
  })

  it('마지막 종목이나 없는 종목은 묶을 것이 없어 그대로다', async () => {
    const id = await started([A, B])
    await linkWithNextExercise(await weIdOf(id, B))
    await linkWithNextExercise('없는 종목')
    await unlinkFromNextExercise(await weIdOf(id, A))
    expect(await layout(id)).toBe('ex-a ex-b')
  })

  it('옮겨도 묶음이 갈라지거나 옆 종목을 끌어들이지 않는다', async () => {
    const id = await started([A, B, C, D])
    await linkWithNextExercise(await weIdOf(id, B))
    expect(await layout(id)).toBe('ex-a [ex-b ex-c] ex-d')

    // 묶이지 않은 종목은 묶음을 통째로 건너뛴다.
    expect(await moveWorkoutExercise(await weIdOf(id, A), 1)).toBe(true)
    expect(await layout(id)).toBe('[ex-b ex-c] ex-a ex-d')
    // 묶음 안에서는 자리만 바뀐다.
    expect(await moveWorkoutExercise(await weIdOf(id, B), 1)).toBe(true)
    expect(await layout(id)).toBe('[ex-c ex-b] ex-a ex-d')
    // 묶음 밖으로 나가면 빠지고, 하나만 남은 묶음은 풀린다.
    expect(await moveWorkoutExercise(await weIdOf(id, B), 1)).toBe(true)
    expect(await layout(id)).toBe('ex-c ex-a ex-b ex-d')
    expect(await strayIds(id)).toBe(0)
    const orders = (await loadWorkoutDetail(id))!.items.map((i) => i.we.order)
    expect(orders).toEqual([0, 1, 2, 3])
  })

  it('종목을 빼면 하나만 남은 묶음은 풀리고, 셋 가운데 하나를 빼면 둘이 묶음으로 남는다', async () => {
    const id = await started([A, B, C, D])
    await linkWithNextExercise(await weIdOf(id, A))
    await linkWithNextExercise(await weIdOf(id, B))
    await removeWorkoutExercise(await weIdOf(id, B))
    expect(await layout(id)).toBe('[ex-a ex-c] ex-d')
    await removeWorkoutExercise(await weIdOf(id, C))
    expect(await layout(id)).toBe('ex-a ex-d')
    expect(await strayIds(id)).toBe(0)
  })

  it('두 묶음 사이의 종목을 빼도 두 묶음이 하나로 합쳐지지 않는다', async () => {
    const extra = 'ex-e'
    await db.exercises.add({ ...(await db.exercises.get(A))!, id: extra, name: extra })
    const id = await started([A, B, C, D, extra])
    await linkWithNextExercise(await weIdOf(id, A))
    await linkWithNextExercise(await weIdOf(id, D))
    expect(await layout(id)).toBe('[ex-a ex-b] ex-c [ex-d ex-e]')
    await removeWorkoutExercise(await weIdOf(id, C))
    expect(await layout(id)).toBe('[ex-a ex-b] [ex-d ex-e]')
  })

  it('종목을 더하면 묶지 않은 채 맨 뒤에 붙고, 혼자 남아 있던 id는 지워진다', async () => {
    const id = await started([A, B, C])
    await linkWithNextExercise(await weIdOf(id, B))
    // 다른 경로(운동을 마칠 때 완료 세트가 없는 종목이 빠지는 것)로 혼자 남은 id를 흉내 낸다.
    await db.workoutExercises.update(await weIdOf(id, A), { supersetId: 'stray' })
    expect(await strayIds(id)).toBe(1)

    await addExercisesToWorkout(id, [D])
    expect(await layout(id)).toBe('ex-a [ex-b ex-c] ex-d')
    expect(await strayIds(id)).toBe(0)
  })

  it('운동을 마치면서 종목이 빠져 혼자 남은 id는 마칠 때 함께 지워진다', async () => {
    const id = await started([A, B])
    await linkWithNextExercise(await weIdOf(id, A))
    const [first] = (await loadWorkoutDetail(id))!.items[0].sets
    await updateSet(first.id, { weightKg: 50, reps: 10, isDone: true })
    await finishWorkout(id, { endedAt: 2_000 })

    expect(await layout(id)).toBe('ex-a')
    expect(await strayIds(id)).toBe(0)
  })

  it('같은 운동을 다시 하면 묶음도 따라가고 id는 새로 만든다', async () => {
    const source = await started([A, B, C])
    await linkWithNextExercise(await weIdOf(source, A))
    for (const item of (await loadWorkoutDetail(source))!.items) {
      await updateSet(item.sets[0].id, { weightKg: 50, reps: 10, isDone: true })
    }
    await finishWorkout(source, { endedAt: 2_000 })

    const again = await repeatWorkout(source, 10_000_000)
    expect(again.created).toBe(true)
    expect(await layout(again.id)).toBe('[ex-a ex-b] ex-c')
    const idOf = async (workoutId: string) => (await loadWorkoutDetail(workoutId))!.items[0].we.supersetId
    expect(await idOf(again.id)).not.toBe(await idOf(source))
    // 묶지 않은 종목에는 값을 두지 않는다.
    expect((await loadWorkoutDetail(again.id))!.items[2].we.supersetId ?? null).toBeNull()
  })
})

describe('루틴의 슈퍼세트', () => {
  const [A, B, C, D] = ['ex-a', 'ex-b', 'ex-c', 'ex-d']

  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.exercises.bulkAdd(
      [A, B, C, D].map((id) => ({
        id,
        name: id,
        bodyPart: 'chest' as const,
        equipment: 'barbell' as const,
        isCustom: false,
        createdAt: 0,
      })),
    )
  })

  const item = (exerciseId: string, supersetId?: string | null) =>
    supersetId === undefined ? { exerciseId, sets: 3, reps: 10 } : { exerciseId, sets: 3, reps: 10, supersetId }

  /** 종목을 순서대로, 같은 묶음끼리 [ ]로 묶어 적는다. */
  function layout(items: { exerciseId: string; supersetId?: string | null }[]) {
    const positions = supersetPositions(items)
    return items
      .map((i, n) => `${positions[n] === 'first' ? '[' : ''}${i.exerciseId}${positions[n] === 'last' ? ']' : ''}`)
      .join(' ')
  }
  const routineLayout = async (id: string) => layout((await getRoutine(id))!.items)
  const workoutLayout = async (id: string) => layout((await loadWorkoutDetail(id))!.items.map((i) => i.we))

  it('묶음은 그대로 저장하고, 혼자 남은 id는 지우며 묶지 않은 종목에는 칸을 두지 않는다', () => {
    const { items } = normalizeRoutineInput({
      name: '상체',
      items: [item(A, 'g'), item(B, 'g'), item(C, 'stray'), item(D, null)],
    })
    expect(items).toEqual([item(A, 'g'), item(B, 'g'), item(C), item(D)])
  })

  it('떨어져 있는 같은 id와 문자열이 아닌 id는 묶음이 아니다', () => {
    const odd = { ...item(D), supersetId: 7 as unknown as string }
    const { items } = normalizeRoutineInput({ name: '상체', items: [item(A, 'g'), item(B), item(C, 'g'), odd] })
    expect(items).toEqual([item(A), item(B), item(C), item(D)])
  })

  it('같은 종목이 두 번 있어 하나가 빠져도 그 위아래 종목이 한 묶음이 되지 않는다', () => {
    // 가운데의 두 번째 A가 빠지면 g를 가진 B와 C가 붙지만, 원래 한 묶음이 아니었다.
    const { items } = normalizeRoutineInput({ name: '상체', items: [item(A), item(B, 'g'), item(A), item(C, 'g')] })
    expect(layout(items)).toBe('ex-a ex-b ex-c')
    expect(items).toEqual([item(A), item(B), item(C)])
  })

  it('루틴을 만들고 고칠 때 묶음을 저장한다', async () => {
    const id = await createRoutine({ name: '상체', items: [item(A, 'g'), item(B, 'g'), item(C, 'g'), item(D)] })
    expect(await routineLayout(id)).toBe('[ex-a ex-b ex-c] ex-d')
    await updateRoutine(id, { name: '상체', items: [item(A, 'g'), item(D), item(B, 'g'), item(C, 'g')] })
    expect(await routineLayout(id)).toBe('ex-a ex-d [ex-b ex-c]')
    expect((await getRoutine(id))!.items[0]).toEqual(item(A))
  })

  it('고치는 동안 종목이 지워져 하나만 남은 묶음은 풀린다', async () => {
    const before = await db.exercises.toArray()
    const draft = [item(A, 'g'), item(B, 'g'), item(C, 'h'), item(D, 'h')]
    expect(syncRoutineDraft(draft, before, before)).toBe(draft)
    const now = before.filter((e) => e.id !== B)
    expect(syncRoutineDraft(draft, before, now)).toEqual([item(A), item(C, 'h'), item(D, 'h')])
  })

  it('루틴으로 시작하면 묶음이 운동으로 따라가고 id는 새로 만든다', async () => {
    const routineId = await createRoutine({ name: '상체', items: [item(A, 'g'), item(B, 'g'), item(C), item(D)] })
    const { id } = await startWorkoutFromRoutine(routineId, 1_000)
    expect(await workoutLayout(id)).toBe('[ex-a ex-b] ex-c ex-d')
    const wes = (await loadWorkoutDetail(id))!.items.map((i) => i.we)
    expect(wes[0].supersetId).not.toBe('g')
    expect(wes[2].supersetId ?? null).toBeNull()
  })

  it('지워진 종목은 빠지고, 그 위아래 종목이 없던 묶음으로 합쳐지지 않는다', async () => {
    const routineId = await createRoutine({
      name: '상체',
      items: [item(A, 'g'), item(B, 'g'), item(C), item(D)],
    })
    // 저장된 값이 흐트러져 있어도(혼자 남은 같은 id가 지워진 종목을 사이에 두고 있어도) 묶지 않는다.
    await db.routines.update(routineId, { items: [item(A, 'x'), item(B), item(C, 'x'), item(D)] })
    await db.exercises.delete(B)
    const loose = await startWorkoutFromRoutine(routineId, 1_000)
    expect(await workoutLayout(loose.id)).toBe('ex-a ex-c ex-d')
    // 다음 운동을 시작할 수 있게 진행 중인 운동은 지운다.
    await deleteWorkout(loose.id)

    // 셋 가운데 하나가 지워지면 남은 둘은 묶음으로 남고, 둘 가운데 하나가 지워지면 풀린다.
    await db.routines.update(routineId, { items: [item(A, 'g'), item(B, 'g'), item(C, 'g'), item(D)] })
    const kept = await startWorkoutFromRoutine(routineId, 2_000)
    expect(await workoutLayout(kept.id)).toBe('[ex-a ex-c] ex-d')
    await deleteWorkout(kept.id)
    await db.exercises.delete(C)
    const single = await startWorkoutFromRoutine(routineId, 3_000)
    expect(await workoutLayout(single.id)).toBe('ex-a ex-d')
    expect((await loadWorkoutDetail(single.id))!.items.every((i) => (i.we.supersetId ?? null) === null)).toBe(true)
  })

  it('루틴 → 운동 → 루틴으로 저장을 거쳐도 묶음이 같다', async () => {
    const routineId = await createRoutine({
      name: '상체',
      items: [item(A, 'g'), item(B, 'g'), item(C), item(D, 'h')],
    })
    expect(await routineLayout(routineId)).toBe('[ex-a ex-b] ex-c ex-d')
    const { id: workoutId } = await startWorkoutFromRoutine(routineId, 1_000)
    // 운동 중에 셋째와 넷째도 묶는다.
    const third = (await loadWorkoutDetail(workoutId))!.items[2].we.id
    await linkWithNextExercise(third)
    for (const i of (await loadWorkoutDetail(workoutId))!.items) {
      await updateSet(i.sets[0].id, { weightKg: 50, reps: 10, isDone: true })
    }
    await finishWorkout(workoutId, { endedAt: 2_000 })

    const savedId = await saveWorkoutAsRoutine(workoutId, '오늘 운동')
    expect(await routineLayout(savedId)).toBe('[ex-a ex-b] [ex-c ex-d]')
    const again = await startWorkoutFromRoutine(savedId, 10_000_000)
    expect(await workoutLayout(again.id)).toBe('[ex-a ex-b] [ex-c ex-d]')
  })

  it('루틴으로 저장할 때 지워진 종목이 빠져 하나만 남은 묶음은 풀린다', async () => {
    const workoutId = await startWorkout(1_000)
    await addExercisesToWorkout(workoutId, [A, B, C])
    const first = (await loadWorkoutDetail(workoutId))!.items[0].we.id
    await linkWithNextExercise(first)
    for (const i of (await loadWorkoutDetail(workoutId))!.items) {
      await updateSet(i.sets[0].id, { weightKg: 50, reps: 10, isDone: true })
    }
    await finishWorkout(workoutId, { endedAt: 2_000 })
    await db.exercises.delete(B)

    const savedId = await saveWorkoutAsRoutine(workoutId, '오늘 운동')
    expect((await getRoutine(savedId))!.items).toEqual([
      { exerciseId: A, sets: 1, reps: 10 },
      { exerciseId: C, sets: 1, reps: 10 },
    ])
  })
})
