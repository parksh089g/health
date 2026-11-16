import { backupFileName, exportBackup } from './backup'
import { SETTING_KEYS, setSetting } from './settings'

/** 파일을 폰에 내려받게 하는 코드. 설정의 백업, CSV 내보내기와 홈의 백업 알림이 함께 쓴다. */

export const BACKUP_MIME = 'application/json'

export function downloadFile(text: string, name: string, type: string = BACKUP_MIME): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 백업 파일을 만들어 내려받거나(download) 공유 시트로 내보내고(share), 마지막 백업 시각을 적는다.
 * 파일 이름을 돌려준다. 공유 창을 그냥 닫으면 AbortError가 나고 백업 시각은 바뀌지 않는다.
 */
export async function saveBackupFile(via: 'download' | 'share' = 'download', now: Date = new Date()): Promise<string> {
  const text = JSON.stringify(await exportBackup(now), null, 2)
  const name = backupFileName(now)
  if (via === 'share') {
    await navigator.share({ files: [new File([text], name, { type: BACKUP_MIME })], title: '헬스 기록 백업' })
  } else {
    downloadFile(text, name)
  }
  await setSetting(SETTING_KEYS.lastBackupAt, now.getTime())
  return name
}

/** 백업을 내보낸 뒤 보여 주는 글 */
export function backupSavedText(name: string): string {
  return `백업 파일(${name})을 내보냈습니다. 폰 밖의 안전한 곳에도 보관해 주세요.`
}

export const BACKUP_FAILED_TEXT = '백업 파일을 만들지 못했습니다. 다시 시도해 주세요.'
