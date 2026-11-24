import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { BodyWeightDialog } from '../components/BodyWeightDialog'
import { ChevronRightIcon, PlusIcon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import type { BodyWeight } from '../db'
import { entryTime, formatComposition, formatWeightChange, listBodyWeights } from '../lib/bodyWeight'
import { formatDay, formatKg, formatMonth, toDateKey } from '../lib/format'
import { useGoBack } from '../lib/useGoBack'

interface Row {
  entry: BodyWeight
  /** 바로 앞 기록과의 차이(kg). 첫 기록이면 null */
  diff: number | null
}

/** 체중 기록 목록. 최근 날짜부터 달별로 보여 주고, 눌러서 고치거나 지우고, 지난 날짜의 기록을 더한다. */
export default function BodyWeightLog() {
  const goBack = useGoBack('/stats')
  const entries = useLiveQuery(listBodyWeights, [])
  // 열려 있는 입력 창. pickDate가 true면 날짜를 고르는 "기록 추가"
  const [target, setTarget] = useState<{ date: string; pickDate: boolean } | null>(null)

  const list = entries ?? []
  const months: { month: string; rows: Row[] }[] = []
  for (const [i, entry] of list.entries()) {
    const month = formatMonth(entryTime(entry))
    const row: Row = { entry, diff: i === 0 ? null : entry.weightKg - list[i - 1].weightKg }
    // 오래된 날짜부터 들어오므로 앞에 붙여 최근 것이 위로 오게 한다.
    const first = months.at(0)
    if (first && first.month === month) first.rows.unshift(row)
    else months.unshift({ month, rows: [row] })
  }

  return (
    <>
      <PageHeader
        title="체중 기록"
        subtitle={entries && entries.length > 0 ? `${entries.length}개` : undefined}
        onBack={goBack}
      />
      <main className="flex-1 px-4 pb-10 pt-4">
        <button
          type="button"
          onClick={() => setTarget({ date: toDateKey(Date.now()), pickDate: true })}
          className="flex h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-accent-soft font-bold text-accent active:opacity-70"
        >
          <PlusIcon className="size-5" />
          기록 추가
        </button>
        <p className="mt-2 break-keep text-xs leading-relaxed text-muted">
          지난 날짜도 골라서 적을 수 있고, 골격근량과 체지방량도 함께 적을 수 있습니다. 하루에 하나만 남고, 같은 날 다시 적으면 바뀝니다.
          {list.length > 1 && ' 체중 아래의 작은 숫자는 바로 앞 기록과의 차이입니다.'}
        </p>

        {entries !== undefined && entries.length === 0 && (
          <p className="mt-4 rounded-2xl border border-dashed border-line p-5 text-center text-sm leading-relaxed text-muted">
            아직 체중 기록이 없습니다.
          </p>
        )}

        {months.map(({ month, rows }) => (
          <section key={month} className="mt-5" aria-label={month}>
            <h2 className="flex items-baseline justify-between text-sm font-semibold text-muted">
              {month}
              <span className="font-normal tabular-nums">{rows.length}개</span>
            </h2>
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {rows.map(({ entry, diff }) => (
                <li key={entry.date}>
                  <button
                    type="button"
                    onClick={() => setTarget({ date: entry.date, pickDate: false })}
                    aria-label={`${formatDay(entryTime(entry))} ${formatKg(entry.weightKg)}kg${formatComposition(entry) ? `, ${formatComposition(entry)}` : ''}. 고치거나 지우기`}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">{formatDay(entryTime(entry))}</span>
                      {formatComposition(entry) !== '' && (
                        <span className="block truncate text-xs tabular-nums text-muted">{formatComposition(entry)}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums text-ink">{formatKg(entry.weightKg)}kg</span>
                      {diff !== null && (
                        <span className="block text-xs tabular-nums text-muted">{formatWeightChange(diff)}</span>
                      )}
                    </span>
                    <ChevronRightIcon className="size-5 shrink-0 text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      {target && entries && (
        <BodyWeightDialog
          key={`${target.date}-${target.pickDate}`}
          entries={entries}
          date={target.date}
          pickDate={target.pickDate}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  )
}
