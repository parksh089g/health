import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  DEFAULT_SET_COUNT,
  addExercisesToWorkout,
  addSet,
  completeSet,
  countThisWeek,
  daysWorkedThisWeek,
  deleteWorkout,
  finishWorkout,
  getActiveWorkout,
  getLastSets,
  loadWorkoutDetail,
  loadWorkoutSummaries,
  isValidRpe,
  markEnteredSetsDone,
  moveWorkoutExercise,
  prefillTemplate,
  removeSet,
  removeWorkoutExercise,
  repeatWorkout,
  setVolume,
  startWorkout,
  totalVolume,
  updateSet,
} from './workouts'

const SQUAT = 'ex-squat'
const BENCH = 'ex-bench'
const ROW = 'ex-row'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await db.exercises.bulkAdd([
    { id: SQUAT, name: '스쿼트', bodyPart: 'legs', equipment: 'barbell', isCustom: false, createdAt: 0 },
    { id: BENCH, name: '벤치프레스', bodyPart: 'chest', equipment: 'barbell', isCustom: false, createdAt: 0 },
    { id: ROW, name: '바벨 로우', bodyPart: 'back', equipment: 'barbell', isCustom: false, createdAt: 0 },
  ])
})

/** 운동 안에서 그 종목의 세트를 순서대로 가져온다. */
async function setsOf(workoutId: string, exerciseId: string) {
  const detail = await loadWorkoutDetail(workoutId)
  const item = detail?.items.find((i) => i.we.exerciseId === exerciseId)
  if (!item) throw new Error('운동에 그 종목이 없습니다.')
  return item.sets
}

/** 주어진 세트를 완료한 운동 하나를 끝까지 기록한다. */
async function recordWorkout(startedAt: number, exerciseId: string, done: [weightKg: number, reps: number][]) {
  const id = await startWorkout(startedAt)
  await addExercisesToWorkout(id, [exerciseId])
  const sets = await setsOf(id, exerciseId)
  const weId = sets[0].workoutExerciseId
  for (let i = sets.length; i < done.length; i++) await addSet(weId)
  const all = await setsOf(id, exerciseId)
  for (const [i, [weightKg, reps]] of done.entries()) {
    await updateSet(all[i].id, { weightKg, reps, isDone: true })
  }
  expect(await finishWorkout(id, { endedAt: startedAt + 3_600_000 })).toBe(true)
  return id
}

describe('운동 시작', () => {
  it('진행 중인 운동이 있으면 새로 만들지 않고 그 운동을 돌려준다', async () => {
    const first = await startWorkout()
    const second = await startWorkout()
    expect(second).toBe(first)
    expect(await db.workouts.count()).toBe(1)
    expect((await getActiveWorkout())?.id).toBe(first)
  })

  it('운동을 마치면 진행 중인 운동이 없어진다', async () => {
    await recordWorkout(Date.now(), SQUAT, [[60, 8]])
    expect(await getActiveWorkout()).toBeUndefined()
  })
})

describe('종목 추가와 지난 세트 자동 채우기', () => {
  it('처음 하는 종목은 빈 세트로 시작한다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT])
    const sets = await setsOf(id, SQUAT)
    expect(sets).toHaveLength(DEFAULT_SET_COUNT)
    for (const s of sets) expect(s).toMatchObject({ weightKg: null, reps: null, isDone: false, isWarmup: false })
  })

  it('지난번에 완료한 세트의 무게와 횟수를 미리 채운다', async () => {
    await recordWorkout(1_000, SQUAT, [
      [60, 8],
      [62.5, 6],
    ])
    const id = await startWorkout(10_000_000)
    await addExercisesToWorkout(id, [SQUAT])
    const sets = await setsOf(id, SQUAT)
    expect(sets.map((s) => [s.weightKg, s.reps, s.isDone])).toEqual([
      [60, 8, false],
      [62.5, 6, false],
    ])
  })

  it('지난번의 RPE는 가져오지 않는다', async () => {
    const past = await startWorkout(1_000)
    await addExercisesToWorkout(past, [SQUAT])
    const [warmup, first] = await setsOf(past, SQUAT)
    await updateSet(warmup.id, { weightKg: 40, reps: 10, isWarmup: true, isDone: true, rpe: 6 })
    await updateSet(first.id, { weightKg: 100, reps: 5, isDone: true, rpe: 9.5 })
    await finishWorkout(past, { endedAt: 2_000 })
    const last = await getLastSets(SQUAT)
    expect(last.map((s) => s.rpe)).toEqual([6, 9.5])

    // 종목 추가
    const id = await startWorkout(10_000_000)
    await addExercisesToWorkout(id, [SQUAT])
    const sets = await setsOf(id, SQUAT)
    expect(sets.map((s) => [s.weightKg, s.reps, s.isWarmup])).toEqual([
      [40, 10, true],
      [100, 5, false],
    ])
    for (const s of sets) expect(s.rpe ?? null).toBeNull()

    // 루틴처럼 세트 수를 맞출 때와 같은 운동 다시 하기
    for (const t of prefillTemplate(last, 3)) expect(t).not.toHaveProperty('rpe')
    await deleteWorkout(id)
    const again = await repeatWorkout(past, 20_000_000)
    for (const s of await setsOf(again.id, SQUAT)) expect(s.rpe ?? null).toBeNull()
  })

  it('가장 최근에 한 운동의 값을 쓴다', async () => {
    await recordWorkout(1_000, SQUAT, [[60, 8]])
    await recordWorkout(20_000_000, SQUAT, [[70, 5]])
    await recordWorkout(10_000_000, SQUAT, [[65, 6]])
    const last = await getLastSets(SQUAT)
    expect(last.map((s) => [s.weightKg, s.reps])).toEqual([[70, 5]])
  })

  it('진행 중인 운동은 지난 기록으로 보지 않는다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT])
    const [first] = await setsOf(id, SQUAT)
    await updateSet(first.id, { weightKg: 100, reps: 1, isDone: true })
    expect(await getLastSets(SQUAT)).toEqual([])
  })

  it('이미 들어 있는 종목은 다시 넣지 않고, 새 종목은 뒤에 붙인다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT])
    await addExercisesToWorkout(id, [SQUAT, BENCH, BENCH])
    const detail = await loadWorkoutDetail(id)
    expect(detail?.items.map((i) => i.we.exerciseId)).toEqual([SQUAT, BENCH])
  })

  it('운동 화면용 조회는 요청하면 지난 세트도 함께 준다', async () => {
    await recordWorkout(1_000, SQUAT, [[60, 8]])
    const id = await startWorkout(10_000_000)
    await addExercisesToWorkout(id, [SQUAT])
    const detail = await loadWorkoutDetail(id, { withLastSets: true })
    expect(detail?.items[0].lastSets.map((s) => [s.weightKg, s.reps])).toEqual([[60, 8]])
    expect(detail?.items[0].exercise?.name).toBe('스쿼트')
  })
})

describe('세트 고치기', () => {
  it('세트를 추가하면 바로 앞 세트의 값을 따라간다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT])
    const sets = await setsOf(id, SQUAT)
    await updateSet(sets[2].id, { weightKg: 80, reps: 5 })
    await addSet(sets[0].workoutExerciseId)
    const after = await setsOf(id, SQUAT)
    expect(after).toHaveLength(DEFAULT_SET_COUNT + 1)
    expect(after.at(-1)).toMatchObject({ weightKg: 80, reps: 5, isDone: false })
  })

  it('세트를 추가할 때 앞 세트의 RPE는 따라가지 않는다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT])
    const sets = await setsOf(id, SQUAT)
    await updateSet(sets[2].id, { weightKg: 80, reps: 5, isDone: true, rpe: 9 })
    await addSet(sets[0].workoutExerciseId)
    const added = (await setsOf(id, SQUAT)).at(-1)
    expect(added).toMatchObject({ weightKg: 80, reps: 5 })
    expect(added?.rpe ?? null).toBeNull()
  })

  it('RPE는 6부터 10까지 0.5 단위만 저장하고, 지울 수 있다', async () => {
    expect([6, 8.5, 10].every(isValidRpe)).toBe(true)
    expect([5.5, 10.5, 8.25, Number.NaN, '8', null, undefined].some(isValidRpe)).toBe(false)

    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT])
    const [first] = await setsOf(id, SQUAT)
    const rpeNow = async () => (await db.sets.get(first.id))?.rpe

    await updateSet(first.id, { rpe: 8.5 })
    expect(await rpeNow()).toBe(8.5)
    // 다른 값을 고쳐도 RPE는 그대로다.
    await updateSet(first.id, { weightKg: 60, reps: 8, isDone: true })
    expect(await rpeNow()).toBe(8.5)
    await updateSet(first.id, { rpe: 11 })
    expect(await rpeNow()).toBeNull()
    await updateSet(first.id, { rpe: 7 })
    await updateSet(first.id, { rpe: null })
    expect(await rpeNow()).toBeNull()
  })

  it('가운데 세트를 지우면 남은 세트의 순서가 빈틈없이 이어지고 값은 그대로다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT, BENCH])
    const sets = await setsOf(id, SQUAT)
    const weId = sets[0].workoutExerciseId
    await addSet(weId)
    const [warmup, first, second, third] = await setsOf(id, SQUAT)
    await updateSet(warmup.id, { weightKg: 40, reps: 10, isWarmup: true, isDone: true })
    await updateSet(first.id, { weightKg: 100, reps: 5, isDone: true, rpe: 8 })
    await updateSet(second.id, { weightKg: 100, reps: 4, isDone: true })
    await updateSet(third.id, { weightKg: 90, reps: 8 })

    await removeSet(first.id)

    const after = await setsOf(id, SQUAT)
    expect(after.map((s) => s.id)).toEqual([warmup.id, second.id, third.id])
    expect(after.map((s) => s.order)).toEqual([0, 1, 2])
    expect(after.map((s) => [s.weightKg, s.reps, s.isWarmup, s.isDone])).toEqual([
      [40, 10, true, true],
      [100, 4, false, true],
      [90, 8, false, false],
    ])
    // 다른 종목의 세트는 건드리지 않는다.
    expect((await setsOf(id, BENCH)).map((s) => s.order)).toEqual([0, 1, 2])

    // 지운 뒤에 더한 세트는 맨 뒤에 붙는다.
    await addSet(weId)
    expect((await setsOf(id, SQUAT)).map((s) => s.order)).toEqual([0, 1, 2, 3])
  })

  it('첫 세트, 마지막 세트, 하나 남은 세트도 지울 수 있다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT])
    const [a, b, c] = await setsOf(id, SQUAT)

    await removeSet(a.id)
    expect((await setsOf(id, SQUAT)).map((s) => [s.id, s.order])).toEqual([
      [b.id, 0],
      [c.id, 1],
    ])
    await removeSet(c.id)
    expect((await setsOf(id, SQUAT)).map((s) => [s.id, s.order])).toEqual([[b.id, 0]])
    await removeSet(b.id)
    expect(await setsOf(id, SQUAT)).toEqual([])

    // 이미 지워진 세트를 다시 지워도 아무 일도 없다.
    await removeSet(b.id)
    expect(await db.sets.count()).toBe(0)
  })

  it('끝난 운동에서 세트를 지워도 순서가 이어진다', async () => {
    const id = await recordWorkout(1_000, SQUAT, [
      [60, 8],
      [62.5, 6],
      [65, 4],
    ])
    const sets = await setsOf(id, SQUAT)
    await removeSet(sets[1].id)
    const after = await setsOf(id, SQUAT)
    expect(after.map((s) => [s.order, s.weightKg, s.isDone])).toEqual([
      [0, 60, true],
      [1, 65, true],
    ])
  })

  it('종목을 빼면 그 세트도 함께 지워진다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT, BENCH])
    const sets = await setsOf(id, SQUAT)
    await removeWorkoutExercise(sets[0].workoutExerciseId)
    const detail = await loadWorkoutDetail(id)
    expect(detail?.items.map((i) => i.we.exerciseId)).toEqual([BENCH])
    expect(await db.sets.count()).toBe(DEFAULT_SET_COUNT)
  })

  it('횟수가 있는 세트만 완료로 표시한다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT])
    const sets = await setsOf(id, SQUAT)
    await updateSet(sets[0].id, { weightKg: 60, reps: 8 })
    await updateSet(sets[1].id, { weightKg: 60 })

    expect(await completeSet(sets[0].id)).toBe(true)
    expect(await completeSet(sets[1].id)).toBe(false)
    expect(await completeSet('없는 세트')).toBe(false)
    expect((await setsOf(id, SQUAT)).map((s) => s.isDone)).toEqual([true, false, false])
  })

  it('횟수를 적자마자 완료를 눌러도 방금 적은 값으로 판단한다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT])
    const [first] = await setsOf(id, SQUAT)

    // 화면에서는 횟수 저장이 끝나기를 기다리지 않고 바로 완료를 누를 수 있다.
    const saving = updateSet(first.id, { reps: 8 })
    const completing = completeSet(first.id)

    expect(await completing).toBe(true)
    await saving
    expect((await setsOf(id, SQUAT))[0]).toMatchObject({ reps: 8, isDone: true })
  })

  it('횟수를 적은 세트만 한꺼번에 완료로 바꾼다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT])
    const sets = await setsOf(id, SQUAT)
    await updateSet(sets[0].id, { weightKg: 60, reps: 8 })
    await updateSet(sets[1].id, { weightKg: 60 })
    expect(await markEnteredSetsDone(id)).toBe(1)
    expect((await setsOf(id, SQUAT)).map((s) => s.isDone)).toEqual([true, false, false])
  })
})

describe('종목 순서 바꾸기', () => {
  /** 운동 안의 종목 순서와 저장된 순서 값 */
  async function orderOf(workoutId: string) {
    const detail = await loadWorkoutDetail(workoutId)
    return detail?.items.map((i) => [i.we.exerciseId, i.we.order])
  }
  async function weIdOf(workoutId: string, exerciseId: string) {
    const detail = await loadWorkoutDetail(workoutId)
    const item = detail?.items.find((i) => i.we.exerciseId === exerciseId)
    if (!item) throw new Error('운동에 그 종목이 없습니다.')
    return item.we.id
  }

  it('종목을 한 칸 위나 아래로 옮긴다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT, BENCH, ROW])

    expect(await moveWorkoutExercise(await weIdOf(id, ROW), -1)).toBe(true)
    expect(await orderOf(id)).toEqual([
      [SQUAT, 0],
      [ROW, 1],
      [BENCH, 2],
    ])
    expect(await moveWorkoutExercise(await weIdOf(id, SQUAT), 1)).toBe(true)
    expect(await orderOf(id)).toEqual([
      [ROW, 0],
      [SQUAT, 1],
      [BENCH, 2],
    ])
  })

  it('맨 위에서 위로, 맨 아래에서 아래로는 바꾸지 않는다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT, BENCH])
    expect(await moveWorkoutExercise(await weIdOf(id, SQUAT), -1)).toBe(false)
    expect(await moveWorkoutExercise(await weIdOf(id, BENCH), 1)).toBe(false)
    expect(await moveWorkoutExercise('없는 종목', 1)).toBe(false)
    expect(await orderOf(id)).toEqual([
      [SQUAT, 0],
      [BENCH, 1],
    ])
  })

  it('종목을 빼서 순서 값에 빈틈이 있어도 옮긴 뒤에는 0부터 이어진다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT, BENCH, ROW])
    await removeWorkoutExercise(await weIdOf(id, SQUAT))
    expect(await orderOf(id)).toEqual([
      [BENCH, 1],
      [ROW, 2],
    ])

    expect(await moveWorkoutExercise(await weIdOf(id, BENCH), 1)).toBe(true)
    expect(await orderOf(id)).toEqual([
      [ROW, 0],
      [BENCH, 1],
    ])
    // 새로 넣는 종목은 맨 뒤에 붙는다.
    await addExercisesToWorkout(id, [SQUAT])
    expect(await orderOf(id)).toEqual([
      [ROW, 0],
      [BENCH, 1],
      [SQUAT, 2],
    ])
  })

  it('옮겨도 세트는 그대로이고 다른 운동은 건드리지 않는다', async () => {
    const past = await startWorkout(1_000)
    await addExercisesToWorkout(past, [SQUAT, BENCH])
    for (const exerciseId of [SQUAT, BENCH]) {
      const [first] = await setsOf(past, exerciseId)
      await updateSet(first.id, { weightKg: 50, reps: 10, isDone: true })
    }
    await finishWorkout(past, { endedAt: 2_000 })

    const id = await startWorkout(10_000_000)
    await addExercisesToWorkout(id, [SQUAT, BENCH])
    const before = await setsOf(id, BENCH)
    await moveWorkoutExercise(await weIdOf(id, BENCH), -1)

    expect((await orderOf(id))?.map(([exerciseId]) => exerciseId)).toEqual([BENCH, SQUAT])
    expect(await setsOf(id, BENCH)).toEqual(before)
    expect((await orderOf(past))?.map(([exerciseId]) => exerciseId)).toEqual([SQUAT, BENCH])

    // 끝난 운동(기록 상세)에서도 옮길 수 있다.
    await moveWorkoutExercise(await weIdOf(past, BENCH), -1)
    expect(await orderOf(past)).toEqual([
      [BENCH, 0],
      [SQUAT, 1],
    ])
  })
})

describe('운동 마치기', () => {
  it('완료하지 않은 세트와 완료 세트가 없는 종목은 기록에서 뺀다', async () => {
    const id = await startWorkout(1_000)
    await addExercisesToWorkout(id, [SQUAT, BENCH])
    const sets = await setsOf(id, SQUAT)
    await updateSet(sets[0].id, { weightKg: 60, reps: 8, isDone: true })
    await updateSet(sets[1].id, { weightKg: 60, reps: 8 })

    expect(await finishWorkout(id, { memo: '  가볍게  ', endedAt: 5_000 })).toBe(true)

    const detail = await loadWorkoutDetail(id)
    expect(detail?.workout).toMatchObject({ endedAt: 5_000, memo: '가볍게' })
    expect(detail?.items.map((i) => i.we.exerciseId)).toEqual([SQUAT])
    expect(detail?.items[0].sets.map((s) => [s.weightKg, s.reps, s.isDone])).toEqual([[60, 8, true]])
  })

  it('완료한 세트가 하나도 없으면 아무것도 바꾸지 않는다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [SQUAT])
    expect(await finishWorkout(id)).toBe(false)
    expect((await getActiveWorkout())?.id).toBe(id)
    expect(await setsOf(id, SQUAT)).toHaveLength(DEFAULT_SET_COUNT)
  })

  it('운동을 지우면 종목과 세트도 함께 지워진다', async () => {
    const keep = await recordWorkout(1_000, BENCH, [[40, 10]])
    const id = await startWorkout(10_000_000)
    await addExercisesToWorkout(id, [SQUAT])
    await deleteWorkout(id)
    expect(await db.workouts.toCollection().primaryKeys()).toEqual([keep])
    expect(await db.workoutExercises.count()).toBe(1)
    expect(await db.sets.count()).toBe(1)
  })
})

describe('같은 운동 다시 하기', () => {
  it('같은 종목을 같은 순서로 넣고 최근 값으로 채운다', async () => {
    const source = await startWorkout(1_000)
    await addExercisesToWorkout(source, [BENCH, SQUAT])
    for (const exerciseId of [BENCH, SQUAT]) {
      const [first] = await setsOf(source, exerciseId)
      await updateSet(first.id, { weightKg: 50, reps: 10, isDone: true })
    }
    await finishWorkout(source, { endedAt: 2_000 })
    await recordWorkout(10_000_000, SQUAT, [[55, 9]])

    const result = await repeatWorkout(source, 20_000_000)
    expect(result.created).toBe(true)
    const detail = await loadWorkoutDetail(result.id)
    expect(detail?.workout.endedAt).toBeNull()
    expect(detail?.items.map((i) => i.we.exerciseId)).toEqual([BENCH, SQUAT])
    expect(detail?.items[0].sets.map((s) => [s.weightKg, s.reps, s.isDone])).toEqual([[50, 10, false]])
    expect(detail?.items[1].sets.map((s) => [s.weightKg, s.reps, s.isDone])).toEqual([[55, 9, false]])
  })

  it('진행 중인 운동이 있으면 새로 만들지 않는다', async () => {
    const source = await recordWorkout(1_000, SQUAT, [[60, 8]])
    const active = await startWorkout(10_000_000)
    expect(await repeatWorkout(source)).toEqual({ id: active, created: false })
    expect(await db.workouts.count()).toBe(2)
  })
})

describe('요약 값', () => {
  it('볼륨은 완료한 본 세트만 센다', () => {
    const base = { weightKg: 60, reps: 8, isWarmup: false, isDone: true }
    expect(setVolume(base)).toBe(480)
    expect(setVolume({ ...base, isWarmup: true })).toBe(0)
    expect(setVolume({ ...base, isDone: false })).toBe(0)
    expect(setVolume({ ...base, weightKg: null })).toBe(0)
    expect(totalVolume([base, { ...base, weightKg: 62.5, reps: 4 }])).toBe(730)
  })

  it('기록 목록은 끝난 운동만 최근 것부터 보여 준다', async () => {
    const older = await recordWorkout(1_000, SQUAT, [
      [60, 8],
      [60, 8],
    ])
    const newer = await recordWorkout(10_000_000, BENCH, [[40, 10]])
    await startWorkout(20_000_000)

    const summaries = await loadWorkoutSummaries()
    expect(summaries.map((s) => s.workout.id)).toEqual([newer, older])
    expect(summaries[1]).toMatchObject({ exerciseNames: ['스쿼트'], setCount: 2, volume: 960 })
  })

  it('이번 주 운동은 월요일부터 일요일까지로 센다', () => {
    const at = (month: number, day: number, hour = 10) => new Date(2026, month - 1, day, hour).getTime()
    const done = (startedAt: number) => ({ startedAt, endedAt: startedAt + 1 })
    const now = at(11, 18) // 수요일
    const workouts = [
      done(at(11, 15, 23)), // 지난주 일요일
      done(at(11, 16, 0)), // 월요일
      done(at(11, 17)), // 화요일
      done(at(11, 17, 20)), // 화요일에 한 번 더
      { startedAt: at(11, 18), endedAt: null }, // 진행 중
    ]
    expect(countThisWeek(workouts, now)).toBe(3)
    expect(daysWorkedThisWeek(workouts, now)).toEqual([true, true, false, false, false, false, false])
  })
})
