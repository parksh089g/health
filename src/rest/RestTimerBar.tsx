import { formatClock } from '../lib/format'
import { REST_STEP_SECONDS } from '../lib/rest'
import { REST_OPTIONS } from '../lib/settings'
import { useRestTimer } from './context'

/**
 * 화면 아래에 뜨는 휴식 타이머. 타이머가 없으면 아무것도 그리지 않는다.
 * 윗줄의 −15초, +15초는 이번 휴식만 바꾸고, 아랫줄에서 고른 길이는 다음 휴식에도 쓰인다
 * (종목에 정해 둔 휴식 시간으로 시작했을 때는 이번만).
 */
export function RestTimerBar() {
  const rest = useRestTimer()
  if (!rest.active) return null

  const total = rest.durationSeconds * 1000
  const progress = total > 0 ? Math.min(1, Math.max(0, 1 - rest.remainingMs / total)) : 1

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-md bg-linear-to-t from-bg from-70% to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-6">
      <div
        role="timer"
        aria-label="휴식 타이머"
        className={`pointer-events-auto rounded-2xl border p-3 shadow-lg ${
          rest.finished ? 'border-good bg-good text-white' : 'border-line bg-surface text-ink'
        }`}
      >
        <div className="flex items-center gap-1.5">
          {/* "휴식"을 시간 위에 얹어서, 10분이 넘는 시간(14:59)도 버튼 옆에 다 들어가게 한다. */}
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-medium leading-4 ${rest.finished ? 'text-white/90' : 'text-muted'}`}>휴식</p>
            <p className="text-3xl font-bold tabular-nums leading-none">
              {rest.finished ? '끝!' : formatClock(rest.remainingMs + 999)}
            </p>
          </div>
          {!rest.finished &&
            [-REST_STEP_SECONDS, REST_STEP_SECONDS].map((delta) => (
              <button
                key={delta}
                type="button"
                disabled={!rest.canAdjust(delta)}
                onClick={() => rest.adjust(delta)}
                className="h-11 shrink-0 rounded-xl bg-surface-2 px-1.5 text-sm font-semibold tabular-nums text-ink active:opacity-70 disabled:opacity-40"
              >
                {delta < 0 ? '−' : '+'}
                {Math.abs(delta)}초
              </button>
            ))}
          <button
            type="button"
            onClick={rest.stop}
            className={`h-11 shrink-0 rounded-xl text-[15px] font-semibold active:opacity-70 ${
              rest.finished ? 'bg-white/20 px-4 text-white' : 'bg-accent-soft px-3 text-accent'
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
            <div className="mt-3 grid grid-cols-6 gap-1.5" role="group" aria-label="휴식 시간 고르기">
              {REST_OPTIONS.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  aria-pressed={rest.durationSeconds === sec}
                  onClick={() => rest.changeDuration(sec)}
                  className={`h-11 min-w-0 rounded-xl text-sm font-semibold tabular-nums active:opacity-70 ${
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
