import { useEffect } from 'react'

/**
 * active인 동안 화면이 꺼지지 않게 한다. 지원하지 않는 기기에서는 그냥 넘어간다.
 * 다른 앱에 다녀오면 풀리므로 화면이 다시 보일 때 다시 건다. (휴식 타이머가 쉬는 동안 하는 것과 같다.)
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
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
  }, [active])
}
