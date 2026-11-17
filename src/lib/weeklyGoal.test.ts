import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { SETTING_KEYS, getWeeklyGoal, setSetting } from './settings'
import { countByWeek, isWeeklyGoal, saveWeeklyGoal, weeklyGoalStatus, WEEKLY_GOAL_OPTIONS } from './weeklyGoal'
import { countThisWeek } from './workouts'

/** 로컬 시간. month는 1~12 */
const at = (y: number, month: number, d: number, h = 19, min = 0, sec = 0) =>
  new Date(y, month - 1, d, h, min, sec).getTime()

/** 끝낸 운동 */
const done = (startedAt: number, minutes = 60) => ({ startedAt, endedAt: startedAt + minutes * 60_000 })
/** 진행 중인 운동 */
const active = (startedAt: number) => ({ startedAt, endedAt: null })

/** 그 날짜부터 하루에 한 번씩 n번 끝낸 운동 */
const daily = (y: number, month: number, d: number, n: number) =>
  Array.from({ length: n }, (_, i) => done(at(y, month, d + i)))

// 2026-11-16은 월요일이다. 이번 주는 11/16(월)~11/22(일), 지난주는 11/9~11/15.
const WED = at(2026, 11, 18, 12)

describe('isWeeklyGoal', () => {
  it('1~7의 정수만 받는다', () => {
    for (const v of WEEKLY_GOAL_OPTIONS) expect(isWeeklyGoal(v)).toBe(true)
    for (const v of [0, 8, -1, 2.5, NaN, Infinity, '4', null, undefined, true, [3], { value: 3 }]) {
      expect(isWeeklyGoal(v)).toBe(false)
    }
  })
})

describe('saveWeeklyGoal', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('저장한 목표를 다시 읽는다', async () => {
    expect(await getWeeklyGoal()).toBeNull()
    await saveWeeklyGoal(4)
    expect(await getWeeklyGoal()).toBe(4)
    await saveWeeklyGoal(7)
    expect(await getWeeklyGoal()).toBe(7)
  })

  it('null이면 목표를 없앤다', async () => {
    await saveWeeklyGoal(3)
    await saveWeeklyGoal(null)
    expect(await getWeeklyGoal()).toBeNull()
  })

  it('범위를 벗어난 값은 저장하지 않는다', async () => {
    await saveWeeklyGoal(3)
    for (const v of [0, 8, 2.5, NaN]) await expect(saveWeeklyGoal(v)).rejects.toThrow(RangeError)
    expect(await getWeeklyGoal()).toBe(3)
  })

  it('저장된 값이 이상하면 목표가 없는 것으로 본다', async () => {
    const workouts = daily(2026, 11, 16, 3)
    for (const stored of ['4', 0, 8, 3.5, -2, true, { goal: 4 }, [4], null]) {
      await setSetting(SETTING_KEYS.weeklyGoal, stored)
      const goal = await getWeeklyGoal()
      expect(goal).toBeNull()
      expect(weeklyGoalStatus(workouts, goal, WED)).toBeNull()
      // 읽는 쪽을 거치지 않고 값이 바로 들어와도 같다.
      expect(weeklyGoalStatus(workouts, stored, WED)).toBeNull()
    }
  })
})

describe('countByWeek', () => {
  it('월요일 0시부터 일요일 끝까지를 한 주로 센다', () => {
    const monday = at(2026, 11, 16, 0)
    const counts = countByWeek([
      done(at(2026, 11, 15, 23, 59, 59)), // 일요일 끝: 지난주
      done(monday), // 월요일 0시 정각: 이번 주
      done(at(2026, 11, 22, 23, 59, 59)), // 일요일 끝: 이번 주
      done(at(2026, 11, 23, 0)), // 다음 주 월요일 0시
    ])
    expect(counts.get(at(2026, 11, 9, 0))).toBe(1)
    expect(counts.get(monday)).toBe(2)
    expect(counts.get(at(2026, 11, 23, 0))).toBe(1)
    expect(counts.size).toBe(3)
  })

  it('진행 중인 운동은 세지 않고, 주를 넘겨 끝낸 운동은 시작한 주에 넣는다', () => {
    const counts = countByWeek([
      active(at(2026, 11, 17)),
      done(at(2026, 11, 15, 23, 30), 90), // 일요일 밤에 시작해 월요일 새벽에 끝냄
    ])
    expect(counts.get(at(2026, 11, 9, 0))).toBe(1)
    expect(counts.has(at(2026, 11, 16, 0))).toBe(false)
  })

  it('해가 바뀌는 주도 한 주다', () => {
    // 2026-12-28(월)~2027-01-03(일)
    const counts = countByWeek([done(at(2026, 12, 28, 0)), done(at(2026, 12, 31)), done(at(2027, 1, 1)), done(at(2027, 1, 3, 23, 59))])
    expect([...counts]).toEqual([[at(2026, 12, 28, 0), 4]])
  })
})

describe('weeklyGoalStatus: 이번 주 진행', () => {
  it('목표가 없으면 null', () => {
    expect(weeklyGoalStatus(daily(2026, 11, 16, 3), null, WED)).toBeNull()
  })

  it('이번 주에 끝낸 운동을 목표에 견준다', () => {
    const workouts = [
      done(at(2026, 11, 15)), // 지난주 일요일
      done(at(2026, 11, 16, 7)),
      done(at(2026, 11, 17)),
      active(at(2026, 11, 18, 11)),
    ]
    expect(weeklyGoalStatus(workouts, 4, WED)).toEqual({ goal: 4, count: 2, remaining: 2, met: false, streak: 0 })
  })

  it('홈의 이번 주 횟수(countThisWeek)와 같은 수를 센다', () => {
    const workouts = [
      done(at(2026, 11, 15, 23, 59, 59)),
      done(at(2026, 11, 16, 0)),
      done(at(2026, 11, 17, 7)),
      done(at(2026, 11, 17, 20)), // 하루에 두 번 하면 2회
      active(at(2026, 11, 18)),
      done(at(2026, 11, 22, 23, 59)),
      done(at(2026, 11, 23, 0)),
    ]
    // 월요일 0시, 주 중간, 일요일 끝, 그 앞뒤 주
    for (const now of [at(2026, 11, 16, 0), WED, at(2026, 11, 22, 23, 59, 59), at(2026, 11, 15, 23, 59), at(2026, 11, 23, 0)]) {
      expect(weeklyGoalStatus(workouts, 3, now)?.count).toBe(countThisWeek(workouts, now))
    }
    expect(weeklyGoalStatus(workouts, 3, WED)?.count).toBe(4)
  })

  it('목표를 채우거나 넘기면 남은 횟수는 0', () => {
    expect(weeklyGoalStatus(daily(2026, 11, 16, 3), 3, WED)).toMatchObject({ count: 3, remaining: 0, met: true })
    expect(weeklyGoalStatus(daily(2026, 11, 16, 5), 3, at(2026, 11, 21))).toMatchObject({ count: 5, remaining: 0, met: true })
  })

  it('일요일 밤과 월요일 0시는 다른 주다', () => {
    const workouts = daily(2026, 11, 16, 3)
    expect(weeklyGoalStatus(workouts, 3, at(2026, 11, 22, 23, 59, 59))).toMatchObject({ count: 3, met: true, streak: 1 })
    // 주가 바뀌면 0회부터 다시 세고, 지난주가 된 주는 연속에 남는다.
    expect(weeklyGoalStatus(workouts, 3, at(2026, 11, 23, 0))).toMatchObject({ count: 0, remaining: 3, met: false, streak: 1 })
  })

  it('해가 바뀌는 주에서도 같은 주로 센다', () => {
    const workouts = [done(at(2026, 12, 28)), done(at(2026, 12, 31)), done(at(2027, 1, 1))]
    expect(weeklyGoalStatus(workouts, 3, at(2027, 1, 2))).toMatchObject({ count: 3, met: true })
    expect(weeklyGoalStatus(workouts, 3, at(2026, 12, 27))).toMatchObject({ count: 0, met: false })
    expect(weeklyGoalStatus(workouts, 3, at(2027, 1, 4, 0))).toMatchObject({ count: 0, met: false, streak: 1 })
  })
})

describe('weeklyGoalStatus: 연속 달성', () => {
  const streak = (workouts: { startedAt: number; endedAt: number | null }[], goal: number, now = WED) =>
    weeklyGoalStatus(workouts, goal, now)?.streak

  // 지난 세 주(10/26, 11/2, 11/9 주)에 세 번씩
  const threeWeeks = [...daily(2026, 10, 26, 3), ...daily(2026, 11, 2, 3), ...daily(2026, 11, 9, 3)]

  it('기록이 없으면 0', () => {
    expect(streak([], 1)).toBe(0)
    expect(streak([], 7)).toBe(0)
    expect(streak([active(at(2026, 11, 17))], 1)).toBe(0)
  })

  it('이번 주를 아직 못 채웠으면 지난주까지 이어진 주만 센다(끊지 않는다)', () => {
    expect(streak(threeWeeks, 3)).toBe(3)
    expect(streak([...threeWeeks, ...daily(2026, 11, 16, 2)], 3)).toBe(3)
    // 일요일 밤까지도 끊기지 않는다.
    expect(streak([...threeWeeks, ...daily(2026, 11, 16, 2)], 3, at(2026, 11, 22, 23, 59, 59))).toBe(3)
  })

  it('이번 주를 채우면 1주가 더해진다', () => {
    expect(streak([...threeWeeks, ...daily(2026, 11, 16, 3)], 3)).toBe(4)
    expect(streak(daily(2026, 11, 16, 3), 3)).toBe(1)
  })

  it('못 채운 채로 주가 끝나면 다음 주에 끊긴다', () => {
    const workouts = [...threeWeeks, ...daily(2026, 11, 16, 2)]
    expect(streak(workouts, 3, at(2026, 11, 23, 0))).toBe(0)
    // 그다음 주를 채워도 1주부터 다시 센다.
    expect(streak([...workouts, ...daily(2026, 11, 23, 3)], 3, at(2026, 11, 26))).toBe(1)
  })

  it('중간에 못 채운 주가 있으면 거기서 끊긴다', () => {
    const workouts = [
      ...daily(2026, 10, 19, 3),
      ...daily(2026, 10, 26, 2), // 한 번 모자란 주
      ...daily(2026, 11, 2, 3),
      ...daily(2026, 11, 9, 3),
    ]
    expect(streak(workouts, 3)).toBe(2)
    // 한 주를 통째로 쉰 경우
    expect(streak([...daily(2026, 10, 26, 3), ...daily(2026, 11, 9, 3)], 3)).toBe(1)
  })

  it('지난주를 못 채웠으면 그 앞의 연속은 세지 않는다', () => {
    const workouts = [...daily(2026, 10, 26, 3), ...daily(2026, 11, 2, 3)]
    expect(streak(workouts, 3)).toBe(0)
    expect(streak([...workouts, ...daily(2026, 11, 16, 3)], 3)).toBe(1)
  })

  it('목표가 1회면 한 번이라도 한 주가 이어진 만큼', () => {
    const weekly = [done(at(2026, 10, 25)), done(at(2026, 10, 26, 0)), done(at(2026, 11, 8, 23, 59)), done(at(2026, 11, 9))]
    // 10/19 주(일요일), 10/26 주(월요일 0시), 11/2 주(일요일 끝), 11/9 주
    expect(streak(weekly, 1)).toBe(4)
    expect(streak([...weekly, done(at(2026, 11, 16, 0))], 1)).toBe(5)
    expect(streak(weekly, 2)).toBe(0)
  })

  it('하루에 두 번 한 운동도 따로 세고, 진행 중인 운동은 세지 않는다', () => {
    const lastWeek = [done(at(2026, 11, 10, 7)), done(at(2026, 11, 10, 20))]
    expect(streak(lastWeek, 2)).toBe(1)
    expect(streak([done(at(2026, 11, 10, 7)), active(at(2026, 11, 11))], 2)).toBe(0)
    expect(streak([...lastWeek, done(at(2026, 11, 16)), active(at(2026, 11, 17))], 2)).toBe(1)
  })

  it('해를 넘겨도 이어진다', () => {
    // 12/21 주, 12/28 주(해가 바뀌는 주), 1/4 주
    const workouts = [
      ...daily(2026, 12, 21, 2),
      done(at(2026, 12, 31)),
      done(at(2027, 1, 2)),
      ...daily(2027, 1, 4, 2),
    ]
    expect(streak(workouts, 2, at(2027, 1, 12))).toBe(3)
    expect(streak(workouts, 2, at(2027, 1, 3, 23, 59))).toBe(2)
  })

  it('목표를 바꾸면 지난 주들도 새 목표로 다시 센다', () => {
    const workouts = [...daily(2026, 10, 26, 4), ...daily(2026, 11, 2, 3), ...daily(2026, 11, 9, 4), ...daily(2026, 11, 16, 3)]
    expect(streak(workouts, 3)).toBe(4)
    expect(streak(workouts, 4)).toBe(1) // 이번 주는 아직, 지난주만
    expect(streak(workouts, 5)).toBe(0)
  })

  it('이번 주보다 뒤의 날짜로 적힌 운동은 세지 않는다', () => {
    expect(weeklyGoalStatus(daily(2026, 11, 23, 3), 3, WED)).toMatchObject({ count: 0, met: false, streak: 0 })
  })
})
