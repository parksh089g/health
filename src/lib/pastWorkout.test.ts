import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { findNewRecords } from './history'
import { getRecommendation } from './recommend'
import { countThisWeek } from './workouts'
import {
  addExercisesToWorkout,
  finishWorkout,
  getActiveWorkout,
  getLastSets,
  isPastWorkout,
  loadWorkoutDetail,
  loadWorkoutSummaries,
  localTimestamp,
  pastWorkoutError,
  startPastWorkout,
  startWorkout,
  updateSet,
} from './workouts'

const SQUAT = 'ex-squat'
/** 2026-11-17(화) 15:00 로컬 */
const NOW = new Date(2026, 10, 17, 15, 0).getTime()

beforeEach(async () => {
  await db.delete()
  await db.open()
  await db.exercises.add({
    id: SQUAT,
    name: '스쿼트',
    bodyPart: 'legs',
    equipment: 'barbell',
    isCustom: false,
    createdAt: 0,
    targetReps: 5,
  })
})

async function squatSets(workoutId: string) {
  const detail = await loadWorkoutDetail(workoutId)
  return detail?.items.find((i) => i.we.exerciseId === SQUAT)?.sets ?? []
}

/** 스쿼트 세트를 적고 완료한다. */
async function doSquat(workoutId: string, done: [number, number][]) {
  await addExercisesToWorkout(workoutId, [SQUAT])
  const sets = await squatSets(workoutId)
  for (const [i, s] of sets.entries()) {
    const d = done[i]
    await updateSet(s.id, d ? { weightKg: d[0], reps: d[1], isDone: true } : { isDone: false })
  }
}

/** 지금 하는 운동으로 스쿼트를 기록한다. */
async function liveSquat(startedAt: number, done: [number, number][]) {
  const id = await startWorkout(startedAt)
  await doSquat(id, done)
  expect(await finishWorkout(id, { endedAt: startedAt + 3_600_000 })).toBe(true)
  return id
}

describe('날짜와 시각', () => {
  it('로컬 시간으로 바꾸고, 없는 날짜나 틀린 형식은 null', () => {
    expect(localTimestamp('2026-11-12', '18:30')).toBe(new Date(2026, 10, 12, 18, 30).getTime())
    expect(localTimestamp('2026-02-30', '10:00')).toBeNull()
    expect(localTimestamp('2026-11-12', '24:00')).toBeNull()
    expect(localTimestamp('', '10:00')).toBeNull()
    expect(localTimestamp('2026-11-12', '')).toBeNull()
  })

  it('지금보다 늦은 시각과 범위를 벗어난 운동 시간은 막는다', () => {
    expect(pastWorkoutError({ date: '2026-11-16', time: '18:00', minutes: 60 }, NOW)).toBeNull()
    expect(pastWorkoutError({ date: '2026-11-17', time: '16:00', minutes: 60 }, NOW)).toMatch(/앞선 시각/)
    expect(pastWorkoutError({ date: '2026-11-18', time: '08:00', minutes: 60 }, NOW)).toMatch(/앞선 시각/)
    expect(pastWorkoutError({ date: '2026-11-16', time: '18:00', minutes: 0 }, NOW)).toMatch(/운동 시간/)
    expect(pastWorkoutError({ date: '2026-11-16', time: '18:00', minutes: 601 }, NOW)).toMatch(/운동 시간/)
    expect(pastWorkoutError({ date: '2026-11-16', time: '18:00', minutes: 1.5 }, NOW)).toMatch(/운동 시간/)
  })
})

describe('지난 운동 적기', () => {
  it('그날 그 시각에 시작한 운동을 만들고, 마치면 시작 + 운동 시간에 끝난 운동이 된다', async () => {
    const { id, created } = await startPastWorkout({ date: '2026-11-12', time: '18:30', minutes: 75 }, NOW)
    expect(created).toBe(true)
    const startedAt = new Date(2026, 10, 12, 18, 30).getTime()
    const w = await db.workouts.get(id)
    expect(w).toMatchObject({ date: '2026-11-12', startedAt, endedAt: null })
    expect(isPastWorkout(w)).toBe(true)
    expect((await getActiveWorkout())?.id).toBe(id)

    await doSquat(id, [[100, 5]])
    // 운동 완료 화면이 넘기는 시각(지금)보다 적어 둔 끝난 시각이 앞선다.
    expect(await finishWorkout(id, { endedAt: NOW })).toBe(true)
    const done = await db.workouts.get(id)
    expect(done?.endedAt).toBe(startedAt + 75 * 60_000)
    expect(isPastWorkout(done)).toBe(false)
    expect(await getActiveWorkout()).toBeUndefined()
  })

  it('끝난 시각이 지금보다 늦으면 지금으로 줄인다', async () => {
    const { id } = await startPastWorkout({ date: '2026-11-17', time: '14:30', minutes: 120 }, NOW)
    expect((await db.workouts.get(id))?.pastEndAt).toBe(NOW)
  })

  it('진행 중인 운동이 있으면 만들지 않고 그 운동을 돌려준다(반대도 마찬가지)', async () => {
    const live = await startWorkout(NOW - 1_000)
    const r = await startPastWorkout({ date: '2026-11-12', time: '18:00', minutes: 60 }, NOW)
    expect(r).toEqual({ id: live, created: false })
    expect(await db.workouts.count()).toBe(1)

    await db.workouts.clear()
    const past = await startPastWorkout({ date: '2026-11-12', time: '18:00', minutes: 60 }, NOW)
    expect(await startWorkout(NOW)).toBe(past.id)
  })

  it('입력이 틀리면 만들지 않는다', async () => {
    await expect(startPastWorkout({ date: '2026-11-18', time: '18:00', minutes: 60 }, NOW)).rejects.toThrow()
    expect(await db.workouts.count()).toBe(0)
  })

  it('미리 채우는 지난번 세트는 그날보다 앞선 기록에서 가져온다', async () => {
    await liveSquat(new Date(2026, 10, 10, 18, 0).getTime(), [[80, 5]])
    await liveSquat(new Date(2026, 10, 15, 18, 0).getTime(), [[90, 5]])
    const { id } = await startPastWorkout({ date: '2026-11-12', time: '18:00', minutes: 60 }, NOW)
    expect((await getLastSets(SQUAT, id)).map((s) => s.weightKg)).toEqual([80])
    await addExercisesToWorkout(id, [SQUAT])
    expect((await squatSets(id)).map((s) => s.weightKg)).toEqual([80])
    // 지금 하는 운동은 가장 최근 기록에서 가져온다.
    expect((await getLastSets(SQUAT)).map((s) => s.weightKg)).toEqual([90])
  })

  it('저장한 지난 운동은 기록 목록, 이번 주 횟수, 새 기록, 다음 추천에 그 날짜로 들어간다', async () => {
    await liveSquat(new Date(2026, 10, 10, 18, 0).getTime(), [[80, 5]])
    const later = await liveSquat(new Date(2026, 10, 16, 18, 0).getTime(), [[85, 5]])
    const { id } = await startPastWorkout({ date: '2026-11-12', time: '18:00', minutes: 60 }, NOW)
    await doSquat(id, [[82.5, 5]])
    await finishWorkout(id, { endedAt: NOW })

    // 기록 목록은 운동한 날 순서
    expect((await loadWorkoutSummaries()).map((s) => s.workout.date)).toEqual(['2026-11-16', '2026-11-12', '2026-11-10'])
    // 11/16(월)이 낀 주: 11/16만. 11/12는 지난주
    const workouts = await db.workouts.toArray()
    expect(countThisWeek(workouts, NOW)).toBe(1)
    expect(countThisWeek(workouts, new Date(2026, 10, 13, 12, 0).getTime())).toBe(2)
    // 그날보다 앞선 기록(80kg)과 비교해 새 기록
    expect((await findNewRecords(id)).some((r) => r.kind === 'maxWeight' && r.previous === 80)).toBe(true)
    // 그 뒤에 한 운동의 기록 비교에는 지난 운동(82.5kg)도 들어간다.
    expect((await findNewRecords(later)).find((r) => r.kind === 'maxWeight')?.previous).toBe(82.5)

    // 다음 운동의 추천은 가장 최근(11/16, 85kg)을 기준으로 한다(하체 바벨은 5kg씩 올린다).
    const next = await startWorkout(NOW)
    await addExercisesToWorkout(next, [SQUAT])
    const we = (await db.workoutExercises.where('workoutId').equals(next).toArray())[0]
    expect((await getRecommendation(we))?.weightKg).toBe(90)
  })
})
