import type { ReactNode } from 'react'

interface ChartReadoutProps {
  /** 고른 막대나 점의 값(크게) */
  value: string
  /** 그 값이 무엇인지(날짜 등) */
  label: string
  /** 오른쪽에 작게 붙이는 참고 값 */
  aside?: ReactNode
}

/**
 * 그래프 위에 고른 값을 크게 보여 주는 줄. 손가락이 그래프를 가려도 값이 보이도록 말풍선 대신 그래프 위에 둔다.
 * 높이가 바뀌지 않아서 값을 바꿔 골라도 그래프가 움직이지 않는다.
 */
export function ChartReadout({ value, label, aside }: ChartReadoutProps) {
  return (
    <div className="flex min-h-14 items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-tight text-ink">{value}</p>
        <p className="truncate text-sm text-muted">{label}</p>
      </div>
      {aside && <div className="shrink-0 pb-0.5 text-right text-sm text-muted">{aside}</div>}
    </div>
  )
}
