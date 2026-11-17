import { SETTING_KEYS, setSetting } from './settings'

/**
 * 홈의 백업 알림. (4단계)
 * 기록은 폰에만 있으니, 끝낸 운동이 있는데 백업한 지 오래됐으면 조용히 알려 준다.
 */

const DAY = 86_400_000

/** 마지막 백업에서 이만큼(일) 지나면 알린다. */
export const BACKUP_REMIND_AFTER_DAYS = 14
/** "나중에"를 누르면 이만큼(일) 숨긴다. */
export const BACKUP_SNOOZE_DAYS = 7

export interface BackupReminderInput {
  now: number
  /** 마지막으로 백업한 시각. 한 번도 안 했으면 null */
  lastBackupAt: number | null
  /** "나중에"로 미뤄 둔 시각. 없으면 null */
  snoozeUntil: number | null
  /** 끝낸 운동 수 */
  finishedWorkouts: number
}

/** 백업 알림을 보여 줄지. 끝낸 운동이 하나라도 있고, 백업이 없거나 14일보다 오래됐고, 미뤄 둔 기간이 지났을 때. */
export function shouldRemindBackup({ now, lastBackupAt, snoozeUntil, finishedWorkouts }: BackupReminderInput): boolean {
  if (finishedWorkouts < 1) return false
  if (snoozeUntil !== null && now < snoozeUntil) return false
  return lastBackupAt === null || now - lastBackupAt > BACKUP_REMIND_AFTER_DAYS * DAY
}

/** 마지막 백업에서 지난 날수(내림). 시계가 뒤로 가 있어도 0 아래로는 내려가지 않는다. */
export function daysSinceBackup(now: number, lastBackupAt: number): number {
  return Math.max(0, Math.floor((now - lastBackupAt) / DAY))
}

/** 백업 알림을 7일 동안 숨긴다. */
export async function snoozeBackupReminder(now: number = Date.now()): Promise<void> {
  await setSetting(SETTING_KEYS.backupSnoozeUntil, now + BACKUP_SNOOZE_DAYS * DAY)
}
