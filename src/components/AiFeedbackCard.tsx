import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { feedbackAdviceId, getWorkoutFeedback, requestWorkoutFeedback } from '../lib/ai/advice'
import { aiModelInfo, formatUsd, getAiModel, typicalCostText } from '../lib/ai/models'
import { useAdviceRequest } from '../lib/ai/useAdviceRequest'
import { formatFullDate } from '../lib/format'
import { getAiApiKey, getAiEnabled } from '../lib/settings'
import { SparkleIcon } from './icons'

/**
 * 끝난 운동의 AI 피드백. 기록 상세에 보인다(운동을 저장하면 바로 이 화면으로 온다).
 * AI 추천을 켰을 때만 보이고, 누를 때만 요청한다. 받은 답은 저장되어 다시 열어도 그대로 보인다.
 */
export function AiFeedbackCard({ workoutId }: { workoutId: string }) {
  const state = useLiveQuery(async () => {
    const [enabled, key, model, feedback] = await Promise.all([
      getAiEnabled(),
      getAiApiKey(),
      getAiModel(),
      getWorkoutFeedback(workoutId).catch(() => null),
    ])
    return { enabled, hasKey: key !== null, model, feedback }
  }, [workoutId])
  const { busy, error, run } = useAdviceRequest(feedbackAdviceId(workoutId), () => requestWorkoutFeedback(workoutId))

  if (!state?.enabled) return null
  const { feedback, hasKey, model } = state

  return (
    <section
      aria-labelledby="ai-feedback-title"
      aria-busy={busy}
      className="mt-3 rounded-2xl border border-line bg-surface p-4"
    >
      <h2 id="ai-feedback-title" className="flex items-center gap-1.5 font-bold text-ink">
        <SparkleIcon className="size-5 text-accent" />
        AI 피드백
      </h2>

      {!hasKey ? (
        <p className="mt-2 text-sm leading-relaxed text-muted">
          <Link to="/settings" className="font-semibold text-accent underline underline-offset-2">
            설정
          </Link>
          에서 Anthropic API 키를 넣으면 이 운동의 피드백을 받을 수 있어요.
        </p>
      ) : (
        <>
          {busy ? (
            <p role="status" className="mt-2 text-sm leading-relaxed text-muted">
              Claude가 이 운동을 지난 기록과 비교하고 있어요. 보통 10~30초 걸려요.
            </p>
          ) : feedback ? (
            <div className="mt-2">
              <p className="break-keep text-[15px] font-semibold leading-relaxed text-ink">{feedback.headline}</p>
              <ul className="mt-2 grid gap-1.5">
                {feedback.points.map((t, i) => (
                  <li key={i} className="flex gap-2 break-keep text-[15px] leading-relaxed text-ink">
                    <span aria-hidden="true" className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-accent" />
                    <span className="min-w-0">{t}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">
                {formatFullDate(feedback.meta.createdAt)} · {aiModelInfo(feedback.meta.model)?.label ?? feedback.meta.model}{' '}
                · 약 {formatUsd(feedback.meta.costUsd)}
              </p>
            </div>
          ) : (
            <p className="mt-2 break-keep text-sm leading-relaxed text-muted">
              이 운동을 같은 종목의 지난 기록과 비교해 잘한 점과 다음에 해 볼 것을 짧게 알려 줘요.{' '}
              {aiModelInfo(model)?.label ?? model}로 한 번에 약 {typicalCostText('feedback', model)}가 들어요.
            </p>
          )}
          {error && (
            <div role="alert" className="mt-2 text-sm leading-relaxed text-danger">
              <p className="break-keep">{error.message}</p>
              {error.detail && <p className="mt-0.5 break-all text-xs text-muted">{error.detail}</p>}
            </div>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void run()}
            className={`mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold active:opacity-80 disabled:opacity-50 ${
              feedback ? 'bg-surface-2 text-ink' : 'bg-accent text-on-accent'
            }`}
          >
            {busy && (
              <span
                aria-hidden="true"
                className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {busy ? '받는 중' : feedback ? '피드백 다시 받기' : 'AI 피드백 받기'}
          </button>
        </>
      )}
    </section>
  )
}
