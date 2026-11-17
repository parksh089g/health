// 클라우드 백업 서버. 앱(dist/)을 올리는 같은 Worker에 들어 있다.
// 정적 파일은 Worker를 거치지 않고 바로 나가고(wrangler.jsonc의 run_worker_first), /api/ 로 온 요청만 여기로 온다.
// 백업은 SQLite를 쓰는 Durable Object 하나(Vault)에 들어 있다. 규칙은 protocol.ts, SQL은 sqlStore.ts에 있다.
import { DurableObject } from 'cloudflare:workers'
import { handleSync, rejectTooLarge, type VaultStore } from './protocol.ts'
import { createSchema, createSqlStore, type SqlRunner } from './sqlStore.ts'
import { SYNC_PREFIX } from './wire.ts'

interface Env {
  VAULT: DurableObjectNamespace
  /** 보관함의 이름. 바꾸면 빈 보관함에서 새로 시작한다(복구 코드를 잃어버렸을 때). */
  VAULT_NAME?: string
}

const DEFAULT_VAULT_NAME = 'main'

/** 그 바이트만 담은 ArrayBuffer. 버퍼의 일부만 가리키는 배열이면 복사한다. */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
  return (whole ? bytes.buffer : bytes.slice().buffer) as ArrayBuffer
}

/** ctx.storage를 sqlStore가 쓰는 모양으로 바꾼다. BLOB은 ArrayBuffer로 넣는다. */
function sqlRunner(storage: DurableObjectStorage): SqlRunner {
  return {
    all: (query, ...bindings) =>
      storage.sql.exec(query, ...bindings.map((b) => (b instanceof Uint8Array ? toBuffer(b) : b))).toArray(),
    transaction: (fn) => storage.transactionSync(fn),
  }
}

/** 백업 보관함. 이름 하나(VAULT_NAME)로 늘 같은 객체를 쓴다. */
export class Vault extends DurableObject<Env> {
  private readonly store: VaultStore

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    const db = sqlRunner(ctx.storage)
    createSchema(db)
    this.store = {
      ...createSqlStore(db),
      // 줄만 지우지 않고 저장소를 통째로 비운 뒤 빈 표를 다시 만든다.
      async wipe() {
        await ctx.storage.deleteAll()
        createSchema(db)
      },
    }
  }

  fetch(request: Request): Promise<Response> {
    return handleSync(request, this.store)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (!pathname.startsWith(SYNC_PREFIX)) {
      return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }
    const tooLarge = rejectTooLarge(request)
    if (tooLarge) return tooLarge
    const id = env.VAULT.idFromName(env.VAULT_NAME || DEFAULT_VAULT_NAME)
    return env.VAULT.get(id).fetch(request)
  },
}
