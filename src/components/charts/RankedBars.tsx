export interface RankedBarRow {
  key: string
  label: string
  value: number
}

interface RankedBarsProps {
  /** 보여 줄 순서대로(보통 큰 것부터) */
  rows: RankedBarRow[]
  /** 접근성: 목록 이름 */
  name: string
  /** 화면 읽기 프로그램이 값 뒤에 읽을 단위 */
  unit: string
}

/** 가로 막대 목록. 이름, 막대, 값이 한 줄씩 나란히 놓이고 막대는 가장 큰 값에 맞춘다. */
export function RankedBars({ rows, name, unit }: RankedBarsProps) {
  const max = Math.max(0, ...rows.map((r) => r.value))
  return (
    <ul aria-label={name} className="grid gap-1.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[2.75rem_1fr_2.5rem] items-center gap-2 text-sm">
          <span className={r.value > 0 ? 'text-ink' : 'text-muted'}>{r.label}</span>
          <span aria-hidden="true" className="flex h-6 items-center">
            {r.value > 0 && (
              <span
                className="h-2.5 min-w-0.5 rounded-r bg-accent"
                style={{ width: `${(r.value / (max || 1)) * 100}%` }}
              />
            )}
          </span>
          <span className={`text-right tabular-nums ${r.value > 0 ? 'font-semibold text-ink' : 'text-muted'}`}>
            {r.value}
            <span className="sr-only">{unit}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
