import { useEffect, useState } from 'react'
import { pendingAdviceRequest } from './advice'
import { AiError } from './client'

const toAiError = (e: unknown) =>
  e instanceof AiError ? e : new AiError('AI 요청 중에 문제가 생겼습니다. 다시 시도해 주세요.', 'request')

/**
 * AI 요청 버튼의 상태(기다리는 중, 오류). 요청은 화면 밖(advice.ts)에서 id별로 기억하므로,
 * 기다리는 도중에 다른 화면에 갔다 와도 다시 "받는 중"으로 이어서 보이고 같은 요청을 또 보내지 않는다.
 */
export function useAdviceRequest(id: string, start: () => Promise<unknown>) {
  const [busy, setBusy] = useState(() => pendingAdviceRequest(id) !== undefined)
  const [error, setError] = useState<AiError | null>(null)

  useEffect(() => {
    // busy는 처음 그릴 때 진행 중인 요청이 있으면 true로 시작했다(useState 초기값).
    // 그 요청이 그리는 사이에 끝났을 수도 있으니, 진행 중인 것이 없어도 한 번 풀어 준다.
    const running = pendingAdviceRequest(id)
    let alive = true
    Promise.resolve(running)
      .catch((e: unknown) => alive && setError(toAiError(e)))
      .finally(() => alive && setBusy(false))
    return () => {
      alive = false
    }
  }, [id])

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await start()
    } catch (e) {
      setError(toAiError(e))
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, run }
}
