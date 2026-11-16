import { db } from '../db'

export const REST_OPTIONS = [60, 90, 120] as const
export const DEFAULT_REST_SECONDS = 90

export const SETTING_KEYS = {
  restSeconds: 'restSeconds',
  lastBackupAt: 'lastBackupAt',
  recommendEnabled: 'recommendEnabled',
  aiEnabled: 'aiEnabled',
  aiApiKey: 'aiApiKey',
  aiModel: 'aiModel',
  aiUsage: 'aiUsage',
} as const

/** 이 폰에만 두고 백업 파일에는 넣지 않는 설정. 복원해도 이 폰의 값이 그대로 남는다. */
export const DEVICE_ONLY_SETTING_KEYS: readonly string[] = [SETTING_KEYS.aiApiKey, SETTING_KEYS.aiUsage]

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

/** AI 추천을 쓰는지. 기본은 꺼짐(켜야 기록이 밖으로 나간다). */
export async function getAiEnabled(): Promise<boolean> {
  const v = await getSetting<unknown>(SETTING_KEYS.aiEnabled, false)
  return v === true
}

/** 저장한 Anthropic API 키. 없으면 null */
export async function getAiApiKey(): Promise<string | null> {
  const v = await getSetting<unknown>(SETTING_KEYS.aiApiKey, null)
  return typeof v === 'string' && v.trim() !== '' ? v : null
}
