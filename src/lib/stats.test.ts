import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { estimate1RM, type ExerciseSession } from './history'
import {
  addMonths,
  availableMetrics,
  bodyPartSets,
  countInMonth,
  exerciseOverviews,
  exerciseSeries,
  formatDayOfYear,
  formatMetric,
  formatMonthDay,
  formatSetsSummary,
  formatWeekRange,
  lastDays,
  loadStatsData,
  metricValue,
  monthGrid,
  weeklyTotals,
  workoutDaysInMonth,
} from './stats'
import { addExercisesToWorkout, finishWorkout, loadWorkoutDetail, startWorkout } from './workouts'

const SQUAT = 'ex-squat'
const BENCH = 'ex-bench'
const DIPS = 'ex-dips'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await db.exercises.bulkAdd([
    { id: SQUAT, name: '스쿼트', bodyPart: 'legs', equipment: 'barbell', isCustom: false, createdAt: 0 },
    { id: BENCH, name: '벤치프레스', bodyPart: 'chest', equipment: 'barbell', isCustom: false, createdAt: 0 },
    { id: DIPS, name: '딥스', bodyPart: 'chest', equipment: 'bodyweight', isCustom: false, createdAt: 0 },
  ])
})

/** 로컬 시간. month는 1~12 */
const at = (y: number, month: number, d: number, h = 18, min = 0) => new Date(y, month - 1, d, h, min).getTime()

type Row = [weightKg: number | null, reps: number, opts?: { warmup?: boolean; done?: boolean }]

/** 세트를 적고 끝낸 운동 하나. finish=false면 진행 중으로 둔다. */
async function record(startedAt: number, entries: [exerciseId: string, rows: Row[]][], finish = true) {
  const id = await startWorkout(startedAt)
  await addExercisesToWorkout(
    id,
    entries.map(([e]) => e),
  )
  const detail = await loadWorkoutDetail(id)
  for (const [exerciseId, rows] of entries) {
    const weId = detail!.items.find((i) => i.we.exerciseId === exerciseId)!.we.id
    await db.sets.where('workoutExerciseId').equals(weId).delete()
    await db.sets.bulkAdd(
      rows.map(([weightKg, reps, opts], i) => ({
        id: `${weId}-${i}`,
        workoutExerciseId: weId,
        order: i,
        weightKg,
        reps,
        isWarmup: opts?.warmup ?? false,
        isDone: opts?.done ?? true,
      })),
    )
  }
  if (finish) expect(await finishWorkout(id, { endedAt: startedAt + 3_600_000 })).toBe(true)
  return id
}

/** DB 없이 쓰는 기록 하나 */
function session(id: string, startedAt: number, exerciseId: string, rows: Row[], ended = true): ExerciseSession {
  return {
    workout: { id, date: '', startedAt, endedAt: ended ? startedAt + 1 : null, memo: '' },
    we: { id: `${id}-${exerciseId}`, workoutId: id, exerciseId, order: 0, memo: '' },
    sets: rows.map(([weightKg, reps, opts], i) => ({
      id: `${id}-${i}`,
      workoutExerciseId: `${id}-${exerciseId}`,
      order: i,
      weightKg,
      reps,
      isWarmup: opts?.warmup ?? false,
      isDone: opts?.done ?? true,
    })),
  }
}

describe('주별 합계', () => {
  // 2026년 11월 16일은 월요일
  const now = at(2026, 11, 18, 12)

  it('이번 주까지 최근 N주를 월요일 0시부터 나누고, 빈 주도 넣는다', () => {
    const weeks = weeklyTotals([], [], { weeks: 12, now })
    expect(weeks).toHaveLength(12)
    expect(weeks[11].start).toBe(at(2026, 11, 16, 0))
    expect(weeks[11].end).toBe(at(2026, 11, 23, 0))
    expect(weeks[0].start).toBe(at(2026, 8, 31, 0))
    expect(weeks.every((w) => w.workouts === 0 && w.volume === 0 && w.sets === 0)).toBe(true)
    for (let i = 1; i < weeks.length; i++) expect(weeks[i].start).toBe(weeks[i - 1].end)
  })

  it('일요일 밤 늦게 시작한 운동은 그 주에, 월요일 0시는 다음 주에 넣는다', () => {
    const sunday = session('sun', at(2026, 11, 15, 23, 59), SQUAT, [[100, 5]])
    const monday = session('mon', at(2026, 11, 16, 0, 0), SQUAT, [[100, 3]])
    const weeks = weeklyTotals([sunday.workout, monday.workout], [sunday, monday], { weeks: 2, now })
    expect(weeks.map((w) => [w.workouts, w.volume, w.sets])).toEqual([
      [1, 500, 1],
      [1, 300, 1],
    ])
  })

  it('볼륨과 세트 수는 완료한 본 세트만, 진행 중인 운동과 범위 밖 운동은 빼고 센다', () => {
    const a = session('a', at(2026, 11, 17), SQUAT, [
      [40, 10, { warmup: true }],
      [100, 5],
      [100, 5],
      [120, 1, { done: false }],
    ])
    const b = session('b', at(2026, 11, 17, 20), DIPS, [[null, 12]])
    const open = session('open', at(2026, 11, 18, 9), SQUAT, [[100, 5]], false)
    const old = session('old', at(2026, 8, 30, 10), SQUAT, [[100, 5]])
    const weeks = weeklyTotals([a.workout, b.workout, open.workout, old.workout], [a, b, open, old], { weeks: 12, now })
    expect(weeks[11]).toMatchObject({ workouts: 2, volume: 1000, sets: 3 })
    expect(weeks.slice(0, 11).every((w) => w.workouts === 0)).toBe(true)
  })

  it('올해가 아닌 날짜에는 연도를 붙인다', () => {
    expect(formatMonthDay(at(2026, 3, 7), now)).toBe('3월 7일')
    expect(formatMonthDay(at(2025, 3, 7), now)).toBe('2025년 3월 7일')
    expect(formatDayOfYear(at(2026, 11, 16), now)).toBe('11월 16일 (월)')
    expect(formatDayOfYear(at(2025, 3, 7), now)).toBe('2025년 3월 7일 (금)')
  })

  it('주 범위를 글로 쓴다', () => {
    expect(formatWeekRange(at(2026, 11, 9, 0))).toBe('11월 9일 ~ 15일')
    expect(formatWeekRange(at(2026, 10, 26, 0))).toBe('10월 26일 ~ 11월 1일')
  })
})

describe('부위별 세트', () => {
  const exercises = new Map([
    [SQUAT, { bodyPart: 'legs' as const }],
    [BENCH, { bodyPart: 'chest' as const }],
    [DIPS, { bodyPart: 'chest' as const }],
  ])

  it('최근 4주는 오늘 포함 28일, 첫날 0시부터', () => {
    const range = lastDays(28, at(2026, 11, 16, 21))
    expect(range).toEqual({ from: at(2026, 10, 20, 0), to: at(2026, 11, 17, 0) })
  })

  it('기간 안의 본 세트를 부위별로 세고, 많은 것부터 준다', () => {
    const range = lastDays(28, at(2026, 11, 16, 21))
    const result = bodyPartSets(
      [
        session('a', at(2026, 11, 2), SQUAT, [
          [60, 5, { warmup: true }],
          [100, 5],
          [100, 5],
          [100, 5],
        ]),
        session('b', at(2026, 11, 2), BENCH, [
          [80, 5],
          [80, 5],
        ]),
        session('c', at(2026, 11, 9), DIPS, [
          [null, 10],
          [null, 10],
        ]),
        session('d', at(2026, 10, 19, 23, 59), BENCH, [[80, 5]]), // 기간 전날
        session('e', at(2026, 11, 16, 20), BENCH, [[80, 5]], false), // 진행 중
        session('f', at(2026, 11, 10), 'gone', [[10, 10]]), // 지워진 종목
      ],
      exercises,
      range,
    )
    expect(result.map((r) => [r.bodyPart, r.sets])).toEqual([
      ['chest', 4],
      ['legs', 3],
      ['other', 1],
      ['back', 0],
      ['shoulders', 0],
      ['arms', 0],
      ['core', 0],
    ])
    expect(result[0].label).toBe('가슴')
  })

  it('기록이 없으면 기타 없이 모두 0', () => {
    const result = bodyPartSets([], exercises, lastDays(28, at(2026, 11, 16)))
    expect(result).toHaveLength(6)
    expect(result.every((r) => r.sets === 0)).toBe(true)
  })
})

describe('운동 달력', () => {
  it('그 달에 운동한 날과 운동 id를 시작한 순서대로 준다', () => {
    const w = (id: string, startedAt: number, ended = true) => ({
      id,
      startedAt,
      endedAt: ended ? startedAt + 1 : null,
    })
    const days = workoutDaysInMonth(
      [
        w('late', at(2026, 11, 3, 19)),
        w('early', at(2026, 11, 3, 7)),
        w('first', at(2026, 11, 1, 0, 0)),
        w('last', at(2026, 11, 30, 23, 59)),
        w('oct', at(2026, 10, 31, 23, 59)),
        w('dec', at(2026, 12, 1, 0, 0)),
        w('open', at(2026, 11, 10), false),
      ],
      { year: 2026, month: 10 },
    )
    expect([...days.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [1, ['first']],
      [3, ['early', 'late']],
      [30, ['last']],
    ])
    expect(
      countInMonth([w('a', at(2026, 11, 3)), w('b', at(2026, 11, 3, 20)), w('c', at(2026, 12, 1))], {
        year: 2026,
        month: 10,
      }),
    ).toBe(2)
  })

  it('달력 칸은 월요일부터, 앞뒤는 빈칸', () => {
    // 2026년 11월 1일은 일요일, 30일은 월요일
    const grid = monthGrid({ year: 2026, month: 10 })
    expect(grid).toHaveLength(6)
    expect(grid[0]).toEqual([null, null, null, null, null, null, 1])
    expect(grid[5]).toEqual([30, null, null, null, null, null, null])
    // 2027년 2월은 월요일에 시작해 28일, 딱 4주
    expect(monthGrid({ year: 2027, month: 1 })).toEqual(
      Array.from({ length: 4 }, (_, i) => Array.from({ length: 7 }, (_, j) => i * 7 + j + 1)),
    )
    // 윤년 2월
    expect(
      monthGrid({ year: 2028, month: 1 })
        .flat()
        .filter((d) => d !== null),
    ).toHaveLength(29)
  })

  it('달을 넘긴다', () => {
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
  })
})

describe('종목별 추이', () => {
  it('기록마다 최고 중량, 추정 1RM, 볼륨, 맨몸 횟수를 오래된 것부터', () => {
    const points = exerciseSeries([
      session('b', at(2026, 11, 9), SQUAT, [
        [105, 3],
        [60, 20],
      ]),
      session('a', at(2026, 11, 2), SQUAT, [
        [40, 10, { warmup: true }],
        [100, 5],
        [100, 4],
      ]),
    ])
    expect(points.map((p) => p.workoutId)).toEqual(['a', 'b'])
    expect(points[0]).toMatchObject({ topWeight: 100, bestE1rm: estimate1RM(100, 5), volume: 900, maxReps: null })
    expect(points[0].sets).toHaveLength(2)
    // 20회 세트는 1RM 계산에서 빠진다
    expect(points[1]).toMatchObject({ topWeight: 105, bestE1rm: estimate1RM(105, 3), volume: 315 + 1200 })
  })

  it('맨몸 종목은 횟수만 볼 수 있다', () => {
    const points = exerciseSeries([
      session('a', at(2026, 11, 2), DIPS, [
        [null, 12],
        [0, 10],
      ]),
    ])
    expect(points[0]).toMatchObject({ topWeight: null, bestE1rm: null, volume: 0, maxReps: 12 })
    expect(availableMetrics(points)).toEqual(['maxReps'])
    expect(metricValue(points[0], 'volume')).toBeNull()
  })

  it('무게를 단 종목은 1RM, 최고 중량, 볼륨', () => {
    const points = exerciseSeries([session('a', at(2026, 11, 2), SQUAT, [[100, 5]])])
    expect(availableMetrics(points)).toEqual(['bestE1rm', 'topWeight', 'volume'])
    expect(availableMetrics([])).toEqual([])
    // 웜업만 한 기록은 그릴 값이 없다.
    expect(
      availableMetrics(exerciseSeries([session('w', at(2026, 11, 2), SQUAT, [[60, 5, { warmup: true }]])])),
    ).toEqual([])
  })

  it('값을 단위와 함께 쓴다', () => {
    expect(formatMetric('bestE1rm', estimate1RM(62.5, 8))).toBe('79.2kg')
    expect(formatMetric('topWeight', 62.5)).toBe('62.5kg')
    expect(formatMetric('volume', 12345.4)).toBe('12,345kg')
    expect(formatMetric('maxReps', 12)).toBe('12회')
  })

  it('본 세트를 짧게 쓰고, 같은 세트가 이어지면 묶는다', () => {
    const s = (weightKg: number | null, reps: number, isWarmup = false, isDone = true) => ({
      weightKg,
      reps,
      isWarmup,
      isDone,
    })
    expect(formatSetsSummary([s(20, 10, true), s(60, 8), s(62.5, 6)])).toBe('60×8 · 62.5×6')
    expect(formatSetsSummary([s(60, 8), s(60, 8), s(60, 8), s(65, 5), s(60, 8)])).toBe('60×8×3 · 65×5 · 60×8')
    expect(formatSetsSummary([s(null, 12), s(null, 12), s(0, 10), s(10, 10, false, false)])).toBe('12회×2 · 10회')
    expect(formatSetsSummary([])).toBe('')
  })
})

describe('통계 데이터 읽기', () => {
  it('비어 있으면 모두 빈 값', async () => {
    const data = await loadStatsData()
    expect(data.workouts).toEqual([])
    expect(data.sessions).toEqual([])
    expect(exerciseOverviews(data.sessionsByExercise)).toEqual([])
    expect(data.exercises.size).toBe(3)
  })

  it('끝난 운동만 읽고, 종목 목록은 최근에 한 것부터', async () => {
    const first = await record(at(2026, 11, 2), [
      [
        SQUAT,
        [
          [60, 5, { warmup: true }],
          [100, 5],
        ],
      ],
      [BENCH, [[80, 5]]],
    ])
    await record(at(2026, 11, 5), [
      [
        DIPS,
        [
          [null, 12],
          [null, 10],
        ],
      ],
    ])
    await record(at(2026, 11, 9), [[SQUAT, [[105, 3]]]])
    await record(at(2026, 11, 12), [[BENCH, [[90, 5]]]], false) // 진행 중

    const data = await loadStatsData()
    expect(data.workouts.map((w) => w.startedAt)).toEqual([at(2026, 11, 2), at(2026, 11, 5), at(2026, 11, 9)])
    expect(data.sessions).toHaveLength(4)
    expect(data.sessions[0].workout.id).toBe(first)

    const list = exerciseOverviews(data.sessionsByExercise)
    expect(list.map((e) => [e.exerciseId, e.sessionCount])).toEqual([
      [SQUAT, 2],
      [DIPS, 1],
      [BENCH, 1],
    ])
    expect(list[0]).toMatchObject({
      lastAt: at(2026, 11, 9),
      bestE1rm: estimate1RM(100, 5),
      maxWeight: 105,
      maxReps: null,
    })
    expect(list[1]).toMatchObject({ bestE1rm: null, maxWeight: null, maxReps: 12 })

    const weeks = weeklyTotals(data.workouts, data.sessions, { weeks: 2, now: at(2026, 11, 12) })
    expect(weeks.map((w) => [w.workouts, w.volume, w.sets])).toEqual([
      [2, 900, 4],
      [1, 315, 1],
    ])
  })
})
