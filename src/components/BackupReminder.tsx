import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { daysSinceBackup, shouldRemindBackup, snoozeBackupReminder } from '../lib/backupReminder'
import { BACKUP_FAILED_TEXT, backupSavedText, saveBackupFile } from '../lib/saveFile'
import { getBackupSnoozeUntil, getLastBackupAt } from '../lib/settings'

interface BackupReminderProps {
  /** 끝낸 운동 수 */
  finishedWorkouts: number
  now: number
}

/**
 * 홈의 백업 알림. 끝낸 운동이 있는데 백업이 없거나 14일보다 오래됐을 때만 보인다.
 * "지금 백업"은 설정의 "백업 파일 저장"과 같은 파일을 내려받고, "나중에"는 7일 동안 숨긴다.
 */
export function BackupReminder({ finishedWorkouts, now }: BackupReminderProps) {
  const state = useLiveQuery(async () => {
    const [lastBackupAt, snoozeUntil] = await Promise.all([getLastBackupAt(), getBackupSnoozeUntil()])
    return { lastBackupAt, snoozeUntil }
  }, [])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // 백업을 마치면 알림 자리에 내보낸 파일 이름을 보여 준다(홈을 벗어날 때까지).
  const [savedName, setSavedName] = useState<string | null>(null)

  if (savedName !== null) {
    return (
      <p
        role="status"
        className="mt-6 break-keep rounded-2xl border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-good"
      >
        {backupSavedText(savedName)}
      </p>
    )
  }

  if (state === undefined || !shouldRemindBackup({ now, finishedWorkouts, ...state })) return null

  const backUp = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      setSavedName(await saveBackupFile('download'))
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface px-4 py-3" aria-label="백업 알림">
      <p className="text-[15px] font-semibold text-ink">
        {state.lastBackupAt === null
          ? '아직 백업한 적이 없습니다'
          : `백업한 지 ${daysSinceBackup(now, state.lastBackupAt)}일 지났습니다`}
      </p>
      <p className="mt-0.5 break-keep text-sm leading-relaxed text-muted">기록은 이 폰에만 있습니다. 백업해 두세요.</p>
      {failed && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {BACKUP_FAILED_TEXT}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void backUp()}
          disabled={busy}
          className="h-11 flex-1 rounded-xl bg-accent-soft text-[15px] font-bold text-accent active:opacity-70 disabled:opacity-40"
        >
          지금 백업
        </button>
        <button
          type="button"
          onClick={() => void snoozeBackupReminder()}
          className="h-11 flex-1 rounded-xl bg-surface-2 text-[15px] font-semibold text-ink active:opacity-70"
        >
          나중에
        </button>
      </div>
    </section>
  )
}
