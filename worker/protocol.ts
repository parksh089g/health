// 클라우드 백업 서버의 규칙. 요청 하나를 받아 보관함(VaultStore)을 읽고 쓴 뒤 답을 만든다.
// 웹 표준 API만 쓰고 지워지는 타입 문법만 쓴다. 그래서 Worker, vitest, Node(e2e의 흉내 서버)가 같은 파일을 그대로 돌린다.
//
//   GET    /api/sync/hello               누구나. 여기에 서버가 있는지, 보관함에 주인이 있는지
//   POST   /api/sync/claim               주인이 없으면 이 토큰이 주인이 된다(처음 온 사람이 주인)
//   GET    /api/sync/status              최신 버전과 남아 있는 스냅샷 목록
//   PUT    /api/sync/snapshot            새 스냅샷. If-Match에 마지막으로 본 버전(처음이면 none)
//   GET    /api/sync/snapshot[?version=] 최신(또는 고른) 스냅샷의 바이트
//   DELETE /api/sync/vault               스냅샷을 모두 지우고 주인도 없앤다
//
// hello 말고는 모두 Authorization: Bearer <토큰>이 있어야 한다. 서버는 토큰의 SHA-256만 갖고 있다.
// 스냅샷은 앱이 암호화한 바이트라서 서버는 내용을 모른다.
import {
  IF_MATCH_NONE,
  KEEP_SNAPSHOTS,
  MAX_SNAPSHOT_BYTES,
  SYNC_PREFIX,
  SYNC_PROTOCOL,
  SYNC_SERVICE,
  type ErrorBody,
  type HelloBody,
  type SnapshotMeta,
  type StatusBody,
  type SyncErrorCode,
  type UploadBody,
} from './wire.ts'

export type PutResult = { ok: true; snapshot: SnapshotMeta } | { ok: false; current: SnapshotMeta | null }

/** 보관함 하나의 저장소. Durable Object(SQLite)와 테스트용 메모리 구현이 있다. */
export interface VaultStore {
  /** 주인의 토큰 해시(SHA-256, 16진수). 주인이 없으면 null */
  owner(): Promise<string | null>
  /** 주인이 없을 때만 주인을 정한다. 이번에 정했으면 true */
  claim(tokenHash: string): Promise<boolean>
  /** 남아 있는 스냅샷(새것부터) */
  snapshots(): Promise<SnapshotMeta[]>
  /**
   * 지금 최신 버전이 expected(없으면 null)와 같을 때만 새 스냅샷을 넣고, keep개를 넘는 오래된 것을 지운다.
   * 비교와 저장은 한 번에 일어나야 한다(사이에 다른 요청이 끼어들면 안 된다).
   */
  put(expected: number | null, bytes: Uint8Array, now: number, keep: number): Promise<PutResult>
  /** 그 버전의 바이트. 없으면 null */
  read(version: number): Promise<Uint8Array | null>
  /** 스냅샷과 주인을 모두 지운다. */
  wipe(): Promise<void>
}

const BASE_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
const JSON_HEADERS = { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }

function json(status: number, body: object, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } })
}

function fail(
  status: number,
  error: SyncErrorCode,
  extra: Partial<ErrorBody> = {},
  headers?: Record<string, string>,
): Response {
  const body: ErrorBody = { error, ...extra }
  return json(status, body, headers)
}

/** 토큰은 base64url 글자 32~128자여야 한다. 아니면 null */
function bearerToken(request: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get('Authorization') ?? '')
  return match ? match[1] : null
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** 길이가 같은 두 해시를 끝까지 비교한다(앞에서 틀려도 걸리는 시간이 같게). */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** 주인의 토큰인지 본다. 아니면 돌려줄 오류 답을 준다. */
async function authorize(request: Request, store: VaultStore): Promise<Response | null> {
  const token = bearerToken(request)
  if (token === null) return fail(401, 'unauthorized', {}, { 'WWW-Authenticate': 'Bearer' })
  const owner = await store.owner()
  if (owner === null) return fail(409, 'not_claimed')
  return sameHash(await sha256Hex(token), owner) ? null : fail(403, 'forbidden')
}

async function status(store: VaultStore): Promise<StatusBody> {
  const snapshots = await store.snapshots()
  return { version: snapshots[0]?.version ?? null, snapshots }
}

/** If-Match 값: none이면 null, "3"이나 3이면 3. 없으면 undefined, 모양이 틀리면 NaN */
function parseIfMatch(value: string | null): number | null | undefined {
  if (value === null) return undefined
  const text = value.trim().replace(/^"(.*)"$/, '$1')
  if (text === IF_MATCH_NONE) return null
  return /^[1-9]\d{0,14}$/.test(text) ? Number(text) : NaN
}

/** 요청 본문을 max 바이트까지만 읽는다. 넘으면 null */
async function readBody(request: Request, max: number): Promise<Uint8Array | null> {
  if (request.body === null) return new Uint8Array(0)
  const reader = request.body.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    parts.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

/**
 * Content-Length가 한도를 넘는 요청이면 돌려줄 답. 본문을 읽기 전에 거절한다.
 * Worker도 Durable Object로 넘기기 전에 이것으로 걸러 낸다(넘긴 뒤에 본문을 읽지 않고 답하면 런타임이 오류를 남긴다).
 */
export function rejectTooLarge(request: Request): Response | null {
  return Number(request.headers.get('Content-Length') ?? 0) > MAX_SNAPSHOT_BYTES ? fail(413, 'too_large') : null
}

async function claim(request: Request, store: VaultStore): Promise<Response> {
  const token = bearerToken(request)
  if (token === null) return fail(401, 'unauthorized', {}, { 'WWW-Authenticate': 'Bearer' })
  const hash = await sha256Hex(token)
  if (await store.claim(hash)) return json(201, await status(store))
  // 이미 주인이 있다. 같은 토큰이면 다시 불러도 괜찮다(답을 못 받고 다시 시도한 경우).
  const owner = await store.owner()
  return owner !== null && sameHash(hash, owner) ? json(200, await status(store)) : fail(403, 'already_claimed')
}

async function upload(request: Request, store: VaultStore, now: number): Promise<Response> {
  const expected = parseIfMatch(request.headers.get('If-Match'))
  if (expected === undefined) return fail(428, 'precondition_required')
  if (Number.isNaN(expected)) return fail(400, 'bad_request')
  const tooLarge = rejectTooLarge(request)
  if (tooLarge) return tooLarge
  const bytes = await readBody(request, MAX_SNAPSHOT_BYTES)
  if (bytes === null) return fail(413, 'too_large')
  if (bytes.byteLength === 0) return fail(400, 'bad_request')
  const result = await store.put(expected, bytes, now, KEEP_SNAPSHOTS)
  if (!result.ok) return fail(412, 'version_mismatch', { current: result.current })
  const body: UploadBody = { snapshot: result.snapshot }
  return json(201, body, { ETag: `"${result.snapshot.version}"` })
}

async function download(url: URL, store: VaultStore): Promise<Response> {
  const asked = url.searchParams.get('version')
  if (asked !== null && !/^[1-9]\d{0,14}$/.test(asked)) return fail(400, 'bad_request')
  const snapshots = await store.snapshots()
  const meta = asked === null ? snapshots[0] : snapshots.find((s) => s.version === Number(asked))
  const bytes = meta ? await store.read(meta.version) : null
  if (!meta || bytes === null) return fail(404, 'no_snapshot')
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/octet-stream',
      ETag: `"${meta.version}"`,
      'X-Snapshot-Version': String(meta.version),
      'X-Snapshot-Created-At': String(meta.createdAt),
    },
  })
}

const ROUTES: Record<string, string[]> = {
  hello: ['GET'],
  claim: ['POST'],
  status: ['GET'],
  snapshot: ['GET', 'PUT'],
  vault: ['DELETE'],
}

/** /api/sync/ 아래의 요청 하나를 처리한다. now는 테스트에서 시각을 정할 때만 준다. */
export async function handleSync(request: Request, store: VaultStore, now: () => number = Date.now): Promise<Response> {
  try {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(SYNC_PREFIX)) return fail(404, 'not_found')
    const route = url.pathname.slice(SYNC_PREFIX.length)
    const methods = Object.hasOwn(ROUTES, route) ? ROUTES[route] : undefined
    if (methods === undefined) return fail(404, 'not_found')
    if (!methods.includes(request.method)) return fail(405, 'method_not_allowed', {}, { Allow: methods.join(', ') })

    if (route === 'hello') {
      const claimed = (await store.owner()) !== null
      const body: HelloBody = { service: SYNC_SERVICE, protocol: SYNC_PROTOCOL, claimed }
      return json(200, body)
    }
    if (route === 'claim') return await claim(request, store)

    const denied = await authorize(request, store)
    if (denied) return denied
    if (route === 'status') return json(200, await status(store))
    if (route === 'snapshot') {
      return request.method === 'PUT' ? await upload(request, store, now()) : await download(url, store)
    }
    await store.wipe()
    return json(200, { wiped: true })
  } catch {
    // 무엇이 틀렸는지는 답에 넣지 않는다(토큰이나 저장소 내용이 새지 않게).
    return fail(500, 'server_error')
  }
}
