import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  cachedSwap,
  canSwap,
  clearSwap,
  pendingSwap,
  requestSwap,
  swapCostText,
  swapModelLabel,
  swapRequestId,
  SWAP_DETAIL_MAX,
  SWAP_REASONS,
  type SwapOption,
  type SwapReason,
  type SwapResult,
} from '../lib/ai/substitute'
import { useAdviceRequest } from '../lib/ai/useAdviceRequest'
import { aiModelInfo, formatUsd, getAiModel } from '../lib/ai/models'
import { equipmentLabel } from '../lib/exercises'
import { formatKg } from '../lib/format'
import { getAiApiKey, getAiEnabled } from '../lib/settings'
import { swapWorkoutExercise } from '../lib/swap'
import type { WorkoutItem } from '../lib/workouts'
import { Dialog } from './Dialog'
import { SparkleIcon } from './icons'

interface AiSwapButtonProps {
  item: WorkoutItem
}

/**
 * 종목 카드 아래의 "대체" 버튼과 그 창. 운동 중에 기구가 차 있거나 몸이 불편할 때, 까닭을 고르면
 * AI가 내 종목 목록에서 같은 부위의 다른 종목 2~3개와 시작 무게를 제안하고, 눌러서 바로 바꾼다.
 * AI 추천을 켰을 때, 무게×횟수로 하는 종목에만 나온다. 누를 때만 요청한다.
 */
export function AiSwapButton({ item }: AiSwapButtonProps) {
  const [open, setOpen] = useState(false)
  const enabled = useLiveQuery(() => getAiEnabled(), [])
  if (!enabled || !canSwap(item.exercise)) return null
  // 바벨 종목은 웜업과 원판 버튼이 함께 있어 줄이 좁으니 아이콘만 보인다.
  const compact = item.exercise.equipment === 'barbell'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="대체 종목 추천"
        aria-haspopup="dialog"
        className={`flex h-11 shrink-0 items-center justify-center gap-1 rounded-xl bg-surface-2 text-[15px] font-semibold text-ink active:opacity-70 ${
          compact ? 'w-11' : 'px-3'
        }`}
      >
        <SparkleIcon className={`${compact ? 'size-5' : 'size-4'} text-accent`} />
        {!compact && '대체'}
      </button>
      {open && <SwapDialog item={item} onClose={() => setOpen(false)} />}
    </>
  )
}

function SwapDialog({ item, onClose }: { item: WorkoutItem; onClose: () => void }) {
  const weId = item.we.id
  const name = item.exercise?.name ?? ''
  const [reason, setReason] = useState<SwapReason | null>(null)
  const [detail, setDetail] = useState('')
  const [result, setResult] = useState<SwapResult | null>(() => cachedSwap(weId))
  const [swapping, setSwapping] = useState(false)
  const state = useLiveQuery(async () => {
    const [key, model] = await Promise.all([getAiApiKey(), getAiModel()])
    return { hasKey: key !== null, model }
  }, [])
  const { busy, error, run } = useAdviceRequest(swapRequestId(weId), async () => {
    if (reason === null) return
    setResult(await requestSwap(weId, reason, detail))
  })

  // 창을 닫았다 다시 열었을 때 아직 기다리는 요청이 있으면, 그 답이 오면 보여 준다.
  useEffect(() => {
    let alive = true
    pendingSwap(weId)
      ?.then((r) => alive && setResult(r))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [weId])

  const choose = async (option: SwapOption) => {
    setSwapping(true)
    try {
      const done = await swapWorkoutExercise(weId, option.exerciseId, { weightKg: option.weightKg, reps: option.reps })
      if (done) {
        clearSwap(weId)
        onClose()
      }
    } finally {
      setSwapping(false)
    }
  }

  return (
    <Dialog open title={`${name} 대신할 종목`} onClose={onClose} actions={[{ label: '닫기', onClick: onClose }]}>
      <div className="-mx-1 max-h-[65dvh] overflow-y-auto px-1" aria-busy={busy}>
        {!state ? null : !state.hasKey ? (
          <p className="break-keep">
            <Link to="/settings" className="font-semibold text-accent underline underline-offset-2">
              설정
            </Link>
            에서 Anthropic API 키를 넣으면 대체 종목을 추천받을 수 있어요.
          </p>
        ) : (
          <>
            <p className="break-keep">왜 바꾸고 싶은지 고르면, 내 종목 중 같은 부위로 대신할 종목과 시작 무게를 알려 줘요.</p>
            <div role="group" aria-label="바꾸는 까닭" className="mt-3 flex flex-wrap gap-2">
              {SWAP_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  aria-pressed={reason === r.value}
                  onClick={() => setReason(r.value)}
                  className={`h-11 rounded-full px-3.5 text-[15px] font-semibold active:opacity-70 ${
                    reason === r.value ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <label className="mt-3 block">
              <span className="text-sm text-muted">덧붙일 말 (선택)</span>
              <input
                type="text"
                value={detail}
                maxLength={SWAP_DETAIL_MAX}
                onChange={(e) => setDetail(e.target.value)}
                placeholder={reason === 'pain' ? '예: 오른쪽 어깨 앞쪽이 찌릿해요' : '예: 덤벨만 비어 있어요'}
                className="mt-1 h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-[15px] text-ink placeholder:text-muted"
              />
            </label>
            <p className="mt-2 break-keep text-xs text-muted">
              설정의 내 정보(부상 메모, 체중)도 함께 봐요. {swapModelLabel(state.model)}로 한 번에 약{' '}
              {swapCostText(state.model)}가 들어요.
            </p>
            <button
              type="button"
              disabled={busy || reason === null || swapping}
              onClick={() => void run()}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-bold text-on-accent active:opacity-80 disabled:opacity-50"
            >
              {busy && (
                <span
                  aria-hidden="true"
                  className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              )}
              {busy ? '받는 중' : result ? '다시 추천받기' : '대체 종목 추천받기'}
            </button>
            {busy && (
              <p role="status" className="mt-2 text-sm text-muted">
                Claude가 고르고 있어요. 보통 5~15초 걸려요.
              </p>
            )}
            {error && (
              <div role="alert" className="mt-2 text-sm leading-relaxed text-danger">
                <p className="break-keep">{error.message}</p>
                {error.detail && <p className="mt-0.5 break-all text-xs text-muted">{error.detail}</p>}
              </div>
            )}
            {result && !busy && (
              <div className="mt-3">
                <ul className="grid gap-2" aria-label="대체 종목">
                  {result.options.map((o) => (
                    <li key={o.exerciseId} className="rounded-xl border border-line p-3">
                      <p className="font-bold text-ink">
                        {o.name}
                        <span className="ml-1.5 text-sm font-normal text-muted">{equipmentLabel(o.equipment)}</span>
                      </p>
                      <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-accent">{startText(o)}</p>
                      {o.reason !== '' && <p className="mt-1 break-keep text-sm leading-snug text-ink">{o.reason}</p>}
                      <button
                        type="button"
                        disabled={swapping}
                        onClick={() => void choose(o)}
                        aria-label={`${o.name}(으)로 바꾸기`}
                        className="mt-2 h-11 w-full rounded-xl bg-surface-2 text-[15px] font-bold text-ink active:opacity-70 disabled:opacity-50"
                      >
                        이 종목으로 바꾸기
                      </button>
                    </li>
                  ))}
                </ul>
                {result.note !== '' && <p className="mt-2 break-keep text-sm leading-snug">{result.note}</p>}
                <p className="mt-2 text-xs text-muted">
                  {aiModelInfo(result.model)?.label ?? result.model} · 약 {formatUsd(result.costUsd)} · 바꾸면 남은 세트가 새
                  종목으로 바뀌고, 끝낸 세트는 기록에 남아요.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

/** "시작 60kg × 8회", 맨몸이면 "시작 맨몸 10회", 무게를 모르면 "시작 8회 · 무게는 가볍게" */
function startText(o: SwapOption): string {
  if (o.weightKg === null) return o.addedWeight ? `시작 맨몸 ${o.reps}회` : `시작 ${o.reps}회 · 무게는 가볍게`
  const w = `${o.addedWeight ? '+' : o.assist ? '보조 ' : ''}${formatKg(o.weightKg)}kg`
  return `시작 ${w} × ${o.reps}회`
}
