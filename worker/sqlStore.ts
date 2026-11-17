// SQLite 위의 보관함. Durable Object의 ctx.storage.sql로 돌고, 테스트에서는 Node의 node:sqlite로 같은 SQL을 돌린다.
// SQLite의 한 줄은 8MB를 넘을 수 없어서 스냅샷의 바이트를 1MB 조각으로 나눠 넣는다.
import type { PutResult, VaultStore } from './protocol.ts'
import type { SnapshotMeta } from './wire.ts'

export type SqlValue = string | number | Uint8Array
/** 읽은 값. BLOB은 Durable Object에서는 ArrayBuffer로, node:sqlite에서는 Uint8Array로 온다. */
export type SqlCell = string | number | null | ArrayBuffer | Uint8Array

/** sqlStore가 쓰는 만큼의 SQLite. 호출은 모두 동기다. */
export interface SqlRunner {
  /** 문장 하나를 돌리고 결과 줄을 모두 돌려준다. */
  all(query: string, ...bindings: SqlValue[]): Record<string, SqlCell>[]
  /** fn 안의 일을 한 트랜잭션으로 한다(던지면 모두 되돌린다). */
  transaction<T>(fn: () => T): T
}

/** 조각 하나의 크기(바이트). 한 줄 8MB 제한보다 훨씬 작게 잡는다. */
export const CHUNK_BYTES = 1024 * 1024

const OWNER_KEY = 'owner'

/** 표를 만든다(이미 있으면 그대로 둔다). */
export function createSchema(db: SqlRunner): void {
  db.all('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.all(
    `CREATE TABLE IF NOT EXISTS snapshots (
      version INTEGER PRIMARY KEY, created_at INTEGER NOT NULL, size INTEGER NOT NULL)`,
  )
  db.all(
    `CREATE TABLE IF NOT EXISTS chunks (
      version INTEGER NOT NULL, seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (version, seq))`,
  )
}

function toBytes(cell: SqlCell): Uint8Array {
  if (cell instanceof Uint8Array) return cell
  if (cell instanceof ArrayBuffer) return new Uint8Array(cell)
  throw new Error('BLOB이 아닌 값')
}

function listSnapshots(db: SqlRunner): SnapshotMeta[] {
  return db
    .all('SELECT version, created_at, size FROM snapshots ORDER BY version DESC')
    .map((r) => ({ version: Number(r.version), createdAt: Number(r.created_at), size: Number(r.size) }))
}

function readOwner(db: SqlRunner): string | null {
  const row = db.all('SELECT value FROM meta WHERE key = ?', OWNER_KEY)[0]
  return row ? String(row.value) : null
}

/** 표가 이미 만들어져 있는 SQLite를 보관함으로 쓴다. */
export function createSqlStore(db: SqlRunner): VaultStore {
  return {
    async owner() {
      return readOwner(db)
    },

    async claim(tokenHash) {
      return db.transaction(() => {
        if (readOwner(db) !== null) return false
        db.all('INSERT INTO meta (key, value) VALUES (?, ?)', OWNER_KEY, tokenHash)
        return true
      })
    },

    async snapshots() {
      return listSnapshots(db)
    },

    async put(expected, bytes, now, keep): Promise<PutResult> {
      return db.transaction((): PutResult => {
        const current = listSnapshots(db)[0] ?? null
        if ((current?.version ?? null) !== expected) return { ok: false, current }
        const snapshot: SnapshotMeta = { version: (current?.version ?? 0) + 1, createdAt: now, size: bytes.byteLength }
        db.all(
          'INSERT INTO snapshots (version, created_at, size) VALUES (?, ?, ?)',
          snapshot.version,
          snapshot.createdAt,
          snapshot.size,
        )
        for (let seq = 0; seq * CHUNK_BYTES < bytes.byteLength; seq++) {
          const chunk = bytes.slice(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES)
          db.all('INSERT INTO chunks (version, seq, data) VALUES (?, ?, ?)', snapshot.version, seq, chunk)
        }
        // 새것부터 keep개만 남긴다.
        const oldest = snapshot.version - keep
        db.all('DELETE FROM chunks WHERE version <= ?', oldest)
        db.all('DELETE FROM snapshots WHERE version <= ?', oldest)
        return { ok: true, snapshot }
      })
    },

    async read(version) {
      const meta = db.all('SELECT size FROM snapshots WHERE version = ?', version)[0]
      if (!meta) return null
      const out = new Uint8Array(Number(meta.size))
      let offset = 0
      for (const row of db.all('SELECT data FROM chunks WHERE version = ? ORDER BY seq', version)) {
        const chunk = toBytes(row.data)
        if (offset + chunk.byteLength > out.byteLength) throw new Error('조각이 스냅샷보다 큼')
        out.set(chunk, offset)
        offset += chunk.byteLength
      }
      if (offset !== out.byteLength) throw new Error('조각이 모자람')
      return out
    },

    async wipe() {
      db.transaction(() => {
        db.all('DELETE FROM chunks')
        db.all('DELETE FROM snapshots')
        db.all('DELETE FROM meta')
      })
    },
  }
}
