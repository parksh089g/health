import { describe, expect, it } from 'vitest'
import { estimateTextWidth, formatAxisNumber, niceTicks, timeTicks } from './scale'

const at = (y: number, month: number, d: number, h = 0) => new Date(y, month - 1, d, h).getTime()

describe('값 축 눈금', () => {
  it('0부터 깔끔한 간격으로 덮는다', () => {
    expect(niceTicks(0, 3, { zero: true, integer: true }).ticks).toEqual([0, 1, 2, 3])
    expect(niceTicks(0, 4, { zero: true, integer: true }).ticks).toEqual([0, 1, 2, 3, 4])
    expect(niceTicks(0, 7, { zero: true, integer: true }).ticks).toEqual([0, 2, 4, 6, 8])
    expect(niceTicks(0, 18320, { zero: true }).ticks).toEqual([0, 5000, 10000, 15000, 20000])
  })

  it('모두 0이면 0과 1', () => {
    expect(niceTicks(0, 0, { zero: true, integer: true }).ticks).toEqual([0, 1])
  })

  it('kg는 2.5와 5 단위도 쓰고, 0 아래로 내려가지 않는다', () => {
    const t = niceTicks(60, 70, {})
    expect(t.ticks).toEqual([60, 62.5, 65, 67.5, 70])
    expect(niceTicks(2, 30, {}).ticks[0]).toBe(0)
  })

  it('값이 하나뿐이면 위아래로 넓힌다', () => {
    const t = niceTicks(60, 60, {})
    expect(t.min).toBeLessThan(60)
    expect(t.max).toBeGreaterThan(60)
    expect(t.ticks).toContain(60)
    expect(niceTicks(12, 12, { integer: true }).ticks.every(Number.isInteger)).toBe(true)
  })

  it('횟수는 정수 눈금만', () => {
    expect(niceTicks(8, 11, { integer: true }).ticks.every(Number.isInteger)).toBe(true)
  })

  it('1만이 넘는 축은 만 단위로 줄인다', () => {
    expect(formatAxisNumber(15000, 20000)).toBe('1.5만')
    expect(formatAxisNumber(0, 20000)).toBe('0')
    expect(formatAxisNumber(2500, 5000)).toBe('2,500')
    expect(formatAxisNumber(62.5, 70)).toBe('62.5')
  })
})

describe('시간 축 눈금', () => {
  it('짧은 기간은 날짜, 몇 주는 월요일', () => {
    expect(timeTicks(at(2026, 11, 2, 18), at(2026, 11, 5, 18), 5).map((t) => t.label)).toEqual(['11/3', '11/4', '11/5'])
    const weeks = timeTicks(at(2026, 9, 10, 18), at(2026, 11, 16, 18), 5)
    expect(weeks.map((t) => t.label)).toEqual(['9/14', '9/28', '10/12', '10/26', '11/9'])
    expect(weeks.every((t) => new Date(t.t).getDay() === 1)).toBe(true)
  })

  it('긴 기간은 달, 1월에는 연도', () => {
    expect(timeTicks(at(2026, 6, 10), at(2027, 3, 1), 5).map((t) => t.label)).toEqual([
      '7월',
      '9월',
      '11월',
      '2027년',
      '3월',
    ])
    expect(timeTicks(at(2026, 9, 10), at(2027, 2, 1), 5).map((t) => t.label)).toEqual([
      '10월',
      '11월',
      '12월',
      '2027년',
      '2월',
    ])
  })

  it('여러 해면 반년이나 한 해 간격', () => {
    const ticks = timeTicks(at(2022, 3, 1), at(2026, 11, 1), 5)
    expect(ticks.map((t) => t.label)).toEqual(['2023년', '2024년', '2025년', '2026년'])
  })

  it('눈금 수를 넘지 않는다', () => {
    for (const max of [2, 3, 4, 6]) {
      expect(timeTicks(at(2025, 1, 1), at(2026, 11, 16), max).length).toBeLessThanOrEqual(max)
    }
  })

  it('글자 폭을 어림한다', () => {
    expect(estimateTextWidth('11/16', 10)).toBeCloseTo(6.2 * 4 + 3.5)
    expect(estimateTextWidth('11월', 10)).toBeCloseTo(12.4 + 10)
  })
})
