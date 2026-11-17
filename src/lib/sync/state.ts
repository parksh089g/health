import { db } from '../../db'
import type { SnapshotMeta } from '../../../worker/wire'
import { SETTING_KEYS } from '../settings'
import { CODE_LENGTH } from './code'
import type { SyncFailure } from './errors'

/**
 * 이 폰의 클라우드 백업 상태. (5단계)
 * 복구 코드(syncCode)와 함께 이 폰에만 두는 설정이다. 백업 파일에 들어가지 않고 복원해도 그대로 남는다.
 */
export interface SyncState {
  /** 서버에 이 코드가 주인으로 등록됐는지. 시작하다가 답을 못 받았으면 false이고, 다음에 올릴 때 다시 등록한다. */
  claimed: boolean
  /** 이 폰이 마지막으로 본 서버의 버전(올렸거나 복원한 때의 최신). 아직 없으면 null */
  version: number | null
  /** 그때 이 폰 기록의 해시(hash.ts). 지금 기록의 해시와 같으면 올릴 것이 없다. */
  hash: string | null
  /** 마지막으로 올리기에 성공한 시각 */
  lastUploadAt: number | null
  /**
   * 올리기를 멈춘 이유. 사용자가 복원하거나 덮어쓰기를 고를 때까지 올리지 않는다.
   * connected: 복구 코드로 연결했는데 클라우드에 이미 백업이 있다.
   * conflict: 다른 기기가 더 새 백업을 올렸다.
   */
  hold: 'connected' | 'conflict' | null
  /** 멈춘 동안 알고 있는 클라우드의 최신 스냅샷 */
  remote: SnapshotMeta | null
  /** 마지막 시도가 실패했으면 그 시각과 이유. 성공하면 지운다. */
  lastError: { at: number; code: SyncFailure } | null
}

export const EMPTY_SYNC_STATE: SyncState = {
  claimed: false,
  version: null,
  hash: null,
  lastUploadAt: null,
  hold: null,
  remote: null,
  lastError: null,
}

const isNumOrNull = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v))

function readMeta(v: unknown): SnapshotMeta | null {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  return typeof r.version === 'number' && typeof r.createdAt === 'number' && typeof r.size === 'number'
    ? { version: r.version, createdAt: r.createdAt, size: r.size }
    : null
}

/** 저장된 값을 읽는다. 없거나 모양이 이상한 칸은 빈 값으로 둔다. */
export function readSyncState(v: unknown): SyncState {
  if (typeof v !== 'object' || v === null) return EMPTY_SYNC_STATE
  const r = v as Record<string, unknown>
  const err = r.lastError as Record<string, unknown> | null | undefined
  return {
    claimed: r.claimed === true,
    version: isNumOrNull(r.version) ? r.version : null,
    hash: typeof r.hash === 'string' ? r.hash : null,
    lastUploadAt: isNumOrNull(r.lastUploadAt) ? r.lastUploadAt : null,
    hold: r.hold === 'connected' || r.hold === 'conflict' ? r.hold : null,
    remote: readMeta(r.remote),
    lastError:
      err && typeof err.at === 'number' && typeof err.code === 'string'
        ? { at: err.at, code: err.code as SyncFailure }
        : null,
  }
}

/** 저장된 복구 코드(끊는 줄 없는 25자). 클라우드 백업을 켜지 않았으면 null */
export async function getSyncCode(): Promise<string | null> {
  const row = await db.settings.get(SETTING_KEYS.syncCode)
  return typeof row?.value === 'string' && row.value.length === CODE_LENGTH ? row.value : null
}

export async function getSyncState(): Promise<SyncState> {
  const row = await db.settings.get(SETTING_KEYS.syncState)
  return readSyncState(row?.value)
}

/** 상태의 일부만 바꾼다. 바꾼 뒤의 상태를 돌려준다. */
export async function patchSyncState(patch: Partial<SyncState>): Promise<SyncState> {
  return db.transaction('rw', db.settings, async () => {
    const next = { ...(await getSyncState()), ...patch }
    await db.settings.put({ key: SETTING_KEYS.syncState, value: next })
    return next
  })
}

/** 복구 코드와 상태를 함께 저장한다(클라우드 백업을 켠다). */
export async function saveSyncLink(code: string, state: SyncState): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    await db.settings.put({ key: SETTING_KEYS.syncCode, value: code })
    await db.settings.put({ key: SETTING_KEYS.syncState, value: state })
  })
}

/** 이 폰에서 복구 코드와 상태를 지운다(클라우드 백업을 끈다). 서버의 백업은 건드리지 않는다. */
export async function clearSyncLink(): Promise<void> {
  await db.settings.bulkDelete([SETTING_KEYS.syncCode, SETTING_KEYS.syncState])
}
