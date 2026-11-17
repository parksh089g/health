import { beforeEach, describe, expect, it } from 'vitest'
import { db, type SetEntry } from '../db'
import { SEED_EXERCISES } from '../seed'
import { buildFeedbackContext, buildRoutineContext, buildWorkoutContext, describeDoneSets } from './ai/context'
import { parseRoutineProposals } from './ai/routineBuilder'
import {
  CARDIO_LOCKED_MESSAGE,
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
  cardioMetricOf,
  cardioSetParts,
  formatCardioTime,
  formatDistance,
  formatFloors,
  formatSetShort,
  hasTarget,
  isCardio,
  isSetEntered,
  isTimed,
  measureOf,
  minutesToSeconds,
  secondsToMinutes,
  setTextOptions,
} from './measure'
import { getWorkoutRecommendations, recommendNext } from './recommend'
import { createRoutine, getRoutine, saveWorkoutAsRoutine, startWorkoutFromRoutine, updateRoutine } from './routines'
import {
  availableMetrics,
  bodyPartSets,
  exerciseOverviews,
  exerciseSeries,
  formatMetric,
  formatSetsSummary,
  hasCardioSessions,
  loadStatsData,
  metricLabel,
  metricValue,
  weeklyCardio,
  weeklyTotals,
} from './stats'
import {
  addExercisesToWorkout,
  addSet,
  completeSet,
  finishWorkout,
  loadWorkoutDetail,
  loadWorkoutSummaries,
  markEnteredSetsDone,
  prefillTemplate,
  recordTimedSet,
  repeatWorkout,
  startWorkout,
  totalVolume,
  updateSet,
} from './workouts'

const STEPMILL = 'seed:stepmill'
const TREADMILL = 'seed:treadmill'
const ROPE = 'seed:jump-rope'
const PLANK = 'seed:plank'
const SQUAT = 'seed:squat'
const CARDIO_SEEDS = [
  'seed:treadmill',
  'seed:stationary-bike',
  'seed:stepmill',
  'seed:elliptical',
  'seed:rowing-machine',
  'seed:running',
  'seed:jump-rope',
]
const DAY = 24 * 60 * 60 * 1000
/** 2026년 11월 16일(월) 오후 7시 */
const NOW = new Date(2026, 10, 16, 19, 0).getTime()

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureSeedExercises()
})

type CardioRow = Partial<Pick<SetEntry, 'durationSec' | 'distanceKm' | 'floors' | 'level' | 'reps' | 'weightKg' | 'rpe'>> & {
  warmup?: boolean
  done?: boolean
}

/** 종목마다 세트를 적어 끝난 운동 하나를 만든다. 세트는 따로 말하지 않으면 완료한 본 세트다. */
async function record(startedAt: number, plan: Record<string, CardioRow[]>): Promise<string> {
  const id = await startWorkout(startedAt)
  await addExercisesToWorkout(id, Object.keys(plan))
  const detail = await loadWorkoutDetail(id)
  for (const item of detail!.items) {
    const rows = plan[item.we.exerciseId]
    await db.sets.where('workoutExerciseId').equals(item.we.id).delete()
    await db.sets.bulkAdd(
      rows.map(({ warmup, done, ...amounts }, i) => ({
        id: `${item.we.id}-${i}`,
        workoutExerciseId: item.we.id,
        order: i,
        weightKg: null,
        reps: null,
        ...amounts,
        isWarmup: warmup ?? false,
        isDone: done ?? true,
      })),
    )
  }
  await finishWorkout(id, { endedAt: startedAt + 3600_000 })
  return id
}

describe('유산소 종목 가리기', () => {
  it('유산소는 시간을 적는 종목이지만 목표가 없다', async () => {
    const stepmill = await db.exercises.get(STEPMILL)
    const plank = await db.exercises.get(PLANK)
    const squat = await db.exercises.get(SQUAT)
    expect([measureOf(stepmill), measureOf(plank), measureOf(squat), measureOf(undefined)]).toEqual([
      'cardio',
      'time',
      'reps',
      'reps',
    ])
    // 운동 화면은 isTimed로 AI 추천을 받을 종목을 가리므로 유산소도 여기에 들어가야 한다.
    expect([isTimed(stepmill), isTimed(plank), isTimed(squat)]).toEqual([true, true, false])
    expect([isCardio(stepmill), isCardio(plank), isCardio(squat)]).toEqual([true, false, false])
    expect([hasTarget(stepmill), hasTarget(plank), hasTarget(squat)]).toEqual([false, true, true])
  })

  it('함께 적는 값은 유산소 종목에서만 읽는다', async () => {
    expect(cardioMetricOf(await db.exercises.get(STEPMILL))).toBe('floors')
    expect(cardioMetricOf(await db.exercises.get(TREADMILL))).toBe('distance')
    expect(cardioMetricOf(await db.exercises.get(ROPE))).toBeNull()
    expect(cardioMetricOf({ measure: 'time', cardioMetric: 'distance' })).toBeNull()
    expect(cardioMetricOf(undefined)).toBeNull()
  })

  it('종목 설명: 부위가 유산소면 그대로, 다른 부위면 유산소를 붙인다', () => {
    expect(exerciseKindText({ bodyPart: 'cardio', equipment: 'machine', measure: 'cardio' })).toBe('유산소 · 머신')
    expect(exerciseKindText({ bodyPart: 'legs', equipment: 'other', measure: 'cardio' })).toBe('하체 · 기타 · 유산소')
    expect(exerciseKindText({ bodyPart: 'core', equipment: 'bodyweight', measure: 'time' })).toBe('코어 · 맨몸 · 시간 종목')
  })
})

describe('유산소 세트의 값과 표기', () => {
  it('시간이 있어야 적은 세트다', () => {
    expect(isSetEntered({ reps: null, durationSec: 1800 })).toBe(true)
    // 거리나 층수만 적은 세트는 아직 적지 않은 세트
    expect(isSetEntered({ reps: null, durationSec: null, ...{ distanceKm: 5, floors: 100 } })).toBe(false)
    expect(isSetEntered({ reps: null, durationSec: 0 })).toBe(false)
  })

  it('분으로 적은 시간을 초로 저장하고, 다시 분으로 보여 준다', () => {
    expect(minutesToSeconds(12.5)).toBe(750)
    expect(minutesToSeconds(30)).toBe(1800)
    expect(minutesToSeconds(0.5)).toBe(30)
    expect(secondsToMinutes(750)).toBe(12.5)
    expect(secondsToMinutes(1800)).toBe(30)
    // 스톱워치로 잰 초 단위 시간은 소수 둘째 자리까지 보여 주고, 그 값을 다시 저장해도 같은 초가 된다.
    expect(secondsToMinutes(754)).toBe(12.57)
    for (const sec of [1, 59, 61, 754, 1799, 3601]) expect(minutesToSeconds(secondsToMinutes(sec))).toBe(sec)
  })

  it('시간은 "30분", "12분 30초"처럼 쓴다', () => {
    expect(formatCardioTime(1800)).toBe('30분')
    expect(formatCardioTime(750)).toBe('12분 30초')
    expect(formatCardioTime(45)).toBe('45초')
    expect(formatCardioTime(5400)).toBe('1시간 30분')
    expect(formatCardioTime(3600)).toBe('1시간')
    expect(formatCardioTime(0)).toBe('0분')
  })

  it('거리와 층수', () => {
    expect(formatDistance(5.25)).toBe('5.25km')
    expect(formatDistance(5)).toBe('5km')
    expect(formatFloors(120)).toBe('120층')
    expect(formatFloors(1200)).toBe('1,200층')
  })

  it('세트 하나를 글로: 적은 값만 차례로', () => {
    const set = { durationSec: 1800, floors: 120, level: 8 }
    expect(cardioSetParts(set)).toEqual(['30분', '120층'])
    expect(cardioSetParts(set, { level: true })).toEqual(['30분', '120층', '강도 8'])
    expect(cardioSetParts({ durationSec: 750, distanceKm: 2.25, level: 9.5 }, { level: true })).toEqual([
      '12분 30초',
      '2.25km',
      '강도 9.5',
    ])
    expect(cardioSetParts({ durationSec: 300 }, { level: true })).toEqual(['5분'])
    expect(cardioSetParts({ durationSec: null })).toEqual([])
  })

  it('짧은 표기와 묶은 표기', async () => {
    const opts = setTextOptions(await db.exercises.get(STEPMILL))
    expect(opts).toEqual({ addedWeight: false, cardio: true })
    const base = { weightKg: null, reps: null, isWarmup: false, isDone: true }
    expect(formatSetShort({ ...base, durationSec: 1800, floors: 120 }, opts)).toBe('30분 120층')
    expect(formatSetShort({ ...base, durationSec: 1500, distanceKm: 5.2 }, opts)).toBe('25분 5.2km')
    expect(formatSetShort({ ...base, durationSec: 300 }, opts)).toBe('5분')
    // 유산소가 아닌 시간 세트는 그대로 초로 쓴다.
    expect(formatSetShort({ ...base, durationSec: 300 })).toBe('300초')
    expect(
      formatSetsSummary(
        [
          { ...base, durationSec: 600, floors: 40 },
          { ...base, durationSec: 600, floors: 40 },
          { ...base, durationSec: 300, floors: 15 },
          { ...base, durationSec: 300, floors: 15, isWarmup: true },
        ],
        opts,
      ),
    ).toBe('10분 40층×2 · 5분 15층')
  })
})

describe('유산소 종목을 운동에 넣기', () => {
  it('지난 기록이 없으면 빈 세트 하나로 시작한다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [STEPMILL, SQUAT, PLANK])
    const detail = await loadWorkoutDetail(id)
    expect(detail!.items.map((item) => item.sets.length)).toEqual([1, 3, 3])
    expect(detail!.items[0].sets[0]).toMatchObject({ weightKg: null, reps: null, durationSec: null, isDone: false })
  })

  it('prefillTemplate: 빈 세트 수를 정할 수 있고, 유산소 값은 따라가되 RPE는 따라가지 않는다', () => {
    expect(prefillTemplate([], undefined, null, true, 1)).toEqual([
      { weightKg: null, reps: null, isWarmup: false, durationSec: null },
    ])
    expect(prefillTemplate([], undefined, null, false)).toHaveLength(3)
    const last = [
      { id: 'a', workoutExerciseId: 'we', order: 0, weightKg: null, reps: null, isWarmup: false, isDone: true, durationSec: 1800, floors: 120, level: 8, rpe: 7 },
    ] satisfies SetEntry[]
    expect(prefillTemplate(last, undefined, null, true, 1)).toEqual([
      { weightKg: null, reps: null, isWarmup: false, durationSec: 1800, floors: 120, level: 8 },
    ])
    // 루틴의 세트 수가 지난 기록보다 많으면 마지막 세트를 되풀이한다.
    expect(prefillTemplate(last, 2, null, true, 1)).toHaveLength(2)
  })

  it('다음 운동에는 지난번 시간, 층수, 강도가 채워지고 RPE는 비어 있다', async () => {
    await record(NOW - 7 * DAY, { [STEPMILL]: [{ durationSec: 1800, floors: 120, level: 8, rpe: 8 }] })
    const id = await startWorkout(NOW)
    await addExercisesToWorkout(id, [STEPMILL])
    const [item] = (await loadWorkoutDetail(id, { withLastSets: true }))!.items
    expect(item.sets).toHaveLength(1)
    expect(item.sets[0]).toMatchObject({ durationSec: 1800, floors: 120, level: 8, reps: null, weightKg: null, isDone: false })
    expect(item.sets[0].rpe).toBeUndefined()
    expect(item.lastSets.map((s) => formatSetShort(s, { cardio: true }))).toEqual(['30분 120층'])
  })

  it('세트 추가는 앞 세트의 시간과 거리, 강도를 따라간다(인터벌)', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [TREADMILL])
    const [item] = (await loadWorkoutDetail(id))!.items
    await updateSet(item.sets[0].id, { durationSec: 300, distanceKm: 1, level: 12, rpe: 9 })
    await addSet(item.we.id)
    const sets = (await loadWorkoutDetail(id))!.items[0].sets
    expect(sets).toHaveLength(2)
    expect(sets[1]).toMatchObject({ durationSec: 300, distanceKm: 1, level: 12, isDone: false })
    expect(sets[1].rpe).toBeUndefined()
  })

  it('시간이 없으면 완료할 수 없고, 적은 세트만 한꺼번에 완료된다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [STEPMILL, TREADMILL])
    const [stepmill, treadmill] = (await loadWorkoutDetail(id))!.items
    await updateSet(stepmill.sets[0].id, { floors: 100 })
    expect(await completeSet(stepmill.sets[0].id)).toBe(false)
    await updateSet(treadmill.sets[0].id, { durationSec: 600, distanceKm: 1.5 })
    expect(await markEnteredSetsDone(id)).toBe(1)
    expect(await finishWorkout(id)).toBe(true)
    // 시간을 적지 않은 스텝밀은 기록에서 빠진다.
    const after = await loadWorkoutDetail(id)
    expect(after!.items.map((item) => item.we.exerciseId)).toEqual([TREADMILL])
  })

  it('스톱워치로 잰 시간을 초로 적고 완료한다', async () => {
    const id = await startWorkout()
    await addExercisesToWorkout(id, [STEPMILL])
    const [item] = (await loadWorkoutDetail(id))!.items
    await updateSet(item.sets[0].id, { floors: 90 })
    expect(await recordTimedSet(item.sets[0].id, 754.4)).toBe(true)
    expect(await db.sets.get(item.sets[0].id)).toMatchObject({ durationSec: 754, floors: 90, isDone: true })
    // 바로 멈춰도 1초는 적는다. 지워진 세트에는 아무것도 하지 않는다.
    expect(await recordTimedSet(item.sets[0].id, 0)).toBe(true)
    expect((await db.sets.get(item.sets[0].id))?.durationSec).toBe(1)
    expect(await recordTimedSet('없는 세트', 30)).toBe(false)
  })

  it('같은 운동 다시 하기에도 유산소 값이 따라온다', async () => {
    const first = await record(NOW - DAY, {
      [STEPMILL]: [{ durationSec: 1200, floors: 80 }],
      [SQUAT]: [{ weightKg: 60, reps: 8 }],
    })
    const { id } = await repeatWorkout(first, NOW)
    const detail = await loadWorkoutDetail(id)
    expect(detail!.items.map((item) => item.we.exerciseId)).toEqual([STEPMILL, SQUAT])
    expect(detail!.items[0].sets).toHaveLength(1)
    expect(detail!.items[0].sets[0]).toMatchObject({ durationSec: 1200, floors: 80, isDone: false })
  })

  it('유산소는 볼륨에 들어가지 않는다', async () => {
    await record(NOW - 3600_000, {
      [STEPMILL]: [{ durationSec: 1800, floors: 120 }],
      [SQUAT]: [{ weightKg: 60, reps: 8 }],
    })
    const [summary] = await loadWorkoutSummaries()
    expect(summary).toMatchObject({ setCount: 2, volume: 480 })
    expect(totalVolume([{ weightKg: null, reps: null, isWarmup: false, isDone: true }])).toBe(0)
    const data = await loadStatsData()
    expect(weeklyTotals(data.workouts, data.sessions, { weeks: 1, now: NOW })[0]).toMatchObject({ volume: 480, sets: 2 })
    // 부위별 세트에도 유산소는 없다.
    expect(bodyPartSets(data.sessions, data.exercises, { from: 0, to: NOW + DAY }).map((b) => b.bodyPart)).not.toContain('cardio')
  })
})

describe('유산소의 개인 기록', () => {
  it('종목마다 세는 기록: 최장 시간과, 거리 또는 층수', async () => {
    expect(recordKindsFor(await db.exercises.get(STEPMILL))).toEqual(['maxDuration', 'maxFloors'])
    expect(recordKindsFor(await db.exercises.get(TREADMILL))).toEqual(['maxDuration', 'maxDistance'])
    expect(recordKindsFor(await db.exercises.get(ROPE))).toEqual(['maxDuration'])
    expect(recordKindsFor(await db.exercises.get(PLANK))).toEqual(['maxDuration'])
  })

  it('가장 긴 시간과 가장 많은 층수를 세고, 추정 1RM과 볼륨은 없다', async () => {
    const stepmill = await db.exercises.get(STEPMILL)
    const w1 = await record(1000, { [STEPMILL]: [{ durationSec: 1800, floors: 100 }] })
    const w2 = await record(2000, {
      [STEPMILL]: [
        { durationSec: 1500, floors: 120 },
        { durationSec: 2400, floors: 200, warmup: true },
      ],
    })
    const records = computeRecords(await getExerciseSessions(STEPMILL), stepmill)
    expect(Object.keys(records).sort()).toEqual(['maxDuration', 'maxFloors'])
    expect(records.maxDuration).toMatchObject({ value: 1800, workoutId: w1 })
    expect(records.maxFloors).toMatchObject({ value: 120, workoutId: w2 })
    expect(recordLabel('maxFloors', stepmill)).toBe('최다 층수')
    expect(recordLabel('maxDistance')).toBe('최장 거리')
    expect(formatRecordValue('maxDuration', 1800, stepmill)).toBe('30분')
    expect(formatRecordValue('maxFloors', 120, stepmill)).toBe('120층')
    expect(formatRecordValue('maxDistance', 5.2)).toBe('5.2km')
    // 시간 종목의 최장 시간은 그대로 초로 쓴다.
    expect(formatRecordValue('maxDuration', 90, await db.exercises.get(PLANK))).toBe('90초')
  })

  it('거리를 적는 종목은 층수를, 시간만 적는 종목은 거리와 층수를 기록으로 치지 않는다', async () => {
    await record(1000, { [TREADMILL]: [{ durationSec: 1500, distanceKm: 4, floors: 10 }] })
    await record(1000, { [ROPE]: [{ durationSec: 300, distanceKm: 1 }] })
    const treadmill = computeRecords(await getExerciseSessions(TREADMILL), await db.exercises.get(TREADMILL))
    expect(Object.keys(treadmill).sort()).toEqual(['maxDistance', 'maxDuration'])
    expect(Object.keys(computeRecords(await getExerciseSessions(ROPE), await db.exercises.get(ROPE)))).toEqual(['maxDuration'])
  })

  it('이번 운동의 새 기록: 더 긴 시간, 더 먼 거리', async () => {
    await record(NOW - 7 * DAY, { [TREADMILL]: [{ durationSec: 1500, distanceKm: 4 }] })
    const today = await record(NOW, { [TREADMILL]: [{ durationSec: 1800, distanceKm: 5.2 }] })
    const found = await findNewRecords(today)
    expect(found.map((r) => [r.kind, r.value, r.previous])).toEqual([
      ['maxDuration', 1800, 1500],
      ['maxDistance', 5.2, 4],
    ])
    expect(found.every((r) => r.setId !== undefined)).toBe(true)
  })

  it('요약에는 시간, 거리, 층수의 합이 담긴다', () => {
    const s = (durationSec: number, more: Partial<SetEntry>) => ({ weightKg: null, reps: null, isWarmup: false, isDone: true, durationSec, ...more })
    expect(summarizeSession([s(600, { distanceKm: 1.1 }), s(900, { distanceKm: 2.2 }), s(300, { distanceKm: 9, isDone: false })])).toMatchObject({
      volume: 0,
      bestE1rm: null,
      maxDuration: 900,
      totalDuration: 1500,
      totalDistance: 3.3,
      totalFloors: 0,
    })
    expect(summarizeSession([s(600, { floors: 40 }), s(600, { floors: 45 })])).toMatchObject({ totalFloors: 85, totalDistance: 0 })
  })
})

describe('유산소 통계', () => {
  it('주별 유산소 시간: 유산소 종목의 완료한 본 세트만 더한다', async () => {
    // 지난주 화요일과 이번 주 월요일
    await record(NOW - 6 * DAY, {
      [STEPMILL]: [{ durationSec: 1800, floors: 120 }],
      [PLANK]: [{ durationSec: 60 }],
    })
    await record(NOW - 3600_000, {
      [TREADMILL]: [
        { durationSec: 600, distanceKm: 1.5 },
        { durationSec: 300, distanceKm: 0.5, warmup: true },
        { durationSec: 150, distanceKm: 0.5 },
      ],
      [SQUAT]: [{ weightKg: 60, reps: 8 }],
    })
    const data = await loadStatsData()
    const weeks = weeklyCardio(data.sessions, data.exercises, { weeks: 12, now: NOW })
    expect(weeks).toHaveLength(12)
    expect(weeks.map((w) => w.seconds).slice(-3)).toEqual([0, 1800, 750])
    expect(weeks[11].start).toBe(new Date(2026, 10, 16).getTime())
    expect(weeks.slice(0, 9).every((w) => w.seconds === 0)).toBe(true)
    expect(hasCardioSessions(data.sessions, data.exercises)).toBe(true)
  })

  it('유산소 기록이 없으면 없다고 알려 준다(시간 종목은 유산소가 아니다)', async () => {
    await record(NOW - DAY, { [PLANK]: [{ durationSec: 60 }], [SQUAT]: [{ weightKg: 60, reps: 8 }] })
    const data = await loadStatsData()
    expect(hasCardioSessions(data.sessions, data.exercises)).toBe(false)
    expect(weeklyCardio(data.sessions, data.exercises, { weeks: 12, now: NOW }).every((w) => w.seconds === 0)).toBe(true)
  })

  it('종목 그래프: 그날의 시간과 층수(또는 거리)를 본다', async () => {
    await record(1000, { [STEPMILL]: [{ durationSec: 600, floors: 40 }, { durationSec: 600, floors: 45 }] })
    await record(2000, { [STEPMILL]: [{ durationSec: 1800, floors: 120 }] })
    const stepmill = await db.exercises.get(STEPMILL)
    const points = exerciseSeries(await getExerciseSessions(STEPMILL))
    expect(availableMetrics(points, stepmill)).toEqual(['totalDuration', 'totalFloors'])
    expect(points.map((p) => [metricValue(p, 'totalDuration'), metricValue(p, 'totalFloors'), metricValue(p, 'totalDistance')])).toEqual([
      [1200, 85, null],
      [1800, 120, null],
    ])
    expect(metricLabel('totalDuration', stepmill)).toBe('시간')
    expect(metricLabel('totalFloors', stepmill)).toBe('층수')
    expect(metricLabel('totalDistance')).toBe('거리')
    expect(formatMetric('totalDuration', 1200, stepmill)).toBe('20분')
    expect(formatMetric('totalFloors', 85, stepmill)).toBe('85층')
    expect(formatMetric('totalDistance', 5.25)).toBe('5.25km')
    // 시간 종목은 그대로 초로, 이름도 "총 시간"으로 쓴다.
    expect(formatMetric('totalDuration', 120, await db.exercises.get(PLANK))).toBe('120초')
    expect(metricLabel('totalDuration', await db.exercises.get(PLANK))).toBe('총 시간')

    await record(3000, { [TREADMILL]: [{ durationSec: 1500, distanceKm: 4.2 }] })
    const treadmill = await db.exercises.get(TREADMILL)
    expect(availableMetrics(exerciseSeries(await getExerciseSessions(TREADMILL)), treadmill)).toEqual(['totalDuration', 'totalDistance'])
    await record(4000, { [ROPE]: [{ durationSec: 300 }] })
    expect(availableMetrics(exerciseSeries(await getExerciseSessions(ROPE)), await db.exercises.get(ROPE))).toEqual(['totalDuration'])
  })

  it('종목 목록에는 최장 시간이 담긴다', async () => {
    await record(1000, { [STEPMILL]: [{ durationSec: 1800, floors: 120 }] })
    const data = await loadStatsData()
    expect(exerciseOverviews(data.sessionsByExercise, data.exercises)).toEqual([
      { exerciseId: STEPMILL, lastAt: 1000, sessionCount: 1, bestE1rm: null, maxWeight: null, maxReps: null, maxDuration: 1800 },
    ])
  })
})

describe('유산소에는 추천이 없다', () => {
  it('규칙 추천은 null', async () => {
    await record(NOW - 7 * DAY, { [STEPMILL]: [{ durationSec: 1800, floors: 120 }] })
    const sessions = await getExerciseSessions(STEPMILL)
    expect(recommendNext((await db.exercises.get(STEPMILL))!, sessions)).toBeNull()
    const id = await startWorkout(NOW)
    await addExercisesToWorkout(id, [STEPMILL, PLANK])
    const recs = await getWorkoutRecommendations(id)
    const [stepmill] = (await loadWorkoutDetail(id))!.items
    expect(recs.get(stepmill.we.id)).toBeNull()
  })

  it('목표를 정할 수 없다', async () => {
    await expect(updateExerciseGoal(STEPMILL, { targetReps: 30 })).rejects.toThrow('유산소 종목에는 목표를 정하지 않습니다.')
    await updateExerciseGoal(STEPMILL, { targetReps: null })
  })
})

describe('AI에 보내는 글의 유산소', () => {
  it('세트를 "30분 · 120층 · 강도 8"로 쓴다', () => {
    const base = { weightKg: null, reps: null, isWarmup: false, isDone: true }
    expect(describeDoneSets([{ ...base, durationSec: 1800, floors: 120, level: 8 }], { cardio: true })).toBe('30분 · 120층 · 강도 8')
    expect(
      describeDoneSets(
        [
          { ...base, durationSec: 300, distanceKm: 0.5, isWarmup: true },
          { ...base, durationSec: 1500, distanceKm: 5.2, rpe: 7 },
        ],
        { cardio: true },
      ),
    ).toBe('웜업 5분 · 0.5km / 25분 · 5.2km(RPE 7)')
  })

  it('운동 추천: 유산소는 기록만 보여 주고 추천을 받지 않는다', async () => {
    await record(NOW - 7 * DAY, { [STEPMILL]: [{ durationSec: 1800, floors: 120, level: 8 }] })
    const id = await startWorkout(NOW)
    await addExercisesToWorkout(id, [STEPMILL])
    const ctx = await buildWorkoutContext(id, NOW)
    // 유산소만 있는 운동은 추천을 받을 종목이 없다.
    expect(ctx.items).toEqual([])
    expect(ctx.prompt).toContain('[추천 안 함] 스텝밀 (유산소, 머신 · 유산소 종목)')
    expect(ctx.prompt).toContain('오늘 세트: 30분 · 120층 · 강도 8')
    expect(ctx.prompt).toContain('30분 · 120층 · 강도 8')
    expect(ctx.prompt).not.toContain('앱의 규칙 추천')
    expect(ctx.prompt).not.toContain('목표 횟수')

    await addExercisesToWorkout(id, [SQUAT])
    const mixed = await buildWorkoutContext(id, NOW)
    expect(mixed.items.map((it) => it.key)).toEqual(['E1'])
    expect(mixed.prompt).toContain('[E1] 스쿼트')
  })

  it('운동 피드백에도 유산소 세트가 들어간다', async () => {
    const id = await record(NOW - DAY, { [STEPMILL]: [{ durationSec: 1800, floors: 120, level: 8 }] })
    const prompt = await buildFeedbackContext(id, NOW)
    expect(prompt).toContain('[1] 스텝밀 (유산소, 머신 · 유산소 종목)')
    expect(prompt).toContain('이번 운동: 30분 · 120층 · 강도 8')
  })

  it('루틴 제안: 유산소 종목은 목표 횟수 없이 저장된다', async () => {
    const ctx = await buildRoutineContext('유산소를 넣은 전신 루틴', NOW)
    const stepmill = ctx.candidates.find((c) => c.exerciseId === STEPMILL)!
    const squat = ctx.candidates.find((c) => c.exerciseId === SQUAT)!
    expect(stepmill.timed).toBe(true)
    expect(ctx.prompt).toContain(`${stepmill.key} 스텝밀 (유산소, 머신) · 유산소 종목`)
    const [proposal] = parseRoutineProposals(
      {
        routines: [
          {
            name: '전신',
            rationale: '유산소로 마무리해요',
            items: [
              { key: squat.key, sets: 3, reps: 8 },
              { key: stepmill.key, sets: 1, reps: 20 },
            ],
          },
        ],
      },
      ctx.candidates,
    )
    expect(proposal.items).toEqual([
      { exerciseId: SQUAT, sets: 3, reps: 8 },
      { exerciseId: STEPMILL, sets: 1, reps: null },
    ])
  })
})

describe('루틴의 유산소 종목', () => {
  it('목표를 넣어 저장해도 비워서 저장한다', async () => {
    const id = await createRoutine({
      name: '하체와 유산소',
      items: [
        { exerciseId: SQUAT, sets: 3, reps: 8 },
        { exerciseId: STEPMILL, sets: 1, reps: 30 },
        { exerciseId: PLANK, sets: 2, reps: 60 },
      ],
    })
    expect((await getRoutine(id))!.items).toEqual([
      { exerciseId: SQUAT, sets: 3, reps: 8 },
      { exerciseId: STEPMILL, sets: 1, reps: null },
      { exerciseId: PLANK, sets: 2, reps: 60 },
    ])
    // 횟수 범위를 벗어난 값이 들어와도 유산소는 비우고 받는다.
    await updateRoutine(id, { name: '유산소', items: [{ exerciseId: STEPMILL, sets: 2, reps: 9999 }] })
    expect((await getRoutine(id))!.items).toEqual([{ exerciseId: STEPMILL, sets: 2, reps: null }])
  })

  it('루틴으로 시작하면 세트 수대로 만들고 목표는 없다', async () => {
    await record(NOW - 7 * DAY, { [STEPMILL]: [{ durationSec: 1800, floors: 120 }] })
    const routineId = await createRoutine({
      name: '유산소 날',
      items: [
        { exerciseId: STEPMILL, sets: 2, reps: null },
        { exerciseId: TREADMILL, sets: 1, reps: null },
      ],
    })
    const { id } = await startWorkoutFromRoutine(routineId, NOW)
    const [stepmill, treadmill] = (await loadWorkoutDetail(id))!.items
    expect(stepmill.we.targetReps).toBeNull()
    // 지난번 한 세트를 두 세트로 되풀이한다.
    expect(stepmill.sets.map((s) => [s.durationSec, s.floors])).toEqual([
      [1800, 120],
      [1800, 120],
    ])
    expect(treadmill.sets).toHaveLength(1)
    expect(treadmill.sets[0]).toMatchObject({ durationSec: null, reps: null })
  })

  it('끝난 운동을 루틴으로 저장하면 유산소는 세트 수만 남는다', async () => {
    const workoutId = await record(NOW - DAY, {
      [SQUAT]: [{ weightKg: 60, reps: 8 }, { weightKg: 60, reps: 8 }],
      [STEPMILL]: [{ durationSec: 1800, floors: 120 }],
    })
    const routineId = await saveWorkoutAsRoutine(workoutId, '하체 날')
    expect((await getRoutine(routineId))!.items).toEqual([
      { exerciseId: SQUAT, sets: 2, reps: 8 },
      { exerciseId: STEPMILL, sets: 1, reps: null },
    ])
  })
})

describe('기본 종목: 유산소 일곱 개', () => {
  it('러닝머신, 실내 자전거, 스텝밀, 일립티컬, 로잉 머신, 달리기, 줄넘기가 들어 있다', async () => {
    const rows = await db.exercises.bulkGet(CARDIO_SEEDS)
    expect(rows.map((e) => [e?.name, e?.bodyPart, e?.equipment, e?.measure, e?.cardioMetric])).toEqual([
      ['러닝머신', 'cardio', 'machine', 'cardio', 'distance'],
      ['실내 자전거', 'cardio', 'machine', 'cardio', 'distance'],
      ['스텝밀', 'cardio', 'machine', 'cardio', 'floors'],
      ['일립티컬', 'cardio', 'machine', 'cardio', 'distance'],
      ['로잉 머신', 'cardio', 'machine', 'cardio', 'distance'],
      ['달리기', 'cardio', 'other', 'cardio', 'distance'],
      ['줄넘기', 'cardio', 'other', 'cardio', undefined],
    ])
    expect(SEED_EXERCISES.filter((s) => s.measure === 'cardio').map((s) => s.id)).toEqual(CARDIO_SEEDS)
    expect(SEED_EXERCISES.filter((s) => s.bodyPart === 'cardio').map((s) => s.id)).toEqual(CARDIO_SEEDS)
  })

  it('이미 쓰던 폰에는 일곱 개가 한 번만 더해진다', async () => {
    // 유산소 종목이 생기기 전의 폰
    await db.exercises.bulkDelete(CARDIO_SEEDS)
    const before = await db.exercises.count()
    await ensureSeedExercises()
    expect(await db.exercises.count()).toBe(before + CARDIO_SEEDS.length)
    await ensureSeedExercises()
    await ensureSeedExercises()
    expect(await db.exercises.count()).toBe(before + CARDIO_SEEDS.length)
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length)
  })

  it('같은 이름의 내 종목이 있으면 기본 종목을 넣지 않고 그 종목을 그대로 둔다', async () => {
    await db.exercises.bulkDelete(CARDIO_SEEDS)
    const mine = await addCustomExercise({ name: '스텝 밀', bodyPart: 'legs', equipment: 'machine' })
    await ensureSeedExercises()
    expect(await db.exercises.get(STEPMILL)).toBeUndefined()
    expect(measureOf(await db.exercises.get(mine))).toBe('reps')
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length)
  })

  it('숨긴 유산소 종목은 다시 열어도 되살아나지 않는다', async () => {
    await db.exercises.update(STEPMILL, { archived: true })
    await ensureSeedExercises()
    expect((await db.exercises.get(STEPMILL))?.archived).toBe(true)
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length)
  })
})

describe('내 유산소 종목', () => {
  it('함께 적는 값을 정해 만든다. 주지 않으면 시간만 적는다', async () => {
    const stairs = await addCustomExercise({ name: '계단 오르기', bodyPart: 'cardio', equipment: 'other', measure: 'cardio', cardioMetric: 'floors' })
    const swim = await addCustomExercise({ name: '수영', bodyPart: 'cardio', equipment: 'other', measure: 'cardio', cardioMetric: null })
    const hike = await addCustomExercise({ name: '등산', bodyPart: 'cardio', equipment: 'other', measure: 'cardio' })
    expect(await db.exercises.get(stairs)).toMatchObject({ measure: 'cardio', cardioMetric: 'floors', isCustom: true })
    expect(cardioMetricOf(await db.exercises.get(swim))).toBeNull()
    expect(cardioMetricOf(await db.exercises.get(hike))).toBeNull()
    // 유산소가 아닌 종목에는 함께 적는 값을 두지 않는다.
    const curl = await addCustomExercise({ name: '케틀벨 스윙', bodyPart: 'legs', equipment: 'other', measure: 'reps', cardioMetric: 'distance' })
    expect((await db.exercises.get(curl))?.cardioMetric).toBeUndefined()
  })

  it('같은 이름의 종목이 다르게 기록하면 알려 준다', async () => {
    await expect(
      addCustomExercise({ name: '스텝밀', bodyPart: 'cardio', equipment: 'machine', measure: 'reps' }),
    ).rejects.toThrow('이미 있는 "스텝밀" 종목은 유산소로 기록합니다.')
    await expect(
      addCustomExercise({ name: '스텝밀', bodyPart: 'cardio', equipment: 'machine', measure: 'cardio', cardioMetric: 'distance' }),
    ).rejects.toThrow('이미 있는 "스텝밀" 종목은 시간과 층수를 기록합니다.')
    await expect(
      addCustomExercise({ name: '줄넘기', bodyPart: 'cardio', equipment: 'other', measure: 'cardio', cardioMetric: 'distance' }),
    ).rejects.toThrow('이미 있는 "줄넘기" 종목은 시간만 기록합니다.')
    // 같은 방식이면 있는 종목을 그대로 쓴다.
    expect(
      await addCustomExercise({ name: '스텝 밀', bodyPart: 'cardio', equipment: 'machine', measure: 'cardio', cardioMetric: 'floors' }),
    ).toBe(STEPMILL)
  })

  it('기록이 없으면 기록 방식과 함께 적는 값을 바꿀 수 있다', async () => {
    const id = await addCustomExercise({ name: '계단 오르기', bodyPart: 'legs', equipment: 'other', measure: 'reps' })
    await updateExerciseGoal(id, { targetReps: 20 })
    const routineId = await createRoutine({ name: '계단', items: [{ exerciseId: id, sets: 3, reps: 20 }] })

    const base = { name: '계단 오르기', bodyPart: 'cardio', equipment: 'other' } as const
    await updateCustomExercise(id, { ...base, measure: 'cardio', cardioMetric: 'floors' })
    expect(await db.exercises.get(id)).toMatchObject({ measure: 'cardio', cardioMetric: 'floors', targetReps: null })
    // 횟수 목표는 뜻을 잃으니 루틴에서도 비운다.
    expect((await getRoutine(routineId))!.items).toEqual([{ exerciseId: id, sets: 3, reps: null }])

    // 함께 적는 값을 주지 않으면 그대로 둔다(이름만 고칠 때).
    await updateCustomExercise(id, { ...base, name: '계단', measure: 'cardio' })
    expect(await db.exercises.get(id)).toMatchObject({ name: '계단', cardioMetric: 'floors' })
    await updateCustomExercise(id, { ...base, measure: 'cardio', cardioMetric: null })
    expect(cardioMetricOf(await db.exercises.get(id))).toBeNull()
    // 유산소가 아니게 되면 함께 적는 값도 없앤다.
    await updateCustomExercise(id, { ...base, measure: 'cardio', cardioMetric: 'distance' })
    await updateCustomExercise(id, { ...base, measure: 'time' })
    expect(await db.exercises.get(id)).toMatchObject({ measure: 'time', cardioMetric: null })
  })

  it('기록이 있으면 기록 방식도 함께 적는 값도 바꿀 수 없다', async () => {
    const id = await addCustomExercise({ name: '계단 오르기', bodyPart: 'cardio', equipment: 'other', measure: 'cardio', cardioMetric: 'floors' })
    const workoutId = await startWorkout()
    await addExercisesToWorkout(workoutId, [id])
    const base = { name: '계단 오르기', bodyPart: 'cardio', equipment: 'other' } as const
    await expect(updateCustomExercise(id, { ...base, measure: 'cardio', cardioMetric: 'distance' })).rejects.toThrow(CARDIO_LOCKED_MESSAGE)
    await expect(updateCustomExercise(id, { ...base, measure: 'reps' })).rejects.toThrow(CARDIO_LOCKED_MESSAGE)
    // 이름, 부위, 기구는 바꿀 수 있다.
    await updateCustomExercise(id, { ...base, name: '계단', measure: 'cardio', cardioMetric: 'floors' })
    expect(await db.exercises.get(id)).toMatchObject({ name: '계단', measure: 'cardio', cardioMetric: 'floors' })
  })
})
