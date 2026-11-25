import { useState } from 'react'
import type { BodyWeight } from '../db'
import {
  BODY_WEIGHT_DRAFT,
  BODY_WEIGHT_RANGE,
  bodyFatPercent,
  bodyWeightDateError,
  bodyWeightError,
  compositionError,
  hasComposition,
  deleteBodyWeight,
  entryTime,
  parseBodyWeight,
  saveBodyWeight,
} from '../lib/bodyWeight'
import { formatKg, toDateKey } from '../lib/format'
import { formatMonthDay } from '../lib/stats'
import { Dialog, type DialogAction } from './Dialog'

interface BodyWeightDialogProps {
  /** 모든 체중 기록, 오래된 날짜부터. 그날의 기록과 미리 채울 값을 찾는 데 쓴다. */
  entries: BodyWeight[]
  /** 적을 날짜(YYYY-MM-DD) */
  date: string
  /** 날짜를 고를 수 있게 할지. 지난 날짜의 기록을 더할 때 켠다. */
  pickDate?: boolean
  onClose: () => void
}

/**
 * 체중 하나를 적거나 고치는 창. 열 때마다 새로 그려야 하므로(입력하던 값이 남지 않게) 열려 있을 때만 그린다.
 * 그날 기록이 없으면 가장 가까운 지난 기록을 미리 채워 두어, 조금만 고쳐서 바로 저장할 수 있다.
 */
export function BodyWeightDialog({ entries, date: initialDate, pickDate = false, onClose }: BodyWeightDialogProps) {
  const [date, setDate] = useState(initialDate)
  // null이면 아직 손대지 않은 것. 그동안은 고른 날짜에 맞는 값을 보여 준다.
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 체성분 입력 칸. null이면 아직 손대지 않은 것(그날 적어 둔 값을 보여 준다).
  const [muscleDraft, setMuscleDraft] = useState<string | null>(null)
  const [fatDraft, setFatDraft] = useState<string | null>(null)

  const [today] = useState(() => toDateKey(Date.now()))
  const existing = entries.find((e) => e.date === date) ?? null
  // 그날보다 앞선 가장 최근 기록. 없으면 그 뒤의 첫 기록.
  const nearby = existing ?? entries.findLast((e) => e.date < date) ?? entries.find((e) => e.date > date) ?? null
  const text = draft ?? (nearby ? formatKg(nearby.weightKg) : '')
  const value = parseBodyWeight(text)
  // 체성분은 그날 적어 둔 값만 채운다(다른 날의 측정값이 오늘 것처럼 남지 않게).
  const muscleText = muscleDraft ?? (existing?.muscleKg ? formatKg(existing.muscleKg) : '')
  const fatText = fatDraft ?? (existing?.bodyFatKg ? formatKg(existing.bodyFatKg) : '')
  const composition = { muscleKg: parseBodyWeight(muscleText), bodyFatKg: parseBodyWeight(fatText) }
  const fatPercent = value !== null ? bodyFatPercent({ weightKg: value, bodyFatKg: composition.bodyFatKg }) : null
  const [showComposition, setShowComposition] = useState(() => {
    const first = entries.find((e) => e.date === initialDate)
    return first ? hasComposition(first) : false
  })

  const changeComposition = (raw: string, set: (v: string) => void) => {
    const next = raw.replace(',', '.')
    if (!BODY_WEIGHT_DRAFT.test(next)) return
    set(next)
    setError(null)
  }

  const change = (raw: string) => {
    const next = raw.replace(',', '.')
    if (!BODY_WEIGHT_DRAFT.test(next)) return
    setDraft(next)
    setError(null)
  }

  const step = (delta: number) => {
    if (value === null) return
    const next = Math.round((value + delta) * 10) / 10
    setDraft(formatKg(Math.min(BODY_WEIGHT_RANGE.max, Math.max(BODY_WEIGHT_RANGE.min, next))))
    setError(null)
  }

  const save = async () => {
    if (busy) return
    const problem = bodyWeightDateError(date) ?? bodyWeightError(value)
    if (problem !== null || value === null) {
      setError(problem)
      return
    }
    // 숫자가 아닌 글이 남아 있으면(예: ".") 빈 칸으로 보지 않고 알린다.
    if ((muscleText.trim() !== '' && composition.muscleKg === null) || (fatText.trim() !== '' && composition.bodyFatKg === null)) {
      setError('체성분은 숫자로 적어 주세요.')
      return
    }
    const compProblem = compositionError(value, composition)
    if (compProblem !== null) {
      setError(compProblem)
      setShowComposition(true)
      return
    }
    setBusy(true)
    try {
      await saveBodyWeight(date, value, undefined, composition)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.')
      setBusy(false)
    }
  }

  const remove = async () => {
    if (busy) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy(true)
    try {
      await deleteBodyWeight(date)
      onClose()
    } catch {
      setError('지우지 못했습니다.')
      setBusy(false)
    }
  }

  const dayName = date === today ? '오늘' : formatMonthDay(entryTime({ date }))
  const actions: DialogAction[] = [{ label: '저장', tone: 'primary', onClick: () => void save() }]
  if (existing && !pickDate) {
    actions.push({
      label: confirmDelete ? '한 번 더 누르면 지워집니다' : '이 기록 지우기',
      tone: confirmDelete ? 'danger' : 'plain',
      onClick: () => void remove(),
    })
  }
  actions.push({ label: '취소', onClick: onClose })

  return (
    <Dialog open title={pickDate ? '체중 기록 추가' : `${dayName} 체중`} onClose={onClose} actions={actions}>
      {pickDate && (
        <label className="mb-3 grid gap-1 text-sm font-semibold">
          날짜
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => {
              setDate(e.currentTarget.value)
              setMuscleDraft(null)
              setFatDraft(null)
              setError(null)
              setConfirmDelete(false)
            }}
            className="h-12 w-full min-w-0 rounded-xl border border-line bg-bg px-3 text-base font-normal text-ink outline-none focus:border-accent"
          />
        </label>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => step(-0.1)}
          disabled={value === null}
          aria-label="0.1kg 내리기"
          className="h-14 w-14 shrink-0 rounded-xl bg-surface-2 text-base font-semibold tabular-nums text-ink active:opacity-70 disabled:opacity-40"
        >
          −0.1
        </button>
        <label className="flex h-14 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border border-line bg-bg px-3 focus-within:border-accent">
          <input
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            aria-label="체중"
            aria-invalid={error !== null}
            placeholder="0.0"
            value={text}
            autoFocus={nearby === null && !pickDate}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => change(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
            }}
            className="w-full min-w-0 bg-transparent text-right text-2xl font-bold tabular-nums text-ink outline-none placeholder:text-muted/60"
          />
          <span className="shrink-0 text-base text-muted">kg</span>
        </label>
        <button
          type="button"
          onClick={() => step(0.1)}
          disabled={value === null}
          aria-label="0.1kg 올리기"
          className="h-14 w-14 shrink-0 rounded-xl bg-surface-2 text-base font-semibold tabular-nums text-ink active:opacity-70 disabled:opacity-40"
        >
          +0.1
        </button>
      </div>


      {showComposition ? (
        <fieldset className="mt-3">
          <legend className="text-sm font-semibold text-ink">체성분 (선택)</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <CompositionField
              label="골격근량"
              value={muscleText}
              onChange={(v) => changeComposition(v, setMuscleDraft)}
              onEnter={() => void save()}
            />
            <CompositionField
              label="체지방량"
              value={fatText}
              onChange={(v) => changeComposition(v, setFatDraft)}
              onEnter={() => void save()}
            />
          </div>
          <p className="mt-1 break-keep text-xs text-muted">
            {fatPercent !== null ? `체지방률 ${formatKg(fatPercent)}% · ` : ''}인바디 같은 측정 결과를 적어 두면 AI가 함께 봅니다.
          </p>
        </fieldset>
      ) : (
        <button
          type="button"
          onClick={() => setShowComposition(true)}
          className="mt-3 h-11 w-full rounded-xl border border-dashed border-line text-sm font-semibold text-accent active:opacity-70"
        >
          골격근량, 체지방량도 적기
        </button>
      )}

      {error !== null ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : (
        <p className="mt-2 break-keep text-sm text-muted">
          {existing
            ? pickDate
              ? `이날 기록(${formatKg(existing.weightKg)}kg)이 있습니다. 저장하면 바뀝니다.`
              : '고친 뒤 저장을 눌러 주세요.'
            : nearby
              ? `${formatMonthDay(entryTime(nearby))} 기록(${formatKg(nearby.weightKg)}kg)을 채워 두었습니다.`
              : '소수 첫째 자리까지 적을 수 있습니다.'}
        </p>
      )}
    </Dialog>
  )
}

function CompositionField({
  label,
  value,
  onChange,
  onEnter,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onEnter: () => void
}) {
  return (
    <label className="flex h-12 min-w-0 items-center gap-1 rounded-xl border border-line bg-bg px-3 focus-within:border-accent">
      <span className="shrink-0 text-sm text-muted">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        aria-label={`${label}(kg)`}
        placeholder="—"
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter()
        }}
        className="w-full min-w-0 bg-transparent text-right text-lg font-bold tabular-nums text-ink outline-none placeholder:text-muted/60"
      />
      <span className="shrink-0 text-sm text-muted">kg</span>
    </label>
  )
}
