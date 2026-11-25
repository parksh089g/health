import { db, type BodyWeight } from '../db'
import { formatKg, toDateKey } from './format'

/**
 * 체중 기록. (4단계)
 * 골격근량과 체지방량(체성분)을 함께 적을 수 있다(선택).
 * 하루에 하나만 둔다. 날짜(로컬 시간 기준 YYYY-MM-DD)가 키라서 같은 날 다시 적으면 덮어쓴다.
 */

export const BODY_WEIGHT_RANGE = { min: 20, max: 300 } as const

/** 입력하는 동안 받아 주는 글자: 숫자 세 자리와 소수 한 자리까지("72." 같은 중간 상태 포함) */
export const BODY_WEIGHT_DRAFT = /^\d{0,3}(\.\d?)?$/

/** 최근 변화를 볼 기간(일). 4주 */
export const CHANGE_DAYS = 28

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

/** 'YYYY-MM-DD'를 그날 0시(로컬 시간)로. 형식이 다르거나 없는 날짜(2월 30일 등)면 null */
export function dateKeyToTime(key: string): number | null {
  const m = DATE_KEY.exec(key)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return toDateKey(d) === key ? d.getTime() : null
}

/** 날짜 키에 일수를 더한다(로컬 시간). 잘못된 키는 그대로 돌려준다. */
export function addDaysToKey(key: string, days: number): string {
  const t = dateKeyToTime(key)
  if (t === null) return key
  const d = new Date(t)
  d.setDate(d.getDate() + days)
  return toDateKey(d)
}

/** 입력 칸의 글자를 숫자로. 비어 있거나 숫자가 아니면 null. 쉼표로 쓴 소수점도 받는다. */
export function parseBodyWeight(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return null
  return Number(t)
}

/** 저장할 수 없는 체중이면 그 이유, 괜찮으면 null. 20~300kg, 소수 첫째 자리까지. */
export function bodyWeightError(weightKg: number | null): string | null {
  if (weightKg === null || !Number.isFinite(weightKg)) return '체중을 입력해 주세요.'
  if (weightKg < BODY_WEIGHT_RANGE.min || weightKg > BODY_WEIGHT_RANGE.max) {
    return `체중은 ${BODY_WEIGHT_RANGE.min}~${BODY_WEIGHT_RANGE.max}kg로 적어 주세요.`
  }
  if (Math.abs(weightKg * 10 - Math.round(weightKg * 10)) > 1e-6) return '체중은 소수 첫째 자리까지 적어 주세요.'
  return null
}

/** 기록할 수 없는 날짜면 그 이유, 괜찮으면 null. 오늘까지의 날짜만 받는다. */
export function bodyWeightDateError(date: string, now: number = Date.now()): string | null {
  if (dateKeyToTime(date) === null) return '날짜를 골라 주세요.'
  if (date > toDateKey(now)) return '오늘 이후의 날짜에는 기록할 수 없습니다.'
  return null
}

/** 체성분(골격근량, 체지방량). 적지 않은 값은 null */
export interface BodyComposition {
  muscleKg: number | null
  bodyFatKg: number | null
}

export const MUSCLE_RANGE = { min: 5, max: 150 } as const
export const BODY_FAT_RANGE = { min: 0.5, max: 200 } as const

/**
 * 저장할 수 없는 체성분이면 그 이유, 괜찮으면 null. 둘 다 적지 않아도 된다.
 * 소수 첫째 자리까지, 골격근량과 체지방량은 각각 체중보다 작고 둘을 더해도 체중을 넘지 않아야 한다.
 */
export function compositionError(weightKg: number, c: BodyComposition): string | null {
  const check = (v: number | null, name: string, range: { min: number; max: number }): string | null => {
    if (v === null) return null
    if (!Number.isFinite(v) || v < range.min || v > range.max) return `${name}은 ${range.min}~${range.max}kg로 적어 주세요.`
    if (Math.abs(v * 10 - Math.round(v * 10)) > 1e-6) return `${name}은 소수 첫째 자리까지 적어 주세요.`
    if (v >= weightKg) return `${name}은 체중보다 작아야 합니다.`
    return null
  }
  const e = check(c.muscleKg, '골격근량', MUSCLE_RANGE) ?? check(c.bodyFatKg, '체지방량', BODY_FAT_RANGE)
  if (e !== null) return e
  if (c.muscleKg !== null && c.bodyFatKg !== null && c.muscleKg + c.bodyFatKg >= weightKg) {
    return '골격근량과 체지방량을 더한 값이 체중보다 작아야 합니다.'
  }
  return null
}

/** 체지방률(%, 소수 첫째 자리). 체지방량이 없으면 null */
export function bodyFatPercent(entry: Pick<BodyWeight, 'weightKg' | 'bodyFatKg'>): number | null {
  const fat = entry.bodyFatKg
  if (typeof fat !== 'number' || !(fat > 0) || !(entry.weightKg > 0)) return null
  return Math.round((fat / entry.weightKg) * 1000) / 10
}

/** 체성분을 적은 기록인지 */
export function hasComposition(entry: Pick<BodyWeight, 'muscleKg' | 'bodyFatKg'>): boolean {
  return (typeof entry.muscleKg === 'number' && entry.muscleKg > 0) || (typeof entry.bodyFatKg === 'number' && entry.bodyFatKg > 0)
}

/** "골격근 32.1kg · 체지방 14.2kg(19.6%)". 체성분을 적지 않았으면 빈 글 */
export function formatComposition(entry: Pick<BodyWeight, 'weightKg' | 'muscleKg' | 'bodyFatKg'>): string {
  const parts: string[] = []
  if (typeof entry.muscleKg === 'number' && entry.muscleKg > 0) parts.push(`골격근 ${formatKg(entry.muscleKg)}kg`)
  const pct = bodyFatPercent(entry)
  if (pct !== null) parts.push(`체지방 ${formatKg(entry.bodyFatKg as number)}kg(${formatKg(pct)}%)`)
  return parts.join(' · ')
}

/**
 * 그날의 체중을 적는다. 그날 기록이 이미 있으면 덮어쓴다.
 * composition을 주면 체성분도 그 값으로 바꾸고(null은 지움), 주지 않으면 그날 적어 둔 체성분을 그대로 둔다.
 */
export async function saveBodyWeight(
  date: string,
  weightKg: number,
  now: number = Date.now(),
  composition?: BodyComposition,
): Promise<BodyWeight> {
  const error = bodyWeightDateError(date, now) ?? bodyWeightError(weightKg)
  if (error !== null) throw new Error(error)
  const weight = Math.round(weightKg * 10) / 10
  return db.transaction('rw', db.bodyWeights, async () => {
    const prev = await db.bodyWeights.get(date)
    const comp: BodyComposition = composition ?? { muscleKg: prev?.muscleKg ?? null, bodyFatKg: prev?.bodyFatKg ?? null }
    // 체중만 고쳤는데 예전 체성분과 맞지 않게 되면(체중이 더 작아짐) 체성분 쪽의 오류로 알린다.
    const compError = compositionError(weight, comp)
    if (compError !== null) throw new Error(compError)
    const row: BodyWeight = { date, weightKg: weight, updatedAt: now }
    if (comp.muscleKg !== null) row.muscleKg = Math.round(comp.muscleKg * 10) / 10
    if (comp.bodyFatKg !== null) row.bodyFatKg = Math.round(comp.bodyFatKg * 10) / 10
    await db.bodyWeights.put(row)
    return row
  })
}

export async function deleteBodyWeight(date: string): Promise<void> {
  await db.bodyWeights.delete(date)
}

/** 모든 체중 기록, 오래된 날짜부터. 백업 파일로 들어온 잘못된 날짜의 줄은 뺀다. */
export async function listBodyWeights(): Promise<BodyWeight[]> {
  const rows = await db.bodyWeights.orderBy('date').toArray()
  return rows.filter((r) => dateKeyToTime(r.date) !== null)
}

/** 날짜 키의 그날 0시. 그래프의 x 값과 날짜 표기에 쓴다(잘못된 키는 0). */
export function entryTime(entry: Pick<BodyWeight, 'date'>): number {
  return dateKeyToTime(entry.date) ?? 0
}

export interface WeightChange {
  /** to - from (kg, 소수 첫째 자리) */
  deltaKg: number
  /** 견주는 기준: 기간 안의 가장 오래된 기록 */
  from: BodyWeight
  /** 기간 안의 가장 최근 기록 */
  to: BodyWeight
}

/**
 * 최근 4주 동안의 변화. 오늘을 기준으로 28일 전(그날 포함)부터 오늘까지의 기록 가운데
 * 가장 오래된 것과 가장 최근 것을 견준다. 그 사이의 기록이 둘보다 적으면 null.
 * entries는 날짜 순서가 아니어도 된다.
 */
export function weightChange(entries: BodyWeight[], now: number, days: number = CHANGE_DAYS): WeightChange | null {
  const today = toDateKey(now)
  const start = addDaysToKey(today, -days)
  let from: BodyWeight | null = null
  let to: BodyWeight | null = null
  for (const e of entries) {
    if (e.date < start || e.date > today) continue
    if (from === null || e.date < from.date) from = e
    if (to === null || e.date > to.date) to = e
  }
  if (from === null || to === null || from.date === to.date) return null
  return { deltaKg: Math.round((to.weightKg - from.weightKg) * 10) / 10, from, to }
}

/** 변화량. "+0.8kg", "−1.2kg", 그대로면 "변화 없음" */
export function formatWeightChange(deltaKg: number): string {
  const rounded = Math.round(deltaKg * 10) / 10
  if (rounded === 0) return '변화 없음'
  return `${rounded > 0 ? '+' : '−'}${formatKg(Math.abs(rounded))}kg`
}

/** 그래프로 볼 기간 */
export type WeightRange = '3m' | '1y' | 'all'

export const WEIGHT_RANGE_LABELS: Record<WeightRange, string> = { '3m': '3개월', '1y': '1년', all: '전체' }

/** 좁은 기간부터 */
const RANGES: WeightRange[] = ['3m', '1y', 'all']
const RANGE_DAYS: Record<WeightRange, number | null> = { '3m': 91, '1y': 365, all: null }

/** 기간 안의 기록만. 기간은 오늘에서 거꾸로 센다(3개월은 13주). */
export function entriesInRange(entries: BodyWeight[], range: WeightRange, now: number): BodyWeight[] {
  const days = RANGE_DAYS[range]
  if (days === null) return entries
  const start = addDaysToKey(toDateKey(now), -days)
  return entries.filter((e) => e.date >= start)
}

/**
 * 골라 볼 만한 기간, 좁은 것부터. 기록이 없는 기간과 더 좁은 기간과 내용이 같은 기간은 뺀다.
 * (기록이 모두 3개월 안에 있으면 '3개월' 하나만 남아 고를 것이 없다.)
 */
export function availableRanges(entries: BodyWeight[], now: number): WeightRange[] {
  const out: WeightRange[] = []
  let shown = 0
  for (const range of RANGES) {
    const n = entriesInRange(entries, range, now).length
    if (n > shown) out.push(range)
    shown = n
  }
  return out
}
