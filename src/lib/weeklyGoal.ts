import type { Workout } from '../db'
import { startOfWeek } from './format'
import { SETTING_KEYS, setSetting } from './settings'

/**
 * 주간 목표(주에 몇 번 운동할지)와 연속 달성.
 *
 * 세는 방법은 홈의 "이번 주 운동"(workouts.ts의 countThisWeek)과 같다.
 * - 끝낸 운동만 센다. 진행 중인 운동은 세지 않는다.
 * - 한 주는 월요일 0시부터 일요일 끝까지다(폰의 시간대). 운동은 시작한 시각이 속한 주에 들어간다.
 * - 날이 아니라 운동 횟수를 센다. 하루에 두 번 했으면 2회다.
 *
 * 연속 달성
 * - 지난주부터 거슬러 올라가며 목표를 채운 주가 끊기지 않고 이어진 수다.
 * - 이번 주는 목표를 채운 때부터 1주로 더한다. 아직 못 채웠어도 주가 끝나기 전에는 연속을 끊지 않는다.
 * - 목표를 언제 바꿨는지는 저장하지 않는다. 그래서 지난 주들도 지금 목표로 센다.
 *   목표를 올리면 연속이 줄 수 있고, 내리면 늘 수 있다.
 */

/** 고를 수 있는 주간 목표(회) */
export const WEEKLY_GOAL_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, 6, 7]

type FinishedAt = Pick<Workout, 'startedAt' | 'endedAt'>

/** 주간 목표로 쓸 수 있는 값인지(1~7의 정수) */
export function isWeeklyGoal(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 7
}

/** 주간 목표를 저장한다. null이면 목표를 없앤다. */
export async function saveWeeklyGoal(goal: number | null): Promise<void> {
  if (goal !== null && !isWeeklyGoal(goal)) throw new RangeError('주간 목표는 1~7회로 정해 주세요.')
  await setSetting(SETTING_KEYS.weeklyGoal, goal)
}

/** 주마다 끝낸 운동 횟수. 키는 그 주 월요일 0시의 시각(ms)이다. */
export function countByWeek(workouts: FinishedAt[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const w of workouts) {
    if (w.endedAt === null) continue
    const week = startOfWeek(w.startedAt).getTime()
    counts.set(week, (counts.get(week) ?? 0) + 1)
  }
  return counts
}

/** 바로 앞 주의 월요일 0시. 1ms 앞은 앞 주의 일요일이다(7일을 빼면 서머타임이 있는 곳에서 어긋날 수 있다). */
function previousWeek(weekStart: number): number {
  return startOfWeek(weekStart - 1).getTime()
}

export interface WeeklyGoalStatus {
  goal: number
  /** 이번 주에 끝낸 운동 횟수 */
  count: number
  /** 목표까지 남은 횟수. 채웠으면 0 */
  remaining: number
  /** 이번 주 목표를 채웠는지 */
  met: boolean
  /** 연속으로 목표를 채운 주. 지금 목표로 센다. */
  streak: number
}

/**
 * 이번 주 진행과 연속 달성. 목표가 없거나 저장된 값이 이상하면 null.
 * now가 속한 주만 보므로 같은 주 안에서는 now가 달라도 결과가 같다.
 */
export function weeklyGoalStatus(workouts: FinishedAt[], goal: unknown, now: number = Date.now()): WeeklyGoalStatus | null {
  if (!isWeeklyGoal(goal)) return null
  const counts = countByWeek(workouts)
  const thisWeek = startOfWeek(now).getTime()
  const count = counts.get(thisWeek) ?? 0
  const met = count >= goal

  // 운동이 없는 주는 0회라 목표(1 이상)를 못 채우므로 기록이 끝나는 곳에서 반드시 멈춘다.
  let streak = met ? 1 : 0
  for (let week = previousWeek(thisWeek); (counts.get(week) ?? 0) >= goal; week = previousWeek(week)) streak += 1

  return { goal, count, remaining: Math.max(0, goal - count), met, streak }
}
