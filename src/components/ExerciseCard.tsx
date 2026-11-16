import { useRef, useState } from 'react'
import type { SetEntry } from '../db'
import { bodyPartLabel, equipmentLabel } from '../lib/exercises'
import { formatKg } from '../lib/format'
import {
  addSet,
  completeSet,
  removeLastSet,
  removeWorkoutExercise,
  updateSet,
  type WorkoutItem,
} from '../lib/workouts'
import { Dialog } from './Dialog'
import { CheckIcon, PlusIcon } from './icons'
import { NumberField } from './NumberField'

interface ExerciseCardProps {
  item: WorkoutItem
  /** active: 운동 중(완료 체크가 있다). history: 지난 기록 수정(모든 세트가 완료 상태). */
  mode: 'active' | 'history'
  /** 세트를 완료로 표시했을 때 */
  onSetDone?: () => void
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

export function ExerciseCard({ item, mode, onSetDone }: ExerciseCardProps) {
  const [askRemove, setAskRemove] = useState(false)
  const { we, exercise, sets, lastSets } = item
  const name = exercise?.name ?? '지워진 종목'
  const labels = setLabels(sets)
  const columns = mode === 'active' ? 'grid-cols-[2.75rem_1fr_1fr_3rem]' : 'grid-cols-[2.75rem_1fr_1fr]'

  return (
    <section className="rounded-2xl border border-line bg-surface p-3" aria-label={name}>
      <header className="flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-ink">{name}</h3>
          {exercise && (
            <p className="text-sm text-muted">
              {bodyPartLabel(exercise.bodyPart)} · {equipmentLabel(exercise.equipment)}
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

      <div className="mt-2 grid gap-2">
        <div className={`grid ${columns} gap-2 text-center text-xs text-muted`}>
          <span>세트</span>
          <span>무게</span>
          <span>횟수</span>
          {mode === 'active' && <span>완료</span>}
        </div>
        {sets.map((set, i) => (
          <SetRow key={set.id} set={set} label={labels[i]} mode={mode} columns={columns} onDone={onSetDone} />
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

interface SetRowProps {
  set: SetEntry
  label: string
  mode: 'active' | 'history'
  columns: string
  onDone?: () => void
}

function SetRow({ set, label, mode, columns, onDone }: SetRowProps) {
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
      <button
        type="button"
        onClick={() => void updateSet(set.id, { isWarmup: !set.isWarmup })}
        aria-label={set.isWarmup ? '웜업 세트. 누르면 본 세트로 바꿉니다.' : `${label}세트. 누르면 웜업으로 바꿉니다.`}
        className={`h-12 rounded-xl text-base font-bold active:opacity-70 ${
          set.isWarmup ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink'
        }`}
      >
        {label}
      </button>
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
