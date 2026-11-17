import { beforeEach, describe, expect, it } from 'vitest'
import { db, type BodyWeight } from '../db'
import {
  BODY_WEIGHT_DRAFT,
  addDaysToKey,
  availableRanges,
  bodyWeightDateError,
  bodyWeightError,
  dateKeyToTime,
  deleteBodyWeight,
  entriesInRange,
  formatWeightChange,
  listBodyWeights,
  parseBodyWeight,
  saveBodyWeight,
  weightChange,
} from './bodyWeight'
import { toDateKey } from './format'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

/** 2026년 11월 16일 오후 3시(로컬 시간) */
const NOW = new Date(2026, 10, 16, 15, 0).getTime()

function entry(date: string, weightKg: number): BodyWeight {
  return { date, weightKg, updatedAt: 0 }
}

describe('날짜 키', () => {
  it('그날 0시(로컬 시간)로 바꾸고, 없는 날짜는 받지 않는다', () => {
    expect(dateKeyToTime('2026-11-16')).toBe(new Date(2026, 10, 16).getTime())
    expect(dateKeyToTime('2026-02-30')).toBeNull()
    expect(dateKeyToTime('2026-13-01')).toBeNull()
    expect(dateKeyToTime('2026-1-5')).toBeNull()
    expect(dateKeyToTime('')).toBeNull()
  })

  it('일수를 더하면 달과 해를 넘어간다', () => {
    expect(addDaysToKey('2026-11-16', -28)).toBe('2026-10-19')
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('체중 입력 검사', () => {
  it('입력 칸의 글자를 숫자로 읽는다', () => {
    expect(parseBodyWeight('72')).toBe(72)
    expect(parseBodyWeight('72.4')).toBe(72.4)
    expect(parseBodyWeight('72,4')).toBe(72.4)
    expect(parseBodyWeight(' 72. ')).toBe(72)
    expect(parseBodyWeight('')).toBeNull()
    expect(parseBodyWeight('.')).toBeNull()
    expect(parseBodyWeight('72kg')).toBeNull()
    expect(parseBodyWeight('-72')).toBeNull()
  })

  it('입력하는 동안에는 숫자 세 자리와 소수 한 자리까지만 받는다', () => {
    for (const ok of ['', '7', '72', '72.', '72.4', '300', '.5']) expect(BODY_WEIGHT_DRAFT.test(ok)).toBe(true)
    for (const bad of ['72.45', '1000', '72..', '7a', '-7', '72,4']) expect(BODY_WEIGHT_DRAFT.test(bad)).toBe(false)
  })

  it('20~300kg만 받는다', () => {
    expect(bodyWeightError(20)).toBeNull()
    expect(bodyWeightError(300)).toBeNull()
    expect(bodyWeightError(72.4)).toBeNull()
    expect(bodyWeightError(19.9)).toBe('체중은 20~300kg로 적어 주세요.')
    expect(bodyWeightError(300.1)).toBe('체중은 20~300kg로 적어 주세요.')
    expect(bodyWeightError(0)).toBe('체중은 20~300kg로 적어 주세요.')
  })

  it('비어 있거나 숫자가 아니면 입력해 달라고 한다', () => {
    expect(bodyWeightError(null)).toBe('체중을 입력해 주세요.')
    expect(bodyWeightError(Number.NaN)).toBe('체중을 입력해 주세요.')
    expect(bodyWeightError(Number.POSITIVE_INFINITY)).toBe('체중을 입력해 주세요.')
  })

  it('소수 둘째 자리는 받지 않는다', () => {
    expect(bodyWeightError(72.45)).toBe('체중은 소수 첫째 자리까지 적어 주세요.')
    // 소수 한 자리는 0.1 단위의 어떤 값이든 괜찮다(부동소수점 오차에 걸리지 않는다).
    for (let i = 200; i <= 3000; i++) expect(bodyWeightError(i / 10)).toBeNull()
  })

  it('날짜는 오늘까지만 받는다', () => {
    expect(bodyWeightDateError('2026-11-16', NOW)).toBeNull()
    expect(bodyWeightDateError('2020-01-01', NOW)).toBeNull()
    expect(bodyWeightDateError('2026-11-17', NOW)).toBe('오늘 이후의 날짜에는 기록할 수 없습니다.')
    expect(bodyWeightDateError('', NOW)).toBe('날짜를 골라 주세요.')
    expect(bodyWeightDateError('2026-02-30', NOW)).toBe('날짜를 골라 주세요.')
  })
})

describe('체중 기록 저장', () => {
  it('같은 날 다시 적으면 덮어써서 하루에 하나만 남는다', async () => {
    await saveBodyWeight('2026-11-16', 72.4, NOW)
    await saveBodyWeight('2026-11-16', 71.9, NOW + 1000)

    expect(await listBodyWeights()).toEqual([{ date: '2026-11-16', weightKg: 71.9, updatedAt: NOW + 1000 }])
  })

  it('적은 순서와 상관없이 오래된 날짜부터 돌려준다', async () => {
    await saveBodyWeight('2026-11-16', 72, NOW)
    await saveBodyWeight('2025-12-31', 75, NOW)
    await saveBodyWeight('2026-11-02', 73, NOW)
    await saveBodyWeight('2026-01-01', 74.5, NOW)

    expect((await listBodyWeights()).map((e) => e.date)).toEqual([
      '2025-12-31',
      '2026-01-01',
      '2026-11-02',
      '2026-11-16',
    ])
  })

  it('지난 날짜에도 적을 수 있고, 지우면 그날만 없어진다', async () => {
    await saveBodyWeight('2026-11-16', 72, NOW)
    await saveBodyWeight('2026-11-01', 73, NOW)

    await deleteBodyWeight('2026-11-01')

    expect((await listBodyWeights()).map((e) => e.date)).toEqual(['2026-11-16'])
  })

  it('잘못된 체중이나 날짜는 저장하지 않는다', async () => {
    await expect(saveBodyWeight('2026-11-16', 19, NOW)).rejects.toThrow('체중은 20~300kg로 적어 주세요.')
    await expect(saveBodyWeight('2026-11-16', 301, NOW)).rejects.toThrow('체중은 20~300kg로 적어 주세요.')
    await expect(saveBodyWeight('2026-11-16', 72.45, NOW)).rejects.toThrow('소수 첫째 자리')
    await expect(saveBodyWeight('2026-11-17', 72, NOW)).rejects.toThrow('오늘 이후')
    await expect(saveBodyWeight('어제', 72, NOW)).rejects.toThrow('날짜를 골라 주세요.')

    expect(await db.bodyWeights.count()).toBe(0)
  })

  it('백업으로 들어온 잘못된 날짜의 줄은 목록에서 뺀다', async () => {
    await db.bodyWeights.bulkAdd([entry('2026-11-16', 72), entry('언젠가', 70)])

    expect((await listBodyWeights()).map((e) => e.date)).toEqual(['2026-11-16'])
  })
})

describe('최근 4주 변화', () => {
  it('28일 전부터 오늘까지의 가장 오래된 기록과 가장 최근 기록을 견준다', () => {
    const entries = [
      entry('2026-10-01', 76),
      entry('2026-10-19', 73.6),
      entry('2026-11-02', 73),
      entry('2026-11-16', 72.4),
    ]

    const change = weightChange(entries, NOW)

    // 10월 19일이 딱 28일 전이다. 그보다 앞선 10월 1일 기록은 보지 않는다.
    expect(change?.from.date).toBe('2026-10-19')
    expect(change?.to.date).toBe('2026-11-16')
    expect(change?.deltaKg).toBe(-1.2)
  })

  it('순서가 섞여 있어도 같고, 늘었으면 양수다', () => {
    const entries = [entry('2026-11-10', 71), entry('2026-10-25', 70.2), entry('2026-11-03', 70.5)]

    expect(weightChange(entries, NOW)).toMatchObject({ deltaKg: 0.8, from: entries[1], to: entries[0] })
  })

  it('오늘 기록이 없어도 기간 안의 가장 최근 기록까지를 본다', () => {
    const entries = [entry('2026-10-30', 80), entry('2026-11-09', 79.5)]

    expect(weightChange(entries, NOW)).toMatchObject({ deltaKg: -0.5 })
  })

  it('기간 안의 기록이 둘보다 적으면 없다', () => {
    expect(weightChange([], NOW)).toBeNull()
    expect(weightChange([entry('2026-11-16', 72)], NOW)).toBeNull()
    // 하나는 4주보다 오래됐다.
    expect(weightChange([entry('2026-10-18', 74), entry('2026-11-16', 72)], NOW)).toBeNull()
    // 앞날로 적힌 기록(시계가 바뀐 경우)은 세지 않는다.
    expect(weightChange([entry('2026-11-16', 72), entry('2026-11-20', 71)], NOW)).toBeNull()
  })

  it('변화량을 부호와 함께 적는다', () => {
    expect(formatWeightChange(0.8)).toBe('+0.8kg')
    expect(formatWeightChange(-1.2)).toBe('−1.2kg')
    expect(formatWeightChange(-2)).toBe('−2kg')
    expect(formatWeightChange(0)).toBe('변화 없음')
    expect(formatWeightChange(72.4 - 72.4000001)).toBe('변화 없음')
  })
})

describe('그래프 기간', () => {
  const today = toDateKey(NOW)
  const old = [entry('2024-05-01', 80), entry('2026-03-01', 76)]
  const recent = [entry('2026-09-01', 74), entry(today, 72)]

  it('기간 안의 기록만 고른다(3개월은 13주, 그날 포함)', () => {
    const all = [...old, entry('2026-08-16', 75), entry('2026-08-17', 74.8), ...recent]

    expect(entriesInRange(all, '3m', NOW).map((e) => e.date)).toEqual(['2026-08-17', '2026-09-01', today])
    expect(entriesInRange(all, '1y', NOW).map((e) => e.date)).toEqual([
      '2026-03-01',
      '2026-08-16',
      '2026-08-17',
      '2026-09-01',
      today,
    ])
    expect(entriesInRange(all, 'all', NOW)).toEqual(all)
  })

  it('기록이 모두 3개월 안에 있으면 고를 기간이 하나뿐이다', () => {
    expect(availableRanges(recent, NOW)).toEqual(['3m'])
  })

  it('더 오래된 기록이 있는 만큼만 넓은 기간을 내놓는다', () => {
    expect(availableRanges([...old, ...recent], NOW)).toEqual(['3m', '1y', 'all'])
    expect(availableRanges([old[1], ...recent], NOW)).toEqual(['3m', '1y'])
    expect(availableRanges([old[0], ...recent], NOW)).toEqual(['3m', 'all'])
  })

  it('최근 기록이 없으면 기록이 있는 가장 좁은 기간부터 내놓는다', () => {
    expect(availableRanges(old, NOW)).toEqual(['1y', 'all'])
    expect(availableRanges([old[0]], NOW)).toEqual(['all'])
    expect(availableRanges([], NOW)).toEqual([])
  })
})
