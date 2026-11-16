import { useState } from 'react'
import type { BodyPart, Exercise } from '../db'
import {
  BODY_PARTS,
  addCustomExercise,
  bodyPartLabel,
  equipmentLabel,
  hiddenExercises,
  pickableExercises,
  restoreExercise,
} from '../lib/exercises'
import { ExerciseForm } from './ExerciseForm'
import { ExerciseManage } from './ExerciseManage'
import { CheckIcon, ChevronRightIcon, PlusIcon, SearchIcon } from './icons'

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

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-5">
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  )
}

/**
 * 종목 고르기 목록. 이름으로 찾고 부위로 거르며, 목록에 없으면 내 종목을 추가한다.
 * 숨긴 종목은 목록에 나오지 않고 맨 아래 "숨긴 종목"에서 다시 보이게 할 수 있다.
 * 줄 끝의 점 세 개 버튼으로 그 자리에서 종목을 고치거나 숨기거나 지운다
 * (다른 화면으로 넘어가지 않아서 고르던 종목과 고치던 루틴이 그대로 남는다).
 * 운동의 종목 선택 화면과 루틴의 종목 선택이 함께 쓴다.
 */
export function ExercisePickerList({ exercises, addedIds, selected, onToggle, onCustomAdded }: ExercisePickerListProps) {
  const [query, setQuery] = useState('')
  const [part, setPart] = useState<BodyPart | 'all'>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [managing, setManaging] = useState<string | null>(null)
  const [hiddenOpen, setHiddenOpen] = useState(false)

  const filter = { query, bodyPart: part }
  const shown = pickableExercises(exercises, filter)
  const hidden = hiddenExercises(exercises, filter)

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
          const open = managing === e.id
          return (
            <li
              key={e.id}
              className={`overflow-hidden rounded-2xl border ${picked ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
            >
              <div className="flex">
                <button
                  type="button"
                  disabled={added}
                  aria-pressed={picked}
                  onClick={() => onToggle(e.id)}
                  className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-1 text-left active:opacity-80 disabled:opacity-50"
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
                <button
                  type="button"
                  aria-label={`종목 관리: ${e.name}`}
                  aria-expanded={open}
                  onClick={() => setManaging(open ? null : e.id)}
                  className={`flex w-11 shrink-0 items-center justify-center active:opacity-60 ${open ? 'text-accent' : 'text-muted'}`}
                >
                  <MoreIcon />
                </button>
              </div>
              {open && (
                <div className="border-t border-line bg-surface p-3">
                  <ExerciseManage
                    exercise={e}
                    onRemoved={() => {
                      setManaging(null)
                      // 고른 종목을 없앴으면 고른 목록에서도 뺀다.
                      if (picked) onToggle(e.id)
                    }}
                  />
                </div>
              )}
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

      {hidden.length > 0 && (
        <section className="mt-3" aria-label="숨긴 종목">
          <button
            type="button"
            aria-expanded={hiddenOpen}
            onClick={() => setHiddenOpen(!hiddenOpen)}
            className="flex h-12 w-full items-center justify-between rounded-2xl px-4 text-[15px] font-semibold text-muted active:bg-surface-2"
          >
            숨긴 종목 {hidden.length}개
            <ChevronRightIcon className={`size-5 transition-transform ${hiddenOpen ? 'rotate-90' : ''}`} />
          </button>
          {hiddenOpen && (
            <ul className="mt-1 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {hidden.map((e) => (
                <li key={e.id} className="flex min-h-14 items-center gap-3 py-2 pl-4 pr-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{e.name}</span>
                    <span className="block text-sm text-muted">
                      {bodyPartLabel(e.bodyPart)} · {equipmentLabel(e.equipment)}
                      {e.isCustom && ' · 내 종목'}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`${e.name} 다시 보이기`}
                    onClick={() => void restoreExercise(e.id)}
                    className="h-11 shrink-0 rounded-xl bg-accent-soft px-3 text-[15px] font-semibold text-accent active:opacity-70"
                  >
                    다시 보이기
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
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
  return (
    <div className="mt-3">
      <ExerciseForm
        title="내 종목 추가"
        submitLabel="추가"
        initial={{ name: initialName, bodyPart: initialPart, equipment: 'barbell' }}
        onSubmit={async (input) => onAdded(await addCustomExercise(input))}
        onCancel={onCancel}
      />
    </div>
  )
}
