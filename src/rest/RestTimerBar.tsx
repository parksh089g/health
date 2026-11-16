import { formatClock } from '../lib/format'
import { REST_OPTIONS } from '../lib/settings'
import { useRestTimer } from './context'

/** 화면 아래에 뜨는 휴식 타이머. 타이머가 없으면 아무것도 그리지 않는다. */
export function RestTimerBar() {
  const rest = useRestTimer()
  if (!rest.active) return null

  const total = rest.durationSeconds * 1000
  const progress = total > 0 ? Math.min(1, 1 - rest.remainingMs / total) : 1

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-md bg-linear-to-t from-bg from-70% to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-6">
      <div
        role="timer"
        aria-label="휴식 타이머"
        className={`pointer-events-auto rounded-2xl border p-3 shadow-lg ${
          rest.finished ? 'border-good bg-good text-white' : 'border-line bg-surface text-ink'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className={`text-sm font-medium ${rest.finished ? 'text-white/90' : 'text-muted'}`}>휴식</span>
            <span className="text-3xl font-bold tabular-nums leading-none">
              {rest.finished ? '끝!' : formatClock(rest.remainingMs + 999)}
            </span>
          </div>
          <button
            type="button"
            onClick={rest.stop}
            className={`h-10 rounded-xl px-4 text-[15px] font-semibold active:opacity-70 ${
              rest.finished ? 'bg-white/20 text-white' : 'bg-surface-2 text-ink'
            }`}
          >
            {rest.finished ? '닫기' : '건너뛰기'}
          </button>
        </div>

        {!rest.finished && (
          <>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {REST_OPTIONS.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  aria-pressed={rest.durationSeconds === sec}
                  onClick={() => rest.changeDuration(sec)}
                  className={`h-10 rounded-xl text-[15px] font-semibold active:opacity-70 ${
                    rest.durationSeconds === sec ? 'bg-accent text-on-accent' : 'bg-surface-2 text-muted'
                  }`}
                >
                  {sec}초
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
