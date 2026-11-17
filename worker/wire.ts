// 클라우드 백업 서버와 앱이 주고받는 값의 모양. 서버(worker/)와 앱(src/lib/sync/)이 함께 쓴다.
// 타입과 상수만 둔다(다른 파일을 가져오지 않는다).

/** 클라우드 백업 요청이 가는 주소의 앞부분 */
export const SYNC_PREFIX = '/api/sync/'
/** hello 답에 들어 있는 이름. 이 값이 있어야 클라우드 백업 서버로 본다. */
export const SYNC_SERVICE = 'health-log-sync'
/** 주고받는 규칙의 버전 */
export const SYNC_PROTOCOL = 1
/** 스냅샷 하나의 최대 크기(바이트) */
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
/** 서버에 남겨 두는 스냅샷 수(새것부터) */
export const KEEP_SNAPSHOTS = 10
/** 처음 올릴 때(서버에 스냅샷이 없다고 알고 있을 때) If-Match에 넣는 값 */
export const IF_MATCH_NONE = 'none'

/** 서버에 있는 스냅샷 하나 */
export interface SnapshotMeta {
  /** 올릴 때마다 1씩 커지는 번호 */
  version: number
  /** 서버가 받은 시각(ms) */
  createdAt: number
  /** 암호문의 크기(바이트) */
  size: number
}

/** GET hello */
export interface HelloBody {
  service: typeof SYNC_SERVICE
  protocol: number
  /** 이미 주인(복구 코드)이 정해진 보관함인지 */
  claimed: boolean
}

/** GET status, POST claim */
export interface StatusBody {
  /** 가장 새 스냅샷의 번호. 하나도 없으면 null */
  version: number | null
  /** 남아 있는 스냅샷(새것부터) */
  snapshots: SnapshotMeta[]
}

/** PUT snapshot */
export interface UploadBody {
  snapshot: SnapshotMeta
}

export type SyncErrorCode =
  /** 토큰이 없거나 모양이 틀림 (401) */
  | 'unauthorized'
  /** 이 보관함의 주인이 아님 (403) */
  | 'forbidden'
  /** 다른 복구 코드가 이미 주인임 (403, claim) */
  | 'already_claimed'
  /** 아직 주인이 없는 보관함 (409) */
  | 'not_claimed'
  /** If-Match가 없음 (428) */
  | 'precondition_required'
  /** 서버의 버전이 앱이 알던 것과 다름 (412). current에 지금 서버의 최신 스냅샷이 온다. */
  | 'version_mismatch'
  /** 16MB를 넘음 (413) */
  | 'too_large'
  /** 요청이 틀림 (400) */
  | 'bad_request'
  /** 그런 스냅샷이 없음 (404) */
  | 'no_snapshot'
  /** 없는 주소 (404) */
  | 'not_found'
  /** 쓸 수 없는 메서드 (405) */
  | 'method_not_allowed'
  /** 서버 안의 오류 (500) */
  | 'server_error'

export interface ErrorBody {
  error: SyncErrorCode
  /** version_mismatch일 때 지금 서버의 최신 스냅샷(없으면 null) */
  current?: SnapshotMeta | null
}
