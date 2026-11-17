import { describe, expect, it } from 'vitest'
import { DEFAULT_BAR_WEIGHT_KG, DEFAULT_PLATES } from './settings'
import {
  describePlateLoad,
  distinctWeights,
  formatPlates,
  isBarWeight,
  nearestLoadable,
  platesFor,
  type PlateSetup,
} from './plates'

/** 기본 설정: 20kg 바, 25 20 15 10 5 2.5 1.25kg 원판 */
const standard: PlateSetup = { barKg: DEFAULT_BAR_WEIGHT_KG, plates: DEFAULT_PLATES }

describe('딱 맞는 무게', () => {
  it('한쪽에 끼울 원판을 무거운 것부터 준다', () => {
    expect(platesFor(100, standard)).toEqual({ perSide: [25, 15], loadedKg: 100, leftoverKg: 0, belowBar: false })
    expect(platesFor(85, standard).perSide).toEqual([25, 5, 2.5])
    expect(platesFor(62.5, standard).perSide).toEqual([20, 1.25])
  })

  it('같은 원판을 여러 장 쓴다', () => {
    expect(platesFor(180, standard).perSide).toEqual([25, 25, 25, 5])
    expect(platesFor(60, { barKg: 20, plates: [10, 5] }).perSide).toEqual([10, 10])
  })

  it('바 무게와 같으면 원판 없이 바만 든다', () => {
    expect(platesFor(20, standard)).toEqual({ perSide: [], loadedKg: 20, leftoverKg: 0, belowBar: false })
  })
})

describe('딱 맞지 않는 무게', () => {
  it('넘지 않는 가장 가까운 무게로 맞추고 남는 무게를 알려 준다', () => {
    expect(platesFor(101, standard)).toEqual({ perSide: [25, 15], loadedKg: 100, leftoverKg: 1, belowBar: false })
    expect(platesFor(63, standard)).toEqual({ perSide: [20, 1.25], loadedKg: 62.5, leftoverKg: 0.5, belowBar: false })
  })

  it('가장 작은 원판 한 쌍보다 조금 무거우면 바만 들고 나머지가 남는다', () => {
    expect(platesFor(22, standard)).toEqual({ perSide: [], loadedKg: 20, leftoverKg: 2, belowBar: false })
  })

  it('남는 무게에 소수 계산 오차가 섞이지 않는다', () => {
    expect(platesFor(72.6, standard).leftoverKg).toBe(0.1)
  })
})

describe('바보다 가벼운 무게', () => {
  it('바보다 가볍다고 알려 준다', () => {
    expect(platesFor(15, standard)).toEqual({ perSide: [], loadedKg: 20, leftoverKg: 0, belowBar: true })
    expect(platesFor(0, standard).belowBar).toBe(true)
  })
})

describe('가진 원판이 다를 때', () => {
  it('켜 둔 원판만 쓴다', () => {
    const no25: PlateSetup = { barKg: 20, plates: [20, 15, 10, 5, 2.5, 1.25] }
    expect(platesFor(100, no25).perSide).toEqual([20, 20])
    expect(platesFor(125, no25).perSide).toEqual([20, 20, 10, 2.5])
  })

  it('0.5kg 원판을 켜면 1kg 단위까지 맞춘다', () => {
    const fine: PlateSetup = { barKg: 20, plates: [...DEFAULT_PLATES, 0.5] }
    expect(platesFor(101, fine)).toEqual({ perSide: [25, 15, 0.5], loadedKg: 101, leftoverKg: 0, belowBar: false })
  })

  it('큰 원판부터 채우면 못 맞추는 무게도 다른 조합으로 맞춘다', () => {
    // 한쪽 30kg: 20을 먼저 끼우면 10이 남지만 15 두 장이면 딱 맞는다.
    expect(platesFor(80, { barKg: 20, plates: [20, 15] })).toEqual({
      perSide: [15, 15],
      loadedKg: 80,
      leftoverKg: 0,
      belowBar: false,
    })
  })

  it('원판 순서가 뒤섞이거나 겹쳐도 같다', () => {
    expect(platesFor(100, { barKg: 20, plates: [5, 25, 15, 25, 10] }).perSide).toEqual([25, 15])
  })

  it('원판이 하나도 없으면 바만 들고 나머지가 남는다', () => {
    expect(platesFor(60, { barKg: 20, plates: [] })).toEqual({
      perSide: [],
      loadedKg: 20,
      leftoverKg: 40,
      belowBar: false,
    })
  })
})

describe('바 무게가 다를 때', () => {
  it('15kg 바', () => {
    expect(platesFor(100, { ...standard, barKg: 15 }).perSide).toEqual([25, 15, 2.5])
  })

  it('딱 떨어지지 않는 바 무게(7.5kg)', () => {
    const odd: PlateSetup = { ...standard, barKg: 7.5 }
    expect(platesFor(50, odd)).toEqual({ perSide: [20, 1.25], loadedKg: 50, leftoverKg: 0, belowBar: false })
    expect(platesFor(60, odd)).toEqual({ perSide: [25, 1.25], loadedKg: 60, leftoverKg: 0, belowBar: false })
    expect(platesFor(61, odd)).toEqual({ perSide: [25, 1.25], loadedKg: 60, leftoverKg: 1, belowBar: false })
    expect(platesFor(7, odd).belowBar).toBe(true)
  })

  it('직접 적는 바 무게는 1~50kg만 받는다', () => {
    expect(isBarWeight(7.5)).toBe(true)
    expect(isBarWeight(50)).toBe(true)
    expect(isBarWeight(0)).toBe(false)
    expect(isBarWeight(51)).toBe(false)
    expect(isBarWeight(null)).toBe(false)
  })
})

describe('가장 가까운 올릴 수 있는 무게', () => {
  it('딱 맞으면 그 무게', () => {
    expect(nearestLoadable(40, standard)).toBe(40)
    expect(nearestLoadable(62.5, standard)).toBe(62.5)
  })

  it('위아래 중 가까운 쪽으로, 똑같이 가까우면 가벼운 쪽으로 맞춘다', () => {
    expect(nearestLoadable(41, standard)).toBe(40)
    expect(nearestLoadable(42, standard)).toBe(42.5)
    expect(nearestLoadable(41.25, standard)).toBe(40)
  })

  it('바보다 가벼우면 바 무게', () => {
    expect(nearestLoadable(12, standard)).toBe(20)
    expect(nearestLoadable(20, standard)).toBe(20)
  })

  it('큰 원판만 있으면 그 원판으로 만들 수 있는 무게로 간다', () => {
    const big: PlateSetup = { barKg: 20, plates: [20, 10] }
    expect(nearestLoadable(48, big)).toBe(40)
    expect(nearestLoadable(52, big)).toBe(60)
    expect(nearestLoadable(21, { barKg: 20, plates: [] })).toBe(20)
  })
})

describe('화면에 보여 줄 글', () => {
  it('한쪽 원판을 + 로 잇는다', () => {
    expect(formatPlates([20, 10, 2.5])).toBe('20 + 10 + 2.5')
  })

  it('딱 맞으면 한 줄', () => {
    expect(describePlateLoad(platesFor(85, standard), 20)).toEqual({ main: '한쪽에 25 + 5 + 2.5', note: null })
    expect(describePlateLoad(platesFor(20, standard), 20)).toEqual({ main: '원판 없이 바만', note: null })
  })

  it('딱 맞지 않으면 맞출 수 있는 무게와 남는 무게를 덧붙인다', () => {
    expect(describePlateLoad(platesFor(101, standard), 20)).toEqual({
      main: '한쪽에 25 + 15',
      note: '100kg까지 맞출 수 있어요 (1kg 남음)',
    })
  })

  it('바보다 가벼우면 그렇다고 알려 준다', () => {
    expect(describePlateLoad(platesFor(15, standard), 20)).toEqual({ main: '바(20kg)보다 가벼워요', note: null })
  })
})

describe('세트에 적힌 무게 모으기', () => {
  it('겹치지 않게 처음 나온 순서대로, 빈 무게는 뺀다', () => {
    const sets = [40, 60, null, 100, 100, 0, 60].map((weightKg) => ({ weightKg }))
    expect(distinctWeights(sets)).toEqual([40, 60, 100])
  })
})
