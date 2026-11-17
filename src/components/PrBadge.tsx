interface PrBadgeProps {
  /** 이 세트(또는 운동)로 세운 기록의 이름(recordLabel). 읽어 주는 이름에 쓴다. */
  labels?: string[]
  className?: string
}

/** 개인 기록(PR)을 새로 세웠다는 작은 표시. */
export function PrBadge({ labels = [], className = '' }: PrBadgeProps) {
  const label = labels.length > 0 ? `새 기록: ${labels.join(', ')}` : '새 기록'
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
