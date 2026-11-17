import { useSyncExternalStore } from 'react'
import type { Stopwatch } from '../lib/stopwatch'
import { getStopwatch, subscribeStopwatch } from './store'

/** 돌고 있는 스톱워치(앱 전체에서 하나). 없으면 null. 시작하거나 멈추면 다시 그린다. */
export function useStopwatch(): Stopwatch | null {
  return useSyncExternalStore(subscribeStopwatch, getStopwatch)
}
