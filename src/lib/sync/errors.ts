import type { SnapshotMeta, SyncErrorCode } from '../../../worker/wire'

/** 클라우드 백업이 실패한 이유. 서버가 알려 준 것과 폰에서 생긴 것이 있다. */
export type SyncFailure =
  | SyncErrorCode
  /** 서버에 닿지 못함(인터넷 끊김 등) */
  | 'network'
  /** 이 주소에는 클라우드 백업 서버가 없음 */
  | 'unavailable'
  /** 서버의 답을 읽을 수 없음 */
  | 'bad_response'
  /** 적은 복구 코드의 모양이 틀림 */
  | 'bad_code'
  /** 이 복구 코드로 풀리지 않는 스냅샷 */
  | 'decrypt_failed'
  /** 더 새로운 앱이 올린 스냅샷 */
  | 'newer_format'
  /** 풀었지만 이 앱의 백업이 아님 */
  | 'bad_backup'
  /** 이 브라우저에는 암호화나 압축 기능이 없음(오래된 브라우저, https가 아닌 주소) */
  | 'unsupported'
  /** 그 밖의 오류(폰의 저장소 오류 등) */
  | 'unknown'

/**
 * 클라우드 백업의 오류. message에는 code만 들어간다(복구 코드나 토큰이 오류 글에 섞이지 않게).
 * 화면에 보여 줄 글은 text.ts의 syncErrorText가 만든다.
 */
export class SyncError extends Error {
  readonly code: SyncFailure
  /** version_mismatch일 때 지금 서버의 최신 스냅샷 */
  readonly current: SnapshotMeta | null
  /** bad_backup일 때 백업을 읽지 못한 이유 */
  readonly detail: string | null

  constructor(code: SyncFailure, extra: { current?: SnapshotMeta | null; detail?: string } = {}) {
    super(code)
    this.name = 'SyncError'
    this.code = code
    this.current = extra.current ?? null
    this.detail = extra.detail ?? null
  }
}

/** 어떤 오류든 이유 코드로 바꾼다. */
export function failureOf(error: unknown): SyncFailure {
  return error instanceof SyncError ? error.code : 'unknown'
}
