import { startOfWeek } from '../../lib/format'

/**
 * 그래프 축의 눈금 계산. 라이브러리 없이 SVG로 그리는 작은 그래프들이 함께 쓴다.
 */

export interface LinearTicks {
  ticks: number[]
  min: number
  max: number
}

/** 사람이 읽기 좋은 눈금 간격(1, 2, 2.5, 5 × 10ⁿ). 정수만 쓰면 2.5는 뺀다. */
function niceStep(raw: number, integer: boolean): number {
  if (!(raw > 0)) return 1
  if (integer && raw <= 1) return 1
  const base = 10 ** Math.floor(Math.log10(raw))
  const steps = integer && base < 10 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]
  for (const s of steps) {
    if (s * base >= raw * (1 - 1e-9)) return s * base
  }
  return 10 * base
}

/**
 * 값 범위를 덮는 깔끔한 눈금. count는 대략의 눈금 수(넘어도 count+1개까지).
 * zero: 0부터 시작한다(막대 그래프). 아니면 값이 모두 0 이상일 때 0 아래로는 내려가지 않는다.
 */
export function niceTicks(
  dataMin: number,
  dataMax: number,
  opts: { count?: number; zero?: boolean; integer?: boolean } = {},
): LinearTicks {
  const count = Math.max(2, opts.count ?? 4)
  const integer = opts.integer ?? false
  let lo = opts.zero ? Math.min(0, dataMin) : dataMin
  let hi = opts.zero ? Math.max(0, dataMax) : dataMax
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0
    hi = 1
  }
  if (hi - lo < 1e-9) {
    // 값이 하나뿐이거나 모두 같으면 위아래로 조금 넓힌다.
    if (opts.zero || hi === 0) hi = lo + 1
    else {
      const pad = Math.max(Math.abs(hi) * 0.1, 1)
      lo -= pad
      hi += pad
    }
  }
  let step = niceStep((hi - lo) / count, integer)
  for (;;) {
    const min = Math.floor(lo / step + 1e-9) * step
    const max = Math.ceil(hi / step - 1e-9) * step
    if (Math.round((max - min) / step) + 1 <= count + 1) {
      const floor = !opts.zero && dataMin >= 0 && min < 0 ? 0 : min
      const n = Math.round((max - floor) / step)
      const ticks = Array.from({ length: n + 1 }, (_, i) => Number((floor + i * step).toFixed(6)))
      return { ticks, min: floor, max }
    }
    step = niceStep(step * 1.000001, integer)
  }
}

/** 축 숫자. 축이 1만을 넘으면 "1.5만", 아니면 "2,500", "62.5" */
export function formatAxisNumber(v: number, axisMax: number): string {
  if (axisMax >= 10000) {
    if (v === 0) return '0'
    return `${Number((v / 10000).toFixed(2))}만`
  }
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
}

export interface TimeTick {
  t: number
  label: string
}

type Interval = { unit: 'day' | 'week' | 'month'; step: number }

const INTERVALS: Interval[] = [
  { unit: 'day', step: 1 },
  { unit: 'day', step: 2 },
  { unit: 'week', step: 1 },
  { unit: 'week', step: 2 },
  { unit: 'month', step: 1 },
  { unit: 'month', step: 2 },
  { unit: 'month', step: 3 },
  { unit: 'month', step: 6 },
  { unit: 'month', step: 12 },
]

/** [t0, t1] 안의 눈금 시각. limit개를 넘으면 거기서 멈춘다. */
function generate(t0: number, t1: number, iv: Interval, limit: number): number[] {
  const out: number[] = []
  if (iv.unit === 'month') {
    const d = new Date(t0)
    const year = d.getFullYear()
    let m = d.getMonth()
    if (new Date(year, m, 1).getTime() < t0) m++
    // 분기, 반기처럼 간격에 맞는 달에서 시작한다(1월, 4월, 7월, 10월).
    while (m % iv.step !== 0) m++
    for (;;) {
      const t = new Date(year, m, 1).getTime()
      if (t > t1 || out.length > limit) break
      out.push(t)
      m += iv.step
    }
    return out
  }
  let start: Date
  if (iv.unit === 'week') {
    start = startOfWeek(t0)
  } else {
    start = new Date(t0)
    start.setHours(0, 0, 0, 0)
  }
  const days = iv.unit === 'week' ? 7 * iv.step : iv.step
  if (start.getTime() < t0) start.setDate(start.getDate() + (iv.unit === 'week' ? 7 : 1))
  for (const d = start; d.getTime() <= t1 && out.length <= limit; d.setDate(d.getDate() + days)) out.push(d.getTime())
  return out
}

function tickLabel(t: number, unit: Interval['unit']): string {
  const d = new Date(t)
  if (unit !== 'month') return `${d.getMonth() + 1}/${d.getDate()}`
  return d.getMonth() === 0 ? `${d.getFullYear()}년` : `${d.getMonth() + 1}월`
}

/**
 * 시간 축 눈금. 하루, 이틀, 한 주(월요일), 두 주, 한 달(1일), 두 달, 분기, 반년, 한 해 가운데
 * maxTicks개 이하가 되는 가장 촘촘한 간격을 고른다. 날짜는 "11/16", 달은 "11월"(1월은 "2027년").
 */
export function timeTicks(t0: number, t1: number, maxTicks: number): TimeTick[] {
  const limit = Math.max(1, maxTicks)
  for (const iv of INTERVALS) {
    const ts = generate(t0, t1, iv, limit)
    if (ts.length <= limit) return ts.map((t) => ({ t, label: tickLabel(t, iv.unit) }))
  }
  return []
}

/** 날짜 하나를 "11/16"으로 */
export function shortDate(t: number): string {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 글자 폭 어림값(px). 한글은 글자 크기만큼, 숫자와 영문은 그 0.6배 정도. */
export function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0
  for (const ch of text) {
    if (/[가-힣]/.test(ch)) w += fontSize
    else if (/[/.,:]/.test(ch)) w += fontSize * 0.35
    else w += fontSize * 0.62
  }
  return w
}
