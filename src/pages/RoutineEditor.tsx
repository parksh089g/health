import { useLiveQuery } from 'dexie-react-hooks'
import { useLayoutEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Dialog } from '../components/Dialog'
import { ExercisePickerList, PickerAddBar } from '../components/ExercisePickerList'
import { ChevronRightIcon, PlusIcon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import { SupersetFrame } from '../components/SupersetFrame'
import { db, type Exercise, type Routine, type RoutineItem } from '../db'
import { bodyPartLabel, equipmentLabel } from '../lib/exercises'
import { isTimed, targetLabel } from '../lib/measure'
import {
  MISSING_EXERCISE_NAME,
  ROUTINE_DEFAULT_SETS,
  ROUTINE_NAME_MAX,
  ROUTINE_SETS_RANGE,
  createRoutine,
  deleteRoutine,
  getRoutine,
  syncRoutineDraft,
  updateRoutine,
} from '../lib/routines'
import {
  cleanSupersetIds,
  linkSupersetIds,
  moveWithSupersets,
  supersetPositions,
  unlinkSupersetIds,
  withSupersetIds,
} from '../lib/supersets'
import { useGoBack } from '../lib/useGoBack'

/** 루틴 만들기와 고치기. 주소의 id가 new면 새 루틴. */
export default function RoutineEditor() {
  const { id = '' } = useParams()
  const isNew = id === 'new'
  const [deleted, setDeleted] = useState(false)
  const data = useLiveQuery(async () => {
    const routine = isNew ? null : ((await getRoutine(id)) ?? null)
    const exercises = await db.exercises.toArray()
    return { routine, exercises }
  }, [id, isNew])

  if (data === undefined || deleted) return null
  if (!isNew && data.routine === null) return <Navigate to="/routines" replace />

  // 고치는 내용은 RoutineForm 안에 있다. 종목 선택도 같은 화면 안에서 열어서, 고르고 돌아와도 내용이 남는다.
  return <RoutineForm key={id} routine={data.routine} exercises={data.exercises} onDeleted={() => setDeleted(true)} />
}

/** 종목 선택을 열었다는 표시(주소의 ?pick). 휴대폰의 뒤로 가기로도 닫힌다. */
const PICK_PARAM = 'pick'

interface RoutineFormProps {
  /** 새 루틴이면 null */
  routine: Routine | null
  exercises: Exercise[]
  onDeleted: () => void
}

function RoutineForm({ routine, exercises, onDeleted }: RoutineFormProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const goBack = useGoBack('/routines')
  const [name, setName] = useState(routine?.name ?? '')
  const [items, setItems] = useState<RoutineItem[]>(routine?.items ?? [])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [ask, setAsk] = useState<'delete' | 'leave' | null>(null)
  const editorScroll = useRef(0)

  // 종목 선택 안에서 종목을 지우거나 횟수/시간을 바꿨으면 고치던 내용도 거기에 맞춘다.
  const [known, setKnown] = useState(exercises)
  if (known !== exercises) {
    setKnown(exercises)
    const synced = syncRoutineDraft(items, known, exercises)
    if (synced !== items) setItems(synced)
  }

  const picking = searchParams.has(PICK_PARAM)
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const positions = supersetPositions(items)
  const nameOf = (item: RoutineItem) => byId.get(item.exerciseId)?.name ?? MISSING_EXERCISE_NAME
  const dirty =
    name !== (routine?.name ?? '') || JSON.stringify(items) !== JSON.stringify(routine?.items ?? [])

  // 종목 선택은 맨 위에서 열고, 닫으면 보던 자리로 돌아온다.
  useLayoutEffect(() => {
    window.scrollTo(0, picking ? 0 : editorScroll.current)
  }, [picking])

  const openPicker = () => {
    editorScroll.current = window.scrollY
    setSearchParams({ [PICK_PARAM]: '1' }, { state: { fromEditor: true } })
  }

  const closePicker = () => {
    // 이 화면에서 연 것이면 한 단계 뒤로(주소 기록이 쌓이지 않게), 주소로 바로 열었으면 표시만 지운다.
    if ((location.state as { fromEditor?: boolean } | null)?.fromEditor) navigate(-1)
    else setSearchParams({}, { replace: true })
  }

  const addItems = (ids: string[]) => {
    setItems((cur) => {
      const have = new Set(cur.map((item) => item.exerciseId))
      const added = ids
        .filter((exerciseId) => !have.has(exerciseId))
        .map((exerciseId) => ({
          exerciseId,
          sets: ROUTINE_DEFAULT_SETS,
          reps: byId.get(exerciseId)?.targetReps ?? null,
        }))
      return [...cur, ...added]
    })
    setError(null)
    closePicker()
  }

  // 고치면 지난 저장 오류 안내는 지운다.
  const patchItem = (index: number, patch: Partial<RoutineItem>) => {
    setError(null)
    setItems((cur) => cur.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  // 슈퍼세트는 옮기거나 빼도 흐트러지지 않게 한다(규칙은 lib/supersets.ts, 운동 화면과 같다).
  const moveItem = (index: number, by: -1 | 1) => {
    setError(null)
    setItems((cur) => {
      const moved = moveWithSupersets(cur, index, by)
      return moved ? withSupersetIds(moved.items, moved.ids) : cur
    })
  }

  const removeItem = (index: number) => {
    setError(null)
    setItems((cur) => {
      const next = cur.filter((_, i) => i !== index)
      return withSupersetIds(next, cleanSupersetIds(next.map((item) => item.supersetId)))
    })
  }

  /** index번째 종목을 바로 위 종목과 슈퍼세트로 묶거나, 묶여 있으면 푼다. */
  const toggleLink = (index: number) => {
    setError(null)
    setItems((cur) => {
      const ids = cur.map((item) => item.supersetId)
      const linked = cur[index].supersetId != null && cur[index].supersetId === cur[index - 1]?.supersetId
      return withSupersetIds(cur, (linked ? unlinkSupersetIds : linkSupersetIds)(ids, index - 1))
    })
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      if (routine) await updateRoutine(routine.id, { name, items })
      else await createRoutine({ name, items })
      goBack()
    } catch (e) {
      setError(e instanceof Error ? e.message : '루틴을 저장하지 못했습니다.')
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!routine) return
    await deleteRoutine(routine.id)
    goBack()
    onDeleted()
  }

  if (picking) {
    return (
      <RoutinePicker
        exercises={exercises}
        inRoutine={new Set(items.map((item) => item.exerciseId))}
        onClose={closePicker}
        onAdd={addItems}
      />
    )
  }

  return (
    <>
      <PageHeader title={routine ? '루틴 고치기' : '새 루틴'} onBack={() => (dirty ? setAsk('leave') : goBack())} />

      <main className="flex-1 px-3 pb-36 pt-4">
        <label className="grid gap-1.5 px-1 text-sm font-semibold text-muted">
          루틴 이름
          <input
            value={name}
            onChange={(e) => {
              setName(e.currentTarget.value)
              setError(null)
            }}
            maxLength={ROUTINE_NAME_MAX}
            enterKeyHint="done"
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            placeholder="예: 하체 날"
            className="h-12 rounded-xl border border-line bg-surface px-3 text-base font-normal text-ink outline-none placeholder:text-muted focus:border-accent"
          />
        </label>

        <h2 className="mt-6 px-1 font-bold text-ink">
          종목 <span className="font-normal tabular-nums text-muted">{items.length}개</span>
        </h2>

        {items.length === 0 ? (
          <p className="mt-2 rounded-2xl border border-dashed border-line p-5 text-center text-sm leading-relaxed break-keep text-muted">
            아직 넣은 종목이 없습니다.
            <br />
            종목마다 세트 수와 목표 횟수를 정할 수 있습니다.
          </p>
        ) : (
          <ol className="mt-2">
            {items.map((item, i) => (
              <SupersetFrame
                key={item.exerciseId}
                as="li"
                ariaLabel={nameOf(item)}
                position={positions[i]}
                previousName={i > 0 ? nameOf(items[i - 1]) : null}
                name={nameOf(item)}
                hint="마지막 종목 뒤에 쉽니다"
                onToggleLink={() => toggleLink(i)}
              >
                <RoutineItemRow
                  index={i}
                  count={items.length}
                  item={item}
                  exercise={byId.get(item.exerciseId)}
                  onChange={(patch) => patchItem(i, patch)}
                  onMove={(by) => moveItem(i, by)}
                  onRemove={() => removeItem(i)}
                />
              </SupersetFrame>
            ))}
          </ol>
        )}

        <button
          type="button"
          onClick={openPicker}
          className="mt-3 flex h-14 w-full items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line text-base font-bold text-accent active:bg-surface-2"
        >
          <PlusIcon className="size-5" />
          종목 추가
        </button>

        {routine && (
          <button
            type="button"
            onClick={() => setAsk('delete')}
            className="mx-auto mt-8 block px-4 py-3 text-sm text-danger underline underline-offset-4"
          >
            이 루틴 삭제
          </button>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-md border-t border-line bg-bg px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {error && (
          <p role="alert" className="mb-2 text-center text-sm text-danger">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="h-14 w-full rounded-2xl bg-accent text-lg font-bold text-on-accent active:opacity-80 disabled:opacity-40"
        >
          저장
        </button>
      </div>

      <Dialog
        open={ask === 'delete'}
        title="이 루틴을 삭제할까요?"
        onClose={() => setAsk(null)}
        actions={[
          { label: '삭제', tone: 'danger', onClick: () => void remove() },
          { label: '취소', onClick: () => setAsk(null) },
        ]}
      >
        루틴만 지워지고, 이 루틴으로 한 운동 기록은 그대로 남습니다.
      </Dialog>

      <Dialog
        open={ask === 'leave'}
        title="저장하지 않고 나갈까요?"
        onClose={() => setAsk(null)}
        actions={[
          { label: '나가기', tone: 'danger', onClick: goBack },
          { label: '계속 고치기', onClick: () => setAsk(null) },
        ]}
      >
        고친 내용은 저장되지 않습니다.
      </Dialog>
    </>
  )
}

interface RoutineItemRowProps {
  index: number
  count: number
  item: RoutineItem
  exercise: Exercise | undefined
  onChange: (patch: Partial<RoutineItem>) => void
  onMove: (by: -1 | 1) => void
  onRemove: () => void
}

function RoutineItemRow({ index, count, item, exercise, onChange, onMove, onRemove }: RoutineItemRowProps) {
  const name = exercise?.name ?? MISSING_EXERCISE_NAME
  // 루틴 종목에는 목표 칸이 reps 하나뿐이라, 시간 종목이면 그 칸에 목표 시간(초)을 담는다(lib/measure.ts).
  const timed = isTimed(exercise)
  const target = targetLabel(exercise)
  const iconButton =
    'flex size-11 items-center justify-center rounded-xl text-ink active:bg-surface-2 disabled:text-muted disabled:opacity-40'

  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-start gap-2">
        <span className="mt-2.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold tabular-nums text-muted">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1 py-1">
          <h3 className="truncate text-lg font-bold leading-snug text-ink">{name}</h3>
          {exercise ? (
            <p className="text-sm text-muted">
              {bodyPartLabel(exercise.bodyPart)} · {equipmentLabel(exercise.equipment)}
            </p>
          ) : (
            <p className="text-sm text-danger">운동을 시작할 때 건너뜁니다.</p>
          )}
        </div>
        <div className="-mr-1 flex shrink-0 items-center">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label={`${name} 위로`}
            className={iconButton}
          >
            <ChevronRightIcon className="size-5 -rotate-90" />
          </button>
          <button
            type="button"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            aria-label={`${name} 아래로`}
            className={iconButton}
          >
            <ChevronRightIcon className="size-5 rotate-90" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`${name} 빼기`}
            className="h-11 rounded-xl px-2.5 text-sm text-muted active:bg-surface-2"
          >
            빼기
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <p className="mb-1 px-1 text-xs text-muted">세트</p>
          <div className="flex h-12 items-center rounded-xl bg-surface-2" role="group" aria-label={`${name} 세트 수`}>
            <button
              type="button"
              disabled={item.sets <= ROUTINE_SETS_RANGE.min}
              onClick={() => onChange({ sets: item.sets - 1 })}
              aria-label="세트 줄이기"
              className="flex size-12 shrink-0 items-center justify-center rounded-xl text-ink active:bg-line disabled:opacity-30"
            >
              <MinusIcon />
            </button>
            <output className="flex-1 text-center text-lg font-semibold tabular-nums text-ink" aria-live="polite">
              {item.sets}
            </output>
            <button
              type="button"
              disabled={item.sets >= ROUTINE_SETS_RANGE.max}
              onClick={() => onChange({ sets: item.sets + 1 })}
              aria-label="세트 늘리기"
              className="flex size-12 shrink-0 items-center justify-center rounded-xl text-ink active:bg-line disabled:opacity-30"
            >
              <PlusIcon className="size-5" />
            </button>
          </div>
        </div>
        <div>
          <p className="mb-1 px-1 text-xs text-muted">{target}</p>
          <RepsField
            value={item.reps}
            onChange={(reps) => onChange({ reps })}
            ariaLabel={`${name} ${target}`}
            unit={timed ? '초' : '회'}
          />
        </div>
      </div>
    </div>
  )
}

/** 목표 횟수(시간 종목은 목표 시간) 칸. 비워 두면 정하지 않은 것(null). */
function RepsField({
  value,
  onChange,
  ariaLabel,
  unit,
}: {
  value: number | null
  onChange: (value: number | null) => void
  ariaLabel: string
  unit: string
}) {
  return (
    <label className="flex h-12 min-w-0 items-center rounded-xl border border-line bg-bg px-3 focus-within:border-accent">
      <input
        type="text"
        inputMode="numeric"
        enterKeyHint="done"
        autoComplete="off"
        aria-label={ariaLabel}
        placeholder="정하지 않음"
        value={value === null ? '' : String(value)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const raw = e.currentTarget.value
          if (!/^\d{0,3}$/.test(raw)) return
          onChange(raw === '' ? null : Number(raw))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className="w-full min-w-0 bg-transparent text-right text-lg font-semibold tabular-nums text-ink outline-none placeholder:text-base placeholder:font-normal placeholder:text-muted"
      />
      {value !== null && <span className="ml-1 shrink-0 text-sm text-muted">{unit}</span>}
    </label>
  )
}

function MinusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="size-5"
    >
      <path d="M5 12h14" />
    </svg>
  )
}

interface RoutinePickerProps {
  exercises: Exercise[]
  inRoutine: Set<string>
  onClose: () => void
  onAdd: (exerciseIds: string[]) => void
}

/** 루틴에 넣을 종목 고르기. 운동의 종목 선택 화면과 같은 목록을 쓴다. */
function RoutinePicker({ exercises, inRoutine, onClose, onAdd }: RoutinePickerProps) {
  const [selected, setSelected] = useState<string[]>([])
  return (
    <>
      <PageHeader title="종목 선택" onBack={onClose} />
      <main className="flex-1 px-3 pb-28 pt-3">
        <ExercisePickerList
          exercises={exercises}
          addedIds={inRoutine}
          selected={selected}
          onToggle={(exerciseId) =>
            setSelected((cur) => (cur.includes(exerciseId) ? cur.filter((x) => x !== exerciseId) : [...cur, exerciseId]))
          }
          onCustomAdded={(exerciseId) => setSelected((cur) => (cur.includes(exerciseId) ? cur : [...cur, exerciseId]))}
        />
      </main>
      <PickerAddBar count={selected.length} onAdd={() => onAdd(selected)} />
    </>
  )
}
