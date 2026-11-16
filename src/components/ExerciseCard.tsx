import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AiExerciseSuggestion, SetEntry } from '../db'
import { bodyPartLabel, equipmentLabel } from '../lib/exercises'
import { formatKg } from '../lib/format'
import type { NewRecord, RecordKind } from '../lib/history'
import { applyRecommendation, isRecommendationApplied, type Recommendation } from '../lib/recommend'
import {
  addSet,
  completeSet,
  moveWorkoutExercise,
  removeSet,
  removeWorkoutExercise,
  updateSet,
  type WorkoutItem,
} from '../lib/workouts'
import { Dialog } from './Dialog'
import { CheckIcon, ChevronRightIcon, PlusIcon, SparkleIcon } from './icons'
import { NumberField } from './NumberField'
import { PrBadge } from './PrBadge'
import { SetSheet } from './SetSheet'

interface ExerciseCardProps {
  item: WorkoutItem
  /** active: 운동 중(완료 체크가 있다). history: 지난 기록 수정(모든 세트가 완료 상태). */
  mode: 'active' | 'history'
  /** 이 운동에서 몇 번째 종목인지(0부터)와 종목 수. 위아래로 옮기는 버튼을 켜고 끄는 데 쓴다. */
  index: number
  count: number
  /** 세트를 완료로 표시했을 때 */
  onSetDone?: () => void
  /** 다음 무게 추천. 운동 중에만 보여 준다. 지난 기록이 없거나 추천을 꺼 두었으면 null */
  recommendation?: Recommendation | null
  /** 이 운동에서 새로 세운 기록(findNewRecords). 기록을 세운 세트에 PR 표시를 붙인다. */
  records?: NewRecord[]
  /** AI 추천. 있으면 규칙 추천 대신 보여 준다(AI가 규칙 추천을 보고 정한 값이라 둘을 함께 두지 않는다). */
  aiSuggestion?: AiExerciseSuggestion | null
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

export function ExerciseCard({
  item,
  mode,
  index,
  count,
  onSetDone,
  recommendation,
  records = [],
  aiSuggestion,
}: ExerciseCardProps) {
  const [askRemove, setAskRemove] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const justMoved = useRef(false)
  const { we, exercise, sets, lastSets } = item
  const name = exercise?.name ?? '지워진 종목'
  const labels = setLabels(sets)
  const target = mode === 'active' ? knownTarget(item) : null
  const note = mode === 'active' ? (exercise?.note?.trim() ?? '') : ''
  const columns = mode === 'active' ? 'grid-cols-[3rem_1fr_1fr_3rem]' : 'grid-cols-[3rem_1fr_1fr]'

  // 옮긴 카드가 화면 밖으로 나가면 따라가서, 이어서 더 옮길 수 있게 한다.
  useEffect(() => {
    if (!justMoved.current) return
    justMoved.current = false
    sectionRef.current?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const move = (direction: -1 | 1) => {
    justMoved.current = true
    void moveWorkoutExercise(we.id, direction)
  }

  return (
    <section ref={sectionRef} className="scroll-my-20 rounded-2xl border border-line bg-surface p-3" aria-label={name}>
      <header className="px-1">
        {/* 이름 줄에는 옮기기와 빼기 버튼이 함께 있어서, 긴 이름은 자르지 않고 두 줄까지 보여 준다. */}
        <div className="-mb-1 -mt-1 flex min-h-11 items-center gap-1">
          <h3 className="min-w-0 flex-1 pb-1 text-lg font-bold leading-snug text-ink">
            {exercise ? (
              <Link to={`/exercises/${exercise.id}`} className="line-clamp-2 rounded-md active:opacity-60">
                {name}
                <ChevronRightIcon className="-mt-0.5 ml-0.5 inline size-4 text-muted" />
              </Link>
            ) : (
              <span className="line-clamp-2">{name}</span>
            )}
          </h3>
          <div className="-mr-2 flex shrink-0 items-center">
            {count > 1 && (
              <>
                <MoveButton direction={-1} disabled={index === 0} onClick={() => move(-1)} />
                <MoveButton direction={1} disabled={index === count - 1} onClick={() => move(1)} />
              </>
            )}
            <button
              type="button"
              onClick={() => setAskRemove(true)}
              className="h-11 rounded-lg px-2.5 text-sm text-muted active:bg-surface-2"
            >
              빼기
            </button>
          </div>
        </div>
        {exercise && (
          <p className="text-sm text-muted">
            {bodyPartLabel(exercise.bodyPart)} · {equipmentLabel(exercise.equipment)}
            {target !== null && <> · 목표 {target}회</>}
          </p>
        )}
        {mode === 'active' && lastSets.length > 0 && (
          <p className="mt-0.5 truncate text-sm text-muted">지난번 {lastSets.map(shortSet).join(' · ')}</p>
        )}
        {/* 종목 메모(시트 높이, 그립 등). 여기서는 보기만 하고 종목 상세에서 고친다. */}
        {note !== '' && (
          <p className="mt-1 line-clamp-2 break-words text-sm leading-snug text-ink">
            <span className="mr-1.5 font-semibold text-muted">메모</span>
            {note}
          </p>
        )}
      </header>

      {mode === 'active' &&
        (aiSuggestion ? (
          <RecommendationBar workoutExerciseId={we.id} sets={sets} recommendation={aiSuggestion} variant="ai" />
        ) : (
          recommendation && <RecommendationBar workoutExerciseId={we.id} sets={sets} recommendation={recommendation} />
        ))}

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

      {/* 세트를 지우는 것은 세트 번호를 눌러 여는 창에 있다(어느 세트든 지울 수 있고, 잘못 누르기 어렵다). */}
      <button
        type="button"
        onClick={() => void addSet(we.id, { done: mode === 'history' })}
        className="mt-3 flex h-11 w-full items-center justify-center gap-1 rounded-xl bg-surface-2 text-[15px] font-semibold text-ink active:opacity-70"
      >
        <PlusIcon className="size-4" />
        세트 추가
      </button>

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

interface MoveButtonProps {
  /** -1: 위로, 1: 아래로 */
  direction: -1 | 1
  disabled: boolean
  onClick: () => void
}

/** 종목을 한 칸 위나 아래로 옮기는 화살표 버튼. */
function MoveButton({ direction, disabled, onClick }: MoveButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={direction === -1 ? '위로 옮기기' : '아래로 옮기기'}
      className="flex h-11 w-10 items-center justify-center rounded-lg text-muted active:bg-surface-2 disabled:opacity-30"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="size-5"
      >
        <path d={direction === -1 ? 'M12 19V5M6 11l6-6 6 6' : 'M12 5v14M6 13l6 6 6-6'} />
      </svg>
    </button>
  )
}

interface RecommendationBarProps {
  workoutExerciseId: string
  sets: SetEntry[]
  recommendation: Pick<Recommendation, 'weightKg' | 'reps' | 'reason' | 'fromWeightKg'>
  /** rule: 앱의 규칙 추천, ai: Claude의 추천 */
  variant?: 'rule' | 'ai'
}

/**
 * 다음 무게 추천 한 줄. "적용"을 누르면 아직 완료하지 않은 본 세트에 추천 값을 채운다(자동으로 바꾸지 않는다).
 * 버튼 폭을 고정해서 "적용"과 "적용됨"이 바뀌어도 아래 세트 줄이 움직이지 않게 한다.
 */
function RecommendationBar({ workoutExerciseId, sets, recommendation: rec, variant = 'rule' }: RecommendationBarProps) {
  const applied = isRecommendationApplied(sets, rec)
  const hasPending = sets.some((s) => !s.isDone && !s.isWarmup)
  const value = rec.weightKg === null ? `${rec.reps}회` : `${formatKg(rec.weightKg)}kg × ${rec.reps}`
  const ai = variant === 'ai'

  return (
    <div
      role="group"
      aria-label={ai ? 'AI 추천' : '다음 무게 추천'}
      className="mt-2 flex items-center gap-2 rounded-xl bg-accent-soft py-2 pl-3 pr-2"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug text-ink">
          {ai ? (
            <span className="mr-0.5 inline-flex items-center gap-0.5 font-semibold text-accent">
              <SparkleIcon className="size-4" />
              AI
            </span>
          ) : (
            <span className="font-semibold text-accent">추천</span>
          )}{' '}
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
  const [sheetOpen, setSheetOpen] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const done = mode === 'active' && set.isDone
  const rpe = set.rpe ?? null
  const setName = set.isWarmup ? '웜업 세트' : `${label}세트`

  const openSheet = () => {
    // 키보드가 올라와 있으면 아래에서 뜨는 창을 가리므로 먼저 내린다.
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    setSheetOpen(true)
  }

  // 완료한 세트는 기록이라 한 번 더 묻고, 아직 하지 않은 세트는 바로 지운다.
  const requestDelete = () => {
    setSheetOpen(false)
    if (set.isDone) setAskDelete(true)
    else void removeSet(set.id)
  }

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
        {/* 번호를 누르면 이 세트의 설정 창(웜업, RPE, 삭제)이 열린다. 적어 둔 RPE는 번호 아래에 보인다. */}
        <button
          type="button"
          onClick={openSheet}
          aria-haspopup="dialog"
          aria-label={`${setName} 설정${rpe === null ? '' : `, RPE ${rpe}`}`}
          className={`flex h-12 w-full flex-col items-center justify-center rounded-xl active:opacity-70 ${
            set.isWarmup ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink'
          }`}
        >
          <span className="text-base font-bold leading-5">{label}</span>
          {rpe === null ? (
            <span aria-hidden="true" className="text-[11px] font-bold leading-3 tracking-widest text-muted">
              ···
            </span>
          ) : (
            <span className="text-[11px] font-semibold leading-3 tabular-nums">RPE {rpe}</span>
          )}
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

      <SetSheet
        open={sheetOpen}
        set={set}
        label={label}
        onClose={() => setSheetOpen(false)}
        onDelete={requestDelete}
      />
      <Dialog
        open={askDelete}
        title={`${setName}를 삭제할까요?`}
        onClose={() => setAskDelete(false)}
        actions={[
          { label: '삭제', tone: 'danger', onClick: () => void removeSet(set.id) },
          { label: '취소', onClick: () => setAskDelete(false) },
        ]}
      >
        완료한 세트 기록이 지워집니다.
      </Dialog>
    </div>
  )
}
