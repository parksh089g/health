import { useId, useState } from 'react'
import type { BodyPart, Equipment } from '../db'
import {
  BODY_PARTS,
  EQUIPMENT,
  EXERCISE_NAME_MAX,
  MEASURE_LOCKED_MESSAGE,
  type ExerciseInput,
} from '../lib/exercises'
import { MEASURES, type Measure } from '../lib/measure'

interface ExerciseFormProps {
  title: string
  submitLabel: string
  initial: ExerciseInput
  /** 저장한다. 오류를 던지면 그 글을 폼에 보여 준다. */
  onSubmit: (input: ExerciseInput) => Promise<void>
  onCancel: () => void
  /** 바깥 카드 안에 넣을 때는 테두리 없이 그린다. */
  bare?: boolean
  /** 기록이 있는 종목을 고칠 때. 횟수와 시간을 바꾸지 못하게 잠그고 까닭을 보여 준다. */
  measureLocked?: boolean
}

/** 종목의 이름, 부위, 기구, 재는 방법(횟수/시간)을 적는 폼. 내 종목을 추가할 때와 고칠 때 함께 쓴다. */
export function ExerciseForm({
  title,
  submitLabel,
  initial,
  onSubmit,
  onCancel,
  bare = false,
  measureLocked = false,
}: ExerciseFormProps) {
  const [name, setName] = useState(initial.name)
  const [bodyPart, setBodyPart] = useState<BodyPart>(initial.bodyPart)
  const [equipment, setEquipment] = useState<Equipment>(initial.equipment)
  const [measure, setMeasure] = useState<Measure>(initial.measure ?? 'reps')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const measureLabelId = useId()

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onSubmit({ name, bodyPart, equipment, measure })
    } catch (e) {
      setError(e instanceof Error ? e.message : '종목을 저장하지 못했습니다.')
      setBusy(false)
    }
  }

  return (
    <form
      className={`grid gap-3 ${bare ? '' : 'rounded-2xl border border-line bg-surface p-4'}`}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h2 className="font-bold text-ink">{title}</h2>
      <label className="grid gap-1 text-sm text-muted">
        이름
        <input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          maxLength={EXERCISE_NAME_MAX}
          placeholder="예: 스미스 머신 스쿼트"
          className="h-12 rounded-xl border border-line bg-bg px-3 text-ink outline-none focus:border-accent"
        />
      </label>
      <label className="grid gap-1 text-sm text-muted">
        부위
        <select
          value={bodyPart}
          onChange={(e) => setBodyPart(e.currentTarget.value as BodyPart)}
          className="h-12 rounded-xl border border-line bg-bg px-3 text-ink outline-none focus:border-accent"
        >
          {BODY_PARTS.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm text-muted">
        기구
        <select
          value={equipment}
          onChange={(e) => setEquipment(e.currentTarget.value as Equipment)}
          className="h-12 rounded-xl border border-line bg-bg px-3 text-ink outline-none focus:border-accent"
        >
          {EQUIPMENT.map((q) => (
            <option key={q.key} value={q.key}>
              {q.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-1 text-sm text-muted">
        <span id={measureLabelId}>기록 방식</span>
        <div role="group" aria-labelledby={measureLabelId} className="grid grid-cols-2 gap-2">
          {MEASURES.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={measure === m.key}
              disabled={measureLocked && measure !== m.key}
              onClick={() => setMeasure(m.key)}
              className={`h-12 rounded-xl text-base font-semibold active:opacity-70 disabled:opacity-40 ${
                measure === m.key ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs leading-relaxed">
          {measureLocked
            ? MEASURE_LOCKED_MESSAGE
            : measure === 'time'
              ? '플랭크처럼 버틴 시간(초)을 세트마다 적습니다.'
              : '세트마다 횟수를 적습니다.'}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="h-12 flex-1 rounded-xl bg-accent font-bold text-on-accent active:opacity-80 disabled:opacity-60"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-12 rounded-xl bg-surface-2 px-5 font-semibold text-ink active:opacity-70"
        >
          취소
        </button>
      </div>
    </form>
  )
}
