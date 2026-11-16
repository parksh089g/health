import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { pendingAdviceRequest } from '../lib/ai/advice'
import { aiModelInfo, formatUsd, getAiModel, typicalCostText, type AiModelId } from '../lib/ai/models'
import {
  discardRoutineDraft,
  getRoutineDraft,
  normalizeRoutineRequest,
  requestRoutineProposals,
  ROUTINE_DRAFT_ID,
  ROUTINE_REQUEST_MAX,
  saveRoutineProposals,
  type RoutineDraftView,
  type RoutineProposalView,
} from '../lib/ai/routineBuilder'
import { useAdviceRequest } from '../lib/ai/useAdviceRequest'
import { formatFullDate } from '../lib/format'
import { getAiApiKey, getAiEnabled } from '../lib/settings'
import { CheckIcon, SparkleIcon } from './icons'

// 답을 기다리는 동안 다른 화면에 갔다 와도 적어 둔 요청이 남도록 화면 밖에 둔다.
let lastRequestText = ''

/**
 * 루틴 화면의 "AI로 루틴 만들기". AI 추천을 켜고 API 키를 넣었을 때만 보인다.
 * 요청을 적어 누를 때만 Claude에게 묻고, 받은 제안은 미리 보기일 뿐 고른 것만 루틴으로 저장한다.
 */
export function AiRoutineBuilder() {
  const state = useLiveQuery(async () => {
    const [enabled, key, model, draft] = await Promise.all([
      getAiEnabled(),
      getAiApiKey(),
      getAiModel(),
      getRoutineDraft().catch(() => null),
    ])
    return { enabled, hasKey: key !== null, model, draft }
  }, [])

  if (!state?.enabled || !state.hasKey) return null
  return <Builder model={state.model} draft={state.draft} />
}

function Builder({ model, draft }: { model: AiModelId; draft: RoutineDraftView | null }) {
  const [text, setText] = useState(() => lastRequestText || (draft?.request ?? ''))
  const [opened, setOpened] = useState(() => pendingAdviceRequest(ROUTINE_DRAFT_ID) !== undefined)
  // 저장하지 않기로 한 제안. 처음에는 모두 고른 상태다.
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const { busy, error, run } = useAdviceRequest(ROUTINE_DRAFT_ID, () => requestRoutineProposals(text))

  const open = opened || busy || draft !== null
  const request = normalizeRoutineRequest(text)
  const chosen = draft ? draft.proposals.filter((p) => !skipped.has(p.id)) : []

  const change = (value: string) => {
    lastRequestText = value
    setText(value)
  }

  const ask = async () => {
    setNotice(null)
    setSkipped(new Set())
    await run()
  }

  const toggle = (id: string) => {
    const next = new Set(skipped)
    if (!next.delete(id)) next.add(id)
    setSkipped(next)
  }

  const save = async () => {
    if (saving || chosen.length === 0) return
    setSaving(true)
    try {
      const ids = await saveRoutineProposals(chosen.map((p) => p.id))
      setNotice({ tone: 'ok', text: `루틴 ${ids.length}개를 저장했습니다. 루틴 목록에서 바로 시작할 수 있어요.` })
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : '루틴을 저장하지 못했습니다.' })
    } finally {
      setSaving(false)
    }
  }

  const discard = async () => {
    await discardRoutineDraft()
    setNotice(null)
    setSkipped(new Set())
  }

  if (!open) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpened(true)}
          className="mt-3 flex h-12 w-full items-center justify-center gap-1.5 rounded-2xl bg-surface-2 text-base font-semibold text-ink active:opacity-70"
        >
          <SparkleIcon className="size-5 text-accent" />
          AI로 루틴 만들기
        </button>
        {notice && <Notice notice={notice} />}
      </>
    )
  }

  return (
    <section
      aria-labelledby="ai-routine-title"
      aria-busy={busy}
      className="mt-3 rounded-2xl border border-line bg-surface p-4 text-left"
    >
      <div className="flex items-center gap-1.5">
        <SparkleIcon className="size-5 shrink-0 text-accent" />
        <h2 id="ai-routine-title" className="min-w-0 flex-1 font-bold text-ink">
          AI로 루틴 만들기
        </h2>
        {!busy && draft === null && (
          <button
            type="button"
            onClick={() => setOpened(false)}
            className="-my-2 -mr-2 h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-muted active:bg-surface-2"
          >
            닫기
          </button>
        )}
      </div>

      <label className="mt-2 grid gap-1.5 text-sm text-muted">
        어떤 루틴을 원하나요?
        <textarea
          value={text}
          onChange={(e) => change(e.currentTarget.value)}
          disabled={busy}
          rows={2}
          maxLength={ROUTINE_REQUEST_MAX}
          placeholder="예: 주 3회 상체/하체 분할"
          className="w-full resize-none rounded-xl border border-line bg-bg p-3 text-base leading-relaxed text-ink outline-none placeholder:text-muted focus:border-accent disabled:opacity-60"
        />
      </label>

      {busy ? (
        <p role="status" className="mt-2 text-sm leading-relaxed text-muted">
          Claude가 루틴을 짜고 있어요. 보통 20~40초 걸려요.
        </p>
      ) : (
        <p className="mt-2 break-keep text-sm leading-relaxed text-muted">
          Claude가 이 요청과 설정의 내 정보, 최근 기록, 종목 목록을 보고 루틴을 1~4개 제안해요. 고른 것만 저장돼요.{' '}
          {aiModelInfo(model)?.label ?? model}로 한 번에 약 {typicalCostText('routines', model)}가 들어요.
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
        disabled={busy || request === ''}
        onClick={() => void ask()}
        className={`mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold active:opacity-80 disabled:opacity-50 ${
          draft ? 'bg-surface-2 text-ink' : 'bg-accent text-on-accent'
        }`}
      >
        {busy && (
          <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        {busy ? '받는 중' : draft ? '루틴 제안 다시 받기' : '루틴 제안 받기'}
      </button>

      {draft && !busy && (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="text-sm font-semibold text-ink">제안받은 루틴 {draft.proposals.length}개</h3>
          <p className="mt-1 break-keep text-xs leading-relaxed text-muted">
            &ldquo;{draft.request}&rdquo; · {formatFullDate(draft.meta.createdAt)} ·{' '}
            {aiModelInfo(draft.meta.model)?.label ?? draft.meta.model} · 약 {formatUsd(draft.meta.costUsd)}
          </p>
          <ul className="mt-3 grid gap-2">
            {draft.proposals.map((p) => (
              <Proposal key={p.id} proposal={p} picked={!skipped.has(p.id)} onToggle={() => toggle(p.id)} />
            ))}
          </ul>
          <button
            type="button"
            disabled={saving || chosen.length === 0}
            onClick={() => void save()}
            className="mt-3 h-12 w-full rounded-xl bg-accent text-base font-bold text-on-accent active:opacity-80 disabled:opacity-40"
          >
            {chosen.length === 0 ? '저장할 루틴을 골라 주세요' : `고른 ${chosen.length}개 루틴으로 저장`}
          </button>
          <button
            type="button"
            onClick={() => void discard()}
            className="mt-1 h-11 w-full rounded-xl text-sm font-semibold text-muted active:bg-surface-2"
          >
            저장하지 않고 제안 지우기
          </button>
        </div>
      )}
      {notice && <Notice notice={notice} />}
    </section>
  )
}

function Notice({ notice }: { notice: { tone: 'ok' | 'error'; text: string } }) {
  return (
    <p
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className={`mt-3 break-keep text-sm leading-relaxed ${notice.tone === 'error' ? 'text-danger' : 'text-good'}`}
    >
      {notice.text}
    </p>
  )
}

function Proposal({ proposal, picked, onToggle }: { proposal: RoutineProposalView; picked: boolean; onToggle: () => void }) {
  return (
    <li className={`rounded-2xl border p-3 ${picked ? 'border-accent bg-accent-soft' : 'border-line bg-bg'}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={picked}
        aria-label={`${proposal.name} 저장하기`}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block break-keep text-base font-bold text-ink">{proposal.name}</span>
          <span className="block text-sm tabular-nums text-muted">종목 {proposal.entries.length}개</span>
        </span>
        <span
          aria-hidden="true"
          className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 ${
            picked ? 'border-accent bg-accent text-on-accent' : 'border-line text-transparent'
          }`}
        >
          <CheckIcon className="size-4" />
        </span>
      </button>
      {proposal.rationale !== '' && (
        <p className="mt-1 break-keep text-sm leading-relaxed text-muted">{proposal.rationale}</p>
      )}
      <ul className="mt-2 grid gap-1">
        {proposal.entries.map(({ item, name }) => (
          <li key={item.exerciseId} className="flex items-baseline gap-2 text-[15px]">
            <span className="min-w-0 flex-1 truncate text-ink">{name}</span>
            <span className="shrink-0 tabular-nums text-muted">
              {item.sets}세트{item.reps === null ? '' : ` × ${item.reps}회`}
            </span>
          </li>
        ))}
      </ul>
    </li>
  )
}
