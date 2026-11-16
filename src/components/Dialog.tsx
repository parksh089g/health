import { useEffect, type ReactNode } from 'react'

export interface DialogAction {
  label: string
  onClick: () => void
  tone?: 'primary' | 'danger' | 'plain'
}

interface DialogProps {
  open: boolean
  title: string
  children?: ReactNode
  actions: DialogAction[]
  /** 바깥을 누르거나 Esc를 눌렀을 때 */
  onClose: () => void
}

const TONE: Record<NonNullable<DialogAction['tone']>, string> = {
  primary: 'bg-accent text-on-accent',
  danger: 'bg-danger text-white',
  plain: 'bg-surface-2 text-ink',
}

/** 확인이 필요한 일을 물어보는 작은 창. */
export function Dialog({ open, title, children, actions, onClose }: DialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        {children && <div className="mt-2 text-[15px] leading-relaxed text-muted">{children}</div>}
        <div className="mt-5 flex flex-col gap-2">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className={`h-12 rounded-xl text-base font-semibold active:opacity-80 ${TONE[a.tone ?? 'plain']}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
