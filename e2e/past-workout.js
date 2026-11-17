// 지난 운동 추가: 날짜, 시작 시각, 운동 시간을 골라 그날의 운동을 적는다.
// 그날 운동으로 저장되는지(기록 목록 순서, 운동 시간), 미리 채우는 값이 그날보다 앞선 기록에서 오는지,
// 지금 하는 운동에만 있는 휴식 타이머, 스톱워치, 추천이 빠지는지, 다음 운동의 미리 채우기에 들어가는지 본다.
import { touchTargets } from './lib/layout.js'

export const title = '지난 운동 추가 (날짜와 시각 고르기, 그날 기준 미리 채우기, 기록 순서, 다음 운동 반영)'

const DAY = 24 * 60 * 60 * 1000
/** 점검용 폰의 시간대(Asia/Seoul)와 UTC의 차이 */
const KST = 9 * 60 * 60 * 1000
const dateKey = (ts) => new Date(ts + KST).toISOString().slice(0, 10)
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
/** 앱의 formatDay와 같은 "11월 16일 (월)" */
function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number)
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${m}월 ${d}일 (${WEEKDAYS[w]})`
}

export async function run(phone) {
  const { page, step, check, visible, text, count, eventually } = phone
  const { open, shot, noOverflow, fill, card } = phone
  const dialog = page.getByRole('dialog', { name: '지난 운동 기록하기' })
  const search = page.getByLabel('종목 이름으로 찾기')
  const bench = card('벤치프레스')
  const fiveDaysAgo = dateKey(Date.now() - 5 * DAY)
  const twoDaysAgo = dateKey(Date.now() - 2 * DAY)

  /** 지난 운동 창에 날짜, 시각, 운동 시간을 넣고 시작한다. */
  const startPast = async (date, time, minutes) => {
    await page.locator('input[type="date"]').fill(date)
    await page.locator('input[type="time"]').fill(time)
    await dialog.getByLabel('운동 시간(분)').fill(String(minutes))
    await dialog.getByRole('button', { name: '종목 적으러 가기' }).tap()
    await visible(page.getByRole('heading', { name: '지난 운동 적기' }), '지난 운동 적기 화면')
  }
  const addBench = async () => {
    await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
    await search.fill('벤치프레스')
    await page.getByRole('button', { name: /^벤치프레스/ }).first().tap()
    await page.getByRole('button', { name: '선택한 1개 추가' }).tap()
  }
  const doSet = async (n, kg, reps) => {
    await fill(bench.getByLabel(`${n}세트 무게`, { exact: true }), kg)
    await fill(bench.getByLabel(`${n}세트 횟수`, { exact: true }), reps)
    await bench.getByRole('button', { name: `${n}세트 완료`, exact: true }).tap()
  }

  // ───────── 창 열기와 입력 확인
  step('기록 화면에서 지난 운동 추가 창 열기')
  await open('/history')
  await page.getByRole('button', { name: '지난 운동 추가' }).tap()
  await visible(dialog, '지난 운동 기록하기 창')
  await touchTargets(phone, '지난 운동 창', dialog)
  await noOverflow('지난 운동 창')
  await shot('01-dialog')
  // 지금보다 늦은 시각은 막는다.
  await page.locator('input[type="date"]').fill(dateKey(Date.now()))
  await page.locator('input[type="time"]').fill('23:59')
  const hourNow = new Date(Date.now() + KST).getUTCHours()
  if (hourNow < 23) {
    await dialog.getByRole('button', { name: '종목 적으러 가기' }).tap()
    await visible(dialog.getByRole('alert').filter({ hasText: '지금보다 앞선 시각' }), '오늘 늦은 시각은 막힘')
  }
  await dialog.getByLabel('운동 시간(분)').fill('0')
  await page.locator('input[type="time"]').fill('00:00')
  await dialog.getByRole('button', { name: '종목 적으러 가기' }).tap()
  await visible(dialog.getByRole('alert').filter({ hasText: '운동 시간은' }), '운동 시간 0분은 막힘')

  // ───────── 5일 전 운동
  step('5일 전 운동 적기')
  await startPast(fiveDaysAgo, '07:30', 45)
  await visible(page.getByText(`${dayLabel(fiveDaysAgo)} 오전 7:30`), '머리에 그날 날짜와 시각')
  await visible(page.getByText('그날 한 종목을 추가해 주세요.'), '빈 화면 안내')
  await addBench()
  await doSet(1, 60, 8)
  await count(page.getByRole('timer', { name: '휴식 타이머' }), 0, '세트를 완료해도 휴식 타이머가 돌지 않음')
  await count(page.getByRole('group', { name: '다음 무게 추천' }), 0, '추천 없음')
  await page.getByRole('button', { name: '마치기' }).tap()
  await visible(page.getByRole('heading', { name: '지난 운동 저장' }), '저장 화면 제목')
  const stat = (label) => page.getByRole('main').locator('dl > div').filter({ hasText: label }).locator('dd')
  await text(stat('운동 시간'), '45분', '운동 시간은 적은 45분')
  // 프리필된 나머지 세트는 완료하지 않았으니 빠진다는 안내 대신 바로 저장
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await visible(page.getByRole('heading', { name: dayLabel(fiveDaysAgo) }), '기록 상세 제목이 그날')
  await visible(page.getByText('오전 7:30 시작 · 45분'), '시작 시각과 운동 시간')

  // ───────── 실제로 오늘 한 운동(더 무겁게) 뒤에 2일 전 운동을 적는다
  step('오늘 운동을 한 뒤 2일 전 운동 적기: 그날보다 앞선 기록으로 채움')
  await open('/')
  await page.getByRole('button', { name: '운동 시작' }).tap()
  await addBench()
  await doSet(1, 70, 5)
  await page.getByRole('button', { name: '마치기' }).tap()
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await visible(page.getByRole('button', { name: '같은 운동 다시 하기' }), '오늘 운동 저장')
  await open('/')
  await page.getByRole('button', { name: '지난 운동 추가' }).tap()
  await startPast(twoDaysAgo, '19:00', 80)
  await addBench()
  await eventually(() => bench.getByLabel('1세트 무게', { exact: true }).inputValue(), '60', '오늘의 70kg이 아니라 5일 전 60kg으로 채움')
  await visible(bench.getByText(/지난번 60×8/), '지난번 줄도 그날보다 앞선 기록')
  await count(page.getByRole('button', { name: /시간 재기$/ }), 0, '스톱워치 없음')
  await fill(bench.getByLabel('1세트 무게', { exact: true }), 62.5)
  await bench.getByRole('button', { name: '1세트 완료', exact: true }).tap()
  await noOverflow('지난 운동 적기')
  await shot('02-past-workout', { fullPage: true })

  // 홈에 "적고 있던 지난 운동"
  await open('/')
  const banner = page.getByRole('region', { name: '적고 있던 지난 운동' })
  await visible(banner, '홈에 적고 있던 지난 운동')
  await visible(banner.getByText(dayLabel(twoDaysAgo)), '그날 날짜')
  await count(page.getByRole('button', { name: '지난 운동 추가' }), 0, '적는 중에는 지난 운동 추가가 감춰짐')
  await shot('03-home-banner')
  await banner.getByRole('button', { name: '이어서 적기' }).tap()
  await page.getByRole('button', { name: '마치기' }).tap()
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await visible(page.getByText('오후 7:00 시작 · 1시간 20분'), '저장한 시작 시각과 운동 시간')

  // ───────── 기록 목록 순서와 저장 값
  step('기록 목록은 운동한 날 순서')
  await open('/history')
  const rowsOnScreen = page.locator('a[href^="#/history/"] p.font-bold')
  await eventually(() => rowsOnScreen.count(), 3, '기록 3개')
  const days = await rowsOnScreen.allTextContents()
  const want = [dayLabel(dateKey(Date.now())), dayLabel(twoDaysAgo), dayLabel(fiveDaysAgo)]
  check(JSON.stringify(days.slice(0, 3)) === JSON.stringify(want), `기록 순서 ${days.slice(0, 3).join(', ')}`)
  await noOverflow('기록 목록')
  await shot('04-history')
  const rows = await page.evaluate(async () => {
    const req = indexedDB.open('health-log')
    const dbh = await new Promise((res) => (req.onsuccess = () => res(req.result)))
    const tx = dbh.transaction('workouts')
    const all = await new Promise((res) => {
      const r = tx.objectStore('workouts').getAll()
      r.onsuccess = () => res(r.result)
    })
    return all.map((w) => ({ date: w.date, past: w.pastEndAt ?? null, ended: w.endedAt !== null }))
  })
  check(rows.length === 3 && rows.every((r) => r.ended && r.past === null), '세 운동 모두 끝났고 적는 중 표시가 남지 않음')
  check(rows.some((r) => r.date === twoDaysAgo) && rows.some((r) => r.date === fiveDaysAgo), '날짜가 그날로 저장')
}
