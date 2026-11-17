// 주간 목표와 연속 달성: 목표가 없는 홈에서 목표를 정하고, 운동을 끝내 진행이 늘어나는지 본다.
// 지난 주들의 운동을 저장소에 넣어 연속 달성 글을 확인하고, 설정에서 목표를 바꾸거나 없애면 홈이 따라오는지 본다.
import { boxOf, touchTargets } from './lib/layout.js'
import { putRows, readRow } from './lib/store.js'

export const title = '주간 목표와 연속 달성 (홈에서 목표 정하기, 진행, 연속 달성, 설정에서 바꾸기)'

const DAY = 24 * 60 * 60 * 1000
const WEEK = 7 * DAY
/** 점검용 폰의 시간대(Asia/Seoul)와 UTC의 차이. 앱은 주를 폰의 시간대로 나눈다(서머타임이 없어 한 주는 늘 7일이다). */
const KST = 9 * 60 * 60 * 1000
const dateKey = (ts) => new Date(ts + KST).toISOString().slice(0, 10)

/** 한국 시간으로 그 시각이 속한 주의 월요일 0시 */
function mondayOf(ts) {
  const local = new Date(ts + KST)
  const sinceMonday = (local.getUTCDay() + 6) % 7
  return Math.floor((ts + KST) / DAY) * DAY - sinceMonday * DAY - KST
}

export async function run(phone) {
  const { page, step, check, visible, hidden, text, attr, count, eventually } = phone
  const { open, shot, noOverflow, fill, card } = phone
  const week = page.getByRole('region', { name: '이번 주 운동' })
  const progress = week.getByRole('progressbar', { name: '주간 목표 진행' })
  const setGoal = week.getByRole('button', { name: '주간 목표 정하기' })
  const changeGoal = week.getByRole('button', { name: '목표 바꾸기' })
  const dialog = page.getByRole('dialog', { name: '주간 목표' })
  const streakText = week.getByText(/\d+주 연속 달성/)
  const storedGoal = async () => (await readRow(page, 'settings', 'weeklyGoal'))?.value ?? null

  // ───────── 목표가 없을 때
  step('목표가 없는 홈')
  await open('/')
  await visible(setGoal, '목표가 없으면 "주간 목표 정하기"')
  await text(week, '0회', '이번 주 0회')
  await count(progress, 0, '목표가 없으면 진행 막대도 없음')
  await count(week.getByText('번 더'), 0, '남은 횟수도 없음')
  check((await storedGoal()) === null, '저장된 목표 없음')
  await noOverflow('홈(목표 없음)')
  await touchTargets(phone, '이번 주 운동(목표 없음)', week)
  const plainHeight = (await boxOf(week)).height
  await shot('01-home-no-goal')

  // ───────── 홈에서 목표 정하기
  step('홈에서 목표 정하기')
  await setGoal.tap()
  await visible(dialog, '목표 창이 열림')
  await attr(dialog.getByRole('button', { name: '없음' }), 'aria-pressed', 'true', '지금은 "없음"이 골라져 있음')
  await noOverflow('목표 창')
  await touchTargets(phone, '목표 창', dialog)
  await shot('02-goal-dialog')
  await dialog.getByRole('button', { name: '닫기' }).tap()
  await hidden(dialog, '닫기를 누르면 그대로 닫힘')
  check((await storedGoal()) === null, '닫기만 하면 목표는 그대로 없음')

  await setGoal.tap()
  await dialog.getByRole('button', { name: '3회', exact: true }).tap()
  await hidden(dialog, '횟수를 고르면 창이 닫힘')
  await text(week, '0 / 3회', '홈에 0 / 3회')
  await text(week, '3번 더', '남은 횟수 3번')
  await attr(progress, 'aria-valuenow', '0', '진행 막대 0')
  await attr(progress, 'aria-valuemax', '3', '진행 막대의 끝은 목표 3')
  await count(streakText, 0, '기록이 없으면 연속 달성 글 없음')
  await eventually(storedGoal, 3, '목표 3회가 저장됨')
  await visible(changeGoal, '목표가 있으면 "목표 바꾸기"')
  await noOverflow('홈(목표 3회)')
  await touchTargets(phone, '이번 주 운동(목표 있음)', week)
  const goalHeight = (await boxOf(week)).height
  check(goalHeight - plainHeight <= 24, `목표가 있어도 카드 높이는 비슷함 (${plainHeight}px → ${goalHeight}px)`)
  await shot('03-home-goal-set')

  // ───────── 운동을 끝내면 진행이 늘어난다
  step('운동을 끝내면 진행이 늘어남')
  await page.getByRole('button', { name: '운동 시작' }).tap()
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  await page.getByLabel('종목 이름으로 찾기').fill('스쿼트')
  await page.getByRole('button', { name: /^스쿼트/ }).tap()
  await page.getByRole('button', { name: '선택한 1개 추가' }).tap()
  const squat = card('스쿼트')
  await fill(squat.getByLabel('1세트 무게', { exact: true }), 60)
  await fill(squat.getByLabel('1세트 횟수', { exact: true }), 5)
  await squat.getByRole('button', { name: '1세트 완료', exact: true }).tap()
  await phone.skipRest()

  // 진행 중인 운동은 아직 세지 않는다.
  await open('/')
  await visible(page.getByRole('region', { name: '진행 중인 운동' }), '홈에 진행 중인 운동')
  await text(week, '0 / 3회', '끝내기 전에는 0 / 3회 그대로')
  await page.getByRole('button', { name: '이어서 하기' }).tap()

  await page.getByRole('button', { name: '마치기' }).tap()
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await visible(page.getByRole('button', { name: '같은 운동 다시 하기' }), '운동을 저장함')
  // 홈의 백업 알림은 이 점검에서 보는 것이 아니라서, 방금 백업한 것으로 해 둔다.
  await putRows(page, { settings: [{ key: 'lastBackupAt', value: Date.now() }] })
  await open('/')
  await page.reload()
  await text(week, '1 / 3회', '운동을 끝내면 1 / 3회')
  await text(week, '2번 더', '남은 횟수 2번')
  await attr(progress, 'aria-valuenow', '1', '진행 막대 1')
  await count(week.locator('[aria-label$="요일 운동함"]'), 1, '오늘 요일에 운동한 표시')
  await count(streakText, 0, '이번 주를 채우기 전이고 지난 기록이 없으면 연속 달성 글 없음')
  await shot('04-home-progress')

  // ───────── 지난 주들의 기록으로 연속 달성
  step('연속 달성')
  // 지난 1~3주는 세 번씩, 4주 전은 두 번, 5~12주 전은 다시 세 번씩 한 것으로 넣는다.
  // 주의 첫 순간(월요일 0시)과 마지막 순간(일요일 23:59:59)에 시작한 운동도 그 주에 들어가야 한다.
  const thisMonday = mondayOf(Date.now())
  const workout = (id, startedAt) => ({ id, date: dateKey(startedAt), startedAt, endedAt: startedAt + 3_600_000, memo: '' })
  const past = []
  for (let ago = 1; ago <= 12; ago++) {
    const monday = thisMonday - ago * WEEK
    past.push(workout(`past-${ago}-mon`, monday), workout(`past-${ago}-sun`, monday + WEEK - 1000))
    if (ago !== 4) past.push(workout(`past-${ago}-wed`, monday + 2 * DAY + 19 * 3_600_000))
  }
  await putRows(page, { workouts: past })
  await page.reload()
  await text(week, '1 / 3회', '지난 주의 운동은 이번 주 횟수에 들어가지 않음')
  await text(week, '2번 더 · 3주 연속 달성', '지난 3주를 채웠으면 "3주 연속 달성" (4주 전에서 끊김)')
  await noOverflow('홈(연속 달성)')
  await shot('05-home-streak')

  // 이번 주도 채우면 한 주가 더해지고, 달성한 표시로 바뀐다.
  await putRows(page, { workouts: [workout('this-1', thisMonday), workout('this-2', thisMonday + 60_000)] })
  await page.reload()
  await text(week, '3 / 3회', '이번 주 3 / 3회')
  await text(week, '목표 달성 · 4주 연속 달성', '이번 주를 채우면 "목표 달성"과 4주 연속')
  await count(week.getByText('번 더'), 0, '채운 뒤에는 남은 횟수 글이 없음')
  await attr(progress, 'aria-valuenow', '3', '진행 막대가 가득 참')
  await noOverflow('홈(목표 달성)')
  await touchTargets(phone, '이번 주 운동(목표 달성)', week)
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot('06-home-goal-met')
  await shot('06-week-card-met', { of: week })

  // ───────── 홈에서 목표 바꾸기: 지난 주들도 새 목표로 다시 센다
  step('홈에서 목표 바꾸기')
  await changeGoal.tap()
  await attr(dialog.getByRole('button', { name: '3회', exact: true }), 'aria-pressed', 'true', '지금 목표 3회가 골라져 있음')
  await dialog.getByRole('button', { name: '2회', exact: true }).tap()
  await hidden(dialog, '고르면 닫힘')
  await eventually(storedGoal, 2, '목표 2회가 저장됨')
  await text(week, '3 / 2회', '목표를 넘기면 3 / 2회')
  await text(week, '목표 달성 · 13주 연속 달성', '목표를 2회로 낮추면 4주 전도 채운 주가 되어 13주 연속')
  await attr(progress, 'aria-valuenow', '2', '진행 막대는 목표까지만')
  await noOverflow('홈(13주 연속)')
  // 폭이 320px인 작은 폰에서도 넘치거나 잘리지 않는다.
  const size = page.viewportSize()
  await page.setViewportSize({ width: 320, height: size.height })
  await noOverflow('홈(13주 연속, 폭 320px)')
  await touchTargets(phone, '이번 주 운동(폭 320px)', week)
  const cardBox = await boxOf(week)
  const buttonBox = await boxOf(changeGoal)
  check(
    buttonBox.right <= cardBox.right && buttonBox.bottom <= cardBox.bottom,
    `폭 320px에서 "목표 바꾸기"가 카드 안에 있음 (버튼 끝 ${buttonBox.right}px, 카드 끝 ${cardBox.right}px)`,
  )
  await shot('07-week-card-narrow', { of: week })
  await changeGoal.tap()
  await noOverflow('목표 창(폭 320px)')
  await touchTargets(phone, '목표 창(폭 320px)', dialog)
  await shot('08-goal-dialog-narrow')
  await dialog.getByRole('button', { name: '닫기' }).tap()
  await page.setViewportSize(size)

  // ───────── 설정에서 바꾸면 홈이 따라온다
  step('설정에서 목표 바꾸기')
  await open('/settings')
  const section = page.getByRole('region', { name: '주간 목표' })
  await visible(section, '설정의 주간 목표 칸')
  await attr(section.getByRole('button', { name: '2회', exact: true }), 'aria-pressed', 'true', '홈에서 정한 2회가 골라져 있음')
  await section.scrollIntoViewIfNeeded()
  await noOverflow('설정(주간 목표)')
  await touchTargets(phone, '설정의 주간 목표', section)
  await section.getByRole('button', { name: '5회', exact: true }).tap()
  await attr(section.getByRole('button', { name: '5회', exact: true }), 'aria-pressed', 'true', '5회를 고름')
  await eventually(storedGoal, 5, '목표 5회가 저장됨')
  await shot('09-settings-goal')
  await shot('09-settings-goal-section', { of: section })
  await open('/')
  await text(week, '3 / 5회', '홈이 3 / 5회로 바뀜')
  await text(week, '2번 더', '남은 횟수 2번')
  await attr(progress, 'aria-valuemax', '5', '진행 막대의 끝이 5')
  await count(streakText, 0, '5회를 채운 주가 없으니 연속 달성 글이 사라짐')
  await shot('10-home-goal-raised')

  // 목표를 없애면 처음 모습으로 돌아간다.
  await open('/settings')
  await section.getByRole('button', { name: '없음' }).tap()
  await attr(section.getByRole('button', { name: '없음' }), 'aria-pressed', 'true', '없음을 고름')
  await eventually(storedGoal, null, '목표가 지워짐')
  await open('/')
  await visible(setGoal, '홈에 다시 "주간 목표 정하기"')
  await text(week, /^이번 주 운동\s*3회/, '목표 없이 3회만 보임')
  await count(progress, 0, '진행 막대 없음')
  await count(streakText, 0, '연속 달성 글 없음')

  // 저장된 값이 이상하면 목표가 없는 것으로 본다.
  await putRows(page, { settings: [{ key: 'weeklyGoal', value: '많이' }] })
  await page.reload()
  await visible(setGoal, '이상한 값이 저장돼 있어도 목표가 없는 홈')
  await count(progress, 0, '진행 막대 없음')

  step('콘솔')
  phone.consoleClean()
}
