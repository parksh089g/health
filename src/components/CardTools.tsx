import { useState, type ReactNode } from 'react'
import { canWarmup } from '../lib/warmup'
import type { WorkoutItem } from '../lib/workouts'
import { PlateSheet } from './PlateSheet'
import { WarmupDialog } from './WarmupDialog'

interface CardToolsProps {
  item: WorkoutItem
  /** active: 운동 중, history: 지난 기록 수정 */
  mode: 'active' | 'history'
}

/** 웜업 버튼의 불꽃 모양 */
const FLAME =
  'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.1 2-6 .5 2.5 2 4.9 4 6.5s3 3.5 3 5.5' +
  'a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z'

/**
 * 종목 카드 아래 "세트 추가" 옆에 놓이는 도구 버튼들.
 * - 웜업: 본 세트 무게로 웜업 세트를 만들어 넣는다. 운동 중에, 무게를 들고 횟수로 재는 종목에만 나온다.
 * - 원판: 바벨 종목에서 세트 무게마다 한쪽에 끼울 원판을 보여 준다.
 * 둘 다 해당하지 않는 종목이면 아무것도 그리지 않아 "세트 추가"가 줄을 다 쓴다.
 */
export function CardTools({ item, mode }: CardToolsProps) {
  const [open, setOpen] = useState<'warmup' | 'plates' | null>(null)
  const { exercise } = item
  const showWarmup = mode === 'active' && canWarmup(exercise)
  const showPlates = exercise?.equipment === 'barbell'
  if (!showWarmup && !showPlates) return null

  const close = () => setOpen(null)

  return (
    <>
      {showWarmup && (
        <ToolButton label="웜업" ariaLabel="웜업 세트 만들기" onClick={() => setOpen('warmup')}>
          <path d={FLAME} />
        </ToolButton>
      )}
      {showPlates && (
        <ToolButton label="원판" ariaLabel="원판 계산" onClick={() => setOpen('plates')}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="2.5" />
        </ToolButton>
      )}
      {open === 'warmup' && <WarmupDialog item={item} onClose={close} />}
      {open === 'plates' && <PlateSheet name={exercise?.name ?? ''} sets={item.sets} onClose={close} />}
    </>
  )
}

interface ToolButtonProps {
  /** 버튼에 보이는 짧은 이름 */
  label: string
  ariaLabel: string
  onClick: () => void
  /** 아이콘(24×24 선 그림)의 내용 */
  children: ReactNode
}

/** 아이콘과 짧은 이름만 있는 작은 버튼. "세트 추가"가 폭을 넉넉히 쓰도록 좁게 둔다. */
function ToolButton({ label, ariaLabel, onClick, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      className="flex h-11 shrink-0 items-center justify-center gap-1 rounded-xl bg-surface-2 px-3 text-[15px] font-semibold text-ink active:opacity-70"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="size-4"
      >
        {children}
      </svg>
      {label}
    </button>
  )
}
