import { db } from '../db'

export const REST_OPTIONS = [60, 90, 120] as const
export const DEFAULT_REST_SECONDS = 90

export const SETTING_KEYS = {
  restSeconds: 'restSeconds',
  lastBackupAt: 'lastBackupAt',
  recommendEnabled: 'recommendEnabled',
} as const

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value })
}

/** 휴식 시간 기본값(초). 저장된 값이 이상하면 기본값을 쓴다. */
export async function getRestSeconds(): Promise<number> {
  const v = await getSetting<unknown>(SETTING_KEYS.restSeconds, DEFAULT_REST_SECONDS)
  return typeof v === 'number' && v > 0 && v <= 3600 ? v : DEFAULT_REST_SECONDS
}

/** 마지막으로 백업한 시각. 한 번도 안 했으면 null. */
export async function getLastBackupAt(): Promise<number | null> {
  const v = await getSetting<unknown>(SETTING_KEYS.lastBackupAt, null)
  return typeof v === 'number' ? v : null
}

/** 운동 중에 다음 무게 추천을 보여 줄지. 기본은 켜짐. */
export async function getRecommendEnabled(): Promise<boolean> {
  const v = await getSetting<unknown>(SETTING_KEYS.recommendEnabled, true)
  return typeof v === 'boolean' ? v : true
}
