import { useState } from 'react'
import type { SetEntry } from '../db'
import { formatClock } from '../lib/format'
import { formatSeconds } from '../lib/measure'
import { stopwatchElapsedMs, stopwatchReachedTarget, type Stopwatch } from '../lib/stopwatch'
import { useNow } from '../lib/useNow'
import { useWakeLock } from '../lib/useWakeLock'
import { recordTimedSet } from '../lib/workouts'
import { releaseAudio } from '../rest/alert'
import { useRestTimer } from '../rest/context'
import { beginStopwatch, cancelStopwatch, takeStopwatch } from '../stopwatch/store'
import { useStopwatch } from '../stopwatch/useStopwatch'
import { Dialog } from './Dialog'

interface SetStopwatchProps {
  /** 이 종목의 세트, 순서대로 */
  sets: SetEntry[]
  /** 세트 줄에 보이는 이름("W", "1", "2" …). sets와 같은 순서 */
  labels: string[]
  /** 목표 시간(초). 시간 종목에 목표가 있을 때만. 지나면 한 번 알린다. */
  targetSec: number | null
  /** 유산소 종목인지. 오래 하는 운동이라 재는 동안 화면을 켜 두지 않는다. */
  cardio: boolean
  /** 멈춰서 세트를 완료로 표시했을 때(세트의 완료 체크를 눌렀을 때와 같다) */
  onDone?: () => void
}

/** 이만큼 넘게 잰 시간은 취소할 때 한 번 더 묻는다(잘못 눌러 긴 유산소 시간을 날리지 않게). */
const ASK_CANCEL_AFTER_MS = 60_000

function setName(label: string): string {
  return label === 'W' ? '웜업 세트' : `${label}세트`
}

function StopwatchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-5"
    >
      <circle cx="12" cy="13.5" r="7" />
      <path d="M12 10v3.5l2 1.5M10 3h4M12 3v3.5" />
    </svg>
  )
}

/**
 * 세트 시간을 재는 스톱워치. 시간 종목과 유산소 종목의 카드에서 세트 줄 아래에 놓인다.
 * 시작하면 아직 완료하지 않은 첫 세트를 재고, 멈추면 잰 시간을 그 세트에 적고 완료로 표시한다.
 * 스톱워치는 앱 전체에서 하나라서, 다른 종목을 재는 동안에는 시작할 수 없다.
 */
export function SetStopwatch({ sets, labels, targetSec, cardio, onDone }: SetStopwatchProps) {
  const stopwatch = useStopwatch()
  const running = stopwatch ? sets.findIndex((s) => s.id === stopwatch.setId) : -1
  if (stopwatch && running >= 0) {
    return <RunningStopwatch stopwatch={stopwatch} name={setName(labels[running])} cardio={cardio} onDone={onDone} />
  }

  const next = sets.findIndex((s) => !s.isDone)
  if (next < 0) return null
  const busy = stopwatch !== null
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => beginStopwatch(sets[next].id, targetSec)}
      className="mt-2 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-accent-soft text-[15px] font-semibold text-accent active:opacity-70 disabled:opacity-50"
    >
      <StopwatchIcon />
      {busy ? '다른 종목의 시간을 재는 중' : `${setName(labels[next])} 시간 재기`}
    </button>
  )
}

interface RunningStopwatchProps {
  stopwatch: Stopwatch
  /** 재고 있는 세트의 이름. "2세트", "웜업 세트" */
  name: string
  cardio: boolean
  onDone?: () => void
}

function RunningStopwatch({ stopwatch, name, cardio, onDone }: RunningStopwatchProps) {
  const now = useNow(250)
  const rest = useRestTimer()
  const [askCancel, setAskCancel] = useState(false)
  // 버티는 종목은 폰을 내려놓고 하므로 화면을 켜 둔다. 유산소는 길어서 켜 두지 않는다(꺼져도 시간은 맞다).
  useWakeLock(!cardio)

  const elapsed = stopwatchElapsedMs(stopwatch, now)
  const target = stopwatch.targetSec
  const reached = stopwatchReachedTarget(stopwatch, now)

  const stop = () => {
    const taken = takeStopwatch()
    if (!taken) return
    void recordTimedSet(taken.setId, taken.seconds)
    // 완료 체크를 눌렀을 때와 같게: 휴식 타이머가 가려지지 않게 키보드를 내리고 바깥에 알린다.
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    onDone?.()
  }

  const cancel = () => {
    setAskCancel(false)
    cancelStopwatch()
    // 목표 시간 알림을 위해 켜 둔 소리를 끈다(쉬는 중이면 휴식 타이머가 쓰고 있으니 그대로 둔다).
    if (!rest.active) releaseAudio()
  }

  return (
    <>
      <div role="timer" aria-label="스톱워치" className="mt-2 rounded-xl bg-accent-soft p-3">
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium leading-4 text-accent">{name} 재는 중</p>
            <p className="mt-1 text-4xl font-bold tabular-nums leading-none text-ink">{formatClock(elapsed)}</p>
          </div>
          {target !== undefined && (
            <p className={`shrink-0 text-sm ${reached ? 'font-semibold text-good' : 'text-muted'}`}>
              목표 {formatSeconds(target)}
              {reached && ' 채움'}
            </p>
          )}
        </div>
        <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
          <button
            type="button"
            onClick={() => (elapsed >= ASK_CANCEL_AFTER_MS ? setAskCancel(true) : cancel())}
            aria-label="시간 재기 취소"
            className="h-12 rounded-xl bg-surface px-4 text-[15px] font-semibold text-ink active:opacity-70"
          >
            취소
          </button>
          <button
            type="button"
            onClick={stop}
            className="h-12 rounded-xl bg-accent text-base font-bold text-on-accent active:opacity-80"
          >
            멈추고 기록
          </button>
        </div>
      </div>

      <Dialog
        open={askCancel}
        title="시간 재기를 취소할까요?"
        onClose={() => setAskCancel(false)}
        actions={[
          { label: '취소하고 버리기', tone: 'danger', onClick: cancel },
          { label: '계속 재기', onClick: () => setAskCancel(false) },
        ]}
      >
        지금까지 잰 시간은 세트에 기록되지 않습니다.
      </Dialog>
    </>
  )
}
