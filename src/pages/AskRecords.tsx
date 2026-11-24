import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { SparkleIcon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import {
  askChat,
  chatCostText,
  clearChatError,
  getChatState,
  MAX_QUESTIONS,
  QUESTION_MAX,
  resetChat,
  subscribeChat,
  type ChatTurn,
} from '../lib/ai/chat'
import { aiModelInfo, formatUsd, getAiModel } from '../lib/ai/models'
import { getAiApiKey, getAiEnabled } from '../lib/settings'
import { useGoBack } from '../lib/useGoBack'

/** 처음 열었을 때 눌러서 입력 칸에 채우는 예시 질문. 눌러도 바로 보내지 않는다(보낼 때만 요금이 든다). */
const EXAMPLES = [
  '지난달 벤치프레스 최고 무게가 얼마였지?',
  '최근 4주 동안 덜 한 부위가 있어?',
  '요즘 정체된 종목이 있어?',
  '체중과 체성분 변화를 보고 앞으로 4주 운동 계획 세워 줘',
]

/** 내 기록에 물어보기. 글로 물으면 Claude가 폰의 기록에서 필요한 것만 찾아 답한다. */
export default function AskRecords() {
  const goBack = useGoBack('/stats')
  const chat = useSyncExternalStore(subscribeChat, getChatState)
  const settings = useLiveQuery(async () => {
    const [enabled, key, model] = await Promise.all([getAiEnabled(), getAiApiKey(), getAiModel()])
    return { enabled, hasKey: key !== null, model }
  }, [])
  // 보내지 못한 질문이 있으면 입력 칸에 되돌려 놓은 채로 연다.
  const [draft, setDraft] = useState(() => getChatState().failedQuestion ?? '')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  // 새 질문이나 답이 붙으면 맨 아래로 내린다.
  const count = chat.turns.length
  useEffect(() => {
    if (count > 0) endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [count, chat.busy])

  const ready = settings?.enabled === true && settings.hasKey
  const questions = chat.turns.filter((t) => t.role === 'user').length
  const send = () => {
    if (!ready || chat.busy || draft.trim() === '') return
    const q = draft
    setDraft('')
    void askChat(q).then(() => {
      // 보내지 못했으면 입력 칸에 되돌려 놓는다(그사이 새로 적은 글이 있으면 그대로 둔다).
      const failed = getChatState().failedQuestion
      if (failed !== null) setDraft((d) => (d.trim() === '' ? failed : d))
    })
  }

  return (
    <>
      <PageHeader
        title="내 기록에 물어보기"
        subtitle={settings?.model ? `${aiModelInfo(settings.model)?.label ?? settings.model} · 보낼 때만 요청` : undefined}
        onBack={goBack}
        right={
          count > 0 && (
            <button
              type="button"
              onClick={() => {
                resetChat()
                setDraft('')
              }}
              disabled={chat.busy}
              className="h-11 shrink-0 rounded-xl px-3 text-[15px] font-semibold text-accent active:bg-surface-2 disabled:opacity-40"
            >
              새 대화
            </button>
          )
        }
      />

      <main className="flex-1 px-4 pb-48 pt-4" aria-live="polite" aria-busy={chat.busy}>
        {settings !== undefined && !ready ? (
          <p className="rounded-2xl border border-dashed border-line p-5 text-sm leading-relaxed text-muted">
            <Link to="/settings" className="font-semibold text-accent underline underline-offset-2">
              설정
            </Link>
            에서 AI 추천을 켜고 Anthropic API 키를 넣으면 기록에 대해 물어볼 수 있어요.
          </p>
        ) : count === 0 ? (
          <Intro
            onPick={(q) => {
              setDraft(q)
              inputRef.current?.focus()
            }}
          />
        ) : (
          <ol className="grid gap-3">
            {chat.turns.map((t) => (
              <Turn key={t.id} turn={t} />
            ))}
          </ol>
        )}

        {chat.busy && (
          <div role="status" className="mt-3 flex items-start gap-2 rounded-2xl bg-surface-2 p-3 text-sm leading-relaxed text-muted">
            <span
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
            />
            <span className="min-w-0 break-keep">
              {chat.activity.length === 0
                ? 'Claude가 질문을 읽고 있어요.'
                : `기록을 보는 중: ${chat.activity.join(', ')}`}
              <br />
              <span className="text-xs">보통 15~40초 걸려요. 다른 화면에 다녀와도 이어서 받아요.</span>
            </span>
          </div>
        )}

        {chat.error && (
          <div role="alert" className="mt-3 rounded-2xl border border-line bg-surface p-3 text-sm leading-relaxed text-danger">
            <p className="break-keep">{chat.error.message}</p>
            {chat.error.detail && <p className="mt-0.5 break-all text-xs text-muted">{chat.error.detail}</p>}
            <button type="button" onClick={clearChatError} className="mt-1 h-9 text-sm font-semibold text-accent">
              닫기
            </button>
          </div>
        )}
        <div ref={endRef} />
      </main>

      {ready && (
        <div className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-md border-t border-line bg-bg px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          <p className="mb-1.5 px-1 text-xs text-muted">
            {questions >= MAX_QUESTIONS
              ? '대화가 길어졌어요. 새 대화를 시작해 주세요.'
              : `${aiModelInfo(settings.model)?.label ?? settings.model}로 한 번에 약 ${chatCostText(settings.model, chat.historyTokens)}${
                  count > 0 ? ' · 이어서 물으면 앞의 대화도 함께 보내요' : ''
                }`}
          </p>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">질문</span>
              <textarea
                ref={inputRef}
                value={draft}
                rows={1}
                maxLength={QUESTION_MAX}
                enterKeyHint="send"
                placeholder={count === 0 ? '예: 지난달 벤치 최고 무게는?' : '이어서 물어보기'}
                onChange={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  // 한글 조합 중의 Enter는 글자를 끝내는 것이라 보내지 않는다.
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    send()
                  }
                }}
                className="block max-h-32 min-h-12 w-full resize-none rounded-xl border border-line bg-surface px-3 py-3 text-base leading-snug text-ink outline-none [field-sizing:content] placeholder:text-muted/70 focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={chat.busy || draft.trim() === '' || questions >= MAX_QUESTIONS}
              className="h-12 shrink-0 rounded-xl bg-accent px-4 text-[15px] font-bold text-on-accent active:opacity-80 disabled:opacity-40"
            >
              {chat.busy ? '받는 중' : '보내기'}
            </button>
          </form>
        </div>
      )}
    </>
  )
}

function Intro({ onPick }: { onPick: (q: string) => void }) {
  return (
    <section aria-labelledby="ask-intro-title">
      <h2 id="ask-intro-title" className="flex items-center gap-1.5 font-bold text-ink">
        <SparkleIcon className="size-5 text-accent" />
        기록에 대해 물어보세요
      </h2>
      <p className="mt-2 break-keep text-sm leading-relaxed text-muted">
        Claude가 운동 기록, 체중, 골격근량과 체지방량 기록 중에서 질문에 필요한 것만 찾아 보고 답해요. 내 정보(목표, 부상)를
        반영해 운동 계획도 세워 줘요.
      </p>
      <h3 className="mt-4 text-sm font-semibold text-muted">이렇게 물어볼 수 있어요</h3>
      <ul className="mt-2 grid gap-2">
        {EXAMPLES.map((q) => (
          <li key={q}>
            <button
              type="button"
              onClick={() => onPick(q)}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-[15px] leading-snug text-ink active:bg-surface-2"
            >
              {q}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 break-keep text-xs leading-relaxed text-muted">
        누르면 입력 칸에 채워지고, 보내기를 눌러야 요청해요. 대화는 이 폰에만 남고 백업에는 들어가지 않아요.
      </p>
    </section>
  )
}

function Turn({ turn }: { turn: ChatTurn }) {
  if (turn.role === 'user') {
    return (
      <li className="ml-10 self-end rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-[15px] leading-relaxed text-on-accent">
        <span className="sr-only">내 질문: </span>
        <span className="whitespace-pre-wrap break-keep">{turn.text}</span>
      </li>
    )
  }
  return (
    <li className="rounded-2xl rounded-bl-md border border-line bg-surface p-3.5">
      <span className="sr-only">Claude의 답: </span>
      <AnswerText text={turn.text} />
      <p className="mt-2 text-xs text-muted">
        {aiModelInfo(turn.model ?? '')?.label ?? turn.model}
        {turn.costUsd !== undefined && ` · 약 ${formatUsd(turn.costUsd)}`}
        {turn.looked && turn.looked.length > 0 && ` · 본 기록: ${turn.looked.join(', ')}`}
      </p>
    </li>
  )
}

/** 답의 글. 빈 줄로 문단을 나누고, "- "로 시작하는 줄은 목록으로 보여 준다. */
function AnswerText({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/)
  return (
    <div className="grid gap-2 text-[15px] leading-relaxed text-ink">
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim() !== '')
        const bullets = lines.filter((l) => /^\s*[-•·]\s+/.test(l))
        if (bullets.length > 0 && bullets.length === lines.length) {
          return (
            <ul key={i} className="grid gap-1">
              {lines.map((l, j) => (
                <li key={j} className="flex gap-2 break-keep">
                  <span aria-hidden="true" className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-accent" />
                  <span className="min-w-0">{l.replace(/^\s*[-•·]\s+/, '')}</span>
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i} className="whitespace-pre-wrap break-keep">
            {block}
          </p>
        )
      })}
    </div>
  )
}
