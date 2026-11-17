import { describe, expect, it } from 'vitest'
import { createMemoryStore } from './memoryStore.ts'
import { createNodeSqlRunner } from './nodeSqlite.ts'
import { handleSync, type VaultStore } from './protocol.ts'
import { createSchema, createSqlStore } from './sqlStore.ts'
import { KEEP_SNAPSHOTS, MAX_SNAPSHOT_BYTES, type StatusBody } from './wire.ts'

const TOKEN_A = 'A'.repeat(43)
const TOKEN_B = 'B'.repeat(43)

interface CallInit {
  token?: string
  ifMatch?: string
  body?: Uint8Array<ArrayBuffer> | string
  headers?: Record<string, string>
}

function sqlStore(): VaultStore {
  const db = createNodeSqlRunner()
  createSchema(db)
  return createSqlStore(db)
}

// 같은 규칙을 메모리 보관함과 SQLite 보관함(Durable Object가 쓰는 SQL)에 모두 돌려 본다.
describe.each([
  ['메모리 보관함', createMemoryStore],
  ['SQLite 보관함', sqlStore],
])('handleSync (%s)', (_name, createStore) => {
  let clock = 1_000
  const setup = () => {
    clock = 1_000
    const store = createStore()
    const call = (method: string, path: string, init: CallInit = {}) => {
      const headers = new Headers(init.headers)
      if (init.token) headers.set('Authorization', `Bearer ${init.token}`)
      if (init.ifMatch !== undefined) headers.set('If-Match', init.ifMatch)
      const request = new Request(`https://health.example/api/sync/${path}`, { method, headers, body: init.body })
      return handleSync(request, store, () => clock)
    }
    const upload = (body: string, ifMatch: string, token = TOKEN_A) => call('PUT', 'snapshot', { token, ifMatch, body })
    return { store, call, upload }
  }
  const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error

  it('hello는 토큰 없이도 답하고 주인이 있는지 알려 준다', async () => {
    const { call } = setup()
    const before = await call('GET', 'hello')
    expect(before.status).toBe(200)
    expect(before.headers.get('Cache-Control')).toBe('no-store')
    expect(await before.json()).toEqual({ service: 'health-log-sync', protocol: 1, claimed: false })

    await call('POST', 'claim', { token: TOKEN_A })
    expect(await (await call('GET', 'hello')).json()).toMatchObject({ claimed: true })
  })

  it('처음 claim한 토큰이 주인이 되고, 다른 토큰은 거절된다', async () => {
    const { call, store } = setup()
    const first = await call('POST', 'claim', { token: TOKEN_A })
    expect(first.status).toBe(201)
    expect(await first.json()).toEqual({ version: null, snapshots: [] })
    // 서버에는 토큰이 아니라 해시만 남는다.
    const owner = await store.owner()
    expect(owner).toMatch(/^[0-9a-f]{64}$/)
    expect(owner).not.toContain(TOKEN_A)

    // 같은 토큰으로 다시 불러도 된다(답을 못 받고 다시 시도한 경우).
    expect((await call('POST', 'claim', { token: TOKEN_A })).status).toBe(200)

    const other = await call('POST', 'claim', { token: TOKEN_B })
    expect(other.status).toBe(403)
    expect(await errorOf(other)).toBe('already_claimed')
    expect(await store.owner()).toBe(owner)
  })

  it('토큰이 없거나 모양이 틀리면 401, 주인이 없으면 409, 주인이 아니면 403', async () => {
    const { call } = setup()
    const unclaimed = await call('GET', 'status', { token: TOKEN_A })
    expect(unclaimed.status).toBe(409)
    expect(await errorOf(unclaimed)).toBe('not_claimed')

    await call('POST', 'claim', { token: TOKEN_A })
    const routes: [string, string][] = [
      ['GET', 'status'],
      ['GET', 'snapshot'],
      ['PUT', 'snapshot'],
      ['DELETE', 'vault'],
    ]
    for (const [method, path] of routes) {
      const body = method === 'PUT' ? 'x' : undefined
      const none = await call(method, path, { body, ifMatch: 'none' })
      expect(none.status, `${method} ${path} 토큰 없음`).toBe(401)
      expect(await errorOf(none)).toBe('unauthorized')
      const short = await call(method, path, { body, ifMatch: 'none', headers: { Authorization: 'Bearer short' } })
      expect(short.status, `${method} ${path} 짧은 토큰`).toBe(401)
      const wrong = await call(method, path, { body, ifMatch: 'none', token: TOKEN_B })
      expect(wrong.status, `${method} ${path} 다른 토큰`).toBe(403)
      expect(await errorOf(wrong)).toBe('forbidden')
    }
    expect((await call('POST', 'claim')).status).toBe(401)
    // 거절된 요청은 아무것도 바꾸지 않는다.
    expect(await (await call('GET', 'status', { token: TOKEN_A })).json()).toEqual({ version: null, snapshots: [] })
  })

  it('올리기는 If-Match가 서버의 버전과 같아야 한다', async () => {
    const { call, upload } = setup()
    await call('POST', 'claim', { token: TOKEN_A })

    const missing = await call('PUT', 'snapshot', { token: TOKEN_A, body: 'one' })
    expect(missing.status).toBe(428)
    expect(await errorOf(missing)).toBe('precondition_required')
    expect((await upload('one', 'latest')).status).toBe(400)
    expect((await upload('', 'none')).status).toBe(400)

    const first = await upload('one', 'none')
    expect(first.status).toBe(201)
    expect(first.headers.get('ETag')).toBe('"1"')
    expect(await first.json()).toEqual({ snapshot: { version: 1, createdAt: 1_000, size: 3 } })

    // 서버에 이미 있는데 처음인 줄 알고 올리면 거절하고 지금 버전을 알려 준다.
    const stale = await upload('other', 'none')
    expect(stale.status).toBe(412)
    expect(await stale.json()).toEqual({
      error: 'version_mismatch',
      current: { version: 1, createdAt: 1_000, size: 3 },
    })

    clock = 2_000
    expect((await upload('two', '"1"')).status).toBe(201)
    // 따옴표가 없어도 받는다.
    expect((await upload('three', '2')).status).toBe(201)
    expect((await upload('late', '"1"')).status).toBe(412)

    const status = (await (await call('GET', 'status', { token: TOKEN_A })).json()) as StatusBody
    expect(status.version).toBe(3)
    expect(status.snapshots.map((s) => [s.version, s.createdAt, s.size])).toEqual([
      [3, 2_000, 5],
      [2, 2_000, 3],
      [1, 1_000, 3],
    ])
  })

  it('가장 새것이나 고른 버전을 그대로 돌려준다', async () => {
    const { call, upload } = setup()
    await call('POST', 'claim', { token: TOKEN_A })
    expect((await call('GET', 'snapshot', { token: TOKEN_A })).status).toBe(404)

    await upload('one', 'none')
    clock = 5_000
    await upload('two', '1')

    const latest = await call('GET', 'snapshot', { token: TOKEN_A })
    expect(latest.status).toBe(200)
    expect(latest.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(latest.headers.get('Cache-Control')).toBe('no-store')
    expect(latest.headers.get('X-Snapshot-Version')).toBe('2')
    expect(latest.headers.get('X-Snapshot-Created-At')).toBe('5000')
    expect(await latest.text()).toBe('two')

    expect(await (await call('GET', 'snapshot?version=1', { token: TOKEN_A })).text()).toBe('one')
    const missing = await call('GET', 'snapshot?version=7', { token: TOKEN_A })
    expect(missing.status).toBe(404)
    expect(await errorOf(missing)).toBe('no_snapshot')
    expect((await call('GET', 'snapshot?version=abc', { token: TOKEN_A })).status).toBe(400)
  })

  it(`새것부터 ${KEEP_SNAPSHOTS}개만 남긴다`, async () => {
    const { call, upload } = setup()
    await call('POST', 'claim', { token: TOKEN_A })
    for (let v = 0; v < KEEP_SNAPSHOTS + 3; v++) {
      expect((await upload(`snapshot ${v + 1}`, v === 0 ? 'none' : String(v))).status).toBe(201)
    }
    const status = (await (await call('GET', 'status', { token: TOKEN_A })).json()) as StatusBody
    expect(status.version).toBe(13)
    expect(status.snapshots.map((s) => s.version)).toEqual([13, 12, 11, 10, 9, 8, 7, 6, 5, 4])
    expect((await call('GET', 'snapshot?version=3', { token: TOKEN_A })).status).toBe(404)
    expect(await (await call('GET', 'snapshot?version=4', { token: TOKEN_A })).text()).toBe('snapshot 4')
    expect(await (await call('GET', 'snapshot', { token: TOKEN_A })).text()).toBe('snapshot 13')
  })

  it('16MB를 넘는 본문은 받지 않는다', async () => {
    const { call } = setup()
    await call('POST', 'claim', { token: TOKEN_A })
    // 길이를 알려 온 요청은 본문을 읽기 전에 거절한다.
    const declared = await call('PUT', 'snapshot', {
      token: TOKEN_A,
      ifMatch: 'none',
      body: 'x',
      headers: { 'Content-Length': String(MAX_SNAPSHOT_BYTES + 1) },
    })
    expect(declared.status).toBe(413)
    expect(await errorOf(declared)).toBe('too_large')
    // 길이를 알리지 않아도 읽다가 한도를 넘으면 멈춘다.
    const body = new Uint8Array(MAX_SNAPSHOT_BYTES + 1)
    const tooBig = await call('PUT', 'snapshot', { token: TOKEN_A, ifMatch: 'none', body })
    expect(tooBig.status).toBe(413)
    expect(await (await call('GET', 'status', { token: TOKEN_A })).json()).toEqual({ version: null, snapshots: [] })

    // 딱 한도까지는 받고, 받은 그대로 돌려준다(SQLite 보관함은 1MB 조각 16개로 나눠 넣는다).
    const full = new Uint8Array(MAX_SNAPSHOT_BYTES)
    for (let i = 0; i < full.length; i += 4099) full[i] = (i % 251) + 1
    full[full.length - 1] = 7
    expect((await call('PUT', 'snapshot', { token: TOKEN_A, ifMatch: 'none', body: full })).status).toBe(201)
    const back = new Uint8Array(await (await call('GET', 'snapshot', { token: TOKEN_A })).arrayBuffer())
    expect(back.length).toBe(full.length)
    expect(back.every((b, i) => b === full[i])).toBe(true)
  })

  it('wipe는 스냅샷과 주인을 모두 지우고, 그 뒤에는 누구든 다시 주인이 될 수 있다', async () => {
    const { call, upload } = setup()
    await call('POST', 'claim', { token: TOKEN_A })
    await upload('one', 'none')

    expect((await call('DELETE', 'vault', { token: TOKEN_B })).status).toBe(403)
    const wiped = await call('DELETE', 'vault', { token: TOKEN_A })
    expect(wiped.status).toBe(200)
    expect(await (await call('GET', 'hello')).json()).toMatchObject({ claimed: false })
    expect((await call('GET', 'status', { token: TOKEN_A })).status).toBe(409)

    expect((await call('POST', 'claim', { token: TOKEN_B })).status).toBe(201)
    expect(await (await call('GET', 'status', { token: TOKEN_B })).json()).toEqual({ version: null, snapshots: [] })
    expect((await call('GET', 'status', { token: TOKEN_A })).status).toBe(403)
  })

  it('없는 주소는 404, 틀린 메서드는 405이고 모든 답이 no-store다', async () => {
    const { call } = setup()
    const responses = [
      await call('GET', 'nope'),
      await call('GET', ''),
      await call('POST', 'hello'),
      await call('GET', 'claim'),
      await call('POST', 'status', { token: TOKEN_A }),
      await call('GET', 'status'),
    ]
    expect(responses.map((r) => r.status)).toEqual([404, 404, 405, 405, 405, 401])
    expect(responses[2].headers.get('Allow')).toBe('GET')
    for (const res of responses) {
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(res.headers.get('Content-Type')).toContain('application/json')
    }
    const outside = await handleSync(new Request('https://health.example/api/other'), createStore())
    expect(outside.status).toBe(404)
  })

  it('보관함이 던지면 내용을 드러내지 않고 500으로 답한다', async () => {
    const store = createStore()
    store.owner = async () => {
      throw new Error(`secret ${TOKEN_A}`)
    }
    const res = await handleSync(new Request('https://health.example/api/sync/hello'), store)
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('{"error":"server_error"}')
  })
})
