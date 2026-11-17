// Worker 런타임(workerd)이 주는 것 가운데 이 Worker가 쓰는 만큼만 손으로 적은 타입.
// @cloudflare/workers-types를 설치하지 않으려고 둔 파일이다. 런타임의 다른 기능을 쓰게 되면 여기에 더한다.
// https://developers.cloudflare.com/durable-objects/api/

/** ctx.storage.sql.exec()가 돌려주는 결과 */
interface SqlStorageCursor<T = Record<string, ArrayBuffer | string | number | null>> {
  toArray(): T[]
  one(): T
  readonly columnNames: string[]
  readonly rowsRead: number
  readonly rowsWritten: number
}

interface SqlStorage {
  exec<T = Record<string, ArrayBuffer | string | number | null>>(
    query: string,
    ...bindings: (ArrayBuffer | string | number | null)[]
  ): SqlStorageCursor<T>
  readonly databaseSize: number
}

interface DurableObjectStorage {
  readonly sql: SqlStorage
  /** callback을 한 트랜잭션으로 돌린다. callback은 동기 함수여야 한다. */
  transactionSync<T>(callback: () => T): T
  /** 이 객체의 저장소(SQL 표 포함)를 통째로 지운다. */
  deleteAll(): Promise<void>
}

interface DurableObjectId {
  toString(): string
  readonly name?: string
}

interface DurableObjectState {
  readonly id: DurableObjectId
  readonly storage: DurableObjectStorage
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

interface DurableObjectStub {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState
    protected readonly env: Env
    constructor(ctx: DurableObjectState, env: Env)
    fetch?(request: Request): Response | Promise<Response>
  }
}
