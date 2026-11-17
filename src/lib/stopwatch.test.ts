import { describe, expect, it } from 'vitest'
import {
  parseStopwatch,
  startStopwatch,
  stopwatchElapsedMs,
  stopwatchReachedTarget,
  stopwatchSeconds,
  stopwatchTargetLeftMs,
} from './stopwatch'

const T0 = new Date(2026, 10, 16, 19, 0).getTime()

describe('스톱워치', () => {
  it('시작한 시각만 들고 있고, 흐른 시간은 시계에서 계산한다', () => {
    const sw = startStopwatch('set-1', T0)
    expect(sw).toEqual({ setId: 'set-1', startedAt: T0 })
    expect(stopwatchElapsedMs(sw, T0 + 12_345)).toBe(12_345)
    // 화면을 30분 꺼 뒀다가 돌아와도 그만큼 흐른 것으로 나온다.
    expect(stopwatchElapsedMs(sw, T0 + 30 * 60_000)).toBe(1_800_000)
    // 시계가 뒤로 가도 음수가 되지 않는다.
    expect(stopwatchElapsedMs(sw, T0 - 5000)).toBe(0)
  })

  it('세트에 적을 시간은 초로 반올림하고 1초보다 작아지지 않는다', () => {
    const sw = startStopwatch('set-1', T0)
    expect(stopwatchSeconds(sw, T0 + 62_400)).toBe(62)
    expect(stopwatchSeconds(sw, T0 + 62_500)).toBe(63)
    expect(stopwatchSeconds(sw, T0 + 754_000)).toBe(754)
    expect(stopwatchSeconds(sw, T0 + 200)).toBe(1)
    expect(stopwatchSeconds(sw, T0)).toBe(1)
  })

  it('목표 시간이 있으면 남은 시간과 채웠는지를 알 수 있다', () => {
    const sw = startStopwatch('set-1', T0, 60)
    expect(sw.targetSec).toBe(60)
    expect(stopwatchTargetLeftMs(sw, T0 + 45_000)).toBe(15_000)
    expect(stopwatchReachedTarget(sw, T0 + 59_999)).toBe(false)
    expect(stopwatchReachedTarget(sw, T0 + 60_000)).toBe(true)
    // 채운 뒤에도 계속 센다.
    expect(stopwatchTargetLeftMs(sw, T0 + 75_000)).toBe(-15_000)
    expect(stopwatchSeconds(sw, T0 + 75_000)).toBe(75)
  })

  it('목표가 없거나 쓸 수 없는 값이면 목표 없이 잰다', () => {
    for (const target of [undefined, null, 0, -5, Number.NaN]) {
      const sw = startStopwatch('set-1', T0, target)
      expect(sw.targetSec).toBeUndefined()
      expect(stopwatchTargetLeftMs(sw, T0 + 1000)).toBeNull()
      expect(stopwatchReachedTarget(sw, T0 + 999_000)).toBe(false)
    }
  })

  it('저장한 값을 그대로 읽고, 알린 표시도 남긴다', () => {
    const sw = startStopwatch('set-1', T0, 60)
    expect(parseStopwatch(JSON.stringify(sw))).toEqual(sw)
    expect(parseStopwatch(JSON.stringify({ ...sw, alerted: true }))).toEqual({ ...sw, alerted: true })
    const plain = startStopwatch('set-2', T0)
    expect(parseStopwatch(JSON.stringify(plain))).toEqual(plain)
    // 목표가 없으면 알린 표시도 쓰지 않는다.
    expect(parseStopwatch(JSON.stringify({ ...plain, alerted: true }))).toEqual(plain)
  })

  it('모양이 맞지 않는 값은 버린다', () => {
    expect(parseStopwatch(null)).toBeNull()
    expect(parseStopwatch('')).toBeNull()
    expect(parseStopwatch('{')).toBeNull()
    expect(parseStopwatch('null')).toBeNull()
    expect(parseStopwatch(JSON.stringify({ startedAt: T0 }))).toBeNull()
    expect(parseStopwatch(JSON.stringify({ setId: '', startedAt: T0 }))).toBeNull()
    expect(parseStopwatch(JSON.stringify({ setId: 'set-1', startedAt: '어제' }))).toBeNull()
    expect(parseStopwatch(JSON.stringify({ setId: 'set-1', startedAt: T0, targetSec: '60' }))).toEqual({
      setId: 'set-1',
      startedAt: T0,
    })
  })
})
