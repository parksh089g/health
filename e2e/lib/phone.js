// 점검용 휴대폰 화면과, 이 앱의 화면을 누를 때 여러 시나리오가 같이 쓰는 동작.
// 시나리오마다 새로 열기 때문에 저장소(IndexedDB)는 늘 빈 상태에서 시작한다.
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { devices } from 'playwright'
import { sampleBackupFile } from './sample-backup.js'

/** 지금 백업 파일 형식의 버전(src/lib/backup.ts의 BACKUP_VERSION). 형식을 바꾸면 여기도 같이 올린다. */
export const BACKUP_VERSION = 4

/** 누르기, 입력 같은 동작 하나를 기다리는 시간(ms). 요소를 못 찾으면 이 시간 뒤에 시나리오가 멈춘다. */
const ACTION_TIMEOUT = 15_000

export async function openPhone(browser, { baseUrl, shotsDir, checks }) {
  mkdirSync(shotsDir, { recursive: true })
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    // 실제로 쓰는 폰의 화면 폭
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    acceptDownloads: true,
  })
  context.setDefaultTimeout(ACTION_TIMEOUT)
  const page = await context.newPage()

  // 콘솔 오류와 경고, 처리하지 못한 예외, 실패한 요청을 모아 둔다. 시나리오 끝에서 비어 있는지 본다.
  const consoleProblems = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleProblems.push(`${m.type()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => consoleProblems.push(`pageerror: ${e.message}`))
  page.on('requestfailed', (r) => consoleProblems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`))

  const { check, visible } = checks
  const restTimer = page.getByRole('timer', { name: '휴식 타이머' })

  /** 운동 화면과 기록 상세의 종목 카드 */
  const card = (name) => page.getByRole('region', { name, exact: true })

  /** 앱 안의 화면을 주소로 연다. 예: open('/settings') */
  const open = (route) => page.goto(`${baseUrl}#${route}`)

  async function capture(file, { fullPage, of }) {
    const target = path.join(shotsDir, file)
    if (of) await of.screenshot({ path: target })
    else await page.screenshot({ path: target, fullPage })
  }

  return {
    ...checks,
    context,
    page,
    baseUrl,
    consoleProblems,
    card,
    open,
    restTimer,

    /** 지금 주소의 # 뒷부분. 예: '#/history' */
    hash: () => new URL(page.url()).hash,

    /**
     * 밝은 화면과 어두운 화면을 한 장씩 찍는다(name.png, name-dark.png).
     * fullPage: 스크롤 아래까지, of: 그 요소만.
     */
    async shot(name, { fullPage = false, of } = {}) {
      await capture(`${name}.png`, { fullPage, of })
      await page.emulateMedia({ colorScheme: 'dark' })
      await capture(`${name}-dark.png`, { fullPage, of })
      await page.emulateMedia({ colorScheme: 'light' })
    },

    /**
     * 화면 폭(360px 등)에서 가로로 넘치는 것이 없는지 본다.
     * 폰 흉내에서는 넘친 내용을 따라 window.innerWidth도 커지므로, 정해 둔 화면 폭과 비교한다.
     */
    async noOverflow(label) {
      const width = page.viewportSize()?.width ?? 360
      const over = await page.evaluate(
        (width) => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - width,
        width,
      )
      check(over <= 0, `${label}: 가로 스크롤 없음 (넘침 ${over}px)`)
    },

    /** 입력 칸을 눌러 값을 넣고 Enter로 확정한다. */
    async fill(locator, value) {
      await locator.tap()
      await locator.fill(String(value))
      await locator.press('Enter')
    },

    /** 종목 카드의 세트 값을 '무게x횟수'로 이어 붙인다. 예: setValues(bench, ['W', 1, 2]) → '40x8 75x8 75x8' */
    async setValues(exerciseCard, labels) {
      const out = []
      for (const label of labels) {
        const weight = await exerciseCard.getByLabel(`${label}세트 무게`, { exact: true }).inputValue()
        const reps = await exerciseCard.getByLabel(`${label}세트 횟수`, { exact: true }).inputValue()
        out.push(`${weight}x${reps}`)
      }
      return out.join(' ')
    },

    /** 휴식 타이머가 떠 있으면 건너뛴다. 타이머 자체를 보는 점검이 아닐 때 쓴다. */
    async skipRest() {
      if (await restTimer.isVisible().catch(() => false)) await restTimer.getByRole('button', { name: '건너뛰기' }).tap()
    },

    /** 버튼을 눌러 받은 파일의 이름과 내용 */
    async download(button) {
      const [file] = await Promise.all([page.waitForEvent('download'), button.tap()])
      return { name: file.suggestedFilename(), text: await readFile(await file.path(), 'utf8') }
    },

    /** 설정 화면에서 샘플 기록(약 10주)을 복원한다. 화면은 설정에 머문다. */
    async restoreSample() {
      await open('/settings')
      await page.getByLabel('백업 파일 선택').setInputFiles(sampleBackupFile())
      const dialog = page.getByRole('dialog', { name: '백업에서 복원할까요?' })
      await visible(dialog, '복원 확인 창')
      await dialog.getByRole('button', { name: '지우고 복원' }).tap()
      await visible(page.getByText('백업에서 기록을 복원했습니다.'), '샘플 기록 복원')
    },

    /** 모아 둔 콘솔 오류와 경고가 없는지 본다. ignore에 맞는 줄은 예상한 것으로 치고 뺀다. */
    consoleClean({ ignore = [] } = {}) {
      const unexpected = consoleProblems.filter((line) => !ignore.some((pattern) => pattern.test(line)))
      check(unexpected.length === 0, `콘솔 오류와 경고 없음${unexpected.length ? `: ${unexpected.join(' | ')}` : ''}`)
    },

    close: () => context.close(),
  }
}
