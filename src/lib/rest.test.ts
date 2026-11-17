import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  REST_STEP_SECONDS,
  adjustRest,
  canAdjustRest,
  parseRestTimer,
  restDurationSeconds,
  setRestDuration,
  startRest,
} from './rest'
import {
  DEFAULT_REST_SECONDS,
  REST_OPTIONS,
  REST_RANGE,
  SETTING_KEYS,
  getRestSeconds,
  isRestSeconds,
  setSetting,
} from './settings'

const NOW = 1_800_000_000_000

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('휴식 시간 설정', () => {
  it('고를 수 있는 시간에 긴 휴식(3~5분)이 들어 있고 모두 범위 안이다', () => {
    expect(REST_OPTIONS).toContain(180)
    expect(REST_OPTIONS).toContain(300)
    expect(REST_OPTIONS.every(isRestSeconds)).toBe(true)
    expect(isRestSeconds(DEFAULT_REST_SECONDS)).toBe(true)
  })

  it('범위 안의 정수 초만 받는다', () => {
    expect(isRestSeconds(REST_RANGE.min)).toBe(true)
    expect(isRestSeconds(REST_RANGE.max)).toBe(true)
    expect(isRestSeconds(105)).toBe(true)
    expect(isRestSeconds(REST_RANGE.min - 1)).toBe(false)
    expect(isRestSeconds(REST_RANGE.max + 1)).toBe(false)
    expect(isRestSeconds(90.5)).toBe(false)
    expect(isRestSeconds('90')).toBe(false)
    expect(isRestSeconds(null)).toBe(false)
    expect(isRestSeconds(undefined)).toBe(false)
  })

  it('기본값은 프리셋이 아닌 값도 저장되고, 이상한 값이면 90초로 본다', async () => {
    expect(await getRestSeconds()).toBe(DEFAULT_REST_SECONDS)
    await setSetting(SETTING_KEYS.restSeconds, 210)
    expect(await getRestSeconds()).toBe(210)
    await setSetting(SETTING_KEYS.restSeconds, 0)
    expect(await getRestSeconds()).toBe(DEFAULT_REST_SECONDS)
    await setSetting(SETTING_KEYS.restSeconds, 99999)
    expect(await getRestSeconds()).toBe(DEFAULT_REST_SECONDS)
    await setSetting(SETTING_KEYS.restSeconds, '120')
    expect(await getRestSeconds()).toBe(DEFAULT_REST_SECONDS)
  })
})

describe('휴식 타이머 계산', () => {
  it('시작하면 그 길이만큼 뒤에 끝난다', () => {
    expect(startRest(NOW, 90)).toEqual({ startedAt: NOW, endsAt: NOW + 90_000 })
    expect(startRest(NOW, 240, true)).toEqual({ startedAt: NOW, endsAt: NOW + 240_000, ownTime: true })
    expect(restDurationSeconds(startRest(NOW, 240))).toBe(240)
  })

  it('길이를 바꾸면 시작한 시각은 그대로고 끝나는 시각만 바뀐다', () => {
    const timer = startRest(NOW, 90, true)
    expect(setRestDuration(timer, 180)).toEqual({ startedAt: NOW, endsAt: NOW + 180_000, ownTime: true })
  })

  it('15초씩 늘리고 줄인다', () => {
    const timer = startRest(NOW, 90)
    const later = NOW + 30_000
    const longer = adjustRest(timer, REST_STEP_SECONDS, later)
    expect(longer.endsAt - later).toBe(75_000)
    expect(restDurationSeconds(longer)).toBe(105)
    expect(longer.startedAt).toBe(NOW)
    const shorter = adjustRest(timer, -REST_STEP_SECONDS, later)
    expect(shorter.endsAt - later).toBe(45_000)
  })

  it('줄여서 바로 끝나 버리면 줄이지 않는다', () => {
    const timer = startRest(NOW, 60)
    const nearEnd = NOW + 50_000
    expect(canAdjustRest(timer, -REST_STEP_SECONDS, nearEnd)).toBe(false)
    expect(adjustRest(timer, -REST_STEP_SECONDS, nearEnd)).toBe(timer)
    // 15초보다 조금이라도 더 남았으면 줄일 수 있다.
    expect(canAdjustRest(timer, -REST_STEP_SECONDS, NOW + 44_000)).toBe(true)
  })

  it('남은 시간이 한계를 넘게 늘리지 않는다', () => {
    const timer = startRest(NOW, REST_RANGE.max)
    expect(canAdjustRest(timer, REST_STEP_SECONDS, NOW)).toBe(false)
    expect(adjustRest(timer, REST_STEP_SECONDS, NOW)).toBe(timer)
    // 쉬는 동안 남은 시간이 줄었으면 다시 늘릴 수 있다.
    expect(canAdjustRest(timer, REST_STEP_SECONDS, NOW + 15_000)).toBe(true)
  })

  it('끝난 휴식은 바꾸지 않는다', () => {
    const timer = startRest(NOW, 60)
    expect(canAdjustRest(timer, REST_STEP_SECONDS, NOW + 60_000)).toBe(false)
    expect(adjustRest(timer, REST_STEP_SECONDS, NOW + 61_000)).toBe(timer)
  })
})

describe('저장해 둔 타이머 읽기', () => {
  it('예전 모양(시작과 끝 시각만)도 읽는다', () => {
    expect(parseRestTimer(JSON.stringify({ startedAt: NOW, endsAt: NOW + 2000 }))).toEqual({
      startedAt: NOW,
      endsAt: NOW + 2000,
    })
  })

  it('종목 시간으로 시작했다는 표시를 그대로 읽는다', () => {
    expect(parseRestTimer(JSON.stringify(startRest(NOW, 180, true)))).toEqual({
      startedAt: NOW,
      endsAt: NOW + 180_000,
      ownTime: true,
    })
  })

  it('모양이 맞지 않으면 null', () => {
    expect(parseRestTimer(null)).toBeNull()
    expect(parseRestTimer('')).toBeNull()
    expect(parseRestTimer('{')).toBeNull()
    expect(parseRestTimer('null')).toBeNull()
    expect(parseRestTimer(JSON.stringify({ startedAt: '1', endsAt: 2 }))).toBeNull()
    expect(parseRestTimer(JSON.stringify({ startedAt: NOW, endsAt: NOW - 1 }))).toBeNull()
  })
})
