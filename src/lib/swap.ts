import { db } from '../db'
import { addExerciseWithPrefill } from './workouts'
import { cleanWorkoutSupersets } from './supersets'

/** 바꿔 넣을 종목의 시작 무게와 횟수. 무게가 null이면 맨몸(또는 아직 모름)이라 횟수만 채운다. */
export interface SwapPlan {
  weightKg: number | null
  reps: number
}

/**
 * 운동 중인 종목 하나를 다른 종목으로 바꾼다. 바꿔 넣은 WorkoutExercise의 id를 돌려준다.
 * - 아직 한 세트도 끝내지 않았으면 그 자리의 종목을 통째로 바꾼다.
 * - 이미 끝낸 세트가 있으면 그 세트는 기록으로 남기고(남은 세트만 지운다), 새 종목을 바로 뒤에 넣는다.
 * 새 종목의 본 세트 수는 남아 있던 본 세트 수에 맞추고(없으면 1), 세트는 새 종목의 지난 기록으로 미리 채운 뒤
 * plan이 있으면 아직 하지 않은 본 세트에 그 무게와 횟수를 채운다. 슈퍼세트 묶음과 루틴의 목표 횟수는 이어받는다.
 * 그 종목이 이미 이 운동에 들어 있거나, 바꿀 종목이 없으면 아무것도 바꾸지 않고 null을 돌려준다.
 */
export async function swapWorkoutExercise(
  workoutExerciseId: string,
  exerciseId: string,
  plan: SwapPlan | null = null,
): Promise<string | null> {
  return db.transaction('rw', [db.workouts, db.workoutExercises, db.sets, db.exercises], async () => {
    const we = await db.workoutExercises.get(workoutExerciseId)
    if (!we || we.exerciseId === exerciseId) return null
    if (!(await db.exercises.get(exerciseId))) return null
    const list = await db.workoutExercises.where('workoutId').equals(we.workoutId).sortBy('order')
    if (list.some((x) => x.exerciseId === exerciseId)) return null

    const sets = await db.sets.where('workoutExerciseId').equals(we.id).toArray()
    const keepOld = sets.some((s) => s.isDone)
    const remaining = sets.filter((s) => !s.isWarmup && !s.isDone).length
    const setCount = Math.max(1, remaining)

    let order = we.order
    if (keepOld) {
      // 끝낸 세트는 그대로 두고 남은 세트만 지운다. 새 종목이 들어갈 자리를 비우려고 뒤 종목을 한 칸씩 민다.
      await db.sets.bulkDelete(sets.filter((s) => !s.isDone).map((s) => s.id))
      const after = list.filter((x) => x.order > we.order)
      await db.workoutExercises.bulkUpdate(after.map((x) => ({ key: x.id, changes: { order: x.order + 1 } })))
      order = we.order + 1
    } else {
      await db.sets.bulkDelete(sets.map((s) => s.id))
      await db.workoutExercises.delete(we.id)
    }

    const newId = await addExerciseWithPrefill(we.workoutId, exerciseId, order, {
      setCount,
      ...(we.targetReps != null ? { targetReps: we.targetReps } : {}),
    })
    if (we.supersetId) await db.workoutExercises.update(newId, { supersetId: we.supersetId })

    if (plan) {
      const fresh = await db.sets.where('workoutExerciseId').equals(newId).sortBy('order')
      // 지난 기록에서 따라온 웜업이 새 시작 무게보다 무거우면 맞지 않으니 뺀다(웜업은 웜업 버튼으로 다시 만든다).
      const heavyWarmups = fresh.filter(
        (s) => s.isWarmup && plan.weightKg !== null && (s.weightKg ?? 0) >= plan.weightKg,
      )
      await db.sets.bulkDelete(heavyWarmups.map((s) => s.id))
      const working = fresh.filter((s) => !s.isWarmup)
      await db.sets.bulkUpdate(
        working.map((s) => ({
          key: s.id,
          changes: plan.weightKg === null ? { reps: plan.reps } : { weightKg: plan.weightKg, reps: plan.reps },
        })),
      )
    }

    await cleanWorkoutSupersets(we.workoutId)
    return newId
  })
}
