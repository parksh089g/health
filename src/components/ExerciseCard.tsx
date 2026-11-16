import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { SetEntry } from '../db'
import { bodyPartLabel, equipmentLabel } from '../lib/exercises'
import { formatKg } from '../lib/format'
import type { NewRecord, RecordKind } from '../lib/history'
import { applyRecommendation, isRecommendationApplied, type Recommendation } from '../lib/recommend'
import {
  addSet,
  completeSet,
  removeLastSet,
  removeWorkoutExercise,
  updateSet,
  type WorkoutItem,
} from '../lib/workouts'
import { Dialog } from './Dialog'
import { CheckIcon, ChevronRightIcon, PlusIcon } from './icons'
import { NumberField } from './NumberField'
import { PrBadge } from './PrBadge'

interface ExerciseCardProps {
  item: WorkoutItem
  /** active: 운동 중(완료 체크가 있다). history: 지난 기록 수정(모든 세트가 완료 상태). */
  mode: 'active' | 'history'
  /** 세트를 완료로 표시했을 때 */
  onSetDone?: () => void
  /** 다음 무게 추천. 운동 중에만 보여 준다. 지난 기록이 없거나 추천을 꺼 두었으면 null */
  recommendation?: Recommendation | null
  /** 이 운동에서 새로 세운 기록(findNewRecords). 기록을 세운 세트에 PR 표시를 붙인다. */
  records?: NewRecord[]
}

/** "60×8" 또는 무게가 없으면 "8회" */
function shortSet(s: Pick<SetEntry, 'weightKg' | 'reps'>): string {
  const reps = s.reps ?? 0
  return s.weightKg ? `${formatKg(s.weightKg)}×${reps}` : `${reps}회`
}

/** 웜업은 W, 본 세트는 1부터 센다. */
function setLabels(sets: SetEntry[]): string[] {
  let n = 0
  return sets.map((s) => (s.isWarmup ? 'W' : String(++n)))
}

/** 목표 횟수로 보여 줄 값. 이 운동의 목표(루틴) → 종목의 목표. 없으면 null */
function knownTarget(item: WorkoutItem): number | null {
  const v = item.we.targetReps ?? item.exercise?.targetReps
  return typeof v === 'number' && v > 0 ? v : null
}

export function ExerciseCard({ item, mode, onSetDone, recommendation, records = [] }: ExerciseCardProps) {
  const [askRemove, setAskRemove] = useState(false)
  const { we, exercise, sets, lastSets } = item
  const name = exercise?.name ?? '지워진 종목'
  const labels = setLabels(sets)
  const target = mode === 'active' ? knownTarget(item) : null
  const columns = mode === 'active' ? 'grid-cols-[2.75rem_1fr_1fr_3rem]' : 'grid-cols-[2.75rem_1fr_1fr]'

  return (
    <section className="rounded-2xl border border-line bg-surface p-3" aria-label={name}>
      <header className="flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-ink">
            {exercise ? (
              <Link
                to={`/exercises/${exercise.id}`}
                className="inline-flex max-w-full items-center gap-0.5 rounded-md active:opacity-60"
              >
                <span className="truncate">{name}</span>
                <ChevronRightIcon className="size-4 shrink-0 text-muted" />
              </Link>
            ) : (
              <span className="block truncate">{name}</span>
            )}
          </h3>
          {exercise && (
            <p className="text-sm text-muted">
              {bodyPartLabel(exercise.bodyPart)} · {equipmentLabel(exercise.equipment)}
              {target !== null && <> · 목표 {target}회</>}
            </p>
          )}
          {mode === 'active' && lastSets.length > 0 && (
            <p className="mt-0.5 truncate text-sm text-muted">지난번 {lastSets.map(shortSet).join(' · ')}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setAskRemove(true)}
          className="-mr-1 shrink-0 rounded-lg px-3 py-2 text-sm text-muted active:bg-surface-2"
        >
          빼기
        </button>
      </header>

      {mode === 'active' && recommendation && (
        <RecommendationBar workoutExerciseId={we.id} sets={sets} recommendation={recommendation} />
      )}

      <div className="mt-2 grid gap-2">
        <div className={`grid ${columns} gap-2 text-center text-xs text-muted`}>
          <span>세트</span>
          <span>무게</span>
          <span>횟수</span>
          {mode === 'active' && <span>완료</span>}
        </div>
        {sets.map((set, i) => (
          <SetRow
            key={set.id}
            set={set}
            label={labels[i]}
            mode={mode}
            columns={columns}
            onDone={onSetDone}
            recordKinds={records.filter((r) => r.setId === set.id).map((r) => r.kind)}
          />
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void addSet(we.id, { done: mode === 'history' })}
          className="flex h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-surface-2 text-[15px] font-semibold text-ink active:opacity-70"
        >
          <PlusIcon className="size-4" />
          세트 추가
        </button>
        <button
          type="button"
          disabled={sets.length === 0}
          onClick={() => void removeLastSet(we.id)}
          className="h-11 rounded-xl bg-surface-2 px-4 text-[15px] font-medium text-muted active:opacity-70 disabled:opacity-40"
        >
          세트 삭제
        </button>
      </div>

      <Dialog
        open={askRemove}
        title={`${name} 빼기`}
        onClose={() => setAskRemove(false)}
        actions={[
          { label: '빼기', tone: 'danger', onClick: () => void removeWorkoutExercise(we.id) },
          { label: '취소', onClick: () => setAskRemove(false) },
        ]}
      >
        이 종목과 입력한 세트가 이 운동에서 지워집니다.
      </Dialog>
    </section>
  )
}

interface RecommendationBarProps {
  workoutExerciseId: string
  sets: SetEntry[]
  recommendation: Recommendation
}

/**
 * 다음 무게 추천 한 줄. "적용"을 누르면 아직 완료하지 않은 본 세트에 추천 값을 채운다(자동으로 바꾸지 않는다).
 * 버튼 폭을 고정해서 "적용"과 "적용됨"이 바뀌어도 아래 세트 줄이 움직이지 않게 한다.
 */
function RecommendationBar({ workoutExerciseId, sets, recommendation: rec }: RecommendationBarProps) {
  const applied = isRecommendationApplied(sets, rec)
  const hasPending = sets.some((s) => !s.isDone && !s.isWarmup)
  const value = rec.weightKg === null ? `${rec.reps}회` : `${formatKg(rec.weightKg)}kg × ${rec.reps}`

  return (
    <div
      role="group"
      aria-label="다음 무게 추천"
      className="mt-2 flex items-center gap-2 rounded-xl bg-accent-soft py-2 pl-3 pr-2"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug text-ink">
          <span className="font-semibold text-accent">추천</span>{' '}
          <strong className="font-bold tabular-nums">{value}</strong>
        </p>
        <p className="mt-0.5 break-keep text-sm leading-snug text-muted">{rec.reason}</p>
      </div>
      <button
        type="button"
        disabled={applied || !hasPending}
        onClick={() => void applyRecommendation(workoutExerciseId, rec)}
        aria-label={applied ? '추천 적용됨' : `추천 ${value} 적용`}
        className={`flex h-11 w-[4.75rem] shrink-0 items-center justify-center gap-0.5 rounded-lg text-[15px] font-bold ${
          applied ? 'text-accent' : 'bg-accent text-on-accent active:opacity-80 disabled:opacity-40'
        }`}
      >
        {applied && <CheckIcon className="size-4" />}
        {applied ? '적용됨' : '적용'}
      </button>
    </div>
  )
}

interface SetRowProps {
  set: SetEntry
  label: string
  mode: 'active' | 'history'
  columns: string
  onDone?: () => void
  /** 이 세트로 새로 세운 기록의 종류. 비어 있으면 PR 표시가 없다. */
  recordKinds: RecordKind[]
}

function SetRow({ set, label, mode, columns, onDone, recordKinds }: SetRowProps) {
  const repsRef = useRef<HTMLInputElement>(null)
  const done = mode === 'active' && set.isDone

  /** 완료로 바뀐 뒤: 휴식 타이머가 가려지지 않게 키보드를 내리고 바깥에 알린다. */
  const afterDone = () => {
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    onDone?.()
  }

  const toggleDone = () => {
    if (set.isDone) {
      void updateSet(set.id, { isDone: false })
      return
    }
    if ((set.reps ?? 0) > 0) {
      void updateSet(set.id, { isDone: true })
      afterDone()
      return
    }
    // 횟수가 없으면 완료로 표시하지 않고 횟수 칸으로 보낸다.
    repsRef.current?.focus()
    // 다만 방금 친 횟수가 아직 화면까지 돌아오지 않았을 수 있으니, 저장된 값으로 한 번 더 확인한다.
    void completeSet(set.id).then((ok) => {
      if (ok) afterDone()
    })
  }

  const changeReps = (reps: number | null) => {
    // 운동 중에 횟수를 지우면 완료 표시도 함께 푼다.
    const clearsDone = mode === 'active' && set.isDone && (reps ?? 0) <= 0
    void updateSet(set.id, clearsDone ? { reps, isDone: false } : { reps })
  }

  return (
    <div className={`grid ${columns} items-center gap-2`}>
      <div className="relative">
        <button
          type="button"
          onClick={() => void updateSet(set.id, { isWarmup: !set.isWarmup })}
          aria-label={set.isWarmup ? '웜업 세트. 누르면 본 세트로 바꿉니다.' : `${label}세트. 누르면 웜업으로 바꿉니다.`}
          className={`h-12 w-full rounded-xl text-base font-bold active:opacity-70 ${
            set.isWarmup ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink'
          }`}
        >
          {label}
        </button>
        {/* 자리를 차지하지 않게 겹쳐 그려서, 표시가 생기거나 사라져도 세트 줄이 움직이지 않는다. */}
        {recordKinds.length > 0 && (
          <PrBadge kinds={recordKinds} className="pointer-events-none absolute -right-1.5 -top-1.5 shadow-sm" />
        )}
      </div>
      <NumberField
        decimal
        unit="kg"
        ariaLabel={`${label}세트 무게`}
        value={set.weightKg}
        onChange={(weightKg) => void updateSet(set.id, { weightKg })}
        dimmed={done}
      />
      <NumberField
        unit="회"
        ariaLabel={`${label}세트 횟수`}
        value={set.reps}
        onChange={changeReps}
        inputRef={repsRef}
        dimmed={done}
      />
      {mode === 'active' && (
        <button
          type="button"
          onClick={toggleDone}
          aria-pressed={set.isDone}
          aria-label={`${label}세트 완료`}
          className={`flex size-12 items-center justify-center rounded-full border-2 active:scale-95 ${
            set.isDone ? 'border-good bg-good text-white' : 'border-line bg-bg text-muted'
          }`}
        >
          <CheckIcon className="size-6" />
        </button>
      )}
    </div>
  )
}
