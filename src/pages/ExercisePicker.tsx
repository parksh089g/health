import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { CheckIcon, PlusIcon, SearchIcon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import { db, type BodyPart, type Equipment } from '../db'
import { BODY_PARTS, EQUIPMENT, addCustomExercise, bodyPartLabel, equipmentLabel } from '../lib/exercises'
import { useGoBack } from '../lib/useGoBack'
import { addExercisesToWorkout } from '../lib/workouts'

/** 종목 선택 화면. 부위로 거르거나 이름으로 찾아 여러 개를 한 번에 추가한다. */
export default function ExercisePicker() {
  const { id = '' } = useParams()
  const goBack = useGoBack(`/workout/${id}`)
  const [query, setQuery] = useState('')
  const [part, setPart] = useState<BodyPart | 'all'>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const data = useLiveQuery(async () => {
    const workout = (await db.workouts.get(id)) ?? null
    const exercises = await db.exercises.toArray()
    const inWorkout = await db.workoutExercises.where('workoutId').equals(id).toArray()
    return { workout, exercises, inWorkout: new Set(inWorkout.map((we) => we.exerciseId)) }
  }, [id])

  if (data === undefined) return null
  if (data.workout === null || data.workout.endedAt !== null) return <Navigate to="/" replace />

  const q = query.trim().toLowerCase()
  const shown = data.exercises
    .filter((e) => (part === 'all' || e.bodyPart === part) && (q === '' || e.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))

  const toggle = (exerciseId: string) => {
    setSelected((cur) => (cur.includes(exerciseId) ? cur.filter((x) => x !== exerciseId) : [...cur, exerciseId]))
  }

  const addSelected = async () => {
    if (selected.length === 0 || busy) return
    setBusy(true)
    try {
      await addExercisesToWorkout(id, selected)
      goBack()
    } catch {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="종목 선택" onBack={goBack} />

      <main className="flex-1 px-3 pb-28 pt-3">
        <label className="flex h-12 items-center gap-2 rounded-xl border border-line bg-surface px-3 focus-within:border-accent">
          <SearchIcon className="size-5 shrink-0 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="종목 이름으로 찾기"
            aria-label="종목 이름으로 찾기"
            className="w-full min-w-0 bg-transparent text-ink outline-none placeholder:text-muted"
          />
        </label>

        <div className="-mx-3 mt-3 flex gap-2 overflow-x-auto px-3 pb-1" role="group" aria-label="부위">
          {[{ key: 'all' as const, label: '전체' }, ...BODY_PARTS].map((b) => (
            <button
              key={b.key}
              type="button"
              aria-pressed={part === b.key}
              onClick={() => setPart(b.key)}
              className={`h-10 shrink-0 rounded-full px-4 text-[15px] font-semibold ${
                part === b.key ? 'bg-accent text-on-accent' : 'bg-surface-2 text-muted'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>

        <ul className="mt-3 grid gap-2">
          {shown.map((e) => {
            const added = data.inWorkout.has(e.id)
            const picked = selected.includes(e.id)
            return (
              <li key={e.id}>
                <button
                  type="button"
                  disabled={added}
                  aria-pressed={picked}
                  onClick={() => toggle(e.id)}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 py-2 text-left active:opacity-80 disabled:opacity-50 ${
                    picked ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{e.name}</span>
                    <span className="block text-sm text-muted">
                      {bodyPartLabel(e.bodyPart)} · {equipmentLabel(e.equipment)}
                      {e.isCustom && ' · 내 종목'}
                    </span>
                  </span>
                  {added ? (
                    <span className="shrink-0 text-sm text-muted">추가됨</span>
                  ) : (
                    <span
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 ${
                        picked ? 'border-accent bg-accent text-on-accent' : 'border-line text-transparent'
                      }`}
                    >
                      <CheckIcon className="size-4" />
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        {shown.length === 0 && <p className="py-6 text-center text-muted">찾는 종목이 없습니다.</p>}

        {formOpen ? (
          <CustomExerciseForm
            initialName={query.trim()}
            initialPart={part === 'all' ? 'chest' : part}
            onCancel={() => setFormOpen(false)}
            onAdded={(exerciseId) => {
              setFormOpen(false)
              setQuery('')
              setSelected((cur) => (cur.includes(exerciseId) ? cur : [...cur, exerciseId]))
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="mt-3 flex h-12 w-full items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line font-semibold text-accent active:bg-surface-2"
          >
            <PlusIcon className="size-5" />내 종목 추가
          </button>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-md border-t border-line bg-bg px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <button
          type="button"
          disabled={selected.length === 0 || busy}
          onClick={() => void addSelected()}
          className="h-14 w-full rounded-2xl bg-accent text-lg font-bold text-on-accent active:opacity-80 disabled:opacity-40"
        >
          {selected.length === 0 ? '종목을 골라 주세요' : `선택한 ${selected.length}개 추가`}
        </button>
      </div>
    </>
  )
}

interface CustomExerciseFormProps {
  initialName: string
  initialPart: BodyPart
  onCancel: () => void
  onAdded: (exerciseId: string) => void
}

function CustomExerciseForm({ initialName, initialPart, onCancel, onAdded }: CustomExerciseFormProps) {
  const [name, setName] = useState(initialName)
  const [bodyPart, setBodyPart] = useState<BodyPart>(initialPart)
  const [equipment, setEquipment] = useState<Equipment>('barbell')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    try {
      onAdded(await addCustomExercise({ name, bodyPart, equipment }))
    } catch (e) {
      setError(e instanceof Error ? e.message : '종목을 추가하지 못했습니다.')
    }
  }

  return (
    <form
      className="mt-3 grid gap-3 rounded-2xl border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h2 className="font-bold text-ink">내 종목 추가</h2>
      <label className="grid gap-1 text-sm text-muted">
        이름
        <input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          maxLength={40}
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
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="h-12 flex-1 rounded-xl bg-accent font-bold text-on-accent active:opacity-80">
          추가
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
