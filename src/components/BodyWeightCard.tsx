import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  WEIGHT_RANGE_LABELS,
  availableRanges,
  entriesInRange,
  entryTime,
  formatComposition,
  formatWeightChange,
  hasComposition,
  listBodyWeights,
  weightChange,
  type WeightRange,
} from '../lib/bodyWeight'
import { formatFullDate, formatKg, toDateKey } from '../lib/format'
import { formatDayOfYear, formatMonthDay } from '../lib/stats'
import { BodyWeightDialog } from './BodyWeightDialog'
import { ChartReadout } from './charts/ChartReadout'
import { ChartTable } from './charts/ChartTable'
import { TimeLineChart } from './charts/TimeLineChart'
import { ChevronRightIcon } from './icons'
import { SegmentedControl } from './SegmentedControl'

const RANGE_NAMES: Record<WeightRange, string> = { '3m': '최근 3개월', '1y': '최근 1년', all: '전체 기간' }

/** 통계 화면의 체중 카드. 최근 값, 최근 4주 변화, 그래프를 보여 주고 오늘 체중을 바로 적는다. */
export function BodyWeightCard({ now }: { now: number }) {
  const entries = useLiveQuery(listBodyWeights, [])
  const [recording, setRecording] = useState(false)
  const [chosen, setChosen] = useState<WeightRange | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  if (entries === undefined) return null

  const today = toDateKey(now)
  const hasToday = entries.some((e) => e.date === today)
  const ranges = availableRanges(entries, now)
  const range = chosen !== null && ranges.includes(chosen) ? chosen : ranges.at(0)
  const series = range === undefined ? [] : entriesInRange(entries, range, now)
  const found = series.findIndex((e) => e.date === picked)
  const selected = found >= 0 ? found : series.length - 1
  const sel = series.at(selected)
  const change = weightChange(entries, now)
  const weights = series.map((e) => e.weightKg)
  const latestComposition = entries.findLast(hasComposition)

  return (
    <section aria-labelledby="bodyweight-title" className="mt-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="bodyweight-title" className="font-bold text-ink">
            체중
          </h2>
          {range !== undefined && (
            <p className="truncate text-xs text-muted">
              {RANGE_NAMES[range]} · 기록 {series.length}개
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setRecording(true)}
          className="h-11 shrink-0 rounded-xl bg-accent-soft px-4 text-[15px] font-bold text-accent active:opacity-70"
        >
          {hasToday ? '오늘 체중 고치기' : '오늘 체중 기록'}
        </button>
      </div>

      {range === undefined || sel === undefined ? (
        <p className="mt-3 break-keep text-sm leading-relaxed text-muted">
          체중을 적어 두면 최근 값과 변화 그래프가 여기에 나타납니다. 하루에 하나씩 기록됩니다.
        </p>
      ) : (
        <>
          {ranges.length > 1 && (
            <div className="mt-3">
              <SegmentedControl
                label="그래프로 볼 기간"
                value={range}
                onChange={setChosen}
                options={ranges.map((r) => ({ value: r, label: WEIGHT_RANGE_LABELS[r] }))}
              />
            </div>
          )}
          <div className="mt-3">
            <ChartReadout
              value={`${formatKg(sel.weightKg)}kg`}
              label={`${formatDayOfYear(entryTime(sel), now)}${sel.date === today ? ' · 오늘' : ''}`}
              aside={
                change && (
                  <>
                    최근 4주
                    <br />
                    <span className="font-semibold text-ink">{formatWeightChange(change.deltaKg)}</span>
                  </>
                )
              }
            />
          </div>
          {latestComposition && (
            <p className="mt-2 text-sm tabular-nums text-muted">
              체성분 · {formatComposition(latestComposition)}
              <span className="text-xs"> ({formatMonthDay(entryTime(latestComposition), now)})</span>
            </p>
          )}
          {series.length < 2 ? (
            <p className="mt-3 break-keep text-sm leading-relaxed text-muted">
              기록이 둘 이상 쌓이면 변화 그래프가 나타납니다.
            </p>
          ) : (
            <div className="mt-2">
              <TimeLineChart
                points={series.map((e) => ({ t: entryTime(e), v: e.weightKg }))}
                selected={selected}
                active={found >= 0}
                onSelect={(i) => setPicked(series[i].date)}
                name={`체중 그래프. 기록 ${series.length}개, 최저 ${formatKg(Math.min(...weights))}kg, 최고 ${formatKg(Math.max(...weights))}kg`}
                valueText={(i) => `${formatFullDate(entryTime(series[i]))}, ${formatKg(series[i].weightKg)}kg`}
                unit="kg"
              />
            </div>
          )}
          <div className="mt-1 flex items-start justify-between gap-3">
            <p className="min-w-0 break-keep text-xs leading-relaxed text-muted">
              {change
                ? `최근 4주 변화는 ${formatMonthDay(entryTime(change.from), now)} 기록(${formatKg(change.from.weightKg)}kg)과 비교한 값입니다. `
                : ''}
              {series.length < 2 ? '지난 기록은 전체 보기에서 고칩니다.' : '점을 누르거나 좌우로 밀어 보세요.'}
            </p>
            <Link
              to="/body-weight"
              aria-label="체중 기록 전체 보기"
              className="-my-2.5 flex h-11 shrink-0 items-center text-sm font-medium text-accent"
            >
              전체 보기
              <ChevronRightIcon className="size-4" />
            </Link>
          </div>
          <ChartTable
            caption={`${RANGE_NAMES[range]} 체중 기록`}
            headers={['날짜', '체중']}
            rows={series.map((e) => [formatFullDate(entryTime(e)), `${formatKg(e.weightKg)}kg`])}
          />
        </>
      )}

      {recording && <BodyWeightDialog entries={entries} date={today} onClose={() => setRecording(false)} />}
    </section>
  )
}
