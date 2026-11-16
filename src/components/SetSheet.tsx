import { useEffect, type ReactNode } from 'react'
import type { SetEntry } from '../db'
import { formatSeconds, formatWeight, setSeconds } from '../lib/measure'
import { RPE_VALUES, updateSet } from '../lib/workouts'
import { Toggle } from './Toggle'

interface SetSheetProps {
  open: boolean
  set: SetEntry
  /** 세트 줄에 보이는 이름. 웜업은 "W", 본 세트는 번호 */
  label: string
  /** 맨몸 종목이면 무게를 추가 무게("+10kg")로 보여 준다. */
  addedWeight?: boolean
  /** 바깥이나 닫기를 누르거나 Esc를 눌렀을 때 */
  onClose: () => void
  /** "세트 삭제"를 눌렀을 때. 바로 지울지 한 번 더 물을지는 부르는 쪽이 정한다. */
  onDelete: () => void
}

/**
 * "60kg × 8회", 무게가 없으면 "8회", 시간 세트는 "60초"나 "10kg × 60초", 추가 무게는 "+10kg × 8회".
 * 아직 아무것도 적지 않았으면 null
 */
function setSummary(set: Pick<SetEntry, 'weightKg' | 'reps' | 'durationSec'>, addedWeight: boolean): string | null {
  const seconds = setSeconds(set)
  const reps = set.reps ?? 0
  const amount = seconds > 0 ? formatSeconds(seconds) : reps > 0 ? `${reps}회` : null
  if (!set.weightKg) return amount
  const weight = formatWeight(set.weightKg, addedWeight)
  return amount === null ? weight : `${weight} × ${amount}`
}

/**
 * 세트 하나의 설정 창. 세트 번호를 누르면 아래에서 올라온다.
 * 웜업 표시, 힘든 정도(RPE), 세트 삭제를 한곳에 모아서 세트 줄에는 칸을 더 두지 않는다.
 */
export function SetSheet({ open, set, label, addedWeight = false, onClose, onDelete }: SetSheetProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const title = set.isWarmup ? '웜업 세트' : `${label}세트`
  const summary = setSummary(set, addedWeight)
  const rpe = set.rpe ?? null

  // RPE는 고르면 바로 닫는다. 세트를 끝낼 때마다 적는 값이라 누르는 횟수를 줄인다.
  const pickRpe = (value: number | null) => {
    void updateSet(set.id, { rpe: value })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} 설정`}
        className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="flex items-baseline gap-2 text-lg font-bold text-ink">
          {title}
          {summary && <span className="text-[15px] font-medium tabular-nums text-muted">{summary}</span>}
        </h2>

        <button
          type="button"
          role="switch"
          aria-checked={set.isWarmup}
          aria-label="웜업 세트"
          onClick={() => void updateSet(set.id, { isWarmup: !set.isWarmup })}
          className="mt-3 flex min-h-12 w-full items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-ink">웜업 세트</span>
            <span className="block text-sm text-muted">볼륨 계산에서 빠집니다.</span>
          </span>
          <Toggle on={set.isWarmup} />
        </button>

        <div className="mt-4 border-t border-line pt-4">
          <p id={`rpe-${set.id}`} className="font-semibold text-ink">
            힘든 정도 (RPE)
          </p>
          <div role="group" aria-labelledby={`rpe-${set.id}`} className="mt-2 grid grid-cols-5 gap-1.5">
            {RPE_VALUES.map((value) => (
              <RpeButton key={value} on={rpe === value} onClick={() => pickRpe(value)}>
                {value}
              </RpeButton>
            ))}
            <button
              type="button"
              disabled={rpe === null}
              onClick={() => pickRpe(null)}
              aria-label="RPE 지우기"
              className="h-11 rounded-xl text-[15px] font-semibold text-muted active:bg-surface-2 disabled:opacity-40"
            >
              지우기
            </button>
          </div>
          <p className="mt-2 break-keep text-sm leading-snug text-muted">
            10은 더 못 하는 정도, 9는 1회, 8은 2회 더 할 수 있는 정도입니다.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="h-12 rounded-xl bg-surface-2 text-base font-semibold text-danger active:opacity-80"
          >
            세트 삭제
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-12 rounded-xl bg-surface-2 text-base font-semibold text-ink active:opacity-80"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

interface RpeButtonProps {
  on: boolean
  onClick: () => void
  children: ReactNode
}

function RpeButton({ on, onClick, children }: RpeButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`h-11 rounded-xl text-base font-semibold tabular-nums active:opacity-70 ${
        on ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink'
      }`}
    >
      {children}
    </button>
  )
}
