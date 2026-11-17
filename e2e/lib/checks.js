// 점검 도구. 하나가 틀려도 멈추지 않고 끝까지 본 뒤, 틀린 것을 모아서 알려 준다.
// 줄마다 'ok' 또는 'FAIL'을 찍고, 틀린 점검은 problems에 '[단계] 내용'으로 쌓인다.

/** 화면이 바뀌기를 기다리는 기본 시간(ms) */
const WAIT = 8000
/** 기다리는 동안 한 번 읽는 데 쓰는 시간(ms). 요소가 아직 없으면 이만큼만 기다리고 다시 읽는다. */
const READ = 500

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const show = (value) => (value instanceof RegExp ? String(value) : JSON.stringify(value))

export function createChecks() {
  const problems = []
  let total = 0
  let current = ''

  function record(ok, message) {
    total += 1
    if (ok) console.log(`  ok   ${message}`)
    else {
      problems.push(`[${current}] ${message}`)
      console.log(`  FAIL ${message}`)
    }
    return ok
  }

  /** read()가 accept를 통과하는 값을 줄 때까지 다시 읽는다. 마지막으로 읽은 값도 돌려준다. */
  async function poll(read, accept, timeout) {
    const deadline = Date.now() + timeout
    for (;;) {
      const last = await read().catch((e) => `오류: ${e.message.split('\n')[0]}`)
      if (accept(last)) return { ok: true, last }
      if (Date.now() >= deadline) return { ok: false, last }
      await sleep(100)
    }
  }

  async function waitFor(locator, state, timeout) {
    return locator
      .first()
      .waitFor({ state, timeout })
      .then(
        () => true,
        () => false,
      )
  }

  return {
    problems,
    /** 지금까지 한 점검 수 */
    get total() {
      return total
    },

    /** 지금부터 하는 점검이 속한 단계 이름 */
    step(name) {
      current = name
      console.log(name)
    },

    /** 점검이 아닌 참고 내용 */
    note(message) {
      console.log(`       ${message}`)
    },

    /** 점검 밖에서 생긴 문제(시나리오가 중간에 멈춘 경우 등) */
    fail(message) {
      return record(false, message)
    },

    /** 이미 구한 값을 바로 확인한다. */
    check(condition, message) {
      return record(Boolean(condition), message)
    },

    /** 요소가 보일 때까지 기다린다. */
    async visible(locator, message, timeout = WAIT) {
      const ok = await waitFor(locator, 'visible', timeout)
      return record(ok, ok ? message : `보이지 않음: ${message}`)
    },

    /** 요소가 사라질 때까지 기다린다. 처음부터 없어도 통과다. */
    async hidden(locator, message, timeout = WAIT) {
      const ok = await waitFor(locator, 'hidden', timeout)
      return record(ok, ok ? message : `사라지지 않음: ${message}`)
    },

    /** 요소의 글에 expected가 들어 있을(정규식이면 맞을) 때까지 기다린다. 공백과 줄바꿈은 한 칸으로 본다. */
    async text(locator, expected, message, timeout = WAIT) {
      const read = async () => {
        const raw = await locator.first().textContent({ timeout: READ })
        return (raw ?? '').replace(/\s+/g, ' ').trim()
      }
      const accept = (actual) => (typeof expected === 'string' ? actual.includes(expected) : expected.test(actual))
      const { ok, last } = await poll(read, accept, timeout)
      return record(ok, ok ? message : `${message} (기대: ${show(expected)}, 실제: ${show(last)})`)
    },

    /** 요소의 속성이 value가 될 때까지 기다린다. */
    async attr(locator, name, value, message, timeout = WAIT) {
      const read = () => locator.first().getAttribute(name, { timeout: READ })
      const { ok, last } = await poll(read, (actual) => actual === value, timeout)
      return record(ok, ok ? message : `${message} (${name} 기대: ${show(value)}, 실제: ${show(last)})`)
    },

    /** 맞는 요소가 n개가 될 때까지 기다린다. */
    async count(locator, n, message, timeout = WAIT) {
      const { ok, last } = await poll(() => locator.count(), (actual) => actual === n, timeout)
      return record(ok, ok ? message : `${message} (기대: ${n}, 실제: ${last})`)
    },

    /** read()가 expected와 같은 값을 줄 때까지 기다린다. 화면이 아닌 값(저장소, 여러 칸을 모은 글)에 쓴다. */
    async eventually(read, expected, message, timeout = WAIT) {
      const want = JSON.stringify(expected)
      const { ok, last } = await poll(read, (actual) => JSON.stringify(actual) === want, timeout)
      return record(ok, ok ? message : `${message} (기대: ${want}, 실제: ${show(last)})`)
    },
  }
}
