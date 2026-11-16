import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { AiError, checkConnection } from '../lib/ai/client'
import { AI_MODELS, estimateCostUsd, formatUsd, getAiModel, getAiUsage, type AiModelId } from '../lib/ai/models'
import { getAiApiKey, getAiEnabled, setSetting, SETTING_KEYS } from '../lib/settings'
import { SegmentedControl } from './SegmentedControl'
import { Toggle } from './Toggle'

const TYPICAL_USAGE = { input_tokens: 4000, output_tokens: 2000 }

/** "sk-ant-…ab12": 앞뒤 몇 글자만 보여 준다. */
function maskKey(key: string): string {
  return key.length <= 12 ? '저장된 키' : `${key.slice(0, 7)}…${key.slice(-4)}`
}

interface Notice {
  tone: 'ok' | 'error'
  text: string
  detail?: string
}

/** 설정 화면의 AI 추천(Claude) 칸. 켜기, API 키, 모델, 연결 확인, 이번 달 사용량. */
export function AiSettings() {
  const state = useLiveQuery(async () => {
    const [enabled, key, model, usage] = await Promise.all([getAiEnabled(), getAiApiKey(), getAiModel(), getAiUsage()])
    return { enabled, key, model, usage }
  }, [])
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [checking, setChecking] = useState(false)

  const enabled = state?.enabled ?? false

  const saveKey = async () => {
    const key = draft.trim()
    if (key === '') return
    await setSetting(SETTING_KEYS.aiApiKey, key)
    setDraft('')
    setNotice(
      key.startsWith('sk-ant-')
        ? { tone: 'ok', text: '키를 이 폰에 저장했습니다. 연결 확인으로 키가 맞는지 볼 수 있어요.' }
        : { tone: 'error', text: 'Anthropic API 키는 보통 sk-ant-로 시작합니다. 키를 다시 확인해 주세요.' },
    )
  }

  const removeKey = async () => {
    await setSetting(SETTING_KEYS.aiApiKey, null)
    setNotice({ tone: 'ok', text: '이 폰에서 키를 지웠습니다.' })
  }

  const check = async () => {
    if (!state?.key) return
    setChecking(true)
    setNotice(null)
    try {
      const name = await checkConnection(state.key, state.model)
      setNotice({ tone: 'ok', text: `연결됐습니다. ${name}를 쓸 수 있어요.` })
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError('연결을 확인하지 못했습니다.', 'request')
      setNotice({ tone: 'error', text: err.message, detail: err.detail })
    } finally {
      setChecking(false)
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4" aria-label="AI 추천">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="AI 추천"
        aria-describedby="ai-desc"
        disabled={state === undefined}
        onClick={() => void setSetting(SETTING_KEYS.aiEnabled, !enabled)}
        className="flex min-h-12 w-full items-center gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-ink">AI 추천 (Claude)</span>
          <span id="ai-desc" className="mt-1 block break-keep text-sm leading-relaxed text-muted">
            운동 중에 Claude가 최근 기록을 보고 종목마다 무게와 횟수를 제안하고, 통계 화면에서 기록을 분석해 줍니다.
            누를 때만 요청하고, 끄면 기록이 밖으로 나가지 않습니다.
          </span>
        </span>
        <Toggle on={enabled} />
      </button>

      {enabled && state && (
        <div className="mt-4 grid gap-4 border-t border-line pt-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Anthropic API 키</h3>
            {state.key ? (
              <div className="mt-2 flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate rounded-xl bg-surface-2 px-3 py-3 font-mono text-sm text-ink">
                  {maskKey(state.key)}
                </p>
                <button
                  type="button"
                  onClick={() => void removeKey()}
                  className="h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-danger active:bg-surface-2"
                >
                  키 지우기
                </button>
              </div>
            ) : (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void saveKey()
                }}
              >
                <input
                  type="password"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="sk-ant-..."
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-label="Anthropic API 키"
                  className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-[15px] text-ink outline-none focus:border-accent"
                />
                <button
                  type="submit"
                  disabled={draft.trim() === ''}
                  className="h-11 shrink-0 rounded-xl bg-accent px-4 text-[15px] font-bold text-on-accent active:opacity-80 disabled:opacity-40"
                >
                  저장
                </button>
              </form>
            )}
            <p className="mt-2 break-keep text-xs leading-relaxed text-muted">
              키는{' '}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-accent underline underline-offset-2"
              >
                Anthropic 콘솔
              </a>
              에서 만들 수 있어요. 이 폰에만 저장되고 백업 파일에는 들어가지 않습니다. 요금은 Claude 구독과 따로, 쓴
              만큼 Anthropic에서 청구됩니다.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink">모델</h3>
            <div className="mt-2">
              <SegmentedControl<AiModelId>
                label="AI 모델"
                options={AI_MODELS.map((m) => ({ value: m.id, label: m.label }))}
                value={state.model}
                onChange={(v) => void setSetting(SETTING_KEYS.aiModel, v)}
              />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {AI_MODELS.find((m) => m.id === state.model)?.note} · 운동 추천 한 번에 약{' '}
              {formatUsd(estimateCostUsd(TYPICAL_USAGE, state.model, state.model))}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink">
              이번 달 {state.usage.calls}회 · 약 {formatUsd(state.usage.costUsd)}
              <span className="block text-xs text-muted">이 폰에서 센 어림값이에요. 실제 청구는 콘솔에서 확인하세요.</span>
            </p>
            <button
              type="button"
              disabled={!state.key || checking}
              onClick={() => void check()}
              className="h-11 shrink-0 rounded-xl bg-surface-2 px-4 text-sm font-semibold text-ink active:opacity-70 disabled:opacity-40"
            >
              {checking ? '확인 중' : '연결 확인'}
            </button>
          </div>

          <p className="break-keep text-xs leading-relaxed text-muted">
            요청할 때 종목 이름, 날짜, 무게와 횟수, 목표, 운동 메모가 Anthropic으로 전송됩니다. 이름이나 연락처 같은
            개인 정보는 보내지 않습니다.
          </p>

          {notice && (
            <div
              role={notice.tone === 'error' ? 'alert' : 'status'}
              className={`text-sm leading-relaxed ${notice.tone === 'error' ? 'text-danger' : 'text-good'}`}
            >
              <p className="break-keep">{notice.text}</p>
              {notice.detail && <p className="mt-0.5 break-all text-xs text-muted">{notice.detail}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
