import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { DEFAULT_INCREMENT_KG, incrementFor, updateExerciseGoal } from './exercises'
import {
  computeRecords,
  estimate1RM,
  findNewRecords,
  getAllExerciseSessions,
  getExerciseSessions,
  summarizeSession,
} from './history'
import {
  addExerciseWithPrefill,
  addExercisesToWorkout,
  finishWorkout,
  loadWorkoutDetail,
  prefillTemplate,
  repeatWorkout,
  startWorkout,
  updateSet,
} from './workouts'

const SQUAT = 'ex-squat'
const DIPS = 'ex-dips'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await db.exercises.bulkAdd([
    { id: SQUAT, name: '스쿼트', bodyPart: 'legs', equipment: 'barbell', isCustom: false, createdAt: 0 },
    { id: DIPS, name: '딥스', bodyPart: 'chest', equipment: 'bodyweight', isCustom: false, createdAt: 0 },
  ])
})

type Row = [weightKg: number | null, reps: number, opts?: { warmup?: boolean; done?: boolean }]

/** 세트를 적고 끝낸 운동 하나. finish=false면 진행 중으로 둔다. */
async function record(startedAt: number, exerciseId: string, rows: Row[], finish = true) {
  const id = await startWorkout(startedAt)
  await addExercisesToWorkout(id, [exerciseId])
  const detail = await loadWorkoutDetail(id)
  const weId = detail!.items.find((i) => i.we.exerciseId === exerciseId)!.we.id
  await db.sets.where('workoutExerciseId').equals(weId).delete()
  await db.sets.bulkAdd(
    rows.map(([weightKg, reps, opts], i) => ({
      id: `${id}-${i}`,
      workoutExerciseId: weId,
      order: i,
      weightKg,
      reps,
      isWarmup: opts?.warmup ?? false,
      isDone: opts?.done ?? true,
    })),
  )
  if (finish) expect(await finishWorkout(id, { endedAt: startedAt + 1000 })).toBe(true)
  return id
}

describe('추정 1RM과 요약', () => {
  it('Epley 공식으로 계산한다', () => {
    expect(estimate1RM(100, 1)).toBe(100)
    expect(estimate1RM(60, 10)).toBeCloseTo(80)
    expect(estimate1RM(0, 5)).toBe(0)
    expect(estimate1RM(60, 0)).toBe(0)
  })

  it('완료한 본 세트만 요약하고, 12회를 넘는 세트는 1RM에서 뺀다', () => {
    const s = (weightKg: number | null, reps: number, isWarmup = false, isDone = true) => ({ weightKg, reps, isWarmup, isDone })
    expect(summarizeSession([s(20, 10, true), s(60, 8), s(70, 5), s(100, 3, false, false), s(40, 20)])).toEqual({
      topWeight: 70,
      bestE1rm: estimate1RM(70, 5),
      volume: 60 * 8 + 70 * 5 + 40 * 20,
      maxReps: null,
      workingSetCount: 3,
    })
    expect(summarizeSession([s(null, 12), s(0, 15)])).toMatchObject({ topWeight: null, bestE1rm: null, volume: 0, maxReps: 15 })
  })
})

describe('종목별 기록', () => {
  it('끝난 운동의 완료 세트만 오래된 것부터 준다', async () => {
    const late = await record(20_000, SQUAT, [[70, 5]])
    const early = await record(10_000, SQUAT, [[60, 5], [65, 5, { done: false }]])
    await record(30_000, SQUAT, [[80, 5]], false) // 진행 중

    const sessions = await getExerciseSessions(SQUAT)
    expect(sessions.map((s) => s.workout.id)).toEqual([early, late])
    expect(sessions[0].sets.map((s) => s.weightKg)).toEqual([60])
  })

  it('빼거나 이전 것만 볼 수 있다', async () => {
    const a = await record(10_000, SQUAT, [[60, 5]])
    const b = await record(20_000, SQUAT, [[70, 5]])
    expect((await getExerciseSessions(SQUAT, { excludeWorkoutId: a })).map((s) => s.workout.id)).toEqual([b])
    expect((await getExerciseSessions(SQUAT, { before: 20_000 })).map((s) => s.workout.id)).toEqual([a])
  })

  it('모든 종목을 한꺼번에 묶어 준다', async () => {
    await record(10_000, SQUAT, [[60, 5]])
    await record(20_000, DIPS, [[null, 10]])
    await record(30_000, SQUAT, [[70, 5]])
    const all = await getAllExerciseSessions()
    expect(all.get(SQUAT)?.map((s) => s.sets[0].weightKg)).toEqual([60, 70])
    expect(all.get(DIPS)).toHaveLength(1)
  })
})

describe('개인 기록', () => {
  it('종류별로 가장 좋은 기록과 그 세트를 찾는다', async () => {
    const a = await record(10_000, SQUAT, [[100, 1], [80, 8], [80, 8]])
    const b = await record(20_000, SQUAT, [[90, 5], [60, 20]])
    const r = computeRecords(await getExerciseSessions(SQUAT))

    expect(r.maxWeight).toMatchObject({ value: 100, workoutId: a })
    expect(r.maxWeight?.set?.reps).toBe(1)
    expect(r.bestE1rm).toMatchObject({ value: estimate1RM(90, 5), workoutId: b })
    expect(r.sessionVolume).toMatchObject({ value: 90 * 5 + 60 * 20, workoutId: b })
    expect(r.maxReps).toBeUndefined()
  })

  it('맨몸 종목은 최다 횟수를 본다', async () => {
    await record(10_000, DIPS, [[null, 10], [null, 12]])
    expect(computeRecords(await getExerciseSessions(DIPS)).maxReps?.value).toBe(12)
  })

  it('같은 값이면 먼저 세운 기록을 남긴다', async () => {
    const a = await record(10_000, SQUAT, [[100, 1]])
    await record(20_000, SQUAT, [[100, 1]])
    expect(computeRecords(await getExerciseSessions(SQUAT)).maxWeight?.workoutId).toBe(a)
  })

  it('이번 운동에서 새로 세운 기록을 찾는다(진행 중이어도)', async () => {
    await record(10_000, SQUAT, [[100, 3], [80, 8]])
    const now = await record(20_000, SQUAT, [[105, 1], [80, 8], [20, 10, { warmup: true }]], false)

    const found = await findNewRecords(now)
    expect(found.map((f) => [f.kind, f.value, f.previous])).toEqual([['maxWeight', 105, 100]])
    expect(found[0].setId).toBe(`${now}-0`)
  })

  it('처음 하는 종목이나 기록을 못 넘긴 운동은 새 기록이 없다', async () => {
    const first = await record(10_000, SQUAT, [[100, 5]])
    expect(await findNewRecords(first)).toEqual([])
    const weaker = await record(20_000, SQUAT, [[90, 5]])
    expect(await findNewRecords(weaker)).toEqual([])
  })

  it('나중에 한 운동은 비교 대상에 넣지 않는다', async () => {
    const early = await record(10_000, SQUAT, [[80, 5]])
    await record(5_000, SQUAT, [[70, 5]])
    await record(20_000, SQUAT, [[120, 5]])
    expect((await findNewRecords(early)).map((f) => f.kind)).toEqual(['maxWeight', 'bestE1rm', 'sessionVolume'])
  })
})

describe('지난 세트로 틀 만들기', () => {
  const set = (weightKg: number, reps: number, isWarmup = false) => ({
    id: `${weightKg}-${reps}`,
    workoutExerciseId: 'we',
    order: 0,
    weightKg,
    reps,
    isWarmup,
    isDone: true,
  })

  it('세트 수를 주면 웜업은 두고 본 세트를 맞춘다', () => {
    const last = [set(20, 10, true), set(60, 8), set(65, 6)]
    expect(prefillTemplate(last, 4).map((t) => [t.weightKg, t.reps, t.isWarmup])).toEqual([
      [20, 10, true],
      [60, 8, false],
      [65, 6, false],
      [65, 6, false],
      [65, 6, false],
    ])
    expect(prefillTemplate(last, 1).map((t) => t.weightKg)).toEqual([20, 60])
    expect(prefillTemplate([], 2)).toEqual([
      { weightKg: null, reps: null, isWarmup: false },
      { weightKg: null, reps: null, isWarmup: false },
    ])
  })

  it('목표 횟수를 종목 기록에 남기고, 같은 운동 다시 하기에도 따라간다', async () => {
    const id = await startWorkout(10_000)
    await db.transaction('rw', db.workouts, db.workoutExercises, db.sets, () =>
      addExerciseWithPrefill(id, SQUAT, 0, { setCount: 5, targetReps: 5 }),
    )
    const detail = await loadWorkoutDetail(id)
    expect(detail?.items[0].we.targetReps).toBe(5)
    expect(detail?.items[0].sets).toHaveLength(5)

    await updateSet(detail!.items[0].sets[0].id, { weightKg: 100, reps: 5, isDone: true })
    await finishWorkout(id, { endedAt: 11_000 })
    const again = await repeatWorkout(id, 20_000)
    expect((await loadWorkoutDetail(again.id))?.items[0].we.targetReps).toBe(5)
  })
})

describe('종목 목표', () => {
  it('증량 단위는 정한 값, 없으면 하체 5kg와 나머지 2.5kg', () => {
    expect(incrementFor({ bodyPart: 'legs' })).toBe(DEFAULT_INCREMENT_KG.legs)
    expect(incrementFor({ bodyPart: 'chest', incrementKg: null })).toBe(DEFAULT_INCREMENT_KG.other)
    expect(incrementFor({ bodyPart: 'chest', incrementKg: 1 })).toBe(1)
  })

  it('목표 횟수와 증량 단위를 바꾸고 지울 수 있다', async () => {
    await updateExerciseGoal(SQUAT, { targetReps: 5, incrementKg: 2.5 })
    expect(await db.exercises.get(SQUAT)).toMatchObject({ targetReps: 5, incrementKg: 2.5 })
    await updateExerciseGoal(SQUAT, { incrementKg: null })
    expect(await db.exercises.get(SQUAT)).toMatchObject({ targetReps: 5, incrementKg: null })
  })

  it('범위를 벗어나면 거절한다', async () => {
    await expect(updateExerciseGoal(SQUAT, { targetReps: 0 })).rejects.toThrow('목표 횟수')
    await expect(updateExerciseGoal(SQUAT, { targetReps: 5.5 })).rejects.toThrow('목표 횟수')
    await expect(updateExerciseGoal(SQUAT, { incrementKg: 0 })).rejects.toThrow('증량 단위')
    await expect(updateExerciseGoal('없는 종목', { targetReps: 5 })).rejects.toThrow('종목을 찾을 수 없습니다.')
  })
})
