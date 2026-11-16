// Anthropic API 흉내. api.anthropic.com으로 가는 요청을 브라우저 안에서 가로채서 미리 정해 둔 답을 준다.
// 실제 API는 부르지 않으므로 키도 요금도 필요 없다.

const CORS = { 'access-control-allow-origin': '*', 'request-id': 'req_test' }
const JSON_HEADERS = { ...CORS, 'content-type': 'application/json' }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 스트리밍 답(SSE) 한 건의 본문. 글 블록은 두 조각으로 나눠 보내 이어 붙이는 것까지 본다. */
function sseBody({ model, blocks, usage }) {
  const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let out = event('message_start', {
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: usage.input_tokens, output_tokens: 1 },
    },
  })
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      out += event('content_block_start', { index, content_block: { type: 'text', text: '' } })
      const half = Math.ceil(block.text.length / 2)
      for (const part of [block.text.slice(0, half), block.text.slice(half)]) {
        out += event('content_block_delta', { index, delta: { type: 'text_delta', text: part } })
      }
    } else {
      out += event('content_block_start', { index, content_block: block })
    }
    out += event('content_block_stop', { index })
  })
  out += event('message_delta', {
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: usage.output_tokens },
  })
  out += event('message_stop', {})
  return out
}

export async function mockAnthropic(context) {
  /** 앱이 보낸 요청: { method, path, headers, body } */
  const requests = []
  /** /v1/messages 요청에 차례로 돌려줄 답 */
  const replies = []

  await context.route('https://api.anthropic.com/**', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' },
      })
    }
    const { pathname } = new URL(request.url())
    requests.push({
      method: request.method(),
      path: pathname,
      headers: await request.allHeaders(),
      body: request.postData(),
    })

    // 설정의 "연결 확인"이 부르는 모델 조회
    if (pathname.startsWith('/v1/models/')) {
      const model = {
        type: 'model',
        id: pathname.split('/').pop(),
        display_name: 'Claude Sonnet 5.5',
        created_at: '2026-10-01T00:00:00Z',
      }
      return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(model) })
    }

    const reply = replies.shift()
    if (!reply) {
      const error = { type: 'error', error: { type: 'api_error', message: '준비한 답이 없는 요청' } }
      return route.fulfill({ status: 500, headers: JSON_HEADERS, body: JSON.stringify(error) })
    }
    if (reply.delayMs) await sleep(reply.delayMs)
    if (reply.held) await reply.held
    const headers = { ...CORS, 'content-type': reply.contentType }
    const body = typeof reply.body === 'function' ? reply.body(JSON.parse(request.postData())) : reply.body
    return route.fulfill({ status: reply.status, headers, body })
  })

  return {
    requests,

    /** 지금까지 온 /v1/messages 요청 */
    messageRequests: () => requests.filter((r) => r.path === '/v1/messages'),

    /**
     * 다음 /v1/messages 요청에 스트리밍으로 답한다.
     * json: 답의 글이 될 객체. 앱이 보낸 요청을 보고 답을 정해야 하면(요청 글에 적힌 종목 key로 답할 때 등)
     * 요청 본문을 받아 객체를 돌려주는 함수를 준다.
     * blocks: 글 블록 하나가 아닌 답(대체 모델로 넘어간 경우 등)을 직접 줄 때.
     * hold: true면 답을 붙잡아 두고, 돌려준 함수를 부를 때 보낸다. 기다리는 동안의 화면을 시간에 쫓기지 않고 볼 때 쓴다.
     */
    replyWithMessage({ model, json, blocks, delayMs = 0, hold = false }) {
      const usage = { input_tokens: 3500, output_tokens: 1800 }
      const body = (answer) =>
        sseBody({ model, blocks: blocks ?? [{ type: 'text', text: JSON.stringify(answer) }], usage })
      let release = () => {}
      const held = hold ? new Promise((resolve) => (release = resolve)) : null
      replies.push({
        status: 200,
        contentType: 'text/event-stream',
        body: typeof json === 'function' ? (requestBody) => body(json(requestBody)) : body(json),
        delayMs,
        held,
      })
      return release
    },

    /** 다음 /v1/messages 요청에 오류로 답한다. */
    replyWithError({ status, type, message }) {
      replies.push({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ type: 'error', error: { type, message } }),
      })
    },
  }
}
