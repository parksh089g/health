import { RECORD_LABELS, type RecordKind } from '../lib/history'

interface PrBadgeProps {
  /** 이 세트(또는 운동)로 세운 기록의 종류. 읽어 주는 이름에 쓴다. */
  kinds?: RecordKind[]
  className?: string
}

/** 개인 기록(PR)을 새로 세웠다는 작은 표시. */
export function PrBadge({ kinds = [], className = '' }: PrBadgeProps) {
  const label = kinds.length > 0 ? `새 기록: ${kinds.map((k) => RECORD_LABELS[k]).join(', ')}` : '새 기록'
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex h-5 items-center rounded-full bg-accent px-1.5 text-[11px] font-extrabold leading-none tracking-wide text-on-accent ${className}`}
    >
      PR
    </span>
  )
}
