import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Exercise, type SetEntry } from '../db'
import { SEED_EXERCISES } from '../seed'
import {
  MEASURE_LOCKED_MESSAGE,
  addCustomExercise,
  ensureSeedExercises,
  exerciseKindText,
  updateCustomExercise,
  updateExerciseGoal,
} from './exercises'
import {
  computeRecords,
  findNewRecords,
  formatRecordValue,
  getExerciseSessions,
  recordKindsFor,
  recordLabel,
  summarizeSession,
} from './history'
import {
  formatSetShort,
  formatTarget,
  isSetEntered,
  isTimed,
  measureOf,
  targetLabel,
  usesAddedWeight,
} from './measure'
import {
  applyRecommendation,
  formatRecommendation,
  getWorkoutRecommendations,
  isRecommendationApplied,
  recommendNext,
  setsToApply,
  type RecommendSession,
} from './recommend'
import { createRoutine, getRoutine, saveWorkoutAsRoutine, startWorkoutFromRoutine } from './routines'
import {
  availableMetrics,
  bodyPartSets,
  exerciseOverviews,
  exerciseSeries,
  formatMetric,
  formatSetsSummary,
  loadStatsData,
  metricLabel,
  weeklyTotals,
} from './stats'
import {
  addExercisesToWorkout,
  addSet,
  completeSet,
  deleteWorkout,
  finishWorkout,
  loadWorkoutDetail,
  loadWorkoutSummaries,
  markEnteredSetsDone,
  prefillTemplate,
  repeatWorkout,
  setVolume,
  startWorkout,
  totalVolume,
  updateSet,
} from './workouts'

const PLANK = 'seed:plank'
const PULL_UP = 'seed:pull-up'
const SQUAT = 'seed:squat'
const NEW_TIME_SEEDS = ['seed:plank', 'seed:side-plank', 'seed:dead-hang', 'seed:wall-sit']

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureSeedExercises()
})

/** 세트 한 줄: [무게, 횟수, 시간(초)] */
type Row = [weightKg: number | null, reps: number | null, durationSec?: number | null, opts?: { warmup?: boolean; done?: boolean }]

function toSet(row: Row, i = 0): SetEntry {
  const [weightKg, reps, durationSec, opts] = row
  const set: SetEntry = {
    id: `s${i}`,
    workoutExerciseId: 'we',
    order: i,
    weightKg,
    reps,
    isWarmup: opts?.warmup ?? false,
    isDone: opts?.done ?? true,
  }
  if (durationSec !== undefined) set.durationSec = durationSec
  return set
}

/** 세트를 적고 끝낸 운동 하나. finish=false면 진행 중으로 둔다. */
async function record(startedAt: number, rowsByExercise: Record<string, Row[]>, finish = true) {
  const id = await startWorkout(startedAt)
  await addExercisesToWorkout(id, Object.keys(rowsByExercise))
  const detail = await loadWorkoutDetail(id)
  for (const [exerciseId, rows] of Object.entries(rowsByExercise)) {
    const weId = detail!.items.find((i) => i.we.exerciseId === exerciseId)!.we.id
    await db.sets.where('workoutExerciseId').equals(weId).delete()
    await db.sets.bulkAdd(rows.map((row, i) => ({ ...toSet(row, i), id: `${id}-${exerciseId}-${i}`, workoutExerciseId: weId })))
  }
  if (finish) expect(await finishWorkout(id, { endedAt: startedAt + 1000 })).toBe(true)
  return id
}

/** 추천(순수 함수)에 넣는 지난 기록 한 번 */
function session(at: number, rows: Row[], targetReps?: number | null): RecommendSession {
  return { workout: { id: `w${at}`, startedAt: at }, we: targetReps === undefined ? {} : { targetReps }, sets: rows.map(toSet) }
}

const pullUp: Pick<Exercise, 'bodyPart' | 'equipment'> = { bodyPart: 'back', equipment: 'bodyweight' }
const plank: Pick<Exercise, 'bodyPart' | 'equipment' | 'measure' | 'targetReps'> = {
  bodyPart: 'core',
  equipment: 'bodyweight',
  measure: 'time',
}

describe('재는 방법과 표기', () => {
  it('measure가 없으면 횟수, time이면 시간 종목', () => {
    expect(measureOf({})).toBe('reps')
    expect(measureOf({ measure: null })).toBe('reps')
    expect(measureOf(undefined)).toBe('reps')
    expect(isTimed({ measure: 'time' })).toBe(true)
    expect(usesAddedWeight({ equipment: 'bodyweight' })).toBe(true)
    expect(usesAddedWeight({ equipment: 'barbell' })).toBe(false)
  })

  it('목표는 시간 종목이면 초로 읽는다', () => {
    expect(targetLabel({ measure: 'time' })).toBe('목표 시간')
    expect(targetLabel({})).toBe('목표 횟수')
    expect(formatTarget({ measure: 'time' }, 60)).toBe('60초')
    expect(formatTarget({}, 8)).toBe('8회')
    expect(exerciseKindText({ bodyPart: 'core', equipment: 'bodyweight', measure: 'time' })).toBe('코어 · 맨몸 · 시간 종목')
    expect(exerciseKindText({ bodyPart: 'back', equipment: 'bodyweight' })).toBe('등 · 맨몸')
  })

  it('횟수나 시간을 적은 세트만 입력한 세트로 본다', () => {
    expect(isSetEntered({ reps: 8 })).toBe(true)
    expect(isSetEntered({ reps: null, durationSec: 60 })).toBe(true)
    expect(isSetEntered({ reps: null })).toBe(false)
    expect(isSetEntered({ reps: 0, durationSec: 0 })).toBe(false)
    expect(isSetEntered({ reps: null, durationSec: null })).toBe(false)
  })

  it('세트를 짧게 쓴다: 추가 무게는 +, 시간 세트는 초', () => {
    expect(formatSetShort({ weightKg: 60, reps: 8 })).toBe('60×8')
    expect(formatSetShort({ weightKg: null, reps: 8 })).toBe('8회')
    expect(formatSetShort({ weightKg: 10, reps: 8 }, { addedWeight: true })).toBe('+10×8')
    expect(formatSetShort({ weightKg: null, reps: 8 }, { addedWeight: true })).toBe('8회')
    expect(formatSetShort({ weightKg: null, reps: null, durationSec: 60 })).toBe('60초')
    expect(formatSetShort({ weightKg: 10, reps: null, durationSec: 45 }, { addedWeight: true })).toBe('+10kg×45초')

    const sets = [[10, 5], [10, 5], [null, 8]].map(([w, r], i) => toSet([w, r], i))
    expect(formatSetsSummary(sets, { addedWeight: true })).toBe('+10×5×2 · 8회')
    expect(formatSetsSummary([toSet([null, null, 60]), toSet([null, null, 60]), toSet([null, null, 45])])).toBe('60초×2 · 45초')
  })
})

describe('기본 종목: 시간 종목 네 개', () => {
  it('플랭크, 사이드 플랭크, 매달리기, 월 싯이 시간 종목으로 들어 있다', async () => {
    const rows = await db.exercises.bulkGet(NEW_TIME_SEEDS)
    expect(rows.map((e) => [e?.name, e?.bodyPart, e?.equipment, e?.measure])).toEqual([
      ['플랭크', 'core', 'bodyweight', 'time'],
      ['사이드 플랭크', 'core', 'bodyweight', 'time'],
      ['매달리기', 'back', 'bodyweight', 'time'],
      ['월 싯', 'legs', 'bodyweight', 'time'],
    ])
    // 그 밖의 기본 종목은 횟수로 둔다.
    expect(SEED_EXERCISES.filter((s) => s.measure === 'time').map((s) => s.id).sort()).toEqual([...NEW_TIME_SEEDS].sort())
  })

  it('이미 쓰던 폰에는 네 개가 한 번만 더해진다', async () => {
    // 이번 종목이 생기기 전의 폰: 네 종목이 없다.
    await db.exercises.bulkDelete(NEW_TIME_SEEDS)
    const before = await db.exercises.count()
    await ensureSeedExercises()
    expect(await db.exercises.count()).toBe(before + 4)
    await ensureSeedExercises()
    await ensureSeedExercises()
    expect(await db.exercises.count()).toBe(before + 4)
    expect((await db.exercises.toArray()).filter((e) => e.name === '플랭크')).toHaveLength(1)
  })

  it('같은 이름의 내 종목이 먼저 있으면 그 종목을 그대로 둔다', async () => {
    await db.exercises.delete(PLANK)
    const mine = await addCustomExercise({ name: '플랭크', bodyPart: 'core', equipment: 'bodyweight' })
    await ensureSeedExercises()
    expect(await db.exercises.get(PLANK)).toBeUndefined()
    expect(measureOf(await db.exercises.get(mine))).toBe('reps')
  })
})

describe('내 종목의 재는 방법', () => {
  it('시간 종목으로 만들 수 있고, 횟수 종목에는 칸을 만들지 않는다', async () => {
    const hold = await addCustomExercise({ name: 'L싯', bodyPart: 'core', equipment: 'bodyweight', measure: 'time' })
    const curl = await addCustomExercise({ name: '리버스 컬', bodyPart: 'arms', equipment: 'barbell', measure: 'reps' })
    expect((await db.exercises.get(hold))?.measure).toBe('time')
    expect(await db.exercises.get(curl)).not.toHaveProperty('measure')
  })

  it('기록이 없으면 바꿀 수 있고, 목표 값은 단위가 달라지므로 지운다', async () => {
    const id = await addCustomExercise({ name: 'L싯', bodyPart: 'core', equipment: 'bodyweight' })
    await updateExerciseGoal(id, { targetReps: 10 })
    const routineId = await createRoutine({
      name: '코어',
      items: [
        { exerciseId: id, sets: 3, reps: 10 },
        { exerciseId: SQUAT, sets: 3, reps: 5 },
      ],
    })

    await updateCustomExercise(id, { name: 'L싯', bodyPart: 'core', equipment: 'bodyweight', measure: 'time' })
    expect(await db.exercises.get(id)).toMatchObject({ measure: 'time', targetReps: null })
    expect((await getRoutine(routineId))?.items).toEqual([
      { exerciseId: id, sets: 3, reps: null },
      { exerciseId: SQUAT, sets: 3, reps: 5 },
    ])
  })

  it('기록이 있으면(진행 중인 운동 포함) 바꾸지 못하고, 다른 값은 그대로 고칠 수 있다', async () => {
    const id = await addCustomExercise({ name: 'L싯', bodyPart: 'core', equipment: 'bodyweight', measure: 'time' })
    const workoutId = await startWorkout(1000)
    await addExercisesToWorkout(workoutId, [id])

    await expect(
      updateCustomExercise(id, { name: 'L싯', bodyPart: 'core', equipment: 'bodyweight', measure: 'reps' }),
    ).rejects.toThrow(MEASURE_LOCKED_MESSAGE)
    expect((await db.exercises.get(id))?.measure).toBe('time')

    // 재는 방법을 그대로 두면(또는 주지 않으면) 이름과 부위는 바꿀 수 있다.
    await updateCustomExercise(id, { name: 'L 싯', bodyPart: 'arms', equipment: 'bodyweight', measure: 'time' })
    await updateCustomExercise(id, { name: 'L 싯 홀드', bodyPart: 'core', equipment: 'bodyweight' })
    expect(await db.exercises.get(id)).toMatchObject({ name: 'L 싯 홀드', bodyPart: 'core', measure: 'time' })
  })

  it('목표 시간은 600초까지, 목표 횟수는 100회까지 받는다', async () => {
    await updateExerciseGoal(PLANK, { targetReps: 120 })
    expect((await db.exercises.get(PLANK))?.targetReps).toBe(120)
    await expect(updateExerciseGoal(PLANK, { targetReps: 601 })).rejects.toThrow('목표 시간은 1~600초로')
    await expect(updateExerciseGoal(SQUAT, { targetReps: 120 })).rejects.toThrow('목표 횟수는 1~100회로')
    await updateExerciseGoal(PLANK, { targetReps: null })
    expect((await db.exercises.get(PLANK))?.targetReps).toBeNull()
  })
})

describe('세트를 입력했는지', () => {
  it('시간을 적은 세트도 완료로 표시하고, 아무것도 없으면 표시하지 않는다', async () => {
    const id = await startWorkout(1000)
    await addExercisesToWorkout(id, [PLANK])
    const [a, b] = (await loadWorkoutDetail(id))!.items[0].sets
    await updateSet(a.id, { durationSec: 60 })
    expect(await completeSet(a.id)).toBe(true)
    expect(await completeSet(b.id)).toBe(false)
    expect((await db.sets.get(a.id))?.isDone).toBe(true)
    expect((await db.sets.get(b.id))?.isDone).toBe(false)
  })

  it('시간을 적은 세트도 한꺼번에 완료로 바꾸고, 운동을 마치면 기록에 남는다', async () => {
    const id = await startWorkout(1000)
    await addExercisesToWorkout(id, [PLANK, PULL_UP])
    const [plankItem, pullItem] = (await loadWorkoutDetail(id))!.items
    await updateSet(plankItem.sets[0].id, { durationSec: 45 })
    await updateSet(plankItem.sets[1].id, { weightKg: 10 }) // 무게만 적은 세트는 입력한 것으로 보지 않는다
    await updateSet(pullItem.sets[0].id, { weightKg: 10, reps: 5 })

    expect(await markEnteredSetsDone(id)).toBe(2)
    expect(await finishWorkout(id, { endedAt: 2000 })).toBe(true)
    const done = (await loadWorkoutDetail(id))!
    expect(done.items.map((i) => i.sets.map((s) => [s.weightKg, s.reps, s.durationSec ?? null]))).toEqual([
      [[null, null, 45]],
      [[10, 5, null]],
    ])
    expect((await loadWorkoutSummaries())[0]).toMatchObject({ setCount: 2, volume: 50, exerciseNames: ['플랭크', '풀업'] })
  })
})

describe('지난 세트 자동 채우기', () => {
  it('시간 종목은 지난번 버틴 시간을 채우고 횟수는 비워 둔다', async () => {
    await record(1000, { [PLANK]: [[null, null, 60], [null, null, 45], [5, null, 30]] })
    const id = await startWorkout(5000)
    await addExercisesToWorkout(id, [PLANK])
    const sets = (await loadWorkoutDetail(id, { withLastSets: true }))!.items[0]
    expect(sets.sets.map((s) => [s.weightKg, s.reps, s.durationSec, s.isDone])).toEqual([
      [null, null, 60, false],
      [null, null, 45, false],
      [5, null, 30, false],
    ])
    expect(sets.lastSets.map((s) => s.durationSec)).toEqual([60, 45, 30])
  })

  it('횟수 종목의 세트에는 시간 칸을 만들지 않는다', async () => {
    await record(1000, { [PULL_UP]: [[10, 5], [null, 8]] })
    const id = await startWorkout(5000)
    await addExercisesToWorkout(id, [PULL_UP])
    const sets = (await loadWorkoutDetail(id))!.items[0].sets
    expect(sets.map((s) => [s.weightKg, s.reps])).toEqual([[10, 5], [null, 8]])
    for (const s of sets) expect(s).not.toHaveProperty('durationSec')
  })

  it('처음 하는 시간 종목은 목표 시간을 시간 칸에 채운다', () => {
    expect(prefillTemplate([], 2, 60, true)).toEqual([
      { weightKg: null, reps: null, isWarmup: false, durationSec: 60 },
      { weightKg: null, reps: null, isWarmup: false, durationSec: 60 },
    ])
    expect(prefillTemplate([], undefined, undefined, true).map((t) => [t.reps, t.durationSec])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ])
    // 세트 수를 늘리면 마지막 본 세트의 시간을 되풀이한다.
    const last = [toSet([null, null, 60], 0), toSet([null, null, 40], 1)]
    expect(prefillTemplate(last, 3, 60, true).map((t) => t.durationSec)).toEqual([60, 40, 40])
  })

  it('세트를 더하면 앞 세트의 시간을 따라간다', async () => {
    const id = await startWorkout(1000)
    await addExercisesToWorkout(id, [PLANK, PULL_UP])
    const [plankItem, pullItem] = (await loadWorkoutDetail(id))!.items
    await updateSet(plankItem.sets[2].id, { weightKg: 5, durationSec: 50 })
    await addSet(plankItem.we.id)
    await updateSet(pullItem.sets[2].id, { weightKg: 10, reps: 5 })
    await addSet(pullItem.we.id)
    const after = (await loadWorkoutDetail(id))!.items
    expect(after[0].sets.at(-1)).toMatchObject({ weightKg: 5, reps: null, durationSec: 50, isDone: false })
    expect(after[1].sets.at(-1)).toMatchObject({ weightKg: 10, reps: 5 })
    expect(after[1].sets.at(-1)).not.toHaveProperty('durationSec')
  })

  it('같은 운동 다시 하기와 루틴으로 시작하기도 시간을 채운다', async () => {
    const first = await record(1000, { [PLANK]: [[null, null, 60], [null, null, 50]], [PULL_UP]: [[10, 5]] })
    const again = await repeatWorkout(first, 5000)
    const items = (await loadWorkoutDetail(again.id))!.items
    expect(items[0].sets.map((s) => s.durationSec)).toEqual([60, 50])
    expect(items[1].sets.map((s) => [s.weightKg, s.reps])).toEqual([[10, 5]])
    await deleteWorkout(again.id)

    // 루틴의 reps는 시간 종목이면 목표 시간(초)이다.
    const routineId = await createRoutine({ name: '코어', items: [{ exerciseId: 'seed:side-plank', sets: 2, reps: 40 }] })
    const started = await startWorkoutFromRoutine(routineId, 9000)
    const item = (await loadWorkoutDetail(started.id))!.items[0]
    expect(item.we.targetReps).toBe(40)
    expect(item.sets.map((s) => [s.reps, s.durationSec])).toEqual([[null, 40], [null, 40]])
  })
})

describe('루틴과 시간 종목', () => {
  it('목표 시간은 600초까지 받고, 횟수 종목은 100회까지만 받는다', async () => {
    const id = await createRoutine({ name: '버티기', items: [{ exerciseId: PLANK, sets: 3, reps: 180 }] })
    expect((await getRoutine(id))?.items[0].reps).toBe(180)
    await expect(createRoutine({ name: '버티기 2', items: [{ exerciseId: PLANK, sets: 3, reps: 601 }] })).rejects.toThrow(
      '목표 시간은 1~600초로 정하거나 비워 두세요.',
    )
    await expect(createRoutine({ name: '하체', items: [{ exerciseId: SQUAT, sets: 3, reps: 180 }] })).rejects.toThrow(
      '목표 횟수는 1~100회로 정하거나 비워 두세요.',
    )
  })

  it('운동을 루틴으로 저장하면 첫 본 세트의 시간이 목표 시간이 된다', async () => {
    const id = await record(1000, {
      [PLANK]: [[null, null, 20, { warmup: true }], [null, null, 75], [null, null, 60]],
      [PULL_UP]: [[10, 5], [10, 5], [null, 8]],
    })
    const routineId = await saveWorkoutAsRoutine(id, '등과 코어')
    expect((await getRoutine(routineId))?.items).toEqual([
      { exerciseId: PLANK, sets: 2, reps: 75 },
      { exerciseId: PULL_UP, sets: 3, reps: 5 },
    ])
  })
})

describe('추천: 맨몸 종목과 추가 무게', () => {
  it('지난번에 맨몸으로만 했으면 1회 더', () => {
    expect(recommendNext(pullUp, [session(1, [[null, 8], [null, 7], [0, 6]])])).toMatchObject({
      kind: 'addReps',
      weightKg: null,
      reps: 9,
      fromWeightKg: null,
    })
  })

  it('지난번에 추가 무게를 달았으면 그 무게를 무게 종목처럼 올린다', () => {
    const rec = recommendNext({ ...pullUp, targetReps: 5 }, [session(1, [[10, 5], [10, 5], [10, 6]])])
    expect(rec).toMatchObject({ kind: 'increase', weightKg: 12.5, reps: 5, fromWeightKg: 10 })
    expect(formatRecommendation(rec!, { addedWeight: true })).toBe('+12.5kg × 5')
    // 종목에 정한 증량 단위를 쓴다.
    expect(recommendNext({ ...pullUp, incrementKg: 1.25 }, [session(1, [[10, 5], [10, 5]])])?.weightKg).toBe(11.25)
    // 가장 무거운 세트가 하나뿐이면 이유에 추가 무게를 쓴다.
    expect(recommendNext(pullUp, [session(1, [[10, 5]])])?.reason).toBe('지난번 +10kg로 5회를 채웠어요')
  })

  it('목표를 못 채웠으면 같은 추가 무게, 3번 연속이면 낮춘다', () => {
    const missed = (at: number) => session(at, [[20, 5], [20, 4], [20, 3]], 5)
    expect(recommendNext(pullUp, [missed(1)])).toMatchObject({ kind: 'keep', weightKg: 20, reps: 5, fromWeightKg: 20 })
    expect(recommendNext(pullUp, [missed(1), missed(2), missed(3)])).toMatchObject({ kind: 'deload', weightKg: 17.5, reps: 5 })
  })

  it('맨몸 세트가 섞여 있어도 추가 무게 세트로 판단한다', () => {
    const mixed = session(1, [[10, 5], [10, 5], [null, 9]])
    expect(recommendNext(pullUp, [mixed])).toMatchObject({ kind: 'increase', weightKg: 12.5, reps: 5, fromWeightKg: 10 })
    // 한동안 추가 무게로 하다가 지난번에 맨몸으로만 했으면 다시 1회 더.
    expect(recommendNext(pullUp, [mixed, session(2, [[null, 10]])])).toMatchObject({ kind: 'addReps', reps: 11 })
  })

  it('무게 추천은 추가 무게 세트와 빈 세트에만, 맨몸 세트는 그대로 둔다', () => {
    const s = (weightKg: number | null, reps: number | null, isDone = false) => ({ weightKg, reps, isWarmup: false, isDone })
    const sets = [s(10, 5), s(10, 5), s(null, 9), s(null, null)]
    const rec = { weightKg: 12.5, reps: 5, fromWeightKg: 10 }
    expect(setsToApply(sets, rec, { addedWeight: true })).toEqual([sets[0], sets[1], sets[3]])
    // 무게 종목은 전과 같이 무게가 빈 세트를 모두 채운다.
    expect(setsToApply(sets, rec)).toEqual(sets)

    expect(isRecommendationApplied(sets, rec, { addedWeight: true })).toBe(false)
    const applied = [s(12.5, 5), s(12.5, 5), s(null, 9)]
    expect(isRecommendationApplied(applied, rec, { addedWeight: true })).toBe(true)
    expect(isRecommendationApplied(applied, rec)).toBe(false)
  })

  it('횟수 추천은 맨몸 세트에만 채운다', () => {
    const s = (weightKg: number | null, reps: number | null) => ({ weightKg, reps, isWarmup: false, isDone: false })
    const sets = [s(10, 5), s(null, 8), s(null, 8)]
    const rec = { weightKg: null, reps: 9, fromWeightKg: null }
    expect(setsToApply(sets, rec, { addedWeight: true })).toEqual([sets[1], sets[2]])
    expect(isRecommendationApplied([s(10, 5), s(null, 9), s(null, 9)], rec, { addedWeight: true })).toBe(true)
    // 맨몸 세트가 하나도 없으면 아무것도 바꾸지 않는다(추가 무게 세트에 횟수만 덮어쓰지 않는다).
    expect(setsToApply([s(10, 5), s(10, 5)], rec, { addedWeight: true })).toHaveLength(0)
  })

  it('끝난 기록에서 추천을 내고, 적용하면 추가 무게 세트만 바뀐다', async () => {
    await record(1000, { [PULL_UP]: [[10, 5], [10, 5], [null, 8]] })
    const id = await startWorkout(5000)
    await addExercisesToWorkout(id, [PULL_UP])
    const we = (await loadWorkoutDetail(id))!.items[0].we
    const rec = (await getWorkoutRecommendations(id)).get(we.id)!
    expect(rec).toMatchObject({ kind: 'increase', weightKg: 12.5, reps: 5, fromWeightKg: 10 })

    expect(await applyRecommendation(we.id, rec, { addedWeight: true })).toBe(2)
    const sets = (await loadWorkoutDetail(id))!.items[0].sets
    expect(sets.map((s) => [s.weightKg, s.reps])).toEqual([[12.5, 5], [12.5, 5], [null, 8]])
    expect(isRecommendationApplied(sets, rec, { addedWeight: true })).toBe(true)
  })
})

describe('추천: 시간 종목', () => {
  it('지난번 가장 오래 버틴 시간보다 5초 더', () => {
    const rec = recommendNext(plank, [session(1, [[null, null, 40]]), session(2, [[null, null, 60], [null, null, 45]])])
    expect(rec).toEqual({
      kind: 'addTime',
      weightKg: null,
      reps: 0,
      durationSec: 65,
      fromWeightKg: null,
      reason: '지난번 최고 60초보다 5초 더 버텨 봐요',
      basedOnWorkoutId: 'w2',
    })
    expect(formatRecommendation(rec!)).toBe('65초')
  })

  it('목표 시간을 못 채운 세트가 있었으면 목표 시간을 다시 추천한다', () => {
    const last = session(1, [[null, null, 60], [null, null, 45]])
    expect(recommendNext({ ...plank, targetReps: 60 }, [last])).toMatchObject({
      kind: 'keep',
      durationSec: 60,
      reason: '60초를 못 채운 세트가 있어서 다시 해요',
    })
    // 모든 세트에서 목표를 채웠으면 가장 오래 버틴 시간에서 5초 더.
    expect(recommendNext({ ...plank, targetReps: 45 }, [last])).toMatchObject({ kind: 'addTime', durationSec: 65 })
  })

  it('목표 시간은 지난 기록의 목표, 오늘의 목표, 종목의 목표 순으로 쓴다', () => {
    const rows: Row[] = [[null, null, 50], [null, null, 50]]
    expect(recommendNext({ ...plank, targetReps: 30 }, [session(1, rows, 60)], 40)).toMatchObject({ kind: 'keep', durationSec: 60 })
    expect(recommendNext({ ...plank, targetReps: 30 }, [session(1, rows)], 90)).toMatchObject({ kind: 'keep', durationSec: 90 })
    expect(recommendNext({ ...plank, targetReps: 30 }, [session(1, rows)])).toMatchObject({ kind: 'addTime', durationSec: 55 })
  })

  it('웜업, 완료하지 않은 세트, 시간이 없는 세트는 보지 않는다', () => {
    const last = session(1, [
      [null, null, 120, { warmup: true }],
      [null, null, 90, { done: false }],
      [null, 10],
      [null, null, 30],
    ])
    expect(recommendNext(plank, [last])).toMatchObject({ kind: 'addTime', durationSec: 35 })
    expect(recommendNext(plank, [session(1, [[null, 10]])])).toBeNull()
    expect(recommendNext(plank, [])).toBeNull()
  })

  it('적용하면 남은 본 세트의 시간만 바꾸고 무게와 완료한 세트는 그대로 둔다', async () => {
    await record(1000, { [PLANK]: [[null, null, 60], [5, null, 40], [null, null, 30]] })
    const id = await startWorkout(5000)
    await addExercisesToWorkout(id, [PLANK])
    const item = (await loadWorkoutDetail(id))!.items[0]
    await updateSet(item.sets[0].id, { isDone: true })
    const rec = (await getWorkoutRecommendations(id)).get(item.we.id)!
    expect(rec).toMatchObject({ kind: 'addTime', durationSec: 65, weightKg: null })

    expect(isRecommendationApplied(item.sets, rec)).toBe(false)
    expect(await applyRecommendation(item.we.id, rec)).toBe(2)
    const sets = (await loadWorkoutDetail(id))!.items[0].sets
    expect(sets.map((s) => [s.weightKg, s.reps, s.durationSec])).toEqual([
      [null, null, 60],
      [5, null, 65],
      [null, null, 65],
    ])
    expect(isRecommendationApplied(sets, rec)).toBe(true)
  })
})

describe('개인 기록의 종류', () => {
  it('종목에 따라 세는 기록이 다르다', () => {
    expect(recordKindsFor({ equipment: 'barbell' })).toEqual(['maxWeight', 'bestE1rm', 'maxReps', 'sessionVolume'])
    expect(recordKindsFor({ equipment: 'bodyweight' })).toEqual(['maxWeight', 'maxReps'])
    expect(recordKindsFor({ equipment: 'bodyweight', measure: 'time' })).toEqual(['maxDuration'])
    expect(recordLabel('maxWeight', { equipment: 'bodyweight' })).toBe('최고 추가 무게')
    expect(recordLabel('maxWeight', { equipment: 'barbell' })).toBe('최고 중량')
    expect(recordLabel('maxDuration')).toBe('최장 시간')
    expect(formatRecordValue('maxWeight', 12.5, { equipment: 'bodyweight' })).toBe('+12.5kg')
    expect(formatRecordValue('maxWeight', 12.5)).toBe('12.5kg')
    expect(formatRecordValue('maxDuration', 90)).toBe('90초')
  })

  it('맨몸 종목은 맨몸 최다 횟수와 최고 추가 무게만 센다', async () => {
    const w1 = await record(1000, { [PULL_UP]: [[null, 12], [null, 10]] })
    const w2 = await record(2000, { [PULL_UP]: [[10, 5], [15, 3], [null, 9]] })
    const exercise = await db.exercises.get(PULL_UP)
    const records = computeRecords(await getExerciseSessions(PULL_UP), exercise)
    expect(Object.keys(records).sort()).toEqual(['maxReps', 'maxWeight'])
    expect(records.maxReps).toMatchObject({ value: 12, workoutId: w1 })
    expect(records.maxWeight).toMatchObject({ value: 15, workoutId: w2 })
    // 종목을 모르면(지워진 종목) 세트에 있는 대로 모두 센다.
    expect(Object.keys(computeRecords(await getExerciseSessions(PULL_UP))).sort()).toEqual([
      'bestE1rm',
      'maxReps',
      'maxWeight',
      'sessionVolume',
    ])
  })

  it('시간 종목은 최장 시간만 세고, 추정 1RM과 볼륨은 없다', async () => {
    await record(1000, { [PLANK]: [[null, null, 60], [null, null, 45]] })
    const w2 = await record(2000, { [PLANK]: [[10, null, 30], [null, null, 75, { warmup: true }], [null, null, 70]] })
    const sessions = await getExerciseSessions(PLANK)
    const records = computeRecords(sessions, await db.exercises.get(PLANK))
    expect(Object.keys(records)).toEqual(['maxDuration'])
    expect(records.maxDuration).toMatchObject({ value: 70, workoutId: w2 })
    expect(summarizeSession(sessions[1].sets)).toEqual({
      topWeight: null,
      bestE1rm: null,
      volume: 0,
      maxReps: null,
      maxDuration: 70,
      totalDuration: 100,
      totalDistance: 0,
      totalFloors: 0,
      workingSetCount: 2,
    })
  })

  it('이번 운동의 새 기록: 더 오래 버틴 시간과 더 무거운 추가 무게', async () => {
    // 처음 추가 무게를 단 날은 비교할 추가 무게 기록이 없어 새 기록이 아니다.
    await record(100, { [PULL_UP]: [[null, 10]] })
    const firstWeighted = await record(200, { [PULL_UP]: [[5, 5], [null, 8]] })
    expect(await findNewRecords(firstWeighted)).toEqual([])

    await record(1000, { [PLANK]: [[null, null, 60]], [PULL_UP]: [[10, 5], [null, 10]] })
    const id = await record(2000, { [PLANK]: [[null, null, 50], [null, null, 65]], [PULL_UP]: [[12.5, 5], [null, 8]] })
    expect(await findNewRecords(id)).toEqual([
      { exerciseId: PLANK, kind: 'maxDuration', value: 65, previous: 60, setId: `${id}-${PLANK}-1` },
      // 추가 무게만으로 낸 추정 1RM과 볼륨은 새 기록으로 치지 않는다.
      { exerciseId: PULL_UP, kind: 'maxWeight', value: 12.5, previous: 10, setId: `${id}-${PULL_UP}-0` },
    ])
  })
})

describe('통계', () => {
  it('볼륨: 추가 무게×횟수만 세고, 맨몸 세트와 시간 세트는 0', () => {
    const s = (weightKg: number | null, reps: number | null, durationSec?: number) => toSet([weightKg, reps, durationSec])
    expect(setVolume(s(10, 5))).toBe(50)
    expect(setVolume(s(null, 12))).toBe(0)
    expect(setVolume(s(null, null, 60))).toBe(0)
    expect(setVolume(s(10, null, 60))).toBe(0)
    expect(totalVolume([s(10, 5), s(null, 12), s(10, null, 60), s(100, 5)])).toBe(550)
  })

  it('시간 세트는 세트 수에 들어가고 볼륨에는 들어가지 않는다', async () => {
    const now = new Date(2026, 10, 16, 19, 0).getTime()
    await record(now - 3600_000, {
      [PLANK]: [[null, null, 30, { warmup: true }], [null, null, 60], [10, null, 45]],
      [PULL_UP]: [[10, 5], [null, 8]],
      [SQUAT]: [[100, 5]],
    })
    const data = await loadStatsData()
    const [week] = weeklyTotals(data.workouts, data.sessions, { weeks: 1, now })
    expect(week).toMatchObject({ workouts: 1, sets: 5, volume: 10 * 5 + 100 * 5 })

    const parts = bodyPartSets(data.sessions, data.exercises, { from: now - 86_400_000, to: now + 1 })
    expect(Object.fromEntries(parts.map((p) => [p.bodyPart, p.sets]))).toMatchObject({ core: 2, back: 2, legs: 1, chest: 0 })
  })

  it('종목별 추이: 시간 종목은 최장 시간과 총 시간', async () => {
    await record(1000, { [PLANK]: [[null, null, 60], [null, null, 45]] })
    await record(2000, { [PLANK]: [[null, null, 70]] })
    const exercise = await db.exercises.get(PLANK)
    const points = exerciseSeries(await getExerciseSessions(PLANK))
    expect(points.map((p) => [p.maxDuration, p.totalDuration, p.volume, p.topWeight, p.maxReps])).toEqual([
      [60, 105, 0, null, null],
      [70, 70, 0, null, null],
    ])
    expect(availableMetrics(points, exercise)).toEqual(['maxDuration', 'totalDuration'])
    expect(formatMetric('maxDuration', 70)).toBe('70초')
    expect(formatMetric('totalDuration', 105)).toBe('105초')
    expect(metricLabel('maxDuration', exercise)).toBe('최장 시간')
  })

  it('종목별 추이: 맨몸 종목은 횟수와 추가 무게', async () => {
    await record(1000, { [PULL_UP]: [[null, 10], [null, 8]] })
    await record(2000, { [PULL_UP]: [[10, 5], [null, 9]] })
    const exercise = await db.exercises.get(PULL_UP)
    const points = exerciseSeries(await getExerciseSessions(PULL_UP))
    expect(availableMetrics(points, exercise)).toEqual(['maxReps', 'topWeight'])
    expect(availableMetrics(points.slice(0, 1), exercise)).toEqual(['maxReps'])
    expect(metricLabel('topWeight', exercise)).toBe('추가 무게')
    expect(formatMetric('topWeight', 10, exercise)).toBe('+10kg')
    expect(formatMetric('topWeight', 10)).toBe('10kg')
    // 종목을 주지 않으면 전과 같이 세트에 있는 값을 모두 준다.
    expect(availableMetrics(points)).toEqual(['bestE1rm', 'topWeight', 'volume', 'maxReps'])
  })

  it('종목 목록: 시간 종목은 최장 시간, 맨몸 종목은 추정 1RM 없이', async () => {
    await record(1000, { [PLANK]: [[null, null, 60]], [PULL_UP]: [[10, 5], [null, 9]], [SQUAT]: [[100, 5]] })
    const data = await loadStatsData()
    const byId = new Map(exerciseOverviews(data.sessionsByExercise, data.exercises).map((o) => [o.exerciseId, o]))
    expect(byId.get(PLANK)).toMatchObject({ maxDuration: 60, bestE1rm: null, maxWeight: null, maxReps: null })
    expect(byId.get(PULL_UP)).toMatchObject({ maxDuration: null, bestE1rm: null, maxWeight: 10, maxReps: 9 })
    expect(byId.get(SQUAT)).toMatchObject({ maxDuration: null, maxWeight: 100 })
    expect(byId.get(SQUAT)?.bestE1rm).toBeGreaterThan(100)
  })
})
