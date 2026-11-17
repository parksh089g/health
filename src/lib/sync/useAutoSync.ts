import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef } from 'react'
import { db } from '../../db'
import { autoSync, type AutoTrigger } from './engine'

/**
 * 클라우드 백업이 켜져 있으면 알아서 올린다. 앱에서 한 번만 쓴다(App.tsx). (5단계)
 * 앱을 열 때, 다시 화면에 나올 때, 인터넷이 돌아올 때, 운동을 끝냈을 때 올릴 것이 있는지 본다.
 * 화면을 막지 않고, 실패해도 콘솔에 아무것도 남기지 않는다(이유는 설정 화면에 보인다).
 */
export function useAutoSync(): void {
  const activeWorkouts = useLiveQuery(() => db.workouts.filter((w) => w.endedAt === null).count(), [])
  const run = useRef<(trigger: AutoTrigger) => void>(() => undefined)
  /** 바로 앞에서 본 진행 중인 운동 수 */
  const seen = useRef<number | undefined>(undefined)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let alive = true
    run.current = (trigger) => {
      void autoSync(trigger).then((result) => {
        // 올린 지 얼마 안 돼 미뤘으면, 앱이 떠 있는 동안에는 그때 가서 다시 본다.
        if (!alive || result.outcome !== 'throttled') return
        clearTimeout(timer)
        timer = setTimeout(() => run.current('timer'), result.retryInMs + 1000)
      })
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') run.current('visible')
    }
    const onOnline = () => run.current('online')
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      alive = false
      clearTimeout(timer)
      run.current = () => undefined
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  useEffect(() => {
    if (activeWorkouts === undefined) return
    const before = seen.current
    seen.current = activeWorkouts
    if (before === undefined) run.current('open')
    else if (before > 0 && activeWorkouts === 0) run.current('workout-end')
  }, [activeWorkouts])
}
