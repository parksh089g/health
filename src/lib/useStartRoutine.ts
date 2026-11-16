import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { startWorkoutFromRoutine } from './routines'

/** 루틴으로 시작하지 못했을 때 보여 줄 안내 */
export type StartRoutineNotice = { kind: 'active'; workoutId: string } | { kind: 'error'; message: string }

/**
 * 루틴으로 운동을 시작한다. 새 운동을 만들면 운동 화면으로 가고,
 * 진행 중인 운동이 있거나 시작하지 못하면 안내(notice)를 남긴다. 안내는 RoutineStartDialog로 보여 준다.
 */
export function useStartRoutine() {
  const navigate = useNavigate()
  const [notice, setNotice] = useState<StartRoutineNotice | null>(null)
  const [busy, setBusy] = useState(false)

  const start = useCallback(
    async (routineId: string) => {
      if (busy) return
      setBusy(true)
      try {
        const result = await startWorkoutFromRoutine(routineId)
        if (result.created) navigate(`/workout/${result.id}`)
        else setNotice({ kind: 'active', workoutId: result.id })
      } catch (e) {
        setNotice({ kind: 'error', message: e instanceof Error ? e.message : '운동을 시작하지 못했습니다.' })
      } finally {
        setBusy(false)
      }
    },
    [busy, navigate],
  )

  const closeNotice = useCallback(() => setNotice(null), [])

  return { start, busy, notice, closeNotice }
}
