import { db, type AiProfile } from '../db'

/** 휴식 타이머와 설정에서 바로 고를 수 있는 휴식 시간(초) */
export const REST_OPTIONS = [60, 90, 120, 180, 240, 300] as const
export const DEFAULT_REST_SECONDS = 90
/** 휴식 시간으로 받을 수 있는 범위(초). 종목에 직접 적는 값과 타이머에서 늘릴 수 있는 한계에 쓴다. */
export const REST_RANGE = { min: 10, max: 900 } as const

/** 휴식 시간으로 쓸 수 있는 값인지(범위 안의 정수 초) */
export function isRestSeconds(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= REST_RANGE.min && v <= REST_RANGE.max
}

export const SETTING_KEYS = {
  restSeconds: 'restSeconds',
  lastBackupAt: 'lastBackupAt',
  recommendEnabled: 'recommendEnabled',
  aiEnabled: 'aiEnabled',
  aiApiKey: 'aiApiKey',
  aiModel: 'aiModel',
  aiUsage: 'aiUsage',
  aiProfile: 'aiProfile',
  backupSnoozeUntil: 'backupSnoozeUntil',
  /** 주에 몇 번 운동할지(1~7). 정하지 않았으면 없음. (5단계) */
  weeklyGoal: 'weeklyGoal',
  /** 바벨 바의 무게(kg). (5단계) */
  barWeightKg: 'barWeightKg',
  /** 가진 원판의 무게 목록(kg). (5단계) */
  plates: 'plates',
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
  return isRestSeconds(v) ? v : DEFAULT_REST_SECONDS
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

export const EMPTY_AI_PROFILE: AiProfile = { goal: null, experience: null, daysPerWeek: null, notes: '' }

/** AI에게 알려 두는 내 목표와 상황. 저장된 값이 없거나 이상하면 빈 값. */
export async function getAiProfile(): Promise<AiProfile> {
  const v = await getSetting<unknown>(SETTING_KEYS.aiProfile, null)
  if (typeof v !== 'object' || v === null) return EMPTY_AI_PROFILE
  const r = v as Record<string, unknown>
  const goals = ['hypertrophy', 'strength', 'fat-loss', 'health']
  const levels = ['beginner', 'intermediate', 'advanced']
  return {
    goal: goals.includes(r.goal as string) ? (r.goal as AiProfile['goal']) : null,
    experience: levels.includes(r.experience as string) ? (r.experience as AiProfile['experience']) : null,
    daysPerWeek: typeof r.daysPerWeek === 'number' && r.daysPerWeek >= 1 && r.daysPerWeek <= 7 ? r.daysPerWeek : null,
    notes: typeof r.notes === 'string' ? r.notes.slice(0, 500) : '',
  }
}

/** 백업 알림을 이 시각까지 미룬다("나중에"를 눌렀을 때). 없으면 null */
export async function getBackupSnoozeUntil(): Promise<number | null> {
  const v = await getSetting<unknown>(SETTING_KEYS.backupSnoozeUntil, null)
  return typeof v === 'number' ? v : null
}

/** 주간 목표(주에 몇 번 운동할지, 1~7). 정하지 않았으면 null */
export async function getWeeklyGoal(): Promise<number | null> {
  const v = await getSetting<unknown>(SETTING_KEYS.weeklyGoal, null)
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 7 ? v : null
}

export const DEFAULT_BAR_WEIGHT_KG = 20
/** 헬스장에 흔히 있는 원판(kg). 한쪽에 끼우는 한 장의 무게다. */
export const DEFAULT_PLATES: readonly number[] = [25, 20, 15, 10, 5, 2.5, 1.25]

/** 바벨 바의 무게(kg). 저장된 값이 이상하면 20kg. */
export async function getBarWeightKg(): Promise<number> {
  const v = await getSetting<unknown>(SETTING_KEYS.barWeightKg, DEFAULT_BAR_WEIGHT_KG)
  return typeof v === 'number' && v >= 0 && v <= 50 ? v : DEFAULT_BAR_WEIGHT_KG
}

/** 가진 원판의 무게 목록(kg), 무거운 것부터. 저장된 값이 없거나 이상하면 기본 목록. */
export async function getPlates(): Promise<number[]> {
  const v = await getSetting<unknown>(SETTING_KEYS.plates, null)
  if (!Array.isArray(v)) return [...DEFAULT_PLATES]
  const plates = v.filter((x): x is number => typeof x === 'number' && x > 0 && x <= 50)
  return plates.length > 0 ? [...new Set(plates)].sort((a, b) => b - a) : [...DEFAULT_PLATES]
}
