import { useId, useState } from 'react'
import type { BodyPart, Equipment } from '../db'
import {
  BODY_PARTS,
  CARDIO_LOCKED_MESSAGE,
  EQUIPMENT,
  EXERCISE_NAME_MAX,
  MEASURE_LOCKED_MESSAGE,
  type ExerciseInput,
} from '../lib/exercises'
import { CARDIO_METRICS, MEASURES, type CardioMetric, type Measure } from '../lib/measure'

interface ExerciseFormProps {
  title: string
  submitLabel: string
  initial: ExerciseInput
  /** 저장한다. 오류를 던지면 그 글을 폼에 보여 준다. */
  onSubmit: (input: ExerciseInput) => Promise<void>
  onCancel: () => void
  /** 바깥 카드 안에 넣을 때는 테두리 없이 그린다. */
  bare?: boolean
  /** 기록이 있는 종목을 고칠 때. 기록 방식(유산소에서 함께 적는 값 포함)을 바꾸지 못하게 잠그고 까닭을 보여 준다. */
  measureLocked?: boolean
}

/** 기록 방식마다 그 아래에 보여 주는 한 줄 설명 */
const MEASURE_HINTS: Record<Measure, string> = {
  reps: '세트마다 횟수를 적습니다.',
  time: '플랭크처럼 버틴 시간(초)을 세트마다 적습니다.',
  cardio: '러닝머신이나 스텝밀처럼 운동한 시간(분)을 적습니다. 무게와 횟수는 적지 않습니다.',
}

/**
 * 종목의 이름, 부위, 기구, 재는 방법(횟수/시간/유산소)을 적는 폼. 내 종목을 추가할 때와 고칠 때 함께 쓴다.
 * 유산소를 고르면 부위도 유산소로 맞추고, 시간과 함께 적을 값(거리/층수/시간만)을 고르게 한다.
 */
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
  // 부위를 유산소로 두고 연 폼(종목 선택에서 유산소만 보다가 추가할 때)은 유산소부터 고른 채로 시작한다.
  const [measure, setMeasure] = useState<Measure>(initial.measure ?? (initial.bodyPart === 'cardio' ? 'cardio' : 'reps'))
  // 그때 기구가 처음 값(바벨) 그대로면 유산소를 고를 때처럼 머신으로 바꿔 둔다.
  const [equipment, setEquipment] = useState<Equipment>(
    initial.measure === undefined && initial.bodyPart === 'cardio' && initial.equipment === 'barbell'
      ? 'machine'
      : initial.equipment,
  )
  const [cardioMetric, setCardioMetric] = useState<CardioMetric | null>(
    initial.cardioMetric === undefined ? 'distance' : initial.cardioMetric,
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const measureLabelId = useId()
  const metricLabelId = useId()
  // 이미 유산소인 종목을 고치는데 함께 적는 값을 넘겨받지 못했으면, 고를 수 없게 하고 저장할 때도 그대로 둔다.
  const metricKnown = initial.measure !== 'cardio' || initial.cardioMetric !== undefined

  const pickMeasure = (next: Measure) => {
    setMeasure(next)
    if (next !== 'cardio') return
    // 유산소 종목은 부위도 유산소로 둔다. 기구가 처음 값(바벨) 그대로면 머신으로 바꿔 둔다.
    setBodyPart('cardio')
    if (equipment === 'barbell') setEquipment('machine')
  }

  const pickBodyPart = (next: BodyPart) => {
    setBodyPart(next)
    if (next === 'cardio' && measure !== 'cardio' && !measureLocked) pickMeasure('cardio')
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      const input: ExerciseInput = { name, bodyPart, equipment, measure }
      if (measure === 'cardio' && metricKnown) input.cardioMetric = cardioMetric
      await onSubmit(input)
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
          onChange={(e) => pickBodyPart(e.currentTarget.value as BodyPart)}
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
        <div role="group" aria-labelledby={measureLabelId} className="grid grid-cols-3 gap-2">
          {MEASURES.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={measure === m.key}
              disabled={measureLocked && measure !== m.key}
              onClick={() => pickMeasure(m.key)}
              className={`h-12 rounded-xl text-base font-semibold active:opacity-70 disabled:opacity-40 ${
                measure === m.key ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="break-keep text-xs leading-relaxed">
          {measureLocked
            ? measure === 'cardio'
              ? CARDIO_LOCKED_MESSAGE
              : MEASURE_LOCKED_MESSAGE
            : MEASURE_HINTS[measure]}
        </p>
      </div>
      {measure === 'cardio' && metricKnown && (
        <div className="grid gap-1 text-sm text-muted">
          <span id={metricLabelId}>시간과 함께 적을 값</span>
          <div role="group" aria-labelledby={metricLabelId} className="grid grid-cols-3 gap-2">
            {CARDIO_METRICS.map((m) => {
              const value = m.key === 'none' ? null : m.key
              return (
                <button
                  key={m.key}
                  type="button"
                  aria-pressed={cardioMetric === value}
                  disabled={measureLocked && cardioMetric !== value}
                  onClick={() => setCardioMetric(value)}
                  className={`h-12 rounded-xl text-base font-semibold active:opacity-70 disabled:opacity-40 ${
                    cardioMetric === value ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink'
                  }`}
                >
                  {m.label}
                </button>
              )
            })}
          </div>
          {!measureLocked && (
            <p className="break-keep text-xs leading-relaxed">
              {cardioMetric === 'floors'
                ? '스텝밀처럼 오른 층수를 함께 적습니다.'
                : cardioMetric === 'distance'
                  ? '달린 거리(km)를 함께 적습니다.'
                  : '줄넘기처럼 시간만 적습니다.'}
            </p>
          )}
        </div>
      )}
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
