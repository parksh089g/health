import type { SetEntry } from '../db'
import { formatKg } from './format'

/**
 * 원판 계산. (5단계)
 *
 * 바벨에 올릴 무게를 "한쪽에 20 + 10 + 2.5"처럼 한쪽에 끼울 원판으로 풀어 준다.
 * 원판은 종류마다 필요한 만큼 있다고 본다. 딱 맞출 수 없는 무게는 넘지 않는 가장 가까운 무게로 맞추고 남는 무게를 알려 준다.
 * 계산은 DB를 보지 않는 순수 함수이고, 바 무게와 가진 원판은 부르는 쪽이 설정에서 읽어 넘긴다.
 */

/** 설정에서 켜고 끌 수 있는 원판(kg), 무거운 것부터 */
export const PLATE_OPTIONS: readonly number[] = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5]
/** 설정에서 바로 고를 수 있는 바 무게(kg) */
export const BAR_OPTIONS: readonly number[] = [20, 15, 10]
/** 직접 적는 바 무게로 받는 범위(kg) */
export const BAR_RANGE = { min: 1, max: 50 } as const

/** 직접 적은 바 무게로 쓸 수 있는 값인지 */
export function isBarWeight(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= BAR_RANGE.min && v <= BAR_RANGE.max
}

/** 바 무게와 가진 원판 */
export interface PlateSetup {
  barKg: number
  /** 한 장의 무게(kg) 목록 */
  plates: readonly number[]
}

export interface PlateLoad {
  /** 한쪽에 끼우는 원판(kg), 무거운 것부터. 바만 들거나 바보다 가벼우면 비어 있다. */
  perSide: number[]
  /** 실제로 맞춰지는 무게(kg): 바 + 양쪽 원판. 바보다 가벼운 무게를 물으면 바 무게 */
  loadedKg: number
  /** 맞추지 못하고 남는 무게(kg). 딱 맞으면 0 */
  leftoverKg: number
  /** 바보다 가벼운 무게인지 */
  belowBar: boolean
}

/** 계산은 0.01kg 단위의 정수로 한다(1.25 같은 소수의 계산 오차를 없앤다). */
const UNIT = 100

function toUnits(kg: number): number {
  return Math.round(kg * UNIT)
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** 한쪽에 끼울 수 있는 무게의 표. count[i]는 i×step을 딱 맞추는 데 드는 가장 적은 장수(못 맞추면 Infinity) */
interface SideTable {
  /** 원판 무게(0.01kg 단위), 무거운 것부터 */
  units: number[]
  /** 원판 무게들의 최대공약수. 이 배수만 만들 수 있다. */
  step: number
  count: number[]
}

function sideTable(limit: number, plates: readonly number[]): SideTable {
  const units = [...new Set(plates.map(toUnits))].filter((u) => u > 0).sort((a, b) => b - a)
  if (units.length === 0) return { units, step: 1, count: [0] }
  const step = units.reduce(gcd)
  const size = Math.max(0, Math.floor(limit / step))
  const count = Array.from({ length: size + 1 }, () => Infinity)
  count[0] = 0
  for (let i = 1; i <= size; i++) {
    for (const u of units) {
      const rest = i - u / step
      if (rest >= 0 && count[rest] + 1 < count[i]) count[i] = count[rest] + 1
    }
  }
  return { units, step, count }
}

/** 표의 i번째 무게를 만드는 원판들(0.01kg 단위). 가장 적은 장수 중에서 무거운 원판을 먼저 쓴다. */
function platesAt(table: SideTable, index: number): number[] {
  const out: number[] = []
  let i = index
  while (i > 0) {
    const u = table.units.find((x) => i - x / table.step >= 0 && table.count[i - x / table.step] === table.count[i] - 1)
    if (u === undefined) break
    out.push(u)
    i -= u / table.step
  }
  return out
}

/**
 * 무게 totalKg를 바에 올릴 때 한쪽에 끼울 원판.
 * 딱 맞출 수 없으면 넘지 않는 가장 가까운 무게로 맞추고 leftoverKg에 남는 무게를 담는다.
 * 바보다 가벼우면 belowBar가 true다.
 */
export function platesFor(totalKg: number, setup: PlateSetup): PlateLoad {
  const total = toUnits(totalKg)
  const bar = toUnits(setup.barKg)
  if (total < bar) return { perSide: [], loadedKg: setup.barKg, leftoverKg: 0, belowBar: true }

  const table = sideTable(Math.floor((total - bar) / 2), setup.plates)
  let index = table.count.length - 1
  while (index > 0 && table.count[index] === Infinity) index--
  const loaded = bar + index * table.step * 2
  return {
    perSide: platesAt(table, index).map((u) => u / UNIT),
    loadedKg: loaded / UNIT,
    leftoverKg: (total - loaded) / UNIT,
    belowBar: false,
  }
}

/**
 * totalKg에 가장 가까운, 실제로 바에 올릴 수 있는 무게(kg). 위아래로 똑같이 가까우면 가벼운 쪽.
 * 바보다 가벼우면 바 무게(원판 없이 바만)다.
 */
export function nearestLoadable(totalKg: number, setup: PlateSetup): number {
  const bar = toUnits(setup.barKg)
  // 한쪽에 올릴 무게. 반 단위가 나올 수 있어 정수로 맞추지 않고 그대로 비교한다.
  const side = (toUnits(totalKg) - bar) / 2
  if (side <= 0) return setup.barKg

  const heaviest = Math.max(0, ...setup.plates.map(toUnits))
  const table = sideTable(Math.ceil(side) + heaviest, setup.plates)
  const reachable = (i: number) => table.count[i] !== Infinity
  let below = Math.min(table.count.length - 1, Math.floor(side / table.step))
  while (below > 0 && !reachable(below)) below--
  let above = Math.ceil(side / table.step)
  while (above < table.count.length && !reachable(above)) above++

  const down = side - below * table.step
  const up = above < table.count.length ? above * table.step - side : Infinity
  const best = up < down ? above : below
  return (bar + best * table.step * 2) / UNIT
}

/** 한쪽 원판을 "25 + 15"로 */
export function formatPlates(perSide: readonly number[]): string {
  return perSide.map(formatKg).join(' + ')
}

export interface PlateLoadText {
  /** "한쪽에 25 + 15", "원판 없이 바만", "바(20kg)보다 가벼워요" */
  main: string
  /** 딱 맞추지 못했을 때 덧붙이는 줄. 딱 맞으면 null */
  note: string | null
}

/** 원판 계산 결과를 화면에 보여 줄 글로 바꾼다. */
export function describePlateLoad(load: PlateLoad, barKg: number): PlateLoadText {
  if (load.belowBar) return { main: `바(${formatKg(barKg)}kg)보다 가벼워요`, note: null }
  const main = load.perSide.length > 0 ? `한쪽에 ${formatPlates(load.perSide)}` : '원판 없이 바만'
  const note =
    load.leftoverKg > 0
      ? `${formatKg(load.loadedKg)}kg까지 맞출 수 있어요 (${formatKg(load.leftoverKg)}kg 남음)`
      : null
  return { main, note }
}

/** 세트들에 적힌 무게를 겹치지 않게, 처음 나온 순서대로 */
export function distinctWeights(sets: readonly Pick<SetEntry, 'weightKg'>[]): number[] {
  const out: number[] = []
  for (const s of sets) {
    const w = s.weightKg ?? 0
    if (w > 0 && !out.includes(w)) out.push(w)
  }
  return out
}
