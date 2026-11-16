import { describe, expect, it } from 'vitest'
import {
  formatClock,
  formatDay,
  formatDuration,
  formatFullDate,
  formatKg,
  formatMonth,
  formatTime,
  formatVolume,
  startOfWeek,
  toDateKey,
} from './format'

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min)

describe('날짜', () => {
  it('날짜 키는 로컬 시간 기준 YYYY-MM-DD', () => {
    expect(toDateKey(local(2026, 11, 6, 23, 59))).toBe('2026-11-06')
    expect(toDateKey(local(2026, 1, 1).getTime())).toBe('2026-01-01')
  })

  it('한 주는 월요일 0시에 시작한다', () => {
    const monday = local(2026, 11, 16).getTime()
    expect(startOfWeek(local(2026, 11, 16)).getTime()).toBe(monday)
    expect(startOfWeek(local(2026, 11, 18, 15, 30)).getTime()).toBe(monday)
    expect(startOfWeek(local(2026, 11, 22, 23, 59)).getTime()).toBe(monday) // 일요일은 그 주의 마지막 날
    expect(startOfWeek(local(2026, 11, 15)).getTime()).toBe(local(2026, 11, 9).getTime())
  })

  it('화면에 쓰는 날짜 표기', () => {
    const ts = local(2026, 11, 16, 21, 5).getTime()
    expect(formatDay(ts)).toBe('11월 16일 (월)')
    expect(formatMonth(ts)).toBe('2026년 11월')
    expect(formatFullDate(ts)).toBe('2026년 11월 16일')
    expect(formatTime(ts)).toBe('오후 9:05')
    expect(formatTime(local(2026, 11, 16, 0, 30).getTime())).toBe('오전 12:30')
    expect(formatTime(local(2026, 11, 16, 12, 0).getTime())).toBe('오후 12:00')
  })
})

describe('시간과 숫자', () => {
  it('운동 시간', () => {
    expect(formatDuration(0)).toBe('0분')
    expect(formatDuration(45 * 60_000)).toBe('45분')
    expect(formatDuration(60 * 60_000)).toBe('1시간')
    expect(formatDuration(72 * 60_000)).toBe('1시간 12분')
  })

  it('타이머 표기', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(65_000)).toBe('1:05')
    expect(formatClock(3_723_000)).toBe('1:02:03')
    expect(formatClock(-5)).toBe('0:00')
  })

  it('무게와 볼륨', () => {
    expect(formatKg(60)).toBe('60')
    expect(formatKg(62.5)).toBe('62.5')
    expect(formatKg(0.1 + 0.2)).toBe('0.3')
    expect(formatVolume(12340)).toBe('12,340')
  })
})
