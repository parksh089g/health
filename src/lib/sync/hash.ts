import type { BackupFile } from '../backup'
import { SETTING_KEYS } from '../settings'
import { sha256Hex } from './crypto'

/** 백업을 하면 바뀌는 설정. 기록이 달라진 것이 아니므로 해시에서 뺀다(넣으면 올릴 때마다 해시가 바뀐다). */
const IGNORED_SETTINGS: readonly string[] = [SETTING_KEYS.lastBackupAt, SETTING_KEYS.backupSnoozeUntil]

/**
 * 백업 내용의 해시. 만든 시각(exportedAt)과 백업 시각 설정은 빼고 센다.
 * 마지막으로 올린 때의 해시와 같으면 그 뒤로 기록이 바뀌지 않은 것이다.
 */
export async function backupHash(backup: BackupFile): Promise<string> {
  const settings = backup.data.settings.filter((r) => !IGNORED_SETTINGS.includes(r.key))
  return sha256Hex(JSON.stringify({ version: backup.version, data: { ...backup.data, settings } }))
}
