import { formatDay, formatFullDate, formatTime } from '../format'
import { CODE_LENGTH } from './code'
import type { SyncFailure } from './errors'

/** 화면에 보여 주는 클라우드 백업의 글. (5단계) */

/** 실패한 이유를 사용자에게 보여 줄 글로 바꾼다. detail은 백업을 읽지 못한 이유(bad_backup). */
export function syncErrorText(code: SyncFailure, detail?: string | null): string {
  switch (code) {
    case 'network':
      return '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'
    case 'unavailable':
    case 'not_found':
      return '이 주소에서는 클라우드 백업을 쓸 수 없습니다.'
    case 'bad_code':
      return `복구 코드는 글자와 숫자 ${CODE_LENGTH}자입니다. 다시 확인해 주세요.`
    case 'forbidden':
    case 'unauthorized':
      return '복구 코드가 맞지 않습니다. 이 주소의 클라우드 백업은 다른 복구 코드로 만들어졌습니다.'
    case 'already_claimed':
      return '이 주소에는 이미 클라우드 백업이 있습니다. 그때 받은 복구 코드로 연결해 주세요.'
    case 'not_claimed':
      return '이 주소에는 클라우드 백업이 없습니다. 지워졌다면 연결을 끊고 새로 시작해 주세요.'
    case 'no_snapshot':
      return '클라우드에 그 백업이 없습니다.'
    case 'too_large':
      return '백업이 너무 커서(16MB 초과) 올리지 못했습니다.'
    case 'decrypt_failed':
      return '클라우드의 백업을 이 복구 코드로 풀지 못했습니다.'
    case 'newer_format':
      return '더 새로운 버전의 앱에서 올린 백업입니다. 앱을 업데이트한 뒤 다시 시도해 주세요.'
    case 'unsupported':
      return '이 브라우저에서는 클라우드 백업을 쓸 수 없습니다. 브라우저를 업데이트한 뒤 다시 시도해 주세요.'
    case 'bad_backup':
      return detail ?? '클라우드의 백업을 읽지 못했습니다.'
    default:
      return '요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
  }
}

/** 스냅샷의 크기. "12KB", "1.4MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/** 올린 때. "2026년 11월 17일 오후 9:41" */
export function formatWhen(ts: number): string {
  return `${formatFullDate(ts)} ${formatTime(ts)}`
}

/** 목록에 적는 짧은 때. "11월 17일 (화) 오후 9:41". 올해가 아니면 앞에 연도를 붙인다. */
export function formatSnapshotDay(ts: number, now: number = Date.now()): string {
  const year = new Date(ts).getFullYear()
  const day = `${formatDay(ts)} ${formatTime(ts)}`
  return year === new Date(now).getFullYear() ? day : `${year}년 ${day}`
}
