import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_REST_SECONDS, SETTING_KEYS, getRestSeconds, setSetting } from '../lib/settings'
import { alertRestOver, releaseAudio, unlockAudio } from './alert'
import { RestTimerContext, type RestTimerValue } from './context'

interface Timer {
  startedAt: number
  endsAt: number
}

const STORAGE_KEY = 'health.restTimer'
/** 휴식이 끝난 뒤 "휴식 끝" 표시를 남겨 두는 시간 */
const FINISHED_SHOW_MS = 8000
/** 끝난 지 이 시간이 넘었으면(화면을 꺼 뒀다가 돌아온 경우) 소리와 진동은 생략한다 */
const ALERT_WINDOW_MS = 3000

function loadTimer(): Timer | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const t: unknown = JSON.parse(raw)
    if (typeof t !== 'object' || t === null) return null
    const { startedAt, endsAt } = t as Partial<Timer>
    if (typeof startedAt !== 'number' || typeof endsAt !== 'number') return null
    return Date.now() < endsAt + FINISHED_SHOW_MS ? { startedAt, endsAt } : null
  } catch {
    return null
  }
}

function saveTimer(timer: Timer | null): void {
  try {
    if (timer) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(timer))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // 저장이 막힌 환경이면 새로고침할 때 타이머가 사라질 뿐이다.
  }
}

export function RestTimerProvider({ children }: { children: ReactNode }) {
  const [timer, setTimer] = useState<Timer | null>(loadTimer)
  const [now, setNow] = useState(() => Date.now())
  const alertedFor = useRef<number | null>(null)
  const restSeconds = useLiveQuery(getRestSeconds) ?? DEFAULT_REST_SECONDS

  useEffect(() => {
    saveTimer(timer)
    if (!timer) releaseAudio()
  }, [timer])

  // 남은 시간은 끝나는 시각에서 계산한다. 화면이 꺼졌다 켜져도 어긋나지 않는다.
  useEffect(() => {
    if (!timer) return
    const tick = () => {
      const t = Date.now()
      setNow(t)
      const overBy = t - timer.endsAt
      if (overBy < 0) return
      if (alertedFor.current !== timer.endsAt) {
        alertedFor.current = timer.endsAt
        if (overBy < ALERT_WINDOW_MS) alertRestOver()
      }
      if (overBy >= FINISHED_SHOW_MS) setTimer(null)
    }
    const id = window.setInterval(tick, 250)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [timer])

  // 쉬는 동안에는 화면이 꺼지지 않게 한다. 지원하지 않는 기기에서는 그냥 넘어간다.
  const running = timer !== null && now < timer.endsAt
  useEffect(() => {
    if (!running || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const acquire = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (cancelled) void l.release()
          else lock = l
        })
        .catch(() => undefined)
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      void lock?.release().catch(() => undefined)
    }
  }, [running])

  const start = useCallback(
    (seconds?: number) => {
      unlockAudio()
      const t = Date.now()
      setNow(t)
      setTimer({ startedAt: t, endsAt: t + (seconds ?? restSeconds) * 1000 })
    },
    [restSeconds],
  )

  const changeDuration = useCallback((seconds: number) => {
    void setSetting(SETTING_KEYS.restSeconds, seconds)
    setNow(Date.now())
    setTimer((cur) => (cur ? { startedAt: cur.startedAt, endsAt: cur.startedAt + seconds * 1000 } : cur))
  }, [])

  const stop = useCallback(() => setTimer(null), [])

  const value = useMemo<RestTimerValue>(() => {
    const remainingMs = timer ? Math.max(0, timer.endsAt - now) : 0
    return {
      active: timer !== null,
      finished: timer !== null && remainingMs === 0,
      remainingMs,
      durationSeconds: timer ? Math.round((timer.endsAt - timer.startedAt) / 1000) : restSeconds,
      start,
      changeDuration,
      stop,
    }
  }, [timer, now, restSeconds, start, changeDuration, stop])

  return <RestTimerContext.Provider value={value}>{children}</RestTimerContext.Provider>
}
