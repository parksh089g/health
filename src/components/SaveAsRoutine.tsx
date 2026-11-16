import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Workout } from '../db'
import { ROUTINE_NAME_MAX, defaultRoutineName, saveWorkoutAsRoutine } from '../lib/routines'
import type { WorkoutItem } from '../lib/workouts'
import { Dialog } from './Dialog'

interface SaveAsRoutineProps {
  workout: Workout
  items: WorkoutItem[]
}

/** 기록 상세의 "루틴으로 저장". 이름을 받아 이 운동의 종목과 세트 수로 루틴을 만든다. */
export function SaveAsRoutine({ workout, items }: SaveAsRoutineProps) {
  const navigate = useNavigate()
  // null이면 이름 묻는 창이 닫혀 있다.
  const [name, setName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const names = items.flatMap((item) => (item.exercise ? [item.exercise.name] : []))

  const open = () => {
    setName(defaultRoutineName(names, workout.startedAt))
    setError(null)
  }

  const save = async () => {
    if (name === null || saving) return
    setSaving(true)
    try {
      const id = await saveWorkoutAsRoutine(workout.id, name)
      setName(null)
      setSavedId(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '루틴을 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={names.length === 0}
        className="mt-2 h-12 w-full rounded-2xl bg-surface-2 text-base font-semibold text-ink active:opacity-70 disabled:opacity-40"
      >
        루틴으로 저장
      </button>

      <Dialog
        open={name !== null}
        title="루틴으로 저장"
        onClose={() => setName(null)}
        actions={[
          { label: '저장', tone: 'primary', onClick: () => void save() },
          { label: '취소', onClick: () => setName(null) },
        ]}
      >
        이 운동의 종목과 세트 수로 루틴을 만듭니다.
        <label className="mt-3 grid gap-1 text-sm font-semibold">
          루틴 이름
          <input
            value={name ?? ''}
            onChange={(e) => {
              setName(e.currentTarget.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
            }}
            maxLength={ROUTINE_NAME_MAX}
            enterKeyHint="done"
            placeholder="예: 하체 날"
            className="h-12 rounded-xl border border-line bg-bg px-3 text-base font-normal text-ink outline-none placeholder:text-muted focus:border-accent"
          />
        </label>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
      </Dialog>

      <Dialog
        open={savedId !== null}
        title="루틴으로 저장했습니다"
        onClose={() => setSavedId(null)}
        actions={[
          { label: '루틴 열기', tone: 'primary', onClick: () => navigate(`/routines/${savedId}`) },
          { label: '닫기', onClick: () => setSavedId(null) },
        ]}
      >
        홈과 루틴 화면에서 바로 시작할 수 있습니다.
      </Dialog>
    </>
  )
}
