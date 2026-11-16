import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { ExercisePickerList, PickerAddBar } from '../components/ExercisePickerList'
import { PageHeader } from '../components/PageHeader'
import { db } from '../db'
import { useGoBack } from '../lib/useGoBack'
import { addExercisesToWorkout } from '../lib/workouts'

/** 종목 선택 화면. 부위로 거르거나 이름으로 찾아 여러 개를 한 번에 추가한다. */
export default function ExercisePicker() {
  const { id = '' } = useParams()
  const goBack = useGoBack(`/workout/${id}`)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const data = useLiveQuery(async () => {
    const workout = (await db.workouts.get(id)) ?? null
    const exercises = await db.exercises.toArray()
    const inWorkout = await db.workoutExercises.where('workoutId').equals(id).toArray()
    return { workout, exercises, inWorkout: new Set(inWorkout.map((we) => we.exerciseId)) }
  }, [id])

  if (data === undefined) return null
  if (data.workout === null || data.workout.endedAt !== null) return <Navigate to="/" replace />

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
        <ExercisePickerList
          exercises={data.exercises}
          addedIds={data.inWorkout}
          selected={selected}
          onToggle={(exerciseId) =>
            setSelected((cur) => (cur.includes(exerciseId) ? cur.filter((x) => x !== exerciseId) : [...cur, exerciseId]))
          }
          onCustomAdded={(exerciseId) => setSelected((cur) => (cur.includes(exerciseId) ? cur : [...cur, exerciseId]))}
        />
      </main>

      <PickerAddBar count={selected.length} disabled={busy} onAdd={() => void addSelected()} />
    </>
  )
}
