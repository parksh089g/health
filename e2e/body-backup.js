// 체중 기록과 백업 알림: 홈의 백업 알림이 언제 보이고 숨는지("나중에", "지금 백업", 운동 중),
// 통계의 체중 카드에서 오늘 체중을 적고 고치고, 2년 치 기록의 그래프와 체중 기록 목록(고치기, 지우기, 지난 날짜 추가)을 눌러 본다.
import { boxOf, touchTargets } from './lib/layout.js'
import { clearStores, putRows, readRow } from './lib/store.js'

export const title = '체중 기록과 백업 알림 (홈의 백업 알림, 통계의 체중 카드, 체중 입력 창, 체중 기록 목록)'

const DAY = 24 * 60 * 60 * 1000
/** 점검용 폰의 시간대(Asia/Seoul)로 본 그 시각의 날짜(YYYY-MM-DD). 앱은 날짜를 폰의 시간대로 센다. */
const dateKey = (ts) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(ts)
const round1 = (n) => Math.round(n * 10) / 10
/** 앱이 변화량을 적는 방식. 예: '−2.7kg', '+0.4kg' */
const changeText = (deltaKg) => `${deltaKg > 0 ? '+' : '−'}${Math.abs(round1(deltaKg))}kg`

export async function run(phone) {
  const { page, step, check, visible, hidden, text, attr, count, eventually } = phone
  const { open, hash, shot, noOverflow, download } = phone
  const now = Date.now()
  const daysAgo = (days) => dateKey(now - days * DAY)
  const main = page.getByRole('main')
  const startButton = page.getByRole('button', { name: '운동 시작' })
  const banner = page.getByRole('region', { name: '백업 알림' })
  const recent = page.getByRole('region', { name: '최근 운동' })

  // ───────── 아무 기록도 없을 때
  step('처음(기록 없음)')
  await open('/')
  await visible(recent.getByText('아직 기록이 없습니다.'), '빈 홈')
  await count(banner, 0, '끝낸 운동이 없으면 백업 알림 없음')
  await open('/stats')
  const weightCard = page.getByRole('region', { name: '체중', exact: true })
  await visible(weightCard.getByText(/^체중을 적어 두면 최근 값과 변화 그래프가 여기에 나타납니다/), '운동 기록이 없어도 통계에 체중 카드')
  await shot('01-stats-empty')
  await open('/body-weight')
  await visible(page.getByText('아직 체중 기록이 없습니다.'), '체중 기록 목록의 빈 상태')
  await shot('02-log-empty')

  // ───────── 홈의 백업 알림
  // 끝낸 운동 9번(사흘마다)을 저장소에 바로 넣는다. 백업은 한 적이 없다.
  step('백업 알림')
  const workouts = Array.from({ length: 9 }, (_, i) => {
    const startedAt = now - (i + 1) * 3 * DAY
    return { id: `w${i + 1}`, date: dateKey(startedAt), startedAt, endedAt: startedAt + 3_600_000, memo: '' }
  })
  await putRows(page, { workouts })
  await open('/')
  await page.reload()
  await visible(banner, '끝낸 운동이 있는데 백업이 없으면 알림')
  await text(banner, '아직 백업한 적이 없습니다', '백업한 적 없음 안내')
  const startBox = await boxOf(startButton)
  let bannerBox = await boxOf(banner)
  check(bannerBox.top >= startBox.bottom, `알림은 운동 시작 버튼 아래 (버튼 끝 ${startBox.bottom}px, 알림 ${bannerBox.top}px)`)
  await noOverflow('홈(백업 알림)')
  await touchTargets(phone, '백업 알림', banner)
  await shot('03-home-banner-never')

  await banner.getByRole('button', { name: '나중에' }).tap()
  await hidden(banner, '"나중에"를 누르면 알림이 사라짐')
  const snoozedDays = async () => {
    const row = await readRow(page, 'settings', 'backupSnoozeUntil')
    return row ? Math.round((row.value - Date.now()) / DAY) : null
  }
  await eventually(snoozedDays, 7, '7일 동안 미룸')

  // 미룬 기간이 지났고 마지막 백업이 3주 전일 때. 루틴이 셋 있어도 알림이 화면 안에 보여야 한다.
  await putRows(page, {
    settings: [
      { key: 'backupSnoozeUntil', value: now - DAY },
      { key: 'lastBackupAt', value: now - 21 * DAY - 3_600_000 },
    ],
    routines: ['하체 날', '가슴과 삼두', '등과 이두'].map((name, i) => ({
      id: `r${i + 1}`,
      name,
      items: [{ exerciseId: 'seed:squat', sets: 3, reps: 8 }],
      createdAt: now,
      updatedAt: now - i,
      lastUsedAt: now - i,
    })),
  })
  await page.reload()
  await visible(banner, '미룬 기간이 지나면 다시 알림')
  await text(banner, '백업한 지 21일 지났습니다', '마지막 백업에서 지난 날수')
  const routinesBox = await boxOf(page.getByRole('region', { name: '루틴', exact: true }))
  const tabsBox = await boxOf(page.getByRole('navigation', { name: '주요 화면' }))
  bannerBox = await boxOf(banner)
  const place = `루틴 끝 ${routinesBox.bottom}px, 알림 ${bannerBox.top}~${bannerBox.bottom}px, 탭 ${tabsBox.top}px`
  check(
    bannerBox.top >= routinesBox.bottom && bannerBox.bottom <= tabsBox.top,
    `루틴이 셋이어도 알림이 루틴 아래, 탭 위에 다 보임 (${place})`,
  )
  await noOverflow('홈(루틴과 백업 알림)')
  await shot('04-home-banner-21days')

  const backupFile = await download(banner.getByRole('button', { name: '지금 백업' }))
  check(
    /^health-backup-\d{4}-\d{2}-\d{2}\.json$/.test(backupFile.name),
    `"지금 백업"으로 받은 파일 이름 (${backupFile.name})`,
  )
  const backup = JSON.parse(backupFile.text)
  check(
    backup.format === 'health-log-backup' && backup.data.workouts.length === 9 && backup.data.routines.length === 3,
    `설정의 백업과 같은 파일 (운동 ${backup.data.workouts.length}, 루틴 ${backup.data.routines.length})`,
  )
  await text(page.getByRole('status'), `백업 파일(${backupFile.name})을 내보냈습니다.`, '알림 자리에 내보낸 파일 안내')
  await hidden(banner, '백업하면 알림이 사라짐')
  await shot('05-home-backup-done')
  await open('/settings')
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
  })
  await text(page.getByRole('region', { name: '백업', exact: true }), `마지막 백업: ${today}`, '설정의 마지막 백업 날짜가 오늘')
  await open('/')
  await visible(recent.getByRole('link').first(), '다시 연 홈')
  await count(banner, 0, '백업한 뒤에는 홈에 알림 없음')

  // 운동 중에는 화면이 붐비니 보이지 않는다.
  step('운동 중에는 알림 숨김')
  await putRows(page, { settings: [{ key: 'lastBackupAt', value: now - 40 * DAY }] })
  await page.reload()
  await text(banner, '백업한 지 40일 지났습니다', '백업이 오래되면 다시 알림')
  await startButton.tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '운동 시작')
  await page.getByRole('button', { name: '뒤로' }).tap()
  await visible(page.getByRole('region', { name: '진행 중인 운동' }), '홈에 진행 중인 운동')
  await count(banner, 0, '운동 중에는 알림이 보이지 않음')
  await shot('06-home-active')
  await page.getByRole('button', { name: '이어서 하기' }).tap()
  await page.getByRole('button', { name: '운동 취소' }).tap()
  await page.getByRole('dialog').getByRole('button', { name: '취소하고 지우기' }).tap()
  await visible(banner, '운동이 끝나면 다시 보임')

  // ───────── 체중: 첫 기록
  step('오늘 체중 기록')
  /** 체중 카드에 크게 보이는 값과 그 아래의 날짜 */
  const shownWeight = weightCard.locator('p').filter({ hasText: /^[\d.]+kg$/ })
  const shownDay = weightCard.getByText(/^(\d+년 )?\d+월 \d+일 \(.\)( · 오늘)?$/)
  const dialog = page.getByRole('dialog')
  const weightInput = dialog.getByLabel('체중', { exact: true })
  const saveButton = dialog.getByRole('button', { name: '저장', exact: true })
  await open('/stats')
  await weightCard.getByRole('button', { name: '오늘 체중 기록' }).tap()
  await visible(page.getByRole('dialog', { name: '오늘 체중' }), '체중 입력 창')
  await text(dialog, '소수 첫째 자리까지 적을 수 있습니다.', '첫 기록 안내')
  await noOverflow('체중 입력 창')
  await touchTargets(phone, '체중 입력 창', dialog)
  await shot('07-dialog-first')
  await saveButton.tap()
  await text(dialog.getByRole('alert'), '체중을 입력해 주세요.', '빈 값은 저장하지 않음')
  await weightInput.fill('15')
  await saveButton.tap()
  await text(dialog.getByRole('alert'), '체중은 20~300kg로 적어 주세요.', '범위를 벗어난 값은 저장하지 않음')
  await shot('08-dialog-error')
  await weightInput.fill('')
  await weightInput.pressSequentially('72.456')
  check((await weightInput.inputValue()) === '72.4', `소수 둘째 자리부터는 들어가지 않음 (${await weightInput.inputValue()})`)
  await weightInput.press('Enter')
  await hidden(dialog, 'Enter로 저장하면 창이 닫힘')
  await visible(weightCard.getByRole('button', { name: '오늘 체중 고치기' }), '오늘 기록이 있으면 버튼이 "고치기"로')
  await text(shownWeight, '72.4kg', '카드에 오늘 체중')
  await text(shownDay, '· 오늘', '오늘 기록 표시')
  await visible(weightCard.getByText('기록이 둘 이상 쌓이면 변화 그래프가 나타납니다.'), '기록 하나로는 그래프 대신 안내')
  await noOverflow('통계(체중 기록 하나)')
  await shot('09-stats-one-entry')

  await weightCard.getByRole('button', { name: '오늘 체중 고치기' }).tap()
  await text(dialog, '고친 뒤 저장을 눌러 주세요.', '오늘 기록을 다시 엶')
  await dialog.getByRole('button', { name: '0.1kg 올리기' }).tap()
  await dialog.getByRole('button', { name: '0.1kg 올리기' }).tap()
  await eventually(() => weightInput.inputValue(), '72.6', '+0.1을 두 번 누르면 72.6')
  await saveButton.tap()
  await hidden(dialog, '저장')
  await text(shownWeight, '72.6kg', '고친 값이 카드에 보임')

  // ───────── 체중: 기록이 많을 때
  // 2년 전부터 9일마다 하나, 최근 5주는 날마다(오늘은 빼고) 조금씩 줄어든 기록.
  step('체중 그래프')
  const history = []
  for (let i = 700; i > 35; i -= 9) {
    history.push({ date: daysAgo(i), weightKg: round1(80 - ((700 - i) / 9) * 0.05), updatedAt: now })
  }
  for (let i = 35; i >= 1; i--) {
    history.push({ date: daysAgo(i), weightKg: round1(75.6 - (35 - i) * 0.1), updatedAt: now })
  }
  const weightOn = (days) => history.find((row) => row.date === daysAgo(days)).weightKg
  const since = (days) => history.filter((row) => row.date >= daysAgo(days)).length
  await clearStores(page, ['bodyWeights'])
  await putRows(page, { bodyWeights: history })
  await page.reload()
  await visible(weightCard.getByRole('button', { name: '오늘 체중 기록' }), '오늘 기록이 없으면 "오늘 체중 기록"')
  await text(weightCard, `최근 3개월 · 기록 ${since(91)}개`, '처음에는 최근 3개월')
  await text(shownWeight, `${weightOn(1)}kg`, '가장 최근(어제) 체중')
  await text(weightCard, `최근 4주${changeText(weightOn(1) - weightOn(28))}`, '최근 4주 변화')
  await text(weightCard, `기록(${weightOn(28)}kg)과 비교한 값입니다.`, '무엇과 견준 변화인지 설명')
  await weightCard.scrollIntoViewIfNeeded()
  await noOverflow('통계(체중 그래프)')
  // 기간을 고르는 버튼은 44px 묶음 안에 있다.
  await touchTargets(phone, '체중 카드', weightCard, { except: '[role=group] button' })
  await shot('10-stats-many')
  await shot('10-card-3m', { of: weightCard })

  const ranges = weightCard.getByRole('group', { name: '그래프로 볼 기간' })
  await ranges.getByRole('button', { name: '1년' }).tap()
  await text(weightCard, `최근 1년 · 기록 ${since(365)}개`, '1년으로 넓힘')
  await ranges.getByRole('button', { name: '전체' }).tap()
  await text(weightCard, `전체 기간 · 기록 ${history.length}개`, '전체 기간')
  await shot('11-card-all', { of: weightCard })
  // 그래프 가운데(1년쯤 전)를 누르면 그날 기록이 위에 보인다.
  const chart = weightCard.getByRole('slider')
  await attr(chart, 'aria-valuenow', String(history.length), '처음에는 가장 최근 기록을 가리킴')
  await chart.tap({ position: { x: Math.round((await boxOf(chart)).width / 2), y: 60 } })
  const pickedIndex = async () => Number(await chart.getAttribute('aria-valuenow'))
  await eventually(async () => (await pickedIndex()) < history.length, true, '그래프를 누르면 그 자리의 기록을 고름')
  // 읽어 주는 글은 "2025년 12월 2일, 78.1kg" 꼴이다.
  const [pickedDate, pickedWeight] = (await chart.getAttribute('aria-valuetext')).split(', ')
  await text(shownWeight, pickedWeight, `고른 기록의 체중이 크게 보임 (${pickedWeight})`)
  await text(shownDay, pickedDate.replace(/^\d+년 /, ''), `고른 기록의 날짜가 보임 (${pickedDate})`)
  await shot('12-card-all-picked', { of: weightCard })
  await ranges.getByRole('button', { name: '3개월' }).tap()

  // 오늘 기록: 어제 값이 채워져 있어서 조금만 고쳐 바로 저장한다.
  await weightCard.getByRole('button', { name: '오늘 체중 기록' }).tap()
  await text(dialog, `기록(${weightOn(1)}kg)을 채워 두었습니다.`, '가장 가까운 지난 기록을 채워 둠')
  await eventually(() => weightInput.inputValue(), String(weightOn(1)), '입력 칸에 어제 값')
  await shot('13-dialog-prefilled')
  await dialog.getByRole('button', { name: '0.1kg 내리기' }).tap()
  const todayWeight = round1(weightOn(1) - 0.1)
  await eventually(() => weightInput.inputValue(), String(todayWeight), '−0.1')
  await saveButton.tap()
  await hidden(dialog, '저장')
  await text(shownWeight, `${todayWeight}kg`, '오늘 체중이 카드에 보임')
  await text(shownDay, '· 오늘', '오늘 기록 표시')
  await text(weightCard, `최근 4주${changeText(todayWeight - weightOn(28))}`, '최근 4주 변화가 오늘 값으로 바뀜')

  // ───────── 체중 기록 목록
  step('체중 기록 목록')
  const rows = main.getByRole('listitem')
  const total = history.length + 1
  await weightCard.getByRole('link', { name: '체중 기록 전체 보기' }).tap()
  await visible(page.getByRole('heading', { name: '체중 기록', level: 1 }), '체중 기록 목록')
  await text(page.getByRole('banner'), `${total}개`, '머리줄에 기록 수')
  await count(rows, total, `기록 ${total}줄`)
  await text(rows.first(), `${todayWeight}kg`, '최근 날짜가 맨 위')
  await text(rows.first(), changeText(todayWeight - weightOn(1)), '바로 앞 기록과의 차이')
  await noOverflow('체중 기록 목록')
  await touchTargets(phone, '체중 기록 목록', main)
  await shot('14-log')

  // 지난 기록 지우기: 한 번 더 눌러야 지워진다.
  await rows.nth(3).getByRole('button').tap()
  await text(dialog, '고친 뒤 저장을 눌러 주세요.', '줄을 누르면 그날 기록을 엶')
  await eventually(() => weightInput.inputValue(), String(weightOn(3)), '그날 값이 채워져 있음')
  await dialog.getByRole('button', { name: '이 기록 지우기' }).tap()
  const confirmDelete = dialog.getByRole('button', { name: '한 번 더 누르면 지워집니다' })
  await visible(confirmDelete, '지우기는 한 번 더 물음')
  await count(rows, total, '묻는 동안에는 지워지지 않음')
  await shot('15-log-delete-confirm')
  await confirmDelete.tap()
  await hidden(dialog, '지우면 창이 닫힘')
  await count(rows, total - 1, '한 줄이 지워짐')

  // 지난 날짜에 추가: 기록이 없는 40일 전.
  const addDialog = page.getByRole('dialog', { name: '체중 기록 추가' })
  const dateInput = addDialog.getByLabel('날짜')
  await page.getByRole('button', { name: '기록 추가' }).tap()
  await visible(addDialog, '기록 추가 창')
  await dateInput.fill(daysAgo(40))
  await text(addDialog, `기록(${weightOn(43)}kg)을 채워 두었습니다.`, '고른 날짜 앞의 가장 가까운 기록을 채워 둠')
  await noOverflow('기록 추가 창')
  await touchTargets(phone, '기록 추가 창', addDialog, { selector: 'button, input[type=date]' })
  await shot('16-log-add-past')
  await weightInput.fill('81.5')
  await saveButton.tap()
  await hidden(addDialog, '저장')
  await visible(main.getByRole('button', { name: /81\.5kg\. 고치거나 지우기$/ }), '지난 날짜의 기록이 목록에 생김')
  await count(rows, total, '한 줄이 늘어남')

  // 앞날은 막고, 이미 기록이 있는 날을 고르면 알려 준다.
  await page.getByRole('button', { name: '기록 추가' }).tap()
  await dateInput.fill(dateKey(now + 2 * DAY))
  await saveButton.tap()
  await text(addDialog.getByRole('alert'), '오늘 이후의 날짜에는 기록할 수 없습니다.', '앞날에는 기록할 수 없음')
  await dateInput.fill(daysAgo(5))
  await text(addDialog, `이날 기록(${weightOn(5)}kg)이 있습니다. 저장하면 바뀝니다.`, '기록이 있는 날을 고르면 알려 줌')
  await shot('17-log-add-existing')
  await page.keyboard.press('Escape')
  await hidden(addDialog, 'Esc로 닫힘')
  await count(rows, total, '닫으면 바뀌지 않음')

  await page.getByRole('button', { name: '뒤로' }).tap()
  await visible(page.getByRole('heading', { name: '통계', exact: true }), '뒤로 가면 통계')
  check(hash() === '#/stats', `주소가 통계 (${hash()})`)

  step('콘솔')
  phone.consoleClean()
}
