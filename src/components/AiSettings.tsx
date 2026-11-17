import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import type { AiProfile } from '../db'
import { AiError, checkConnection } from '../lib/ai/client'
import { AI_MODELS, formatUsd, getAiModel, getAiUsage, typicalCostText, type AiModelId } from '../lib/ai/models'
import { AI_DAYS_RANGE, AI_EXPERIENCES, AI_GOALS, AI_PROFILE_NOTES_MAX, saveAiProfile } from '../lib/ai/profile'
import { getAiApiKey, getAiEnabled, getAiProfile, setSetting, SETTING_KEYS } from '../lib/settings'
import { SegmentedControl } from './SegmentedControl'
import { Toggle } from './Toggle'

/** "sk-ant-…ab12": 앞뒤 몇 글자만 보여 준다. */
function maskKey(key: string): string {
  return key.length <= 12 ? '저장된 키' : `${key.slice(0, 7)}…${key.slice(-4)}`
}

interface Notice {
  tone: 'ok' | 'error'
  text: string
  detail?: string
}

/** 설정 화면의 AI 추천(Claude) 칸. 켜기, API 키, 모델, 내 정보, 연결 확인, 이번 달 사용량. */
export function AiSettings() {
  const state = useLiveQuery(async () => {
    const [enabled, key, model, usage, profile] = await Promise.all([
      getAiEnabled(),
      getAiApiKey(),
      getAiModel(),
      getAiUsage(),
      getAiProfile(),
    ])
    return { enabled, key, model, usage, profile }
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
            Claude가 최근 기록을 보고 운동 중에는 종목마다 무게와 횟수를 제안하고, 운동을 마치면 피드백을, 통계
            화면에서는 기록 분석을, 루틴 화면에서는 루틴 제안을 해 줍니다. 누를 때만 요청하고, 끄면 기록이 밖으로
            나가지 않습니다.
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
              {typicalCostText('workout', state.model)}
            </p>
          </div>

          <ProfileFields profile={state.profile} />

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
            요청할 때 종목 이름과 종목 메모, 날짜, 무게와 횟수, 힘든 정도(RPE), 목표, 루틴, 운동 메모, 체중 기록,
            위에 적은 내 정보가 Anthropic으로 전송됩니다. 이름이나 연락처는 보내지 않으니, 내 정보의 참고할 점에도
            적지 마세요.
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

/** 내 정보: AI에게 알려 두는 목표, 경력, 주당 횟수, 참고할 점. 고르거나 적으면 바로 저장하고, 고른 것을 다시 누르면 지운다. */
function ProfileFields({ profile }: { profile: AiProfile }) {
  const days = Array.from({ length: AI_DAYS_RANGE.max - AI_DAYS_RANGE.min + 1 }, (_, i) => String(AI_DAYS_RANGE.min + i))
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">내 정보</h3>
      <p className="mt-1 break-keep text-xs leading-relaxed text-muted">
        적어 두면 AI에게 요청할 때마다 함께 보내 답에 반영합니다. 비워 둬도 되고, 고른 것을 다시 누르면 지워집니다.
      </p>
      <div className="mt-3 grid gap-3">
        <ProfileRow label="목표">
          <SegmentedControl<NonNullable<AiProfile['goal']> | ''>
            label="목표"
            options={AI_GOALS.map((g) => ({ value: g.value, label: g.label }))}
            value={profile.goal ?? ''}
            onChange={(v) => void saveAiProfile({ goal: v === '' || v === profile.goal ? null : v })}
          />
        </ProfileRow>
        <ProfileRow label="운동 경력">
          <SegmentedControl<NonNullable<AiProfile['experience']> | ''>
            label="운동 경력"
            options={AI_EXPERIENCES.map((e) => ({ value: e.value, label: e.label }))}
            value={profile.experience ?? ''}
            onChange={(v) => void saveAiProfile({ experience: v === '' || v === profile.experience ? null : v })}
          />
        </ProfileRow>
        <ProfileRow label="주당 운동 횟수">
          <SegmentedControl
            label="주당 운동 횟수"
            options={days.map((d) => ({ value: d, label: d }))}
            value={profile.daysPerWeek === null ? '' : String(profile.daysPerWeek)}
            onChange={(v) => void saveAiProfile({ daysPerWeek: Number(v) === profile.daysPerWeek ? null : Number(v) })}
          />
        </ProfileRow>
        <ProfileNotes initial={profile.notes} />
      </div>
    </div>
  )
}

function ProfileRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-sm text-muted">{label}</p>
      {children}
    </div>
  )
}

/** 참고할 점. 적다가 잠깐 멈추거나 입력 칸을 벗어나면 저장한다. */
function ProfileNotes({ initial }: { initial: string }) {
  const [text, setText] = useState(initial)
  // 저장된 값이 밖에서 바뀌면(복원 등) 따라간다. 방금 적어서 저장된 값이면 적는 중인 글을 그대로 둔다.
  const [seen, setSeen] = useState(initial)
  const [sent, setSent] = useState<string | null>(null)
  if (seen !== initial) {
    setSeen(initial)
    if (initial !== sent && text.trim() !== initial) setText(initial)
  }
  const save = () => {
    const notes = text.trim().slice(0, AI_PROFILE_NOTES_MAX)
    setSent(notes)
    void saveAiProfile({ notes })
  }
  // 뒤로 가기로 화면을 떠나도 적은 글이 남도록, 멈추면 바로 저장해 둔다.
  useEffect(() => {
    if (text.trim() === initial) return
    const timer = setTimeout(save, 600)
    return () => clearTimeout(timer)
    // save는 text만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, initial])
  return (
    <label className="grid gap-1.5 text-sm text-muted">
      참고할 점
      <textarea
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={() => {
          if (text.trim() !== initial) save()
        }}
        rows={3}
        maxLength={AI_PROFILE_NOTES_MAX}
        placeholder="부상이나 피하고 싶은 동작 등 (예: 왼쪽 어깨가 좋지 않아 머리 위로 미는 동작은 피하고 싶어요)"
        className="w-full resize-none rounded-xl border border-line bg-surface p-3 text-[15px] leading-relaxed text-ink outline-none placeholder:text-muted focus:border-accent"
      />
    </label>
  )
}
