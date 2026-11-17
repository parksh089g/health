// 테스트용: Node의 node:sqlite를 sqlStore가 쓰는 모양(SqlRunner)으로 바꾼다.
// Durable Object의 SQLite와 같은 SQL을 돌려 보려고 둔다. Worker에는 들어가지 않는다.
import type { SqlCell, SqlRunner } from './sqlStore.ts'

// node:sqlite는 Node 22에서 아직 실험 기능이라 불러올 때 경고가 한 줄 나온다. 테스트 출력에 섞이지 않게 그 줄만 막는다.
const emitWarning = process.emitWarning
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  if (typeof warning === 'string' && warning.includes('SQLite')) return
  ;(emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest)
}) as typeof process.emitWarning
const { DatabaseSync } = await import('node:sqlite')
process.emitWarning = emitWarning

/** 메모리 안의 빈 SQLite */
export function createNodeSqlRunner(): SqlRunner {
  const db = new DatabaseSync(':memory:')
  return {
    all: (query, ...bindings) => db.prepare(query).all(...bindings) as Record<string, SqlCell>[],
    transaction(fn) {
      db.exec('BEGIN')
      try {
        const result = fn()
        db.exec('COMMIT')
        return result
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
}
