// 메모리 안의 보관함. 테스트와 e2e의 흉내 서버가 쓴다(실제 서버는 worker/sqlStore.ts).
import type { PutResult, VaultStore } from './protocol.ts'
import type { SnapshotMeta } from './wire.ts'

export interface MemoryStore extends VaultStore {
  /** 지금까지 받은 스냅샷 수(지워진 것 포함). 올리기가 일어났는지 볼 때 쓴다. */
  readonly uploads: number
}

export function createMemoryStore(): MemoryStore {
  let owner: string | null = null
  /** 새것부터 */
  let kept: { meta: SnapshotMeta; bytes: Uint8Array }[] = []
  let uploads = 0

  return {
    get uploads() {
      return uploads
    },
    async owner() {
      return owner
    },
    async claim(tokenHash) {
      if (owner !== null) return false
      owner = tokenHash
      return true
    },
    async snapshots() {
      return kept.map((s) => ({ ...s.meta }))
    },
    async put(expected, bytes, now, keep): Promise<PutResult> {
      const current = kept[0]?.meta ?? null
      if ((current?.version ?? null) !== expected) return { ok: false, current: current ? { ...current } : null }
      const meta: SnapshotMeta = { version: (current?.version ?? 0) + 1, createdAt: now, size: bytes.byteLength }
      kept = [{ meta, bytes: bytes.slice() }, ...kept].slice(0, keep)
      uploads += 1
      return { ok: true, snapshot: { ...meta } }
    },
    async read(version) {
      return kept.find((s) => s.meta.version === version)?.bytes.slice() ?? null
    },
    async wipe() {
      owner = null
      kept = []
    },
  }
}
