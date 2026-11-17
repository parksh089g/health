import {
  IF_MATCH_NONE,
  SYNC_PREFIX,
  SYNC_SERVICE,
  type ErrorBody,
  type HelloBody,
  type SnapshotMeta,
  type StatusBody,
  type SyncErrorCode,
  type UploadBody,
} from '../../../worker/wire'
import { SyncError } from './errors'

/**
 * 클라우드 백업 서버(worker/protocol.ts)를 부르는 곳. (5단계)
 * 토큰은 Authorization 머리줄로만 보낸다(주소에 넣지 않는다). 실패는 모두 SyncError로 던진다.
 */

/** 이 주소에 클라우드 백업 서버가 있는지 */
export type Hello =
  /** 있다. claimed: 이미 복구 코드가 정해진 보관함인지 */
  | { kind: 'ok'; claimed: boolean }
  /** 없다(개발 서버, 다른 호스팅) */
  | { kind: 'unavailable' }
  /** 지금은 알 수 없다(인터넷 끊김) */
  | { kind: 'offline' }

export interface SyncApi {
  hello(): Promise<Hello>
  /** 이 토큰을 보관함의 주인으로 등록한다. 이미 같은 토큰이 주인이면 그대로 성공한다. */
  claim(token: string): Promise<StatusBody>
  status(token: string): Promise<StatusBody>
  /** expected: 마지막으로 본 서버의 버전. 서버에 아무것도 없다고 알고 있으면 null */
  upload(token: string, bytes: Uint8Array<ArrayBuffer>, expected: number | null): Promise<SnapshotMeta>
  /** version을 주지 않으면 가장 새것 */
  download(token: string, version?: number): Promise<Uint8Array<ArrayBuffer>>
  /** 서버의 스냅샷을 모두 지우고 보관함의 주인도 없앤다. */
  wipe(token: string): Promise<void>
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

const KNOWN_ERRORS: readonly SyncErrorCode[] = [
  'unauthorized',
  'forbidden',
  'already_claimed',
  'not_claimed',
  'precondition_required',
  'version_mismatch',
  'too_large',
  'bad_request',
  'no_snapshot',
  'not_found',
  'method_not_allowed',
  'server_error',
]

function isJson(res: Response): boolean {
  return (res.headers.get('Content-Type') ?? '').includes('application/json')
}

/** 실패한 답을 SyncError로 바꾼다. 우리 서버가 준 답이 아니면(HTML 등) 서버가 없는 것으로 본다. */
async function toError(res: Response): Promise<SyncError> {
  if (!isJson(res)) return new SyncError('unavailable')
  const body = (await res.json().catch(() => null)) as Partial<ErrorBody> | null
  const code = KNOWN_ERRORS.find((c) => c === body?.error)
  return code ? new SyncError(code, { current: body?.current }) : new SyncError('bad_response')
}

/** base: 주소 앞에 붙일 곳(테스트용). 앱에서는 같은 주소의 /api/sync/ 를 부른다. */
export function createApi(fetchFn: FetchFn = (input, init) => fetch(input, init), base = ''): SyncApi {
  async function call(path: string, token: string | null, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (token !== null) headers.set('Authorization', `Bearer ${token}`)
    let res: Response
    try {
      res = await fetchFn(`${base}${SYNC_PREFIX}${path}`, { ...init, headers, cache: 'no-store' })
    } catch {
      throw new SyncError('network')
    }
    if (!res.ok) throw await toError(res)
    return res
  }

  async function callJson<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
    const res = await call(path, token, init)
    if (!isJson(res)) throw new SyncError('unavailable')
    try {
      return (await res.json()) as T
    } catch {
      throw new SyncError('bad_response')
    }
  }

  return {
    async hello() {
      try {
        const body = await callJson<Partial<HelloBody>>('hello', null)
        return body.service === SYNC_SERVICE ? { kind: 'ok', claimed: body.claimed === true } : { kind: 'unavailable' }
      } catch (e) {
        return e instanceof SyncError && e.code === 'network' ? { kind: 'offline' } : { kind: 'unavailable' }
      }
    },

    claim: (token) => callJson<StatusBody>('claim', token, { method: 'POST' }),

    status: (token) => callJson<StatusBody>('status', token),

    async upload(token, bytes, expected) {
      const headers = {
        'Content-Type': 'application/octet-stream',
        'If-Match': expected === null ? IF_MATCH_NONE : `"${expected}"`,
      }
      const body = await callJson<UploadBody>('snapshot', token, { method: 'PUT', headers, body: bytes })
      return body.snapshot
    },

    async download(token, version) {
      const res = await call(version === undefined ? 'snapshot' : `snapshot?version=${version}`, token)
      // 스냅샷은 늘 바이트로 온다. 다른 것이 왔으면(HTML 등) 우리 서버가 아니다.
      const type = res.headers.get('Content-Type') ?? ''
      if (!type.includes('application/octet-stream')) throw new SyncError('unavailable')
      return new Uint8Array(await res.arrayBuffer())
    },

    async wipe(token) {
      await callJson<unknown>('vault', token, { method: 'DELETE' })
    },
  }
}
