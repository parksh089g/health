// 운동 카드: 종목 메모가 카드에 보이는지, 세트 번호를 눌러 여는 설정 창(RPE, 웜업, 세트 삭제),
// 종목 순서 바꾸기를 운동 중과 기록 상세에서 눌러 보고, 바꾼 순서로 다시 시작되는지까지 본다.
import { touchTargets } from './lib/layout.js'
import { patchRows } from './lib/store.js'

export const title = '운동 카드 (종목 메모, 세트 설정 창의 RPE·웜업·삭제, 종목 순서, 기록 상세에서 고치기)'

const LONG_NOTE =
  '랙 높이 14칸, 세이프티 바 5칸. 발은 어깨너비보다 조금 넓게 벌리고 발끝은 살짝 바깥으로 둔다. 벨트는 100kg부터.'
const LONG_NAME = '오버헤드 트라이셉스 익스텐션'

export async function run(phone) {
  const { page, step, check, visible, hidden, text, attr, count, eventually } = phone
  const { open, shot, noOverflow, fill, card, restTimer } = phone
  const main = page.getByRole('main')
  const cardOrder = () => main.getByRole('heading', { level: 3 }).allTextContents()
  /** 세트 번호 버튼에 보이는 글. RPE를 적지 않은 세트는 번호 아래에 점 세 개가 있다. 예: ['W', '1RPE 8.5', '2···'] */
  const chips = (exerciseCard) => exerciseCard.getByRole('button', { name: /세트 설정/ }).allTextContents()
  const sheet = (name) => page.getByRole('dialog', { name: `${name} 설정`, exact: true })
  const openSheet = (exerciseCard, name) => exerciseCard.getByRole('button', { name: new RegExp(`^${name} 설정`) }).tap()
  const weight = (exerciseCard, label) => exerciseCard.getByLabel(`${label}세트 무게`, { exact: true })
  const reps = (exerciseCard, label) => exerciseCard.getByLabel(`${label}세트 횟수`, { exact: true })
  const doneButton = (exerciseCard, label) => exerciseCard.getByRole('button', { name: `${label}세트 완료`, exact: true })
  /** 세트를 완료로 표시하고, 그때 뜨는 휴식 타이머는 건너뛴다. */
  const complete = async (exerciseCard, label) => {
    await doneButton(exerciseCard, label).tap()
    await restTimer.getByRole('button', { name: '건너뛰기' }).tap()
  }

  // ───────── 운동 시작, 종목 셋
  step('준비')
  await open('/')
  await page.getByRole('button', { name: '운동 시작' }).tap()
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  for (const name of ['스쿼트', LONG_NAME, '벤치프레스']) {
    await page.getByLabel('종목 이름으로 찾기').fill(name)
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().tap()
  }
  await page.getByRole('button', { name: '선택한 3개 추가' }).tap()
  const squat = card('스쿼트')
  const bench = card('벤치프레스')
  await visible(squat, '스쿼트 카드')
  // 종목 메모는 종목 상세에서 적는다(exercises-rest 시나리오). 여기서는 저장소에 바로 넣고 다시 연다.
  await patchRows(page, 'exercises', ['seed:squat'], { note: LONG_NOTE })
  await patchRows(page, 'exercises', ['seed:bench-press'], { note: '그립은 링에 약지' })
  await page.reload()

  // ───────── 종목 메모
  step('종목 메모')
  await text(squat, '랙 높이 14칸', '스쿼트 카드에 메모가 보임')
  await text(bench, '그립은 링에 약지', '벤치프레스 카드에 메모가 보임')
  check(!(await card(LONG_NAME).textContent()).includes('메모'), '메모가 없는 종목에는 메모 줄이 없음')
  const noteLines = await squat
    .locator('p')
    .filter({ hasText: '랙 높이 14칸' })
    .evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
  check(noteLines === 2, `긴 메모는 두 줄까지만 보임 (${noteLines}줄)`)
  await noOverflow('운동 중(종목 메모)')
  await shot('01-workout-notes')

  // ───────── 세트 설정 창: RPE
  step('RPE')
  await fill(weight(squat, 1), 60)
  await fill(reps(squat, 1), 8)
  await complete(squat, 1)
  await fill(weight(squat, 2), 62.5)
  await fill(reps(squat, 2), 6)
  await complete(squat, 2)

  await openSheet(squat, '1세트')
  await visible(sheet('1세트'), '세트 번호를 누르면 설정 창')
  await text(sheet('1세트'), '60kg × 8회', '설정 창에 세트 값이 보임')
  await noOverflow('세트 설정 창')
  await touchTargets(phone, '세트 설정 창', sheet('1세트'))
  await shot('02-set-sheet')
  await sheet('1세트').getByRole('button', { name: '8.5', exact: true }).tap()
  await hidden(sheet('1세트'), 'RPE를 고르면 창이 닫힘')
  await eventually(() => chips(squat), ['1RPE 8.5', '2···', '3···'], '고른 RPE가 세트 번호 아래에 보임')

  await openSheet(squat, '2세트')
  await sheet('2세트').getByRole('button', { name: '10', exact: true }).tap()
  await eventually(() => chips(squat), ['1RPE 8.5', '2RPE 10', '3···'], '2세트 RPE 10')
  await shot('03-rpe-shown')

  await openSheet(squat, '2세트')
  await attr(sheet('2세트').getByRole('button', { name: '10', exact: true }), 'aria-pressed', 'true', '고른 RPE가 창에 표시됨')
  await sheet('2세트').getByRole('button', { name: 'RPE 지우기' }).tap()
  await eventually(() => chips(squat), ['1RPE 8.5', '2···', '3···'], 'RPE를 지울 수 있음')

  // ───────── 세트 설정 창: 웜업
  step('웜업 바꾸기')
  const warmupSwitch = page.getByRole('switch', { name: '웜업 세트' })
  await openSheet(squat, '1세트')
  await warmupSwitch.tap()
  await attr(warmupSwitch, 'aria-checked', 'true', '웜업 스위치가 켜짐')
  await sheet('웜업 세트').getByRole('button', { name: '닫기' }).tap()
  await eventually(() => chips(squat), ['WRPE 8.5', '1···', '2···'], '웜업으로 바뀌고 본 세트 번호가 다시 매겨짐(RPE는 그대로)')
  await openSheet(squat, '웜업 세트')
  await warmupSwitch.tap()
  await attr(warmupSwitch, 'aria-checked', 'false', '웜업 스위치가 꺼짐')
  // 창 바깥(위쪽의 어두운 곳)을 눌러 닫는다.
  await page.touchscreen.tap(180, 40)
  await hidden(page.getByRole('dialog'), '바깥을 누르면 창이 닫힘')
  await eventually(() => chips(squat), ['1RPE 8.5', '2···', '3···'], '다시 본 세트로')

  // ───────── 세트 설정 창: 삭제
  step('세트 삭제')
  await squat.getByRole('button', { name: '세트 추가' }).tap()
  await fill(weight(squat, 4), 70)
  await eventually(() => chips(squat), ['1RPE 8.5', '2···', '3···', '4···'], '세트 추가')
  // 아직 하지 않은 세트: 묻지 않고 바로 지운다.
  await openSheet(squat, '3세트')
  await sheet('3세트').getByRole('button', { name: '세트 삭제' }).tap()
  await eventually(() => chips(squat), ['1RPE 8.5', '2···', '3···'], '하지 않은 가운데 세트는 바로 지워짐')
  await count(page.getByRole('dialog'), 0, '확인 창이 뜨지 않음')
  check((await weight(squat, 3).inputValue()) === '70', '뒤 세트가 앞으로 당겨짐(70kg가 3세트)')

  // 완료한 세트: 한 번 더 묻는다.
  const confirm = page.getByRole('dialog', { name: '1세트를 삭제할까요?' })
  await openSheet(squat, '1세트')
  await sheet('1세트').getByRole('button', { name: '세트 삭제' }).tap()
  await visible(confirm, '완료한 세트는 한 번 더 물음')
  check((await chips(squat)).length === 3, '묻는 동안에는 지워지지 않음')
  await shot('04-delete-confirm')
  await confirm.getByRole('button', { name: '취소' }).tap()
  await hidden(confirm, '취소하면 확인 창이 닫힘')
  check((await chips(squat)).length === 3, '취소하면 세트가 그대로')
  await openSheet(squat, '1세트')
  await sheet('1세트').getByRole('button', { name: '세트 삭제' }).tap()
  await confirm.getByRole('button', { name: '삭제', exact: true }).tap()
  await eventually(() => chips(squat), ['1···', '2···'], '확인하면 지워지고 번호가 다시 매겨짐')
  check((await weight(squat, 1).inputValue()) === '62.5', '남은 세트 값은 그대로(62.5kg)')
  await attr(doneButton(squat, 1), 'aria-pressed', 'true', '남은 세트의 완료 표시도 그대로')
  await count(squat.getByRole('button', { name: '세트 삭제' }), 0, '카드 아래에 따로 "세트 삭제" 버튼은 없음')

  // ───────── 종목 순서
  step('종목 순서 바꾸기')
  const moveUp = (exerciseCard) => exerciseCard.getByRole('button', { name: '위로 옮기기' })
  const moveDown = (exerciseCard) => exerciseCard.getByRole('button', { name: '아래로 옮기기' })
  await eventually(cardOrder, ['스쿼트', LONG_NAME, '벤치프레스'], '처음에는 고른 순서')
  check(await moveUp(squat).isDisabled(), '첫 종목은 위로 옮길 수 없음')
  check(await moveDown(bench).isDisabled(), '마지막 종목은 아래로 옮길 수 없음')
  const moveSizes = await page.getByRole('button', { name: /옮기기$/ }).evaluateAll((els) =>
    els.map((el) => {
      const { width, height } = el.getBoundingClientRect()
      return [Math.round(width), Math.round(height)]
    }),
  )
  check(
    moveSizes.length === 6 && moveSizes.every(([w, h]) => w >= 40 && h >= 44),
    `옮기기 버튼 6개가 모두 40×44px 이상 (${JSON.stringify(moveSizes)})`,
  )
  await moveUp(bench).tap()
  await eventually(cardOrder, ['스쿼트', '벤치프레스', LONG_NAME], '벤치프레스를 위로')
  await moveUp(bench).tap()
  await eventually(cardOrder, ['벤치프레스', '스쿼트', LONG_NAME], '한 번 더 위로')
  // 머리줄(56px) 아래, 화면 위쪽 절반에 있어야 이어서 더 옮길 수 있다.
  const benchOnScreen = () =>
    bench.evaluate((el) => el.getBoundingClientRect().top >= 56 && el.getBoundingClientRect().top < 400)
  await eventually(benchOnScreen, true, '옮긴 카드를 화면이 따라감')
  await shot('05-moved')
  await moveDown(bench).tap()
  await eventually(cardOrder, ['스쿼트', '벤치프레스', LONG_NAME], '아래로')
  check((await weight(squat, 1).inputValue()) === '62.5', '옮겨도 세트 값은 그대로')
  await page.reload()
  await visible(squat, '다시 열기')
  await eventually(cardOrder, ['스쿼트', '벤치프레스', LONG_NAME], '다시 열어도 순서가 남아 있음')
  await card(LONG_NAME).scrollIntoViewIfNeeded()
  await noOverflow('운동 중(긴 종목 이름과 옮기기 버튼)')
  await shot('06-long-name')

  // ───────── 기록 상세
  step('기록 상세')
  await fill(weight(bench, 1), 40)
  await fill(reps(bench, 1), 10)
  await complete(bench, 1)
  await openSheet(bench, '1세트')
  await sheet('1세트').getByRole('button', { name: '7.5', exact: true }).tap()
  await fill(weight(bench, 2), 42.5)
  await fill(reps(bench, 2), 8)
  await complete(bench, 2)
  await page.getByRole('button', { name: '마치기' }).tap()
  await visible(page.getByRole('heading', { name: '운동 완료' }), '운동 완료 화면')
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  const again = page.getByRole('button', { name: '같은 운동 다시 하기' })
  await visible(again, '기록 상세')
  await eventually(cardOrder, ['스쿼트', '벤치프레스'], '기록 상세의 종목 순서(세트를 하지 않은 종목은 빠짐)')
  await eventually(() => chips(bench), ['1RPE 7.5', '2···'], '기록 상세에 RPE가 보임')
  check(!(await squat.textContent()).includes('랙 높이'), '기록 상세에는 종목 메모를 두지 않음')
  await shot('07-history-detail')

  await moveUp(bench).tap()
  await eventually(cardOrder, ['벤치프레스', '스쿼트'], '기록 상세에서도 순서를 바꿀 수 있음')
  await openSheet(bench, '2세트')
  await shot('08-history-set-sheet')
  await sheet('2세트').getByRole('button', { name: '9', exact: true }).tap()
  await eventually(() => chips(bench), ['1RPE 7.5', '2RPE 9'], '기록 상세에서 RPE를 적을 수 있음')
  await openSheet(bench, '1세트')
  await sheet('1세트').getByRole('button', { name: '세트 삭제' }).tap()
  await confirm.getByRole('button', { name: '삭제', exact: true }).tap()
  await eventually(() => chips(bench), ['1RPE 9'], '기록 상세에서 첫 세트를 지움(확인 후)')
  check((await weight(bench, 1).inputValue()) === '42.5', '남은 세트는 42.5kg')
  await noOverflow('기록 상세')

  // ───────── 다음 운동
  step('같은 운동 다시 하기')
  await again.tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '새 운동 시작')
  await eventually(cardOrder, ['벤치프레스', '스쿼트'], '기록 상세에서 바꾼 순서로 시작')

  // 새 기록 표시와 RPE가 같은 세트 번호에 함께 있을 때
  await fill(weight(bench, 1), 45)
  await reps(bench, 1).tap()
  await openSheet(bench, '1세트')
  check(
    await page.evaluate(() => !(document.activeElement instanceof HTMLInputElement)),
    '설정 창을 열면 입력 칸에서 포커스가 빠짐(키보드 내려감)',
  )
  await sheet('1세트').getByRole('button', { name: '9.5', exact: true }).tap()
  await complete(bench, 1)
  await visible(bench.getByRole('img', { name: /^새 기록/ }), '45kg를 완료하면 새 기록 표시')
  await visible(bench.getByRole('button', { name: '1세트 설정, RPE 9.5' }), '새 기록 표시가 있어도 RPE가 보임')
  await shot('09-pr-and-rpe')

  step('콘솔')
  phone.consoleClean()
}
