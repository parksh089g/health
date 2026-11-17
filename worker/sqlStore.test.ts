import { describe, expect, it } from 'vitest'
import { createNodeSqlRunner } from './nodeSqlite.ts'
import { CHUNK_BYTES, createSchema, createSqlStore, type SqlRunner } from './sqlStore.ts'

function setup() {
  const db = createNodeSqlRunner()
  createSchema(db)
  return { db, store: createSqlStore(db) }
}

/** 자리마다 값이 다른 n바이트 */
function pattern(n: number): Uint8Array {
  const bytes = new Uint8Array(n)
  for (let i = 0; i < n; i++) bytes[i] = (i * 31 + (i >> 8)) & 0xff
  return bytes
}

const chunkSizes = (db: SqlRunner, version: number) =>
  db.all('SELECT seq, length(data) AS n FROM chunks WHERE version = ? ORDER BY seq', version).map((r) => [r.seq, r.n])

describe('sqlStore', () => {
  it('표는 여러 번 만들어도 된다', () => {
    const { db } = setup()
    createSchema(db)
    expect(db.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name)).toEqual([
      'chunks',
      'meta',
      'snapshots',
    ])
  })

  it('1MB 조각으로 나눠 넣고 읽을 때 다시 잇는다', async () => {
    const { db, store } = setup()
    const sizes = [1, CHUNK_BYTES - 1, CHUNK_BYTES, CHUNK_BYTES + 1, 2 * CHUNK_BYTES + 12345]
    for (const [i, size] of sizes.entries()) {
      const bytes = pattern(size)
      const result = await store.put(i === 0 ? null : i, bytes, 1_000 + i, 10)
      expect(result).toEqual({ ok: true, snapshot: { version: i + 1, createdAt: 1_000 + i, size } })
      const back = await store.read(i + 1)
      expect(back?.length).toBe(size)
      expect(back?.every((b, at) => b === bytes[at])).toBe(true)
    }
    expect(chunkSizes(db, 1)).toEqual([[0, 1]])
    expect(chunkSizes(db, 2)).toEqual([[0, CHUNK_BYTES - 1]])
    expect(chunkSizes(db, 3)).toEqual([[0, CHUNK_BYTES]])
    expect(chunkSizes(db, 4)).toEqual([
      [0, CHUNK_BYTES],
      [1, 1],
    ])
    expect(chunkSizes(db, 5)).toEqual([
      [0, CHUNK_BYTES],
      [1, CHUNK_BYTES],
      [2, 12345],
    ])
  })

  it('버퍼의 일부만 가리키는 배열도 그 부분만 넣는다', async () => {
    const { store } = setup()
    const whole = pattern(64)
    await store.put(null, whole.subarray(10, 20), 1, 10)
    expect(Array.from((await store.read(1)) ?? [])).toEqual(Array.from(whole.slice(10, 20)))
  })

  it('버전이 다르면 아무것도 넣지 않는다', async () => {
    const { db, store } = setup()
    await store.put(null, pattern(10), 1, 10)
    const refused = { ok: false, current: { version: 1, createdAt: 1, size: 10 } }
    expect(await store.put(null, pattern(20), 2, 10)).toEqual(refused)
    expect(await store.put(5, pattern(20), 2, 10)).toEqual(refused)
    expect(db.all('SELECT COUNT(*) AS n FROM chunks')[0].n).toBe(1)
    expect((await store.snapshots()).map((s) => s.version)).toEqual([1])
  })

  it('오래된 스냅샷을 지울 때 조각도 함께 지운다', async () => {
    const { db, store } = setup()
    for (let v = 0; v < 5; v++) await store.put(v === 0 ? null : v, pattern(CHUNK_BYTES + 5), v, 2)
    expect((await store.snapshots()).map((s) => s.version)).toEqual([5, 4])
    expect(db.all('SELECT DISTINCT version FROM chunks ORDER BY version').map((r) => r.version)).toEqual([4, 5])
    expect(await store.read(3)).toBeNull()
  })

  it('넣다가 실패하면 통째로 되돌린다', async () => {
    const { db, store } = setup()
    await store.put(null, pattern(10), 1, 10)
    // 조각을 넣을 자리에 같은 열쇠를 미리 넣어 두어 중간에 실패하게 한다.
    db.all('INSERT INTO chunks (version, seq, data) VALUES (2, 1, ?)', pattern(1))
    await expect(store.put(1, pattern(CHUNK_BYTES + 1), 2, 10)).rejects.toThrow()
    expect((await store.snapshots()).map((s) => s.version)).toEqual([1])
    expect(db.all('SELECT version, seq FROM chunks ORDER BY version, seq').map((r) => [r.version, r.seq])).toEqual([
      [1, 0],
      [2, 1],
    ])
  })

  it('주인은 한 번만 정해지고, wipe 뒤에는 비어 있다', async () => {
    const { db, store } = setup()
    expect(await store.owner()).toBeNull()
    expect(await store.claim('hash-a')).toBe(true)
    expect(await store.claim('hash-b')).toBe(false)
    expect(await store.owner()).toBe('hash-a')
    await store.put(null, pattern(CHUNK_BYTES * 2), 1, 10)

    await store.wipe()
    expect(await store.owner()).toBeNull()
    expect(await store.snapshots()).toEqual([])
    expect(await store.read(1)).toBeNull()
    for (const table of ['meta', 'snapshots', 'chunks']) {
      expect(db.all(`SELECT COUNT(*) AS n FROM ${table}`)[0].n).toBe(0)
    }
    // 지운 뒤에는 버전이 1부터 다시 시작한다.
    expect(await store.put(null, pattern(3), 9, 10)).toMatchObject({ ok: true, snapshot: { version: 1 } })
  })
})
