import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AiExerciseSuggestion, SetEntry } from '../db'
import { bodyPartLabel, equipmentLabel } from '../lib/exercises'
import { recordLabel, type NewRecord } from '../lib/history'
import { formatSetShort, formatTarget, isTimed, usesAddedWeight } from '../lib/measure'
import type { Recommendation } from '../lib/recommend'
import { addSet, moveWorkoutExercise, removeWorkoutExercise, type WorkoutItem } from '../lib/workouts'
import { CardTools } from './CardTools'
import { Dialog } from './Dialog'
import { ChevronRightIcon, PlusIcon } from './icons'
import { RecommendationBar } from './RecommendationBar'
import { SetRow } from './SetRow'
import { setRowColumns } from './setRowColumns'
import { SupersetControl } from './SupersetControl'

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

/** 웜업은 W, 본 세트는 1부터 센다. */
function setLabels(sets: SetEntry[]): string[] {
  let n = 0
  return sets.map((s) => (s.isWarmup ? 'W' : String(++n)))
}

/** 목표 횟수(시간 종목은 목표 시간)로 보여 줄 값. 이 운동의 목표(루틴) → 종목의 목표. 없으면 null */
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
  // 시간 종목은 횟수 대신 버틴 시간(초)을 적고, 맨몸 종목의 무게는 몸에 더한 무게다(비우면 맨몸).
  const timed = isTimed(exercise)
  const addedWeight = usesAddedWeight(exercise)
  const columns = setRowColumns(mode)

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
            <SupersetControl item={item} mode={mode} index={index} count={count} />
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
            {target !== null && <> · 목표 {formatTarget(exercise, target)}</>}
          </p>
        )}
        {mode === 'active' && lastSets.length > 0 && (
          <p className="mt-0.5 truncate text-sm text-muted">
            지난번 {lastSets.map((s) => formatSetShort(s, { addedWeight })).join(' · ')}
          </p>
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
          <RecommendationBar
            workoutExerciseId={we.id}
            sets={sets}
            recommendation={aiSuggestion}
            addedWeight={addedWeight}
            variant="ai"
          />
        ) : (
          recommendation && (
            <RecommendationBar
              workoutExerciseId={we.id}
              sets={sets}
              recommendation={recommendation}
              addedWeight={addedWeight}
            />
          )
        ))}

      <div className="mt-2 grid gap-2">
        <div className={`grid ${columns} gap-2 text-center text-xs text-muted`}>
          <span>세트</span>
          <span>{addedWeight ? '추가 무게' : '무게'}</span>
          <span>{timed ? '시간' : '횟수'}</span>
          {mode === 'active' && <span>완료</span>}
        </div>
        {sets.map((set, i) => (
          <SetRow
            key={set.id}
            set={set}
            label={labels[i]}
            mode={mode}
            columns={columns}
            timed={timed}
            addedWeight={addedWeight}
            onDone={onSetDone}
            recordLabels={records.filter((r) => r.setId === set.id).map((r) => recordLabel(r.kind, exercise))}
          />
        ))}
      </div>

      {/* 세트를 지우는 것은 세트 번호를 눌러 여는 창에 있다(어느 세트든 지울 수 있고, 잘못 누르기 어렵다). */}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void addSet(we.id, { done: mode === 'history' })}
          className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl bg-surface-2 text-[15px] font-semibold text-ink active:opacity-70"
        >
          <PlusIcon className="size-4" />
          세트 추가
        </button>
        {/* 웜업 세트 만들기, 원판 계산 같은 도구 버튼이 들어가는 자리 */}
        <CardTools item={item} mode={mode} />
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
