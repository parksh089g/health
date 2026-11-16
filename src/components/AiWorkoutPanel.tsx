import { Link } from 'react-router-dom'
import type { AiWorkoutAdvice } from '../db'
import { requestWorkoutAdvice, workoutAdviceId, type AdviceMeta } from '../lib/ai/advice'
import { aiModelInfo, formatUsd, typicalCostText, type AiModelId } from '../lib/ai/models'
import { useAdviceRequest } from '../lib/ai/useAdviceRequest'
import { formatTime } from '../lib/format'
import { SparkleIcon } from './icons'

interface AiWorkoutPanelProps {
  workoutId: string
  model: AiModelId
  hasKey: boolean
  hasItems: boolean
  advice: (AiWorkoutAdvice & { meta: AdviceMeta }) | null
}

/** 운동 화면 맨 위의 AI 추천 칸. 누를 때만 Claude에게 묻는다(자동으로 요청하지 않는다). */
export function AiWorkoutPanel({ workoutId, model, hasKey, hasItems, advice }: AiWorkoutPanelProps) {
  const { busy, error, run } = useAdviceRequest(workoutAdviceId(workoutId), () => requestWorkoutAdvice(workoutId))

  if (!hasKey) {
    return (
      <p className="mb-3 rounded-2xl border border-dashed border-line px-4 py-3 text-sm leading-relaxed text-muted">
        AI 추천을 쓰려면{' '}
        <Link to="/settings" className="font-semibold text-accent underline underline-offset-2">
          설정
        </Link>
        에서 Anthropic API 키를 넣어 주세요.
      </p>
    )
  }

  const modelName = aiModelInfo(model)?.label ?? model
  const cost = typicalCostText('workout', model)

  return (
    <section aria-label="AI 코치" aria-busy={busy} className="mb-3 rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-start gap-2 px-1">
        <SparkleIcon className="mt-0.5 size-5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-ink">AI 코치</h2>
          {busy ? (
            <p role="status" className="mt-0.5 text-sm leading-relaxed text-muted">
              Claude가 기록을 보고 있어요. 보통 10~30초 걸려요.
            </p>
          ) : advice ? (
            <>
              <p className="mt-0.5 break-keep text-[15px] leading-relaxed text-ink">{advice.summary}</p>
              <p className="mt-1 text-xs text-muted">
                {aiModelInfo(advice.meta.model)?.label ?? advice.meta.model} · {formatTime(advice.meta.createdAt)} · 약{' '}
                {formatUsd(advice.meta.costUsd)} · 종목마다 AI 추천을 눌러 적용해요
              </p>
            </>
          ) : (
            <p className="mt-0.5 break-keep text-sm leading-relaxed text-muted">
              Claude가 최근 기록을 보고 종목마다 오늘 무게와 횟수를 제안해요. {modelName}로 한 번에 약 {cost}가
              들어요.
            </p>
          )}
          {error && (
            <div role="alert" className="mt-2 text-sm leading-relaxed text-danger">
              <p className="break-keep">{error.message}</p>
              {error.detail && <p className="mt-0.5 break-all text-xs text-muted">{error.detail}</p>}
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        disabled={busy || !hasItems}
        onClick={() => void run()}
        className={`mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold active:opacity-80 disabled:opacity-50 ${
          advice ? 'bg-surface-2 text-ink' : 'bg-accent text-on-accent'
        }`}
      >
        {busy && (
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        )}
        {busy ? '받는 중' : !hasItems ? '종목을 추가하면 받을 수 있어요' : advice ? 'AI 추천 다시 받기' : 'AI 추천 받기'}
      </button>
    </section>
  )
}
