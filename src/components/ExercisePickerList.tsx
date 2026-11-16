import { useState } from 'react'
import type { BodyPart, Equipment, Exercise } from '../db'
import { BODY_PARTS, EQUIPMENT, addCustomExercise, bodyPartLabel, equipmentLabel, nameKey } from '../lib/exercises'
import { CheckIcon, PlusIcon, SearchIcon } from './icons'

interface ExercisePickerListProps {
  exercises: Exercise[]
  /** 이미 들어 있어서 고를 수 없는 종목 */
  addedIds: Set<string>
  /** 고른 종목(고른 순서대로) */
  selected: string[]
  onToggle: (exerciseId: string) => void
  /** 내 종목을 새로 추가했을 때. 보통 고른 목록에 더한다. */
  onCustomAdded: (exerciseId: string) => void
}

/**
 * 종목 고르기 목록. 이름으로 찾고 부위로 거르며, 목록에 없으면 내 종목을 추가한다.
 * 운동의 종목 선택 화면과 루틴의 종목 선택이 함께 쓴다.
 */
export function ExercisePickerList({ exercises, addedIds, selected, onToggle, onCustomAdded }: ExercisePickerListProps) {
  const [query, setQuery] = useState('')
  const [part, setPart] = useState<BodyPart | 'all'>('all')
  const [formOpen, setFormOpen] = useState(false)

  // 띄어쓰기 없이 찾아도 나오게 한다("스티프데드" → "스티프 데드리프트").
  const q = nameKey(query)
  const shown = exercises
    .filter((e) => (part === 'all' || e.bodyPart === part) && (q === '' || nameKey(e.name).includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))

  return (
    <>
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
          const added = addedIds.has(e.id)
          const picked = selected.includes(e.id)
          return (
            <li key={e.id}>
              <button
                type="button"
                disabled={added}
                aria-pressed={picked}
                onClick={() => onToggle(e.id)}
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
            onCustomAdded(exerciseId)
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
    </>
  )
}

interface PickerAddBarProps {
  count: number
  disabled?: boolean
  onAdd: () => void
}

/** 종목 선택 화면 아래에 붙는 "선택한 N개 추가" 버튼 */
export function PickerAddBar({ count, disabled = false, onAdd }: PickerAddBarProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-md border-t border-line bg-bg px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      <button
        type="button"
        disabled={count === 0 || disabled}
        onClick={onAdd}
        className="h-14 w-full rounded-2xl bg-accent text-lg font-bold text-on-accent active:opacity-80 disabled:opacity-40"
      >
        {count === 0 ? '종목을 골라 주세요' : `선택한 ${count}개 추가`}
      </button>
    </div>
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
