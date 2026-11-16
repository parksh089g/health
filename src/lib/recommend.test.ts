import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Exercise } from '../db'
import {
  applyRecommendation,
  deloadWeight,
  getRecommendation,
  getWorkoutRecommendations,
  isRecommendationApplied,
  recommendNext,
  type RecommendSession,
} from './recommend'
import { addExerciseWithPrefill, addExercisesToWorkout, finishWorkout, loadWorkoutDetail, startWorkout } from './workouts'

type Row = [weightKg: number | null, reps: number | null, opts?: { warmup?: boolean; done?: boolean }]

const chest: Pick<Exercise, 'bodyPart' | 'incrementKg' | 'targetReps'> = { bodyPart: 'chest' }
const legs: Pick<Exercise, 'bodyPart' | 'incrementKg' | 'targetReps'> = { bodyPart: 'legs' }

/** 지난 기록 한 번(순수 함수용). at이 클수록 최근 */
function session(at: number, rows: Row[], targetReps?: number | null): RecommendSession {
  return {
    workout: { id: `w${at}`, startedAt: at },
    we: targetReps === undefined ? {} : { targetReps },
    sets: rows.map(([weightKg, reps, opts]) => ({
      weightKg,
      reps,
      isWarmup: opts?.warmup ?? false,
      isDone: opts?.done ?? true,
    })),
  }
}

/** 같은 무게로 같은 횟수를 n세트 */
const sets = (weightKg: number | null, reps: number, n = 3): Row[] => Array.from({ length: n }, () => [weightKg, reps])

describe('지난 기록이 없을 때', () => {
  it('기록이 없으면 추천하지 않는다', () => {
    expect(recommendNext(chest, [])).toBeNull()
  })

  it('완료한 본 세트가 없는 기록은 없는 것으로 본다', () => {
    const warmupOnly = session(1, [[20, 10, { warmup: true }]])
    const notDone = session(2, [[60, 8, { done: false }]])
    const noReps = session(3, [[60, null], [60, 0]])
    expect(recommendNext(chest, [warmupOnly, notDone, noReps])).toBeNull()
  })
})

describe('목표를 채웠을 때: 무게를 올린다', () => {
  it('상체는 2.5kg 올리고 목표 횟수를 그대로 둔다', () => {
    expect(recommendNext({ ...chest, targetReps: 8 }, [session(1, sets(60, 8))])).toEqual({
      kind: 'increase',
      weightKg: 62.5,
      reps: 8,
      reason: '지난번 3세트 모두 8회를 채웠어요',
      basedOnWorkoutId: 'w1',
    })
  })

  it('하체는 5kg 올린다', () => {
    expect(recommendNext({ ...legs, targetReps: 5 }, [session(1, sets(100, 5))])).toMatchObject({
      kind: 'increase',
      weightKg: 105,
      reps: 5,
    })
  })

  it('목표보다 많이 한 세트도 채운 것으로 본다', () => {
    expect(recommendNext({ ...chest, targetReps: 8 }, [session(1, [[60, 10], [60, 9], [60, 8]])])).toMatchObject({
      kind: 'increase',
      weightKg: 62.5,
      reps: 8,
    })
  })

  it('종목에 정한 증량 단위를 쓴다', () => {
    const ex = { ...chest, targetReps: 10, incrementKg: 1 }
    expect(recommendNext(ex, [session(1, sets(20, 10))])).toMatchObject({ kind: 'increase', weightKg: 21 })
    expect(recommendNext({ ...legs, incrementKg: 2.5 }, [session(1, sets(100, 5))])?.weightKg).toBe(102.5)
  })

  it('소수 무게도 오차 없이 더한다', () => {
    expect(recommendNext({ ...chest, targetReps: 8 }, [session(1, sets(62.5, 8))])?.weightKg).toBe(65)
    expect(recommendNext({ ...chest, incrementKg: 1.25 }, [session(1, sets(61.25, 8))])?.weightKg).toBe(62.5)
    // 10.1 + 0.2 = 10.299999999999999 이 되지 않는다.
    expect(recommendNext({ ...chest, incrementKg: 0.2 }, [session(1, sets(10.1, 12))])?.weightKg).toBe(10.3)
  })

  it('가장 무거운 세트가 하나뿐이면 이유에 그 무게를 쓴다', () => {
    expect(recommendNext({ ...chest, targetReps: 5 }, [session(1, [[60, 8], [70, 5]])])).toMatchObject({
      kind: 'increase',
      weightKg: 72.5,
      reps: 5,
      reason: '지난번 70kg로 5회를 채웠어요',
    })
  })
})

describe('목표를 못 채웠을 때: 같은 무게', () => {
  it('한 세트라도 못 채우면 같은 무게로 목표 횟수를 다시 한다', () => {
    expect(recommendNext({ ...chest, targetReps: 8 }, [session(1, [[60, 8], [60, 8], [60, 7]])])).toEqual({
      kind: 'keep',
      weightKg: 60,
      reps: 8,
      reason: '8회를 못 채운 세트가 있어서 같은 무게로 다시 해요',
      basedOnWorkoutId: 'w1',
    })
  })

  it('소수 무게도 그대로 둔다', () => {
    expect(recommendNext({ ...chest, targetReps: 8 }, [session(1, [[62.5, 8], [62.5, 6]])])).toMatchObject({
      kind: 'keep',
      weightKg: 62.5,
      reps: 8,
    })
  })
})

describe('어떤 세트를 보는지', () => {
  it('웜업은 무겁더라도 보지 않는다', () => {
    const rows: Row[] = [[20, 10, { warmup: true }], [100, 1, { warmup: true }], ...sets(60, 8)]
    expect(recommendNext({ ...chest, targetReps: 8 }, [session(1, rows)])).toMatchObject({
      kind: 'increase',
      weightKg: 62.5,
    })
  })

  it('완료하지 않은 세트는 보지 않는다', () => {
    const rows: Row[] = [...sets(60, 8), [60, 3, { done: false }], [80, 8, { done: false }]]
    expect(recommendNext({ ...chest, targetReps: 8 }, [session(1, rows)])).toMatchObject({
      kind: 'increase',
      weightKg: 62.5,
    })
  })

  it('피라미드 세트는 가장 무거운 무게로 한 세트들만 판단한다', () => {
    // 목표가 없으면 가장 무거운 첫 세트의 횟수(4회)가 목표가 된다.
    const pyramid: Row[] = [[60, 8], [62.5, 6], [70, 4]]
    expect(recommendNext(legs, [session(1, pyramid)])).toMatchObject({ kind: 'increase', weightKg: 75, reps: 4 })
    // 가벼운 세트에서 목표를 못 채운 것은 상관없다.
    const withTarget: Row[] = [[50, 6], [70, 8], [70, 8]]
    expect(recommendNext({ ...chest, targetReps: 8 }, [session(1, withTarget)])).toMatchObject({
      kind: 'increase',
      weightKg: 72.5,
      reps: 8,
      reason: '지난번 2세트 모두 8회를 채웠어요',
    })
    // 가장 무거운 세트 중 하나라도 못 채우면 그 무게를 유지한다.
    const missed: Row[] = [[60, 10], [70, 8], [70, 6]]
    expect(recommendNext({ ...chest, targetReps: 8 }, [session(1, missed)])).toMatchObject({
      kind: 'keep',
      weightKg: 70,
      reps: 8,
    })
  })

  it('가장 최근 기록을 본다(넘겨준 순서와 상관없이)', () => {
    const older = session(1, sets(60, 5))
    const newer = session(2, sets(80, 8))
    expect(recommendNext({ ...chest, targetReps: 8 }, [newer, older])).toMatchObject({
      weightKg: 82.5,
      basedOnWorkoutId: 'w2',
    })
  })

  it('가장 최근 기록에 본 세트가 없으면 그 앞 기록을 본다', () => {
    const real = session(1, sets(60, 8))
    const warmupOnly = session(2, [[20, 10, { warmup: true }]])
    expect(recommendNext({ ...chest, targetReps: 8 }, [real, warmupOnly])).toMatchObject({
      weightKg: 62.5,
      basedOnWorkoutId: 'w1',
    })
  })

  it('맨몸 세트가 섞여 있어도 무게를 단 세트로 판단한다', () => {
    const rows: Row[] = [[null, 12], [10, 8], [10, 8]]
    expect(recommendNext({ ...chest, targetReps: 8 }, [session(1, rows)])).toMatchObject({
      kind: 'increase',
      weightKg: 12.5,
      reps: 8,
    })
  })
})

describe('목표 횟수를 정하는 순서', () => {
  const rows: Row[] = [[60, 6], [60, 6], [60, 5]]

  it('지난 기록의 목표를 가장 먼저 쓴다', () => {
    const r = recommendNext({ ...chest, targetReps: 10 }, [session(1, rows, 5)], 8)
    expect(r).toMatchObject({ kind: 'increase', weightKg: 62.5, reps: 5 })
  })

  it('그다음은 오늘의 목표', () => {
    expect(recommendNext({ ...chest, targetReps: 10 }, [session(1, rows, null)], 5)).toMatchObject({
      kind: 'increase',
      reps: 5,
    })
    expect(recommendNext({ ...chest, targetReps: 5 }, [session(1, rows)], 6)).toMatchObject({ kind: 'keep', reps: 6 })
  })

  it('그다음은 종목의 목표', () => {
    expect(recommendNext({ ...chest, targetReps: 5 }, [session(1, rows)], null)).toMatchObject({
      kind: 'increase',
      reps: 5,
    })
    expect(recommendNext({ ...chest, targetReps: 6 }, [session(1, rows)])).toMatchObject({ kind: 'keep', reps: 6 })
  })

  it('목표가 없으면 그 무게로 한 첫 세트의 횟수를 쓴다', () => {
    // 6, 6, 5 → 6회를 못 채운 세트가 있다
    expect(recommendNext(chest, [session(1, rows)])).toMatchObject({ kind: 'keep', weightKg: 60, reps: 6 })
    // 6, 8 → 모두 6회 이상
    expect(recommendNext(chest, [session(1, [[60, 6], [60, 8]])])).toMatchObject({
      kind: 'increase',
      weightKg: 62.5,
      reps: 6,
    })
  })

  it('0회 같은 이상한 목표는 없는 것으로 본다', () => {
    expect(recommendNext({ ...chest, targetReps: 0 }, [session(1, rows, 0)], 0)).toMatchObject({ reps: 6 })
  })
})

describe('정체: 같은 무게에서 3번 연속 못 채우면 낮춘다', () => {
  const miss = (at: number, w = 80) => session(at, [[w, 8], [w, 7], [w, 6]])

  it('약 10% 낮추고 증량 단위의 배수로 내린다', () => {
    // 80 × 0.9 = 72 → 2.5의 배수로 내려 70
    expect(recommendNext({ ...chest, targetReps: 8 }, [miss(1), miss(2), miss(3)])).toEqual({
      kind: 'deload',
      weightKg: 70,
      reps: 8,
      reason: '3번 연속 8회를 못 채워서 무게를 조금 낮춰요',
      basedOnWorkoutId: 'w3',
    })
    // 하체: 100 × 0.9 = 90
    expect(recommendNext({ ...legs, targetReps: 8 }, [miss(1, 100), miss(2, 100), miss(3, 100)])).toMatchObject({
      kind: 'deload',
      weightKg: 90,
    })
  })

  it('두 번까지는 같은 무게를 유지한다', () => {
    expect(recommendNext({ ...chest, targetReps: 8 }, [miss(1), miss(2)])).toMatchObject({ kind: 'keep', weightKg: 80 })
  })

  it('3번 중 한 번이라도 채웠거나 무게가 달랐으면 낮추지 않는다', () => {
    const ok = session(2, sets(80, 8))
    expect(recommendNext({ ...chest, targetReps: 8 }, [miss(1), ok, miss(3)])).toMatchObject({ kind: 'keep' })
    expect(recommendNext({ ...chest, targetReps: 8 }, [miss(1, 77.5), miss(2), miss(3)])).toMatchObject({
      kind: 'keep',
    })
    // 더 오래전의 실패는 세지 않는다.
    expect(recommendNext({ ...chest, targetReps: 8 }, [miss(1), miss(2), ok, miss(4), miss(5)])).toMatchObject({
      kind: 'keep',
    })
  })

  it('낮춘 무게 계산: 증량 단위보다 낮게 내리지 않는다', () => {
    expect(deloadWeight(62.5, 2.5)).toBe(55) // 56.25 → 55
    expect(deloadWeight(100, 5)).toBe(90)
    expect(deloadWeight(50, 1.25)).toBe(45)
    expect(deloadWeight(5, 2.5)).toBe(2.5) // 4.5 → 2.5
    expect(deloadWeight(2.5, 2.5)).toBe(2.5)
  })

  it('더 낮출 수 없으면 같은 무게를 유지한다', () => {
    const tiny = (at: number) => session(at, [[2.5, 8], [2.5, 6]])
    expect(recommendNext({ ...chest, targetReps: 8 }, [tiny(1), tiny(2), tiny(3)])).toMatchObject({
      kind: 'keep',
      weightKg: 2.5,
    })
  })
})

describe('맨몸 종목', () => {
  it('지난번 가장 많이 한 횟수보다 1회 더', () => {
    expect(recommendNext(chest, [session(1, [[null, 10], [null, 12], [0, 9]])])).toEqual({
      kind: 'addReps',
      weightKg: null,
      reps: 13,
      reason: '지난번 최고 12회보다 1회 더 해 봐요',
      basedOnWorkoutId: 'w1',
    })
  })

  it('웜업과 완료하지 않은 세트는 보지 않는다', () => {
    const rows: Row[] = [[null, 20, { warmup: true }], [null, 8], [null, 15, { done: false }]]
    expect(recommendNext(chest, [session(1, rows)])).toMatchObject({ kind: 'addReps', reps: 9 })
  })
})

describe('추천 적용', () => {
  const BENCH = 'ex-bench'
  const DIPS = 'ex-dips'

  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.exercises.bulkAdd([
      { id: BENCH, name: '벤치프레스', bodyPart: 'chest', equipment: 'barbell', isCustom: false, createdAt: 0 },
      { id: DIPS, name: '딥스', bodyPart: 'chest', equipment: 'bodyweight', isCustom: false, createdAt: 0 },
    ])
  })

  /** 운동 하나에 세트를 적는다. finish=false면 진행 중으로 둔다. */
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
    return { id, weId }
  }

  it('지금 운동은 빼고 끝난 기록으로 추천한다', async () => {
    await record(10_000, BENCH, sets(57.5, 8))
    const last = await record(20_000, BENCH, sets(60, 8))
    const now = await record(30_000, BENCH, sets(100, 8), false)
    const we = (await db.workoutExercises.get(now.weId))!
    expect(await getRecommendation({ ...we, targetReps: 8 })).toMatchObject({
      kind: 'increase',
      weightKg: 62.5,
      reps: 8,
      basedOnWorkoutId: last.id,
    })
  })

  it('오늘의 목표 횟수(루틴에서 온 값)를 쓴다', async () => {
    await record(10_000, BENCH, [[60, 8], [60, 8], [60, 6]])
    const id = await startWorkout(20_000)
    await db.transaction('rw', db.workouts, db.workoutExercises, db.sets, () =>
      addExerciseWithPrefill(id, BENCH, 0, { setCount: 3, targetReps: 6 }),
    )
    const recs = await getWorkoutRecommendations(id)
    expect([...recs.values()]).toMatchObject([{ kind: 'increase', weightKg: 62.5, reps: 6 }])
  })

  it('지난 기록이 없거나 종목이 지워졌으면 null', async () => {
    const id = await startWorkout(10_000)
    await addExercisesToWorkout(id, [BENCH, DIPS])
    await db.exercises.delete(DIPS)
    const recs = await getWorkoutRecommendations(id)
    expect(recs.size).toBe(2)
    expect([...recs.values()]).toEqual([null, null])
  })

  it('아직 완료하지 않은 본 세트에만 채운다', async () => {
    await record(10_000, BENCH, sets(60, 8))
    const now = await record(
      20_000,
      BENCH,
      [[20, 10, { warmup: true, done: false }], [60, 8], [60, 7, { done: false }], [null, null, { done: false }]],
      false,
    )
    const rec = await getRecommendation((await db.workoutExercises.get(now.weId))!)
    expect(rec).toMatchObject({ weightKg: 62.5, reps: 8 })

    expect(await applyRecommendation(now.weId, rec!)).toBe(2)
    const after = await db.sets.where('workoutExerciseId').equals(now.weId).sortBy('order')
    expect(after.map((s) => [s.weightKg, s.reps, s.isWarmup, s.isDone])).toEqual([
      [20, 10, true, false],
      [60, 8, false, true],
      [62.5, 8, false, false],
      [62.5, 8, false, false],
    ])
  })

  it('맨몸 추천은 횟수만 바꾼다', async () => {
    const now = await record(10_000, DIPS, [[null, 10, { done: false }], [5, 10, { done: false }]], false)
    expect(await applyRecommendation(now.weId, { weightKg: null, reps: 13 })).toBe(2)
    const after = await db.sets.where('workoutExerciseId').equals(now.weId).sortBy('order')
    expect(after.map((s) => [s.weightKg, s.reps])).toEqual([
      [null, 13],
      [5, 13],
    ])
  })

  it('적용했는지: 남은 본 세트가 모두 추천 값이면 true', () => {
    const s = (weightKg: number | null, reps: number | null, isWarmup = false, isDone = false) => ({
      weightKg,
      reps,
      isWarmup,
      isDone,
    })
    const rec = { weightKg: 62.5, reps: 8 }
    expect(isRecommendationApplied([s(20, 10, true), s(60, 8, false, true), s(62.5, 8), s(62.5, 8)], rec)).toBe(true)
    expect(isRecommendationApplied([s(62.5, 8), s(62.5, 7)], rec)).toBe(false)
    expect(isRecommendationApplied([s(60, 8), s(62.5, 8)], rec)).toBe(false)
    // 남은 세트가 없으면 적용할 것도 없다.
    expect(isRecommendationApplied([s(62.5, 8, false, true)], rec)).toBe(false)
    // 맨몸 추천은 횟수만 본다.
    expect(isRecommendationApplied([s(null, 13), s(0, 13)], { weightKg: null, reps: 13 })).toBe(true)
  })
})
