import { estimateTextWidth, formatAxisNumber, niceTicks } from './scale'
import { useChartWidth, useScrub } from './hooks'

interface ColumnChartProps {
  values: number[]
  /** x축 글자(막대마다). 자리가 모자라면 맨 오른쪽부터 몇 개 걸러 보여 준다. */
  labels: string[]
  /** 굵게 보일 x축 글자(예: 이번 주) */
  strongLabel?: number
  selected: number
  onSelect: (index: number) => void
  /** 접근성: 그래프 이름 */
  name: string
  /** 접근성: 고른 막대를 읽어 주는 글 */
  valueText: (index: number) => string
  /** 맨 위 눈금에 붙이는 단위 */
  unit: string
  integer?: boolean
}

const FONT = 11
const TOP = 8
const PLOT_H = 132
const AXIS_H = 24
const HEIGHT = TOP + PLOT_H + AXIS_H

/** 아래가 평평하고 위 모서리만 둥근 막대 */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

/**
 * 세로 막대 그래프(값 하나). 고른 막대는 진한 색, 나머지는 옅은 색으로 그린다.
 * 막대 자리 어디를 눌러도 그 막대가 골라진다.
 */
export function ColumnChart({
  values,
  labels,
  strongLabel,
  selected,
  onSelect,
  name,
  valueText,
  unit,
  integer,
}: ColumnChartProps) {
  const [ref, width] = useChartWidth<HTMLDivElement>()
  const n = values.length
  const { ticks, min, max } = niceTicks(0, Math.max(0, ...values), { zero: true, integer, count: 4 })
  const tickText = ticks.map((v, i) => formatAxisNumber(v, max) + (i === ticks.length - 1 ? unit : ''))
  const gutter = Math.ceil(Math.max(...tickText.map((t) => estimateTextWidth(t, FONT)))) + 8
  const plotW = Math.max(0, width - gutter)
  const slot = n > 0 ? plotW / n : 0
  const barW = Math.max(3, Math.min(24, slot * 0.6, slot - 2))
  const y = (v: number) => TOP + PLOT_H - ((v - min) / (max - min || 1)) * PLOT_H
  const base = y(0)

  const maxLabelW = Math.max(0, ...labels.map((l) => estimateTextWidth(l, FONT)))
  const labelStep = slot > 0 ? Math.max(1, Math.ceil((maxLabelW + 8) / slot)) : 1

  const { pointer, onKeyDown } = useScrub({
    count: n,
    selected,
    indexAt: (x) => Math.min(n - 1, Math.max(0, Math.floor((x - gutter) / (slot || 1)))),
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
      aria-valuenow={selected + 1}
      aria-valuetext={n > 0 ? valueText(selected) : ''}
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
        {width > 0 && (
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
                    strokeWidth={1}
                    className={v === 0 ? 'stroke-chart-axis' : 'stroke-line'}
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

            {n > 0 && (
              <rect
                x={gutter + slot * selected + 1}
                y={TOP - 4}
                width={Math.max(0, slot - 2)}
                height={PLOT_H + 4}
                rx={6}
                className="fill-surface-2"
              />
            )}

            {values.map((v, i) => {
              if (!(v > 0)) return null
              const top = y(v)
              const x = gutter + slot * i + (slot - barW) / 2
              return (
                <path
                  key={i}
                  d={barPath(x, top, barW, Math.max(1, base - top))}
                  className={i === selected ? 'fill-accent' : 'fill-chart-soft'}
                />
              )
            })}

            {/* 기준선은 막대 위에 한 번 더 그어 막대 밑동이 깔끔하게 보이게 한다. */}
            <line
              x1={gutter}
              x2={width}
              y1={Math.round(base) + 0.5}
              y2={Math.round(base) + 0.5}
              className="stroke-chart-axis"
            />

            {labels.map((label, i) => {
              if ((n - 1 - i) % labelStep !== 0) return null
              const w = estimateTextWidth(label, FONT)
              const cx = Math.min(width - w / 2, Math.max(gutter + w / 2, gutter + slot * (i + 0.5)))
              const strong = i === strongLabel || i === selected
              return (
                <text
                  key={i}
                  x={cx}
                  y={TOP + PLOT_H + 16}
                  textAnchor="middle"
                  fontSize={FONT}
                  className={`tabular-nums ${strong ? 'fill-ink font-semibold' : 'fill-muted'}`}
                >
                  {label}
                </text>
              )
            })}
          </>
        )}
      </svg>
    </div>
  )
}
