import { estimateTextWidth, formatAxisNumber, niceTicks, shortDate, timeTicks, type TimeTick } from './scale'
import { useChartWidth, useScrub } from './hooks'

export interface LinePoint {
  /** 시각(ms) */
  t: number
  v: number
}

interface TimeLineChartProps {
  /** 시간 순서대로 */
  points: LinePoint[]
  selected: number
  /** 사용자가 직접 고른 점이면 세로선을 그어 표시한다. */
  active: boolean
  onSelect: (index: number) => void
  /** 접근성: 그래프 이름 */
  name: string
  /** 접근성: 고른 점을 읽어 주는 글 */
  valueText: (index: number) => string
  /** 맨 위 눈금에 붙이는 단위 */
  unit: string
  integer?: boolean
}

const FONT = 11
const TOP = 10
const PLOT_H = 168
const AXIS_H = 24
const HEIGHT = TOP + PLOT_H + AXIS_H
const PAD_L = 10
const PAD_R = 10
const HALF_DAY = 43_200_000
/** 점 사이가 이보다 좁으면 점 표시를 빼고 선만 그린다. */
const MIN_MARKER_GAP = 10

/** x 위치 목록(오름차순)에서 가장 가까운 것의 순번 */
function nearest(xs: number[], x: number): number {
  let lo = 0
  let hi = xs.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] < x) lo = mid
    else hi = mid
  }
  return Math.abs(xs[hi] - x) < Math.abs(xs[lo] - x) ? hi : lo
}

/**
 * 시간 축 꺾은선 그래프(값 하나). x축은 실제 날짜 간격을 따른다.
 * 점이 드물면 점마다 표시하고, 촘촘하면(100개 이상 등) 선만 그리고 마지막 점과 고른 점만 표시한다.
 */
export function TimeLineChart({
  points,
  selected,
  active,
  onSelect,
  name,
  valueText,
  unit,
  integer,
}: TimeLineChartProps) {
  const [ref, width] = useChartWidth<HTMLDivElement>()
  const n = points.length
  const values = points.map((p) => p.v)
  const { ticks, min, max } = niceTicks(Math.min(...values), Math.max(...values), { integer, count: 4 })
  const tickText = ticks.map((v, i) => formatAxisNumber(v, max) + (i === ticks.length - 1 ? unit : ''))
  const gutter = Math.ceil(Math.max(...tickText.map((t) => estimateTextWidth(t, FONT)))) + 8
  const left = gutter + PAD_L
  const innerW = Math.max(1, width - left - PAD_R)

  let t0 = n > 0 ? points[0].t : 0
  let t1 = n > 0 ? points[n - 1].t : 1
  if (t1 - t0 < HALF_DAY) {
    // 점이 하나뿐이면 가운데에 둔다.
    t0 -= 7 * HALF_DAY
    t1 += 7 * HALF_DAY
  }
  const x = (t: number) => left + ((t - t0) / (t1 - t0)) * innerW
  const y = (v: number) => TOP + PLOT_H - ((v - min) / (max - min || 1)) * PLOT_H
  const xs = points.map((p) => x(p.t))

  let xTicks: TimeTick[]
  if (n <= 1) xTicks = points.map((p) => ({ t: p.t, label: shortDate(p.t) }))
  else {
    xTicks = timeTicks(t0, t1, Math.max(2, Math.floor(innerW / 44)))
    if (xTicks.length === 0) xTicks = [{ t: points[0].t, label: shortDate(points[0].t) }]
  }

  const dense = n > 1 && innerW / (n - 1) < MIN_MARKER_GAP
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(1)},${y(p.v).toFixed(1)}`).join('')
  const sel = n > 0 ? Math.min(selected, n - 1) : -1

  const { pointer, onKeyDown } = useScrub({
    count: n,
    selected: sel,
    indexAt: (px) => (n > 0 ? nearest(xs, px) : 0),
    onSelect,
  })

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={name}
      aria-valuemin={1}
      aria-valuemax={Math.max(1, n)}
      aria-valuenow={sel + 1}
      aria-valuetext={sel >= 0 ? valueText(sel) : ''}
      onKeyDown={onKeyDown}
      className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <svg
        width={width || '100%'}
        height={HEIGHT}
        aria-hidden="true"
        className="block touch-pan-y select-none"
        {...pointer}
      >
        {width > 0 && n > 0 && (
          <>
            {ticks.map((v, i) => {
              const ty = Math.round(y(v)) + 0.5
              return (
                <g key={v}>
                  <line
                    x1={gutter}
                    x2={width}
                    y1={ty}
                    y2={ty}
                    className={i === 0 ? 'stroke-chart-axis' : 'stroke-line'}
                  />
                  <text
                    x={gutter - 8}
                    y={ty}
                    dy="0.35em"
                    textAnchor="end"
                    fontSize={FONT}
                    className="fill-muted tabular-nums"
                  >
                    {tickText[i]}
                  </text>
                </g>
              )
            })}

            {xTicks.map((tick) => {
              const tx = Math.round(x(tick.t)) + 0.5
              const w = estimateTextWidth(tick.label, FONT)
              const cx = Math.min(width - w / 2, Math.max(gutter + w / 2, tx))
              return (
                <g key={tick.t}>
                  <line x1={tx} x2={tx} y1={TOP + PLOT_H} y2={TOP + PLOT_H + 4} className="stroke-chart-axis" />
                  <text
                    x={cx}
                    y={TOP + PLOT_H + 17}
                    textAnchor="middle"
                    fontSize={FONT}
                    className="fill-muted tabular-nums"
                  >
                    {tick.label}
                  </text>
                </g>
              )
            })}

            {active && sel >= 0 && (
              <line
                x1={Math.round(xs[sel]) + 0.5}
                x2={Math.round(xs[sel]) + 0.5}
                y1={TOP - 4}
                y2={TOP + PLOT_H}
                className="stroke-muted"
              />
            )}

            {n > 1 && (
              <path
                d={path}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                className="stroke-accent"
              />
            )}

            {points.map((p, i) => {
              const isSel = i === sel
              if (dense && !isSel && i !== n - 1) return null
              return (
                <circle
                  key={i}
                  cx={xs[i]}
                  cy={y(p.v)}
                  r={isSel && active ? 6 : 4}
                  strokeWidth={2}
                  className="fill-accent stroke-surface"
                />
              )
            })}
          </>
        )}
      </svg>
    </div>
  )
}
