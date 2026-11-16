import type { ReactNode } from 'react'
import { BackIcon } from './icons'

interface PageHeaderProps {
  title: string
  subtitle?: string
  onBack: () => void
  backLabel?: string
  right?: ReactNode
}

/** 탭이 없는 화면(운동 중, 기록 상세 등)의 윗줄. */
export function PageHeader({ title, subtitle, onBack, backLabel = '뒤로', right }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center gap-1 px-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink active:bg-surface-2"
        >
          <BackIcon />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold leading-tight text-ink">{title}</h1>
          {subtitle && <p className="truncate text-sm leading-tight text-muted tabular-nums">{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  )
}
