import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getReview, requestReview } from '../lib/ai/advice'
import { AiError } from '../lib/ai/client'
import { REVIEW_WEEKS } from '../lib/ai/context'
import { aiModelInfo, formatUsd } from '../lib/ai/models'
import { formatFullDate } from '../lib/format'
import { getAiApiKey, getAiEnabled } from '../lib/settings'
import { SparkleIcon } from './icons'

/** 통계 화면의 AI 기록 분석. AI 추천을 켰을 때만 보인다. 누를 때만 요청한다. */
export function AiReviewCard() {
  const state = useLiveQuery(async () => {
    const [enabled, key, review] = await Promise.all([getAiEnabled(), getAiApiKey(), getReview().catch(() => null)])
    return { enabled, hasKey: key !== null, review }
  }, [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AiError | null>(null)

  if (!state?.enabled) return null
  const { review, hasKey } = state

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await requestReview()
    } catch (e) {
      setError(e instanceof AiError ? e : new AiError('AI 요청 중에 문제가 생겼습니다. 다시 시도해 주세요.', 'request'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="ai-review-title"
      aria-busy={busy}
      className="mt-3 rounded-2xl border border-line bg-surface p-4"
    >
      <h2 id="ai-review-title" className="flex items-center gap-1.5 font-bold text-ink">
        <SparkleIcon className="size-5 text-accent" />
        AI 기록 분석
      </h2>

      {!hasKey ? (
        <p className="mt-2 text-sm leading-relaxed text-muted">
          <Link to="/settings" className="font-semibold text-accent underline underline-offset-2">
            설정
          </Link>
          에서 Anthropic API 키를 넣으면 최근 {REVIEW_WEEKS}주 기록을 분석해 드려요.
        </p>
      ) : (
        <>
          {busy ? (
            <p role="status" className="mt-2 text-sm leading-relaxed text-muted">
              Claude가 최근 {REVIEW_WEEKS}주 기록을 보고 있어요. 보통 20~40초 걸려요.
            </p>
          ) : review ? (
            <div className="mt-2">
              <p className="break-keep text-[15px] font-semibold leading-relaxed text-ink">{review.headline}</p>
              <ReviewList title="잘하고 있는 점" items={review.good} />
              <ReviewList title="살펴볼 점" items={review.watch} />
              <ReviewList title="다음 4주 동안" items={review.suggestions} />
              <p className="mt-3 text-xs text-muted">
                {formatFullDate(review.meta.createdAt)} · {aiModelInfo(review.meta.model)?.label ?? review.meta.model} ·
                약 {formatUsd(review.meta.costUsd)}
              </p>
            </div>
          ) : (
            <p className="mt-2 break-keep text-sm leading-relaxed text-muted">
              최근 {REVIEW_WEEKS}주의 운동 빈도, 부위별 균형, 종목별 성장과 정체를 Claude가 읽고 짧게 정리해 줘요.
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
              review ? 'bg-surface-2 text-ink' : 'bg-accent text-on-accent'
            }`}
          >
            {busy && (
              <span
                aria-hidden="true"
                className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {busy ? '분석 중' : review ? '다시 분석하기' : '기록 분석 받기'}
          </button>
        </>
      )}
    </section>
  )
}

function ReviewList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <>
      <h3 className="mt-3 text-sm font-semibold text-muted">{title}</h3>
      <ul className="mt-1 grid gap-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2 break-keep text-[15px] leading-relaxed text-ink">
            <span aria-hidden="true" className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-accent" />
            <span className="min-w-0">{t}</span>
          </li>
        ))}
      </ul>
    </>
  )
}
