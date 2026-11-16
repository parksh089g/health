import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  createRoutine,
  defaultRoutineName,
  deleteRoutine,
  getRoutine,
  listRoutines,
  loadRoutineViews,
  saveWorkoutAsRoutine,
  startWorkoutFromRoutine,
  summarizeNames,
  syncRoutineDraft,
  updateRoutine,
} from './routines'
import { addExercisesToWorkout, addSet, finishWorkout, loadWorkoutDetail, startWorkout, updateSet } from './workouts'

const SQUAT = 'ex-squat'
const BENCH = 'ex-bench'
const CURL = 'ex-curl'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await db.exercises.bulkAdd([
    { id: SQUAT, name: '스쿼트', bodyPart: 'legs', equipment: 'barbell', isCustom: false, createdAt: 0 },
    { id: BENCH, name: '벤치프레스', bodyPart: 'chest', equipment: 'barbell', isCustom: false, createdAt: 0 },
    { id: CURL, name: '바벨 컬', bodyPart: 'arms', equipment: 'barbell', isCustom: false, createdAt: 0 },
  ])
})

const item = (exerciseId: string, sets = 3, reps: number | null = null) => ({ exerciseId, sets, reps })

/** 운동 안의 종목별 세트를 [무게, 횟수, 웜업] 목록으로 가져온다. */
async function setsByExercise(workoutId: string) {
  const detail = await loadWorkoutDetail(workoutId)
  if (!detail) throw new Error('운동이 없습니다.')
  return detail.items.map((i) => ({
    exerciseId: i.we.exerciseId,
    targetReps: i.we.targetReps,
    sets: i.sets.map((s) => [s.weightKg, s.reps, s.isWarmup]),
  }))
}

/** [무게, 횟수, 웜업] 세트를 모두 완료한 운동 하나를 끝까지 기록한다. */
async function recordWorkout(startedAt: number, exerciseId: string, done: [number, number, boolean][]) {
  const id = await startWorkout(startedAt)
  await addExercisesToWorkout(id, [exerciseId])
  const detail = await loadWorkoutDetail(id)
  const weId = detail!.items[0].we.id
  for (let i = detail!.items[0].sets.length; i < done.length; i++) await addSet(weId)
  const sets = (await loadWorkoutDetail(id))!.items[0].sets
  for (const [i, [weightKg, reps, isWarmup]] of done.entries()) {
    await updateSet(sets[i].id, { weightKg, reps, isWarmup, isDone: true })
  }
  // 남은 세트는 완료하지 않은 채로 두면 마칠 때 빠진다.
  expect(await finishWorkout(id, { endedAt: startedAt + 3_600_000 })).toBe(true)
  return id
}

describe('루틴 만들기와 고치기', () => {
  it('이름을 다듬고 종목을 순서대로 저장한다', async () => {
    const id = await createRoutine({ name: '  하체   날 ', items: [item(SQUAT, 5, 5), item(BENCH, 3, null)] }, 1_000)
    expect(await getRoutine(id)).toEqual({
      id,
      name: '하체 날',
      items: [item(SQUAT, 5, 5), item(BENCH, 3, null)],
      createdAt: 1_000,
      updatedAt: 1_000,
      lastUsedAt: null,
    })
  })

  it('같은 종목이 두 번 있으면 처음 것만 남긴다', async () => {
    const id = await createRoutine({ name: '밀기', items: [item(BENCH, 4), item(SQUAT), item(BENCH, 2)] })
    expect((await getRoutine(id))?.items).toEqual([item(BENCH, 4), item(SQUAT)])
  })

  it.each([
    ['빈 이름', { name: '   ', items: [item(SQUAT)] }, '루틴 이름을 입력해 주세요.'],
    ['31자 이름', { name: '가'.repeat(31), items: [item(SQUAT)] }, '30자까지'],
    ['종목 없음', { name: '하체', items: [] }, '종목을 하나 이상'],
    ['세트 0', { name: '하체', items: [item(SQUAT, 0)] }, '세트 수는 1~10세트'],
    ['세트 11', { name: '하체', items: [item(SQUAT, 11)] }, '세트 수는 1~10세트'],
    ['소수 세트', { name: '하체', items: [item(SQUAT, 2.5)] }, '세트 수는 1~10세트'],
    ['횟수 0', { name: '하체', items: [item(SQUAT, 3, 0)] }, '목표 횟수는 1~100회'],
    ['횟수 101', { name: '하체', items: [item(SQUAT, 3, 101)] }, '목표 횟수는 1~100회'],
    ['소수 횟수', { name: '하체', items: [item(SQUAT, 3, 7.5)] }, '목표 횟수는 1~100회'],
  ])('맞지 않는 입력은 거절한다: %s', async (_, input, message) => {
    await expect(createRoutine(input)).rejects.toThrow(message)
    expect(await db.routines.count()).toBe(0)
  })

  it('경계값은 받는다', async () => {
    const id = await createRoutine({ name: '가'.repeat(30), items: [item(SQUAT, 1, 1), item(BENCH, 10, 100)] })
    expect((await getRoutine(id))?.items).toEqual([item(SQUAT, 1, 1), item(BENCH, 10, 100)])
  })

  it('고치면 이름과 종목, 고친 시각만 바뀐다', async () => {
    const id = await createRoutine({ name: '하체', items: [item(SQUAT)] }, 1_000)
    await db.routines.update(id, { lastUsedAt: 2_000 })
    await updateRoutine(id, { name: '하체 날', items: [item(BENCH, 2, 8), item(SQUAT, 4, 6)] }, 3_000)
    expect(await getRoutine(id)).toMatchObject({
      name: '하체 날',
      items: [item(BENCH, 2, 8), item(SQUAT, 4, 6)],
      createdAt: 1_000,
      updatedAt: 3_000,
      lastUsedAt: 2_000,
    })
  })

  it('고칠 때도 입력을 확인하고, 없는 루틴은 오류를 낸다', async () => {
    const id = await createRoutine({ name: '하체', items: [item(SQUAT)] })
    await expect(updateRoutine(id, { name: '', items: [item(SQUAT)] })).rejects.toThrow('루틴 이름')
    expect((await getRoutine(id))?.name).toBe('하체')
    await expect(updateRoutine('nope', { name: '하체', items: [item(SQUAT)] })).rejects.toThrow('루틴을 찾을 수 없습니다.')
  })

  it('저장할 때 지워진 종목은 빼고, 남는 종목이 없으면 오류를 낸다', async () => {
    const id = await createRoutine({ name: '하체', items: [item('ex-gone', 3, 10), item(SQUAT, 4, 5)] })
    expect((await getRoutine(id))?.items).toEqual([item(SQUAT, 4, 5)])

    await updateRoutine(id, { name: '하체', items: [item(BENCH, 3, 8), item('ex-gone')] })
    expect((await getRoutine(id))?.items).toEqual([item(BENCH, 3, 8)])

    await expect(updateRoutine(id, { name: '하체', items: [item('ex-gone')] })).rejects.toThrow('종목을 하나 이상')
    await expect(createRoutine({ name: '없음', items: [item('ex-gone')] })).rejects.toThrow('종목을 하나 이상')
  })

  it('고치는 동안 종목이 지워지거나 횟수와 시간이 바뀌면 고치던 내용을 맞춘다', async () => {
    const before = await db.exercises.toArray()
    const draft = [item(SQUAT, 4, 5), item(BENCH, 3, 8), item(CURL, 2, null)]
    // 바뀐 것이 없으면 그대로
    expect(syncRoutineDraft(draft, before, before)).toBe(draft)

    const now = before
      .filter((e) => e.id !== SQUAT)
      .map((e) => (e.id === BENCH || e.id === CURL ? { ...e, measure: 'time' as const } : e))
    expect(syncRoutineDraft(draft, before, now)).toEqual([item(BENCH, 3, null), item(CURL, 2, null)])
  })

  it('지운다', async () => {
    const id = await createRoutine({ name: '하체', items: [item(SQUAT)] })
    await deleteRoutine(id)
    expect(await getRoutine(id)).toBeUndefined()
  })
})

describe('루틴 목록', () => {
  it('최근에 쓰거나 고친 것부터(새로 만든 루틴이 홈 위쪽에 보이도록)', async () => {
    const a = await createRoutine({ name: 'A', items: [item(SQUAT)] }, 1_000)
    const b = await createRoutine({ name: 'B', items: [item(SQUAT)] }, 2_000)
    const c = await createRoutine({ name: 'C', items: [item(SQUAT)] }, 3_000)
    const d = await createRoutine({ name: 'D', items: [item(SQUAT)] }, 4_000)
    await db.routines.update(a, { lastUsedAt: 5_000 })
    await db.routines.update(b, { lastUsedAt: 6_000 })
    await updateRoutine(c, { name: 'C', items: [item(BENCH)] }, 7_000)
    expect((await listRoutines()).map((r) => r.id)).toEqual([c, b, a, d])
    const e = await createRoutine({ name: 'E', items: [item(SQUAT)] }, 8_000)
    expect((await listRoutines())[0].id).toBe(e)
  })

  it('종목 이름을 붙이고, 지워진 종목을 표시한다', async () => {
    await createRoutine({ name: '상체', items: [item(BENCH), item(CURL), item(SQUAT)] })
    await db.exercises.delete(CURL)
    const [view] = await loadRoutineViews()
    expect(view.names).toEqual(['벤치프레스', '지워진 종목', '스쿼트'])
    expect(view.missingCount).toBe(1)
    expect(view.entries.map((e) => e.exercise?.id)).toEqual([BENCH, undefined, SQUAT])
  })

  it('종목 이름 요약', () => {
    expect(summarizeNames([])).toBe('')
    expect(summarizeNames(['스쿼트'])).toBe('스쿼트')
    expect(summarizeNames(['스쿼트', '레그 프레스'])).toBe('스쿼트, 레그 프레스')
    expect(summarizeNames(['스쿼트', '레그 프레스', '레그 컬', '카프 레이즈'])).toBe('스쿼트, 레그 프레스 외 2개')
  })
})

describe('루틴으로 운동 시작', () => {
  it('루틴의 순서, 세트 수, 목표 횟수로 운동을 만들고 마지막으로 쓴 시각을 남긴다', async () => {
    const routineId = await createRoutine({ name: '전신', items: [item(BENCH, 2, 10), item(SQUAT, 4, null)] })
    const now = new Date(2026, 10, 16, 19, 0).getTime()
    const result = await startWorkoutFromRoutine(routineId, now)
    expect(result.created).toBe(true)

    const workout = await db.workouts.get(result.id)
    expect(workout).toMatchObject({ routineId, startedAt: now, date: '2026-11-16', endedAt: null })
    expect(await setsByExercise(result.id)).toEqual([
      // 처음 하는 종목이라 무게는 비우고 목표 횟수만 채운다.
      { exerciseId: BENCH, targetReps: 10, sets: Array(2).fill([null, 10, false]) },
      { exerciseId: SQUAT, targetReps: null, sets: Array(4).fill([null, null, false]) },
    ])
    expect((await getRoutine(routineId))?.lastUsedAt).toBe(now)
  })

  it('지난 기록으로 채우고, 웜업은 그대로 두고 본 세트 수를 루틴에 맞춘다', async () => {
    await recordWorkout(1_000, SQUAT, [
      [40, 10, true],
      [100, 5, false],
      [105, 3, false],
    ])
    await recordWorkout(2_000, BENCH, [
      [60, 8, false],
      [60, 8, false],
      [60, 7, false],
    ])
    const routineId = await createRoutine({ name: '전신', items: [item(SQUAT, 4, 5), item(BENCH, 2, 8)] })
    const { id } = await startWorkoutFromRoutine(routineId, 10_000_000)
    expect(await setsByExercise(id)).toEqual([
      {
        exerciseId: SQUAT,
        targetReps: 5,
        sets: [
          [40, 10, true],
          [100, 5, false],
          [105, 3, false],
          [105, 3, false],
          [105, 3, false],
        ],
      },
      {
        exerciseId: BENCH,
        targetReps: 8,
        sets: [
          [60, 8, false],
          [60, 8, false],
        ],
      },
    ])
  })

  it('지워진 종목은 건너뛴다', async () => {
    const routineId = await createRoutine({ name: '상체', items: [item(BENCH), item(CURL), item(SQUAT)] })
    await db.exercises.delete(CURL)
    const { id } = await startWorkoutFromRoutine(routineId)
    const detail = await loadWorkoutDetail(id)
    expect(detail?.items.map((i) => [i.we.exerciseId, i.we.order])).toEqual([
      [BENCH, 0],
      [SQUAT, 1],
    ])
  })

  it('진행 중인 운동이 있으면 아무것도 만들지 않고 그 운동을 돌려준다', async () => {
    const routineId = await createRoutine({ name: '하체', items: [item(SQUAT)] })
    const activeId = await startWorkout()
    expect(await startWorkoutFromRoutine(routineId)).toEqual({ id: activeId, created: false })
    expect(await db.workouts.count()).toBe(1)
    expect(await db.workoutExercises.count()).toBe(0)
    expect((await getRoutine(routineId))?.lastUsedAt).toBeNull()
  })

  it('없는 루틴이나 남은 종목이 없는 루틴은 오류를 내고 아무것도 만들지 않는다', async () => {
    await expect(startWorkoutFromRoutine('nope')).rejects.toThrow('루틴을 찾을 수 없습니다.')
    const routineId = await createRoutine({ name: '팔', items: [item(CURL)] })
    await db.exercises.delete(CURL)
    await expect(startWorkoutFromRoutine(routineId)).rejects.toThrow('남아 있는 종목이 없습니다')
    expect(await db.workouts.count()).toBe(0)
    expect((await getRoutine(routineId))?.lastUsedAt).toBeNull()
  })
})

describe('운동 기록을 루틴으로 저장', () => {
  it('완료한 본 세트 수와 첫 본 세트의 횟수로 루틴을 만든다', async () => {
    const workoutId = await startWorkout(1_000)
    await addExercisesToWorkout(workoutId, [SQUAT, BENCH, CURL])
    const detail = (await loadWorkoutDetail(workoutId))!
    const [squat, bench] = detail.items
    // 스쿼트: 웜업 1 + 본 세트 2 완료, 1세트는 완료하지 않음
    await updateSet(squat.sets[0].id, { weightKg: 40, reps: 10, isWarmup: true, isDone: true })
    await updateSet(squat.sets[1].id, { weightKg: 100, reps: 5, isDone: true })
    await updateSet(squat.sets[2].id, { weightKg: 100, reps: 4, isDone: true })
    await addSet(squat.we.id)
    // 벤치: 루틴에서 온 목표 횟수가 있으면 그것을 쓴다
    await db.workoutExercises.update(bench.we.id, { targetReps: 12 })
    await updateSet(bench.sets[0].id, { weightKg: 60, reps: 8, isDone: true })
    // 바벨 컬: 완료한 세트가 없다
    const routineId = await saveWorkoutAsRoutine(workoutId, ' 오늘 운동 ', 5_000)
    expect(await getRoutine(routineId)).toEqual({
      id: routineId,
      name: '오늘 운동',
      items: [item(SQUAT, 2, 5), item(BENCH, 1, 12), item(CURL, 1, null)],
      createdAt: 5_000,
      updatedAt: 5_000,
      lastUsedAt: null,
    })
  })

  it('끝난 기록에서도 만들고, 지워진 종목은 빼며, 세트 수는 10까지만', async () => {
    const many = Array.from({ length: 12 }, (_, i) => [50, 12 - i, false] as [number, number, boolean])
    const squatWorkout = await recordWorkout(1_000, SQUAT, many)
    await addExercisesToWorkout(squatWorkout, [CURL])
    await db.exercises.delete(CURL)
    const routineId = await saveWorkoutAsRoutine(squatWorkout, '스쿼트만')
    expect((await getRoutine(routineId))?.items).toEqual([item(SQUAT, 10, 12)])
  })

  it('이름이 맞지 않거나 기록이 없으면 오류를 낸다', async () => {
    const workoutId = await recordWorkout(1_000, SQUAT, [[100, 5, false]])
    await expect(saveWorkoutAsRoutine(workoutId, '')).rejects.toThrow('루틴 이름을 입력해 주세요.')
    await expect(saveWorkoutAsRoutine('nope', '하체')).rejects.toThrow('운동 기록을 찾을 수 없습니다.')
    const empty = await startWorkout()
    await expect(saveWorkoutAsRoutine(empty, '빈 운동')).rejects.toThrow('저장할 종목이 없습니다')
    expect(await db.routines.count()).toBe(0)
  })

  it('저장한 루틴으로 다시 시작하면 같은 구성이 된다', async () => {
    const workoutId = await recordWorkout(1_000, SQUAT, [
      [40, 10, true],
      [100, 5, false],
      [100, 5, false],
    ])
    const routineId = await saveWorkoutAsRoutine(workoutId, '하체')
    const { id } = await startWorkoutFromRoutine(routineId, 10_000_000)
    expect(await setsByExercise(id)).toEqual([
      {
        exerciseId: SQUAT,
        targetReps: 5,
        sets: [
          [40, 10, true],
          [100, 5, false],
          [100, 5, false],
        ],
      },
    ])
  })

  it('미리 넣어 줄 이름은 종목 이름, 길면 날짜', () => {
    const startedAt = new Date(2026, 10, 16, 19, 0).getTime()
    expect(defaultRoutineName(['스쿼트', '레그 프레스', '레그 컬'], startedAt)).toBe('스쿼트, 레그 프레스 외 1개')
    expect(defaultRoutineName(['라잉 트라이셉스 익스텐션', '사이드 레터럴 레이즈', '크런치'], startedAt)).toBe('11월 16일 운동')
    expect(defaultRoutineName([], startedAt)).toBe('11월 16일 운동')
  })
})
