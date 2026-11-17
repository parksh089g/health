import { db } from '../../db'
import { MAX_SNAPSHOT_BYTES, type SnapshotMeta } from '../../../worker/wire'
import { exportBackup, importBackup, parseBackup, type BackupFile } from '../backup'
import { ensureSeedExercises } from '../exercises'
import { SETTING_KEYS } from '../settings'
import { getActiveWorkout } from '../workouts'
import { createApi, type SyncApi } from './api'
import { generateCode, normalizeCode } from './code'
import { deriveKeys, openBackup, sealBackup } from './crypto'
import { failureOf, SyncError } from './errors'
import { backupHash } from './hash'
import {
  clearSyncLink,
  EMPTY_SYNC_STATE,
  getSyncCode,
  getSyncState,
  patchSyncState,
  saveSyncLink,
  type SyncState,
} from './state'

/**
 * 클라우드 백업이 하는 일: 시작, 복구 코드로 연결, 올리기, 가져오기, 끊기, 지우기, 자동 올리기. (5단계)
 * 여러 기기의 기록을 합치지 않는다. 폰 하나가 통째로 올리고, 새 폰이 통째로 받아 온다.
 *
 * 지키는 규칙:
 * 1. 복구 코드로 연결했는데 클라우드에 이미 백업이 있으면, 복원하거나 덮어쓰기를 고를 때까지 올리지 않는다
 *    (빈 새 폰이 백업을 덮어 버리지 않게).
 * 2. 올릴 때 이 폰이 마지막으로 본 버전을 함께 보낸다. 서버의 버전이 다르면(다른 기기가 올렸으면) 올리기를 멈추고
 *    사용자가 고르게 한다.
 * 3. 복원한 뒤에는 그 버전과 기록의 해시를 적어 두어 곧바로 다시 올리지 않는다.
 * 4. 올리기에 성공하면 마지막 백업 시각도 지금으로 적는다(홈의 백업 알림이 이것을 본다).
 * 5. 복구 코드와 토큰은 로그, 오류 글, 주소, 백업 파일에 넣지 않는다.
 */

export interface SyncDeps {
  api: SyncApi
  now: () => number
  /** 인터넷에 연결되어 있는지 */
  online: () => boolean
}

function defaultDeps(): SyncDeps {
  return { api: createApi(), now: () => Date.now(), online: () => navigator.onLine !== false }
}

/** 자동 올리기는 이 간격보다 자주 하지 않는다(운동을 끝냈을 때는 빼고). 실패한 뒤에도 이만큼 기다린다. */
export const AUTO_MIN_INTERVAL_MS = 5 * 60_000

// 올리기와 가져오기는 한 번에 하나만 한다. 같은 폰에서 탭이 둘 열려 있어도 겹치지 않게, 되는 브라우저에서는 Web Locks도 쓴다.
const LOCK_NAME = 'health-log-sync'
let tail: Promise<unknown> = Promise.resolve()

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = (): Promise<T> =>
    typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request(LOCK_NAME, fn) : fn()
  const next = tail.then(run, run)
  tail = next.catch(() => undefined)
  return next
}

/** 올리기 결과. off: 클라우드 백업이 꺼져 있음, held: 사용자가 고를 때까지 멈춤, unchanged: 올릴 것이 없음 */
export type PushOutcome = 'off' | 'held' | 'unchanged' | 'uploaded' | 'conflict'

/**
 * 지금 기록을 올린다.
 * auto: 마지막으로 올린 뒤 기록이 그대로면 아무것도 하지 않는다.
 * manual: 기록이 그대로여도 서버의 버전을 확인한다.
 * overwrite: 멈춰 있어도 서버의 지금 버전 위에 덮어쓴다(사용자가 덮어쓰기를 골랐을 때만).
 * 실패하면 상태에 이유를 적고 던진다.
 */
async function push(mode: 'auto' | 'manual' | 'overwrite', deps: SyncDeps): Promise<PushOutcome> {
  const code = await getSyncCode()
  if (code === null) return 'off'
  let state = await getSyncState()
  if (state.hold !== null && mode !== 'overwrite') return 'held'
  const now = deps.now()
  try {
    const { token, key } = await deriveKeys(code)
    if (!state.claimed) {
      await deps.api.claim(token)
      state = await patchSyncState({ claimed: true })
    }
    const backup = await exportBackup(new Date(now))
    const hash = await backupHash(backup)
    let expected = state.version
    if (mode === 'overwrite') {
      expected = (await deps.api.status(token)).version
    } else if (hash === state.hash && state.version !== null) {
      if (mode === 'auto') return 'unchanged'
      if ((await deps.api.status(token)).version === state.version) {
        await patchSyncState({ lastError: null })
        return 'unchanged'
      }
      // 서버의 버전이 달라졌다. 그대로 올려 보면 서버가 거절하고(412) 아래에서 멈춘다.
    }
    const bytes = await sealBackup(key, JSON.stringify(backup))
    if (bytes.byteLength > MAX_SNAPSHOT_BYTES) throw new SyncError('too_large')
    const snapshot = await deps.api.upload(token, bytes, expected)
    await db.transaction('rw', db.settings, async () => {
      await patchSyncState({
        version: snapshot.version,
        hash,
        lastUploadAt: now,
        hold: null,
        remote: null,
        lastError: null,
      })
      await db.settings.put({ key: SETTING_KEYS.lastBackupAt, value: now })
    })
    return 'uploaded'
  } catch (e) {
    if (e instanceof SyncError && e.code === 'version_mismatch') {
      // 이 폰의 다른 탭이 방금 올린 것이면 다른 기기가 아니다.
      const latest = await getSyncState()
      if (e.current !== null && latest.version === e.current.version) return 'unchanged'
      await patchSyncState({ hold: 'conflict', remote: e.current, lastError: null })
      return 'conflict'
    }
    await patchSyncState({ lastError: { at: now, code: failureOf(e) } })
    throw e
  }
}

/**
 * 클라우드 백업을 시작한다: 복구 코드를 만들고, 서버에 등록하고, 지금 기록을 올린다. 만든 코드를 돌려준다.
 * 코드는 서버에 등록하기 전에 폰에 먼저 저장한다. 등록 요청은 갔는데 답을 못 받은 경우에도 코드를 잃지 않기 위해서다.
 * 서버가 등록을 받지 않은 것이 분명할 때만(이미 다른 코드가 있음, 서버가 없음) 코드를 지우고 던진다.
 * 그 밖의 실패는 코드를 남긴 채 던지고, 다음에 올릴 때 등록부터 다시 한다.
 */
export function startCloudBackup(deps: SyncDeps = defaultDeps()): Promise<string> {
  return exclusive(async () => {
    const existing = await getSyncCode()
    if (existing !== null) return existing
    const code = generateCode()
    await saveSyncLink(code, EMPTY_SYNC_STATE)
    try {
      await push('manual', deps)
    } catch (e) {
      if (e instanceof SyncError && (e.code === 'already_claimed' || e.code === 'unavailable')) await clearSyncLink()
      throw e
    }
    return code
  })
}

/**
 * 적은 복구 코드로 이미 있는 클라우드 백업에 연결한다(새 폰에서). 연결한 뒤의 상태를 돌려준다.
 * 클라우드에 백업이 있으면 hold가 'connected'가 되어, 복원하거나 덮어쓰기를 고를 때까지 올리지 않는다(규칙 1).
 */
export function connectWithCode(input: string, deps: SyncDeps = defaultDeps()): Promise<SyncState> {
  return exclusive(async () => {
    const code = normalizeCode(input)
    if (code === null) throw new SyncError('bad_code')
    const { token } = await deriveKeys(code)
    const remote = (await deps.api.status(token)).snapshots[0] ?? null
    const state: SyncState = { ...EMPTY_SYNC_STATE, claimed: true, hold: remote ? 'connected' : null, remote }
    await saveSyncLink(code, state)
    return state
  })
}

/** "지금 올리기" */
export function uploadNow(deps: SyncDeps = defaultDeps()): Promise<PushOutcome> {
  return exclusive(() => push('manual', deps))
}

/** 클라우드의 백업을 이 폰의 기록으로 덮어쓴다. 멈춰 있을 때 사용자가 덮어쓰기를 고르면 부른다. */
export function overwriteCloud(deps: SyncDeps = defaultDeps()): Promise<PushOutcome> {
  return exclusive(() => push('overwrite', deps))
}

/** 클라우드에 남아 있는 스냅샷(새것부터) */
export async function listCloudSnapshots(deps: SyncDeps = defaultDeps()): Promise<SnapshotMeta[]> {
  const code = await getSyncCode()
  if (code === null) return []
  const { token } = await deriveKeys(code)
  return (await deps.api.status(token)).snapshots
}

/**
 * 클라우드의 스냅샷으로 이 폰의 기록을 바꾼다. version이 null이면 가장 새것. 복원한 스냅샷을 돌려준다.
 * 이 폰에만 두는 설정(복구 코드, API 키 등)은 그대로 남는다.
 */
export function restoreFromCloud(version: number | null, deps: SyncDeps = defaultDeps()): Promise<SnapshotMeta> {
  return exclusive(async () => {
    const code = await getSyncCode()
    if (code === null) throw new SyncError('unknown')
    const { token, key } = await deriveKeys(code)
    const status = await deps.api.status(token)
    const meta = version === null ? status.snapshots[0] : status.snapshots.find((s) => s.version === version)
    if (!meta) throw new SyncError('no_snapshot')
    const text = await openBackup(key, await deps.api.download(token, meta.version))
    let backup: BackupFile
    try {
      backup = parseBackup(text)
    } catch (e) {
      throw new SyncError('bad_backup', { detail: e instanceof Error ? e.message : undefined })
    }
    await importBackup(backup)
    await ensureSeedExercises()
    // 규칙 3: 방금 복원한 기록의 해시를 적어 둔다. 가장 새것을 복원했으면 클라우드와 같으니 다시 올리지 않는다.
    // 예전 것을 복원했으면 해시를 비워, 다음 자동 올리기 때 이 기록이 클라우드의 최신이 되게 한다.
    const hash = meta.version === status.version ? await backupHash(await exportBackup()) : null
    await patchSyncState({ claimed: true, version: status.version, hash, hold: null, remote: null, lastError: null })
    return meta
  })
}

/** 이 폰에서만 클라우드 백업을 끈다. 클라우드의 백업은 남는다. */
export function disconnectCloud(): Promise<void> {
  return exclusive(clearSyncLink)
}

/** 클라우드의 백업을 모두 지우고 이 폰의 연결도 끊는다. 이 폰의 기록은 그대로다. */
export function wipeCloud(deps: SyncDeps = defaultDeps()): Promise<void> {
  return exclusive(async () => {
    const code = await getSyncCode()
    if (code === null) return
    const { token } = await deriveKeys(code)
    try {
      await deps.api.wipe(token)
    } catch (e) {
      // 이미 지워져 있으면 된 것으로 본다.
      if (!(e instanceof SyncError && e.code === 'not_claimed')) throw e
    }
    await clearSyncLink()
  })
}

/** 자동 올리기를 부른 까닭. workout-end(운동을 끝냄)는 간격 제한을 받지 않는다. */
export type AutoTrigger = 'open' | 'visible' | 'online' | 'workout-end' | 'timer'

export type AutoResult =
  | { outcome: PushOutcome | 'offline' | 'workout' | 'failed' }
  /** 올린 지 얼마 안 됐다. retryInMs 뒤에 다시 불러 보면 된다. */
  | { outcome: 'throttled'; retryInMs: number }

/**
 * 조용히 올린다. 클라우드 백업이 켜져 있고, 멈춰 있지 않고, 인터넷이 되고, 진행 중인 운동이 없고,
 * 마지막으로 올린 뒤 기록이 바뀌었을 때만 올린다. 던지지 않는다(실패는 상태에 적혀 설정 화면에 보인다).
 */
export async function autoSync(trigger: AutoTrigger, deps: SyncDeps = defaultDeps()): Promise<AutoResult> {
  try {
    if ((await getSyncCode()) === null) return { outcome: 'off' }
    const state = await getSyncState()
    if (state.hold !== null) return { outcome: 'held' }
    if (!deps.online()) return { outcome: 'offline' }
    if (await getActiveWorkout()) return { outcome: 'workout' }
    if (trigger !== 'workout-end') {
      const last = Math.max(state.lastUploadAt ?? 0, state.lastError?.at ?? 0)
      const wait = last + AUTO_MIN_INTERVAL_MS - deps.now()
      // 폰의 시계가 뒤로 갔으면(마지막 시각이 앞날이면) 기다리지 않는다.
      if (wait > 0 && wait <= AUTO_MIN_INTERVAL_MS) return { outcome: 'throttled', retryInMs: wait }
    }
    return { outcome: await exclusive(() => push('auto', deps)) }
  } catch {
    return { outcome: 'failed' }
  }
}
