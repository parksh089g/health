// 클라우드 백업: 서버가 없는 주소에서의 안내, 시작과 복구 코드, 운동을 끝냈을 때의 자동 올리기,
// 새 폰에서 복구 코드로 연결해 복원하기, 덮어쓰기 방지(고를 때까지 올리지 않음), 다른 기기가 올린 백업과의 충돌,
// 클라우드에서 가져오기, 연결 끊기, 삭제까지 눌러 본다.
//
// 서버는 흉내가 아니라 실제 규칙(worker/protocol.ts의 handleSync)을 메모리 보관함에 돌린다.
// 브라우저가 /api/sync/ 로 보낸 요청을 가로채 Node 안에서 처리하므로, 두 폰(화면 둘)이 보관함 하나를 같이 쓴다.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { devices } from 'playwright'
import { createMemoryStore } from '../worker/memoryStore.ts'
import { handleSync } from '../worker/protocol.ts'
import { touchTargets } from './lib/layout.js'
import { readRow } from './lib/store.js'

export const title = '클라우드 백업 (시작과 복구 코드, 자동 올리기, 새 폰에서 복원, 덮어쓰기 방지, 충돌, 삭제)'

const SHOTS = fileURLToPath(new URL('./screenshots/sync/', import.meta.url))
const CODE_SHAPE = /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 그 화면(context)에서 /api/sync/ 로 가는 요청을 실제 규칙으로 처리한다. 지나간 요청을 '메서드 경로 상태'로 돌려준다. */
async function serveSync(context, store) {
  const seen = []
  await context.route('**/api/sync/**', async (route) => {
    const request = route.request()
    const sent = await request.allHeaders()
    const headers = {}
    for (const name of ['authorization', 'if-match', 'content-type']) if (sent[name]) headers[name] = sent[name]
    const body = request.postDataBuffer()
    const response = await handleSync(new Request(request.url(), { method: request.method(), headers, body }), store)
    const url = new URL(request.url())
    seen.push({ line: `${request.method()} ${url.pathname} ${response.status}`, url: request.url() })
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  return seen
}

/** 저장소가 비어 있는 새 폰. e2e/lib/phone.js의 화면과 같은 크기다. */
async function openNewPhone(phone) {
  const context = await phone.context.browser().newContext({
    ...devices['Pixel 7'],
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  })
  context.setDefaultTimeout(15_000)
  const page = await context.newPage()
  const consoleProblems = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleProblems.push(`${m.type()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => consoleProblems.push(`pageerror: ${e.message}`))
  page.on('requestfailed', (r) => consoleProblems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`))
  return { context, page, consoleProblems }
}

/** 폰 하나(page)를 누르는 도구. 두 폰이 같이 쓴다. */
function device(phone, page, prefix) {
  const { check, visible, attr } = phone
  // 설정의 다른 칸과 달리 region이 아니라 group이다(이유는 SyncSettings.tsx에 있다).
  const section = page.getByRole('group', { name: '클라우드 백업', exact: true })
  const open = (route) => page.goto(`${phone.baseUrl}#${route}`)

  return {
    page,
    section,
    open,
    dialog: (name) => page.getByRole('dialog', { name }),

    /** 밝은 화면과 어두운 화면을 한 장씩. of를 주지 않으면 클라우드 백업 칸만 찍는다. */
    async shot(name, { of = section, fullPage = false } = {}) {
      mkdirSync(SHOTS, { recursive: true })
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme })
        const file = path.join(SHOTS, `${prefix}-${name}${scheme === 'dark' ? '-dark' : ''}.png`)
        if (of === 'page') await page.screenshot({ path: file, fullPage })
        else await of.screenshot({ path: file })
      }
      await page.emulateMedia({ colorScheme: 'light' })
    },

    async noOverflow(label) {
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      check(over <= 0, `${label}: 가로 스크롤 없음 (넘침 ${over}px)`)
    },

    /** 저장된 클라우드 백업 상태(설정의 syncState). 없으면 null */
    async syncState() {
      return (await readRow(page, 'settings', 'syncState'))?.value ?? null
    },

    /** 설정 화면을 열고 클라우드 백업 칸이 서버에 물어본 답까지 기다린다. */
    async openSettings() {
      await open('/settings')
      await visible(section.getByRole('heading', { name: '클라우드 백업' }), '설정의 클라우드 백업 칸')
    },

    /** 운동을 시작해 종목 하나의 1세트를 적고 완료한다(운동은 아직 끝내지 않는다). */
    async startWorkout(exercise, weight, reps) {
      await open('/')
      await page.getByRole('button', { name: '운동 시작' }).tap()
      await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
      await page.getByLabel('종목 이름으로 찾기').fill(exercise)
      await page.getByRole('button', { name: new RegExp(`^${exercise}`) }).first().tap()
      await page.getByRole('button', { name: '선택한 1개 추가' }).tap()
      const card = page.getByRole('region', { name: exercise, exact: true })
      for (const [label, value] of [['1세트 무게', weight], ['1세트 횟수', reps]]) {
        const input = card.getByLabel(label, { exact: true })
        await input.tap()
        await input.fill(String(value))
        await input.press('Enter')
      }
      const done = card.getByRole('button', { name: '1세트 완료' })
      await done.tap()
      await attr(done, 'aria-pressed', 'true', `${exercise} ${weight}kg × ${reps} 완료`)
      const timer = page.getByRole('timer', { name: '휴식 타이머' })
      if (await timer.isVisible().catch(() => false)) await timer.getByRole('button', { name: '건너뛰기' }).tap()
    },

    /** 진행 중인 운동을 끝낸다. */
    async finishWorkout() {
      await page.getByRole('button', { name: '마치기' }).tap()
      await page.getByRole('button', { name: '저장', exact: true }).tap()
      await visible(page.getByRole('button', { name: '같은 운동 다시 하기' }), '운동을 끝냄')
    },

    /** 기록 화면을 열고 운동이 n개 보일 때까지 기다린다. */
    async historyHas(n, message) {
      await open('/history')
      await phone.count(page.locator('section a[href^="#/history/"]'), n, message)
    },
  }
}

export async function run(phone) {
  const { page, context, step, check, note, visible, hidden, text, count, eventually } = phone
  const store = createMemoryStore()
  /** 서버가 지금까지 받은 스냅샷 수 */
  const uploads = async () => store.uploads
  const versions = async () => (await store.snapshots()).map((s) => s.version)
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
  })

  const old = device(phone, page, 'a')
  const startButton = old.section.getByRole('button', { name: '클라우드 백업 시작' })
  const connectButton = old.section.getByRole('button', { name: '복구 코드로 연결' })

  // ───────── 서버가 없는 주소 (vite preview에는 /api/sync/ 가 없다)
  step('서버가 없는 주소')
  await old.openSettings()
  await text(old.section, '이 주소에서는 클라우드 백업을 쓸 수 없습니다.', '쓸 수 없다고 알림')
  await visible(old.section.getByText(/복구 코드는 백업을 되찾는 하나뿐인 열쇠/), '무엇이 올라가고 어떻게 지키는지 설명')
  check(await startButton.isDisabled(), '"클라우드 백업 시작"이 막혀 있음')
  check(await connectButton.isDisabled(), '"복구 코드로 연결"이 막혀 있음')
  check((await old.syncState()) === null, '저장된 것 없음')
  await old.noOverflow('설정(클라우드 백업을 쓸 수 없음)')
  await old.shot('01-unavailable')
  phone.consoleClean()

  // ───────── 시작
  step('클라우드 백업 시작')
  const seenOld = await serveSync(context, store)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  // 올릴 기록이 있도록 운동을 하나 해 둔다.
  await old.startWorkout('스쿼트', 100, 5)
  await old.finishWorkout()
  await page.reload()
  await old.openSettings()
  await hidden(old.section.getByText('이 주소에서는 클라우드 백업을 쓸 수 없습니다.'), '서버가 있으면 안내가 없음')
  await eventually(() => startButton.isEnabled(), true, '"클라우드 백업 시작"을 누를 수 있음')
  check(store.uploads === 0, '시작하기 전에는 아무것도 올리지 않음')
  await touchTargets(phone, '클라우드 백업(꺼짐)', old.section)
  await old.shot('02-off')

  await startButton.tap()
  const codeBox = old.section.getByRole('group', { name: '복구 코드' })
  await visible(codeBox, '복구 코드가 보임')
  await text(old.section, '이 코드를 지금 폰 밖(종이, 비밀번호 관리 앱 등)에 적어 두세요.', '폰 밖에 적어 두라는 안내')
  const shownCode = (await codeBox.locator('span[aria-hidden=false]').allTextContents()).join('-')
  check(CODE_SHAPE.test(shownCode), `다섯 자씩 다섯 묶음, 헷갈리는 글자 없음 (${shownCode.replace(/[^-]/g, 'X')})`)
  await eventually(uploads, 1, '시작하면서 지금 기록을 올림')
  await text(old.section, `이 폰에서 마지막으로 올린 때 ${today}`, '올린 때가 보임')
  check((await store.owner()) !== null, '보관함에 주인이 생김')
  const savedCode = (await readRow(page, 'settings', 'syncCode'))?.value
  check(savedCode === shownCode.replace(/-/g, ''), '복구 코드가 이 폰에 저장됨')
  check((await old.syncState())?.version === 1, '서버의 버전 1을 기억함')
  await text(page.getByRole('region', { name: '백업', exact: true }), `마지막 백업: ${today}`, '올리면 마지막 백업 날짜도 오늘')

  // 서버에는 암호문만 있다.
  const stored = Buffer.from(await store.read(1))
  check(
    !stored.includes('health-log-backup') && !stored.includes('seed:squat') && !stored.includes(savedCode),
    `서버에 있는 것은 암호문 (${stored.length}바이트)`,
  )
  check(
    seenOld.every((r) => !r.url.includes(savedCode)),
    `복구 코드가 주소에 들어가지 않음 (${seenOld.map((r) => r.line).join(', ')})`,
  )
  await old.noOverflow('설정(클라우드 백업 켜짐)')
  await touchTargets(phone, '클라우드 백업(켜짐)', old.section)
  await old.shot('03-started')

  // 코드 숨기기, 보기, 복사
  await old.section.getByRole('button', { name: '코드 숨기기' }).tap()
  await count(codeBox.locator('span[aria-hidden=false]'), 0, '숨기면 코드가 보이지 않음')
  check(!(await codeBox.textContent()).includes(shownCode.slice(0, 5)), '가린 자리에 코드가 남아 있지 않음')
  await old.shot('04-code-hidden')
  await old.section.getByRole('button', { name: '코드 복사' }).tap()
  await text(old.section.getByRole('status').last(), '복구 코드를 복사했습니다.', '가려 둔 채로도 복사됨')
  check((await page.evaluate(() => navigator.clipboard.readText())) === shownCode, '복사한 글이 복구 코드')
  await old.section.getByRole('button', { name: '코드 보기' }).tap()
  await text(codeBox, shownCode.slice(0, 5), '다시 보기')

  // 화면이 더 좁은 폰(320px)에서도 잘리지 않는다.
  await page.setViewportSize({ width: 320, height: 780 })
  await old.noOverflow('설정(320px)')
  const codeFits = await codeBox.evaluate((el) => el.scrollWidth <= el.clientWidth)
  check(codeFits, '320px에서도 복구 코드가 잘리지 않음')
  await old.shot('05-started-320')
  await page.setViewportSize({ width: 360, height: 780 })

  // ───────── 자동 올리기
  step('운동을 끝내면 자동으로 올림')
  await old.startWorkout('벤치프레스', 60, 8)
  await sleep(800)
  check(store.uploads === 1, '운동 중에는 올리지 않음')
  await old.finishWorkout()
  await eventually(uploads, 2, '운동을 끝내자 바뀐 기록을 올림')
  await eventually(async () => (await old.syncState())?.version, 2, '서버의 버전 2를 기억함')
  check((await old.syncState())?.lastError === null, '실패 기록 없음')
  // 바뀐 것이 없으면 다시 열어도 올리지 않는다.
  await page.reload()
  await old.openSettings()
  await sleep(800)
  check(store.uploads === 2, '기록이 그대로면 다시 열어도 올리지 않음')
  await old.section.getByRole('button', { name: '지금 올리기' }).tap()
  await text(old.section.getByRole('status').last(), '클라우드의 백업이 이미 지금 기록과 같습니다.', '"지금 올리기"도 같으면 올리지 않음')
  check(store.uploads === 2, '스냅샷이 늘지 않음')

  // ───────── 새 폰
  step('새 폰에서 복구 코드로 연결')
  const other = await openNewPhone(phone)
  const seenNew = await serveSync(other.context, store)
  const fresh = device(phone, other.page, 'b')
  await fresh.openSettings()
  await text(fresh.section, '이 주소에는 이미 클라우드 백업이 있습니다.', '이미 백업이 있다고 알림')
  await count(fresh.section.getByRole('button', { name: '클라우드 백업 시작' }), 0, '새로 시작하는 버튼은 없음')
  await fresh.shot('06-new-phone')
  const connect = fresh.section.getByRole('button', { name: '복구 코드로 연결' })
  const codeInput = fresh.section.getByLabel('복구 코드')
  const submit = fresh.section.getByRole('button', { name: '연결', exact: true })
  await connect.tap()
  await visible(codeInput, '복구 코드를 적는 칸')

  await codeInput.fill('abcde-12345')
  await submit.tap()
  await text(fresh.section.getByRole('alert'), '복구 코드는 글자와 숫자 25자입니다.', '모양이 틀린 코드')
  const wrongCode = shownCode.startsWith('0') ? `1${shownCode.slice(1)}` : `0${shownCode.slice(1)}`
  await codeInput.fill(wrongCode)
  await submit.tap()
  await text(fresh.section.getByRole('alert'), '복구 코드가 맞지 않습니다.', '틀린 코드는 받지 않음')
  check((await readRow(other.page, 'settings', 'syncCode')) === null, '틀린 코드는 저장하지 않음')
  await fresh.noOverflow('새 폰 설정(코드 입력)')
  await touchTargets(phone, '복구 코드 입력', fresh.section)
  await fresh.shot('07-wrong-code')

  // 소문자로, 띄어 적어도 받는다.
  await codeInput.fill(shownCode.toLowerCase().replace(/-/g, ' '))
  await submit.tap()
  const restoreDialog = fresh.dialog('클라우드의 백업으로 복원할까요?')
  await visible(restoreDialog, '클라우드에 백업이 있으면 복원할지 물음')
  await text(restoreDialog, `${today}`, '그 백업을 올린 날짜')
  await text(restoreDialog, '지금 이 폰에 있는 기록은 모두 지워지고', '이 폰의 기록이 지워진다는 경고')
  await touchTargets(phone, '복원 확인 창', restoreDialog)
  await fresh.shot('08-restore-dialog', { of: 'page' })
  await restoreDialog.getByRole('button', { name: '취소' }).tap()

  // ───────── 덮어쓰기 방지
  step('고를 때까지 올리지 않음')
  const choice = fresh.section.getByRole('group', { name: '클라우드의 백업과 이 폰의 기록 중 고르기' })
  await visible(choice, '복원과 덮어쓰기 중에 고르라는 안내')
  await text(choice, '정할 때까지 이 폰의 기록은 올리지 않습니다.', '올리지 않는다는 설명')
  check(await fresh.section.getByRole('button', { name: '지금 올리기' }).isDisabled(), '"지금 올리기"가 막혀 있음')
  check((await fresh.syncState())?.hold === 'connected', '멈춤 상태로 저장됨')
  await fresh.noOverflow('새 폰 설정(고르기 전)')
  await touchTargets(phone, '고르기 안내', choice)
  await fresh.shot('09-hold')
  // 새 폰에서 운동을 하나 끝내고 앱을 다시 열어도 클라우드의 백업은 그대로다.
  const requestsBefore = seenNew.length
  await fresh.startWorkout('데드리프트', 120, 3)
  await fresh.finishWorkout()
  await other.page.reload()
  await sleep(1000)
  check(store.uploads === 2, '새 폰의 기록을 올리지 않음')
  check((await versions()).join() === '2,1', `클라우드의 백업이 그대로 (${await versions()})`)
  const quiet = seenNew.slice(requestsBefore).filter((r) => !r.line.includes('/hello'))
  check(quiet.length === 0, `그동안 서버에 보낸 요청 없음${quiet.length ? ` (${quiet.map((r) => r.line)})` : ''}`)
  await fresh.historyHas(1, '새 폰에는 방금 한 운동 하나')

  // ───────── 복원
  step('클라우드의 백업으로 복원')
  await fresh.openSettings()
  await choice.getByRole('button', { name: '클라우드의 백업으로 복원' }).tap()
  await visible(restoreDialog, '복원 확인 창')
  await restoreDialog.getByRole('button', { name: '지우고 복원' }).tap()
  await text(fresh.section.getByRole('status').last(), /^클라우드의 백업\(.+\)으로 복원했습니다\.$/, '복원했다고 알림')
  await hidden(choice, '고르기 안내가 사라짐')
  check((await fresh.syncState())?.version === 2 && (await fresh.syncState())?.hold === null, '복원한 버전을 기억함')
  await fresh.shot('10-restored')
  await fresh.historyHas(2, '옛 폰의 운동 2개가 보임')
  const history = other.page.getByRole('main')
  await text(history, '벤치프레스', '옛 폰에서 한 운동')
  await count(history.getByText('데드리프트'), 0, '새 폰에서 한 운동은 지워짐')
  await other.page.reload()
  await sleep(1000)
  check(store.uploads === 2, '복원한 뒤 곧바로 다시 올리지 않음')

  // ───────── 충돌
  step('다른 기기가 더 새 백업을 올렸을 때')
  await fresh.startWorkout('바벨 로우', 40, 10)
  await fresh.finishWorkout()
  await eventually(uploads, 3, '새 폰이 운동을 끝내고 올림 (버전 3)')
  // 옛 폰은 버전 2까지만 알고 있다.
  await old.startWorkout('스쿼트', 102.5, 5)
  await old.finishWorkout()
  await eventually(async () => (await old.syncState())?.hold, 'conflict', '옛 폰이 올리려다 멈춤')
  check(store.uploads === 3, '옛 폰의 기록으로 덮어쓰지 않음')
  await old.openSettings()
  const conflict = old.section.getByRole('group', { name: '클라우드의 백업과 이 폰의 기록 중 고르기' })
  await text(conflict, '클라우드에 다른 기기가 올린 더 새로운 백업이 있습니다', '다른 기기의 백업이 있다고 알림')
  check(await old.section.getByRole('button', { name: '지금 올리기' }).isDisabled(), '"지금 올리기"가 막혀 있음')
  await page.reload()
  await sleep(800)
  check(store.uploads === 3, '다시 열어도 올리지 않음')
  await old.openSettings()
  await old.noOverflow('설정(충돌)')
  await old.shot('11-conflict')

  await conflict.getByRole('button', { name: '이 폰의 기록으로 덮어쓰기' }).tap()
  const overwriteDialog = old.dialog('클라우드의 백업을 덮어쓸까요?')
  await visible(overwriteDialog, '덮어쓰기 확인 창')
  await old.shot('12-overwrite-dialog', { of: 'page' })
  await overwriteDialog.getByRole('button', { name: '이 폰의 기록으로 덮어쓰기' }).tap()
  await text(old.section.getByRole('status').last(), '이 폰의 기록을 클라우드에 올렸습니다.', '덮어썼다고 알림')
  await hidden(conflict, '고르기 안내가 사라짐')
  await eventually(uploads, 4, '옛 폰의 기록이 버전 4로 올라감')
  check((await versions()).join() === '4,3,2,1', `예전 백업도 남아 있음 (${await versions()})`)

  // ───────── 클라우드에서 가져오기
  step('클라우드에서 가져오기')
  await old.section.getByRole('button', { name: '클라우드에서 가져오기' }).tap()
  const list = old.section.getByRole('list', { name: '클라우드의 백업 목록' })
  await count(list.getByRole('listitem'), 4, '남아 있는 백업 4개')
  await text(list.getByRole('listitem').first(), '최신', '맨 위가 가장 새것')
  await old.noOverflow('설정(백업 목록)')
  await touchTargets(phone, '백업 목록', list)
  await old.shot('13-snapshots')
  // 가장 오래된 것(운동 하나만 있던 때)으로 되돌린다.
  await list.getByRole('listitem').last().getByRole('button').tap()
  await old.dialog('클라우드의 백업으로 복원할까요?').getByRole('button', { name: '지우고 복원' }).tap()
  await text(old.section.getByRole('status').last(), '으로 복원했습니다.', '고른 백업으로 복원')
  await hidden(list, '복원하면 목록이 닫힘')
  await old.historyHas(1, '처음 올린 때의 기록(운동 하나)으로 돌아감')
  check(savedCode === (await readRow(page, 'settings', 'syncCode'))?.value, '복원해도 복구 코드는 그대로')

  // ───────── 끊기와 삭제
  step('연결 끊기와 삭제')
  await fresh.openSettings()
  await fresh.section.getByRole('button', { name: '이 폰 연결 끊기' }).tap()
  await fresh.dialog('이 폰의 연결을 끊을까요?').getByRole('button', { name: '연결 끊기' }).tap()
  await text(fresh.section.getByRole('status').last(), '이 폰의 연결을 끊었습니다.', '새 폰의 연결을 끊음')
  check((await readRow(other.page, 'settings', 'syncCode')) === null, '새 폰에서 복구 코드가 지워짐')
  check((await versions()).length === 4, '클라우드의 백업은 그대로')

  await old.openSettings()
  await old.section.getByRole('button', { name: '클라우드 백업 삭제' }).tap()
  const wipeDialog = old.dialog('클라우드 백업을 모두 삭제할까요?')
  await text(wipeDialog, '되돌릴 수 없습니다', '되돌릴 수 없다는 경고')
  await wipeDialog.getByRole('button', { name: '모두 삭제' }).tap()
  await visible(wipeDialog.getByRole('button', { name: '한 번 더 누르면 삭제됩니다' }), '한 번 더 물음')
  check((await versions()).length === 4, '묻는 동안에는 지워지지 않음')
  await touchTargets(phone, '삭제 확인 창', wipeDialog)
  await old.shot('14-wipe-dialog', { of: 'page' })
  await wipeDialog.getByRole('button', { name: '한 번 더 누르면 삭제됩니다' }).tap()
  await text(old.section.getByRole('status').last(), '클라우드 백업을 모두 삭제했습니다.', '삭제했다고 알림')
  check((await store.owner()) === null && (await versions()).length === 0, '서버가 비고 주인도 없어짐')
  check((await readRow(page, 'settings', 'syncCode')) === null, '이 폰의 복구 코드도 지워짐')
  await visible(startButton, '다시 시작할 수 있음')
  await old.historyHas(1, '이 폰의 기록은 그대로')
  await old.openSettings()
  await old.shot('15-settings-page', { of: 'page', fullPage: true })

  step('콘솔')
  note(`옛 폰이 보낸 요청 ${seenOld.length}건, 새 폰이 보낸 요청 ${seenNew.length}건`)
  // 다른 기기가 먼저 올렸을 때 서버가 412로 거절한 것은 예상한 일이다(브라우저가 실패한 요청으로 적는다).
  phone.consoleClean({ ignore: [/status of 412/] })
  const bad = other.consoleProblems.filter((line) => !/status of (400|403)/.test(line))
  check(bad.length === 0, `새 폰의 콘솔 오류와 경고 없음${bad.length ? `: ${bad.join(' | ')}` : ''}`)
  await other.context.close()
}
