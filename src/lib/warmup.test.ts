import { beforeEach, describe, expect, it } from 'vitest'
import { db, type SetEntry } from '../db'
import { getExerciseSessions, summarizeSession } from './history'
import type { PlateSetup } from './plates'
import { applyRecommendation, getRecommendation } from './recommend'
import { DEFAULT_BAR_WEIGHT_KG, DEFAULT_PLATES } from './settings'
import { applyWarmup, buildWarmupPlan, canWarmup, planWarmup, roundToStep, workingWeight } from './warmup'
import {
  addExercisesToWorkout,
  finishWorkout,
  loadWorkoutDetail,
  startWorkout,
  totalVolume,
  updateSet,
} from './workouts'

const SQUAT = 'ex-squat'
const BENCH = 'ex-bench'
const bar: PlateSetup = { barKg: DEFAULT_BAR_WEIGHT_KG, plates: DEFAULT_PLATES }

beforeEach(async () => {
  await db.delete()
  await db.open()
  await db.exercises.bulkAdd([
    { id: SQUAT, name: '스쿼트', bodyPart: 'legs', equipment: 'barbell', isCustom: false, createdAt: 0 },
    { id: BENCH, name: '벤치프레스', bodyPart: 'chest', equipment: 'barbell', isCustom: false, createdAt: 0 },
  ])
})

describe('웜업 계획: 바벨', () => {
  it('무거운 무게는 바만 드는 세트로 시작해 40%, 60%, 80%로 올라간다', () => {
    expect(planWarmup(100, bar)).toEqual([
      { weightKg: 20, reps: 10 },
      { weightKg: 40, reps: 8 },
      { weightKg: 60, reps: 5 },
      { weightKg: 80, reps: 3 },
    ])
  })

  it('올릴 수 있는 가장 가까운 무게로 맞춘다', () => {
    // 72.5kg의 40%, 60%, 80%는 29, 43.5, 58kg. 2.5kg 이상인 원판만 써서 5kg 단위가 된다.
    expect(planWarmup(72.5, bar).map((s) => s.weightKg)).toEqual([20, 30, 45, 60])
    // 5kg보다 작은 원판이 없으면 10kg 단위로만 올릴 수 있다.
    expect(planWarmup(115, { barKg: 20, plates: [20, 10, 5] }).map((s) => s.weightKg)).toEqual([20, 50, 70, 90])
  })

  it('똑같이 가까우면 가벼운 쪽으로 맞춘다', () => {
    // 62.5kg의 60%는 37.5kg: 35kg와 40kg의 한가운데
    expect(planWarmup(62.5, bar).map((s) => s.weightKg)).toEqual([20, 25, 35, 50])
  })

  it('2.5kg보다 작은 원판만 켜져 있으면 그 원판으로 맞춘다', () => {
    // 30kg의 80%는 24kg: 한쪽에 0.5kg 원판 네 장이면 딱 맞는다.
    expect(planWarmup(30, { barKg: 20, plates: [1.25, 0.5] }).map((s) => s.weightKg)).toEqual([20, 24])
  })

  it('가벼운 무게는 바로 내려간 세트가 겹치지 않게 한 번만 넣는다', () => {
    // 30kg의 40%, 60%는 바보다 가벼워 둘 다 바 무게가 된다.
    expect(planWarmup(30, bar)).toEqual([
      { weightKg: 20, reps: 8 },
      { weightKg: 25, reps: 3 },
    ])
    expect(planWarmup(22.5, bar)).toEqual([{ weightKg: 20, reps: 8 }])
  })

  it('바 무게 이하면 웜업 세트가 없다', () => {
    expect(planWarmup(20, bar)).toEqual([])
    expect(planWarmup(15, bar)).toEqual([])
  })

  it('바 무게가 다르면 그 바에서 시작한다', () => {
    expect(planWarmup(60, { ...bar, barKg: 15 })).toEqual([
      { weightKg: 15, reps: 10 },
      { weightKg: 25, reps: 8 },
      { weightKg: 35, reps: 5 },
      { weightKg: 50, reps: 3 },
    ])
  })
})

describe('웜업 계획: 바벨이 아닌 기구', () => {
  it('20kg부터는 2.5kg 단위로 맞춘다', () => {
    expect(planWarmup(80)).toEqual([
      { weightKg: 32.5, reps: 8 },
      { weightKg: 47.5, reps: 5 },
      { weightKg: 65, reps: 3 },
    ])
  })

  it('20kg 아래는 1kg 단위로 맞춘다', () => {
    expect(planWarmup(12)).toEqual([
      { weightKg: 5, reps: 8 },
      { weightKg: 7, reps: 5 },
      { weightKg: 10, reps: 3 },
    ])
    expect(roundToStep(19.4)).toBe(19)
    expect(roundToStep(21)).toBe(20)
    expect(roundToStep(21.3)).toBe(22.5)
  })

  it('무게가 겹치는 세트와 본 세트보다 가볍지 않은 세트는 뺀다', () => {
    // 3kg: 1.2, 1.8, 2.4kg → 1, 2, 2kg
    expect(planWarmup(3)).toEqual([
      { weightKg: 1, reps: 8 },
      { weightKg: 2, reps: 5 },
    ])
    // 2kg: 0.8, 1.2, 1.6kg → 1, 1, 2kg(본 세트와 같음)
    expect(planWarmup(2)).toEqual([{ weightKg: 1, reps: 8 }])
  })

  it('아주 가벼우면 비어 있다', () => {
    expect(planWarmup(1)).toEqual([])
    expect(planWarmup(0)).toEqual([])
  })
})

describe('웜업을 만들 수 있는 종목', () => {
  it('맨몸, 시간, 유산소 종목과 지워진 종목은 안 된다', () => {
    expect(canWarmup({ equipment: 'barbell' })).toBe(true)
    expect(canWarmup({ equipment: 'dumbbell', measure: 'reps' })).toBe(true)
    expect(canWarmup({ equipment: 'bodyweight' })).toBe(false)
    expect(canWarmup({ equipment: 'other', measure: 'time' })).toBe(false)
    expect(canWarmup({ equipment: 'machine', measure: 'cardio' })).toBe(false)
    expect(canWarmup(undefined)).toBe(false)
  })
})

type Row = [weightKg: number | null, opts?: { warmup?: boolean; done?: boolean }]
const rows = (list: Row[]) =>
  list.map(([weightKg, opts]) => ({ weightKg, isWarmup: opts?.warmup ?? false, isDone: opts?.done ?? false }))

describe('지금 세트로 계획 세우기', () => {
  it('무게를 적은 첫 본 세트가 기준이다', () => {
    expect(workingWeight(rows([[40, { warmup: true }], [null], [100], [110]]))).toBe(100)
    expect(workingWeight(rows([[40, { warmup: true }], [null], [0]]))).toBeNull()
  })

  it('본 세트에 무게가 없으면 계획이 없다', () => {
    expect(buildWarmupPlan(rows([[null], [null]]), bar)).toEqual({ workingKg: null, steps: [], replaces: 0 })
  })

  it('아직 하지 않은 웜업 세트는 바뀔 세트로 센다', () => {
    const plan = buildWarmupPlan(rows([[20, { warmup: true }], [50, { warmup: true }], [100]]), bar)
    expect(plan.replaces).toBe(2)
    expect(plan.steps.map((s) => s.weightKg)).toEqual([20, 40, 60, 80])
  })

  it('완료한 웜업 세트가 있으면 그보다 무거운 것만 넣는다', () => {
    const plan = buildWarmupPlan(
      rows([[20, { warmup: true, done: true }], [40, { warmup: true, done: true }], [60, { warmup: true }], [100]]),
      bar,
    )
    expect(plan).toEqual({
      workingKg: 100,
      steps: [
        { weightKg: 60, reps: 5 },
        { weightKg: 80, reps: 3 },
      ],
      replaces: 1,
    })
  })
})

/** 스쿼트를 넣은 운동을 시작한다. 지난 기록이 없으면 세트는 빈 본 세트 3개다. */
async function startSquat(now = Date.now()) {
  const workoutId = await startWorkout(now)
  await addExercisesToWorkout(workoutId, [SQUAT])
  const sets = await setsOf(workoutId)
  return { workoutId, weId: sets[0].workoutExerciseId, sets }
}

async function setsOf(workoutId: string): Promise<SetEntry[]> {
  const detail = await loadWorkoutDetail(workoutId)
  return detail?.items[0]?.sets ?? []
}

/** 세트를 "W20x10", 완료했으면 "W20x10!"처럼 */
const brief = (sets: SetEntry[]) =>
  sets.map((s) => `${s.isWarmup ? 'W' : ''}${s.weightKg ?? ''}x${s.reps ?? ''}${s.isDone ? '!' : ''}`)

describe('세트에 넣기', () => {
  it('첫 본 세트 앞에 무게와 횟수를 채운 웜업 세트를 넣고 순서를 빈틈없이 매긴다', async () => {
    const { workoutId, weId, sets } = await startSquat()
    for (const s of sets) await updateSet(s.id, { weightKg: 100, reps: 5 })

    await applyWarmup(weId, planWarmup(100, bar))

    const after = await setsOf(workoutId)
    expect(brief(after)).toEqual(['W20x10', 'W40x8', 'W60x5', 'W80x3', '100x5', '100x5', '100x5'])
    expect(after.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(after.slice(0, 4).every((s) => s.isWarmup && !s.isDone && s.workoutExerciseId === weId)).toBe(true)
    // 본 세트는 그대로다(id와 순서만 뒤로 밀린다).
    expect(after.slice(4).map((s) => s.id)).toEqual(sets.map((s) => s.id))
    expect(new Set(after.map((s) => s.id)).size).toBe(7)
  })

  it('아직 하지 않은 웜업 세트만 바꾸고 완료한 세트는 지우지 않는다', async () => {
    const { workoutId, weId, sets } = await startSquat()
    for (const s of sets) await updateSet(s.id, { weightKg: 100, reps: 5 })
    await applyWarmup(weId, planWarmup(100, bar))
    const first = await setsOf(workoutId)
    // 바만 드는 세트와 첫 본 세트를 끝낸 뒤, 본 세트 무게를 110kg로 올려 다시 만든다.
    await updateSet(first[0].id, { isDone: true })
    await updateSet(first[4].id, { weightKg: 110, isDone: true })

    const plan = buildWarmupPlan(await setsOf(workoutId), bar)
    expect(plan.replaces).toBe(3)
    await applyWarmup(weId, plan.steps)

    const after = await setsOf(workoutId)
    expect(brief(after)).toEqual(['W20x10!', 'W45x8', 'W65x5', 'W90x3', '110x5!', '100x5', '100x5'])
    expect(after.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(after[0].id).toBe(first[0].id)
    expect(after[4].id).toBe(first[4].id)
    // 지워진 것은 하지 않은 웜업 세트 3개뿐이다.
    expect(await db.sets.bulkGet(first.slice(1, 4).map((s) => s.id))).toEqual([undefined, undefined, undefined])
  })

  it('본 세트 사이에 끼어 있던 웜업 세트를 지워도 순서에 빈틈이 없다', async () => {
    const { workoutId, weId, sets } = await startSquat()
    await updateSet(sets[0].id, { weightKg: 60, reps: 5 })
    await updateSet(sets[1].id, { isWarmup: true, weightKg: 30, reps: 5 })
    await updateSet(sets[2].id, { weightKg: 60, reps: 5 })

    await applyWarmup(weId, [{ weightKg: 40, reps: 5 }])

    const after = await setsOf(workoutId)
    expect(brief(after)).toEqual(['W40x5', '60x5', '60x5'])
    expect(after.map((s) => s.order)).toEqual([0, 1, 2])
  })

  it('본 세트가 없으면 맨 뒤에 넣고, 넣을 것이 없으면 아무것도 바꾸지 않는다', async () => {
    const { workoutId, weId, sets } = await startSquat()
    for (const s of sets) await updateSet(s.id, { isWarmup: true, weightKg: 20, reps: 10, isDone: true })
    await applyWarmup(weId, [{ weightKg: 40, reps: 8 }])
    expect(brief(await setsOf(workoutId))).toEqual(['W20x10!', 'W20x10!', 'W20x10!', 'W40x8'])

    await applyWarmup(weId, [])
    expect(brief(await setsOf(workoutId))).toEqual(['W20x10!', 'W20x10!', 'W20x10!', 'W40x8'])
  })

  it('다른 종목의 세트는 건드리지 않는다', async () => {
    const { workoutId, weId } = await startSquat()
    await addExercisesToWorkout(workoutId, [BENCH])
    const before = (await loadWorkoutDetail(workoutId))?.items[1].sets

    await applyWarmup(weId, planWarmup(100, bar))

    expect((await loadWorkoutDetail(workoutId))?.items[1].sets).toEqual(before)
  })
})

describe('넣은 웜업 세트는 볼륨과 추천에 들어가지 않는다', () => {
  it('완료해도 볼륨, 본 세트 수, 최고 중량에 들어가지 않는다', async () => {
    const { workoutId, weId, sets } = await startSquat()
    for (const s of sets) await updateSet(s.id, { weightKg: 100, reps: 5, isDone: true })
    await applyWarmup(weId, planWarmup(100, bar))
    for (const s of await setsOf(workoutId)) await updateSet(s.id, { isDone: true })

    const done = await setsOf(workoutId)
    expect(done).toHaveLength(7)
    expect(totalVolume(done)).toBe(1500)
    expect(summarizeSession(done)).toMatchObject({ topWeight: 100, volume: 1500, workingSetCount: 3 })
  })

  it('다음 운동의 추천은 본 세트만 보고, 적용해도 웜업 세트는 그대로다', async () => {
    const first = await startSquat(1_000)
    for (const s of first.sets) await updateSet(s.id, { weightKg: 100, reps: 5, isDone: true })
    await applyWarmup(first.weId, planWarmup(100, bar))
    for (const s of await setsOf(first.workoutId)) await updateSet(s.id, { isDone: true })
    expect(await finishWorkout(first.workoutId, { endedAt: 2_000 })).toBe(true)
    expect((await getExerciseSessions(SQUAT))[0].sets).toHaveLength(7)

    // 다음 운동은 지난번 웜업 세트까지 미리 채워진다.
    const second = await startSquat(10_000)
    expect(brief(second.sets)).toEqual(['W20x10', 'W40x8', 'W60x5', 'W80x3', '100x5', '100x5', '100x5'])

    // 추천은 웜업 80kg × 3회가 아니라 본 세트 100kg × 5회를 보고 5kg(하체)를 올린다.
    const rec = await getRecommendation({ workoutId: second.workoutId, exerciseId: SQUAT })
    expect(rec).toMatchObject({ kind: 'increase', weightKg: 105, reps: 5, fromWeightKg: 100 })
    if (!rec) return

    // 추천을 적용하면 본 세트만 바뀐다.
    await applyRecommendation(second.weId, rec)
    const applied = await setsOf(second.workoutId)
    expect(brief(applied)).toEqual(['W20x10', 'W40x8', 'W60x5', 'W80x3', '105x5', '105x5', '105x5'])
  })
})
