import { useLiveQuery } from 'dexie-react-hooks'
import type { PlateSetup } from './plates'
import { getBarWeightKg, getPlates } from './settings'

/** 설정에 저장된 바 무게와 가진 원판. 읽어 오는 동안에는 undefined. 설정이 바뀌면 따라 바뀐다. */
export function usePlateSetup(): PlateSetup | undefined {
  return useLiveQuery(async () => {
    const barKg = await getBarWeightKg()
    const plates = await getPlates()
    return { barKg, plates }
  }, [])
}
