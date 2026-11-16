// 종목 관리와 휴식 시간: 종목 선택 화면에서 내 종목을 고치고 지우고 기본 종목을 숨겼다 되살린다.
// 휴식 타이머를 조절하고, 종목 상세에서 그 종목만의 휴식 시간과 메모를 적어 운동 화면에서 쓰이는지 본다.
// 기록이 있는 종목은 지우지 않고 숨기는 것까지 이어서 눌러 본다.
import { boxOf, touchTargets } from './lib/layout.js'
import { readRow } from './lib/store.js'

export const title = '종목 관리와 휴식 시간 (종목 고치기·지우기·숨기기, 타이머 조절, 종목별 휴식 시간, 종목 메모)'

const NOTE = '바 높이 5번, 안전바 3번\n벨트는 80kg부터'

export async function run(phone) {
  const { page, step, check, visible, hidden, text, count, eventually } = phone
  const { open, shot, noOverflow, fill, card, restTimer: timer } = phone
  const main = page.getByRole('main')
  const search = page.getByLabel('종목 이름으로 찾기')
  const items = main.getByRole('listitem')
  const exercise = (id) => readRow(page, 'exercises', id)
  const skip = timer.getByRole('button', { name: '건너뛰기' })

  /** 타이머에 보이는 남은 시간(초). 아직 없으면 null */
  const remaining = async () => {
    const clock = /(\d+):(\d\d)/.exec(await timer.textContent({ timeout: 500 }))
    return clock ? Number(clock[1]) * 60 + Number(clock[2]) : null
  }
  /**
   * 남은 시간이 seconds에서 막 줄어들기 시작한 값인지 본다.
   * 점검하는 사이에도 시간이 가므로 12초까지는 줄어 있어도 맞는 것으로 친다(조절 단위 15초보다 좁다).
   */
  const restNear = (seconds, message) =>
    eventually(
      async () => {
        const left = await remaining()
        return left !== null && left <= seconds && left > seconds - 12 ? '맞음' : `남은 시간 ${left}초`
      },
      '맞음',
      `${message} (${seconds}초에서 시작)`,
    )
  /** 세트 값을 넣고 완료로 표시한다. 휴식 타이머는 그대로 둔다. */
  const doSet = async (exerciseCard, n, weightKg, reps) => {
    await fill(exerciseCard.getByLabel(`${n}세트 무게`, { exact: true }), weightKg)
    await fill(exerciseCard.getByLabel(`${n}세트 횟수`, { exact: true }), reps)
    await exerciseCard.getByRole('button', { name: `${n}세트 완료`, exact: true }).tap()
  }

  // ───────── 종목 선택에서 내 종목 고치기, 지우기
  step('내 종목 고치기와 지우기')
  await open('/')
  await page.getByRole('button', { name: '운동 시작' }).tap()
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  await visible(page.getByRole('heading', { name: '종목 선택' }), '종목 선택 화면')
  // 내 종목 둘: 하나는 운동에 쓰고, 하나는 이름을 고친 뒤 지운다.
  for (const [i, name] of ['케틀벨 스윙', '잘못 만든 종목'].entries()) {
    await search.fill(name)
    await page.getByRole('button', { name: '내 종목 추가' }).tap()
    await page.getByRole('button', { name: '추가', exact: true }).tap()
    await visible(page.getByRole('button', { name: `선택한 ${i + 1}개 추가` }), `내 종목 "${name}" 추가`)
  }

  await search.fill('잘못')
  await page.getByRole('button', { name: '종목 관리: 잘못 만든 종목' }).tap()
  await visible(page.getByText('아직 기록이 없는 내 종목이라 완전히 지울 수 있습니다.'), '줄 끝의 버튼으로 관리 칸을 엶')
  await noOverflow('종목 관리 칸(내 종목)')
  await shot('01-picker-manage-custom')
  const nameInput = page.getByRole('textbox', { name: '이름', exact: true })
  const save = page.getByRole('button', { name: '저장', exact: true })
  await page.getByRole('button', { name: '이름·부위·기구 바꾸기' }).tap()
  await nameInput.fill('스쿼트')
  await save.tap()
  await visible(page.getByText('같은 이름의 종목이 이미 있습니다.'), '이미 있는 이름으로는 바꿀 수 없음')
  await shot('02-picker-rename-duplicate')
  await nameInput.fill('고친 종목')
  await page.getByRole('combobox', { name: '부위' }).selectOption('core')
  await save.tap()
  await search.fill('고친')
  await visible(page.getByRole('button', { name: /^고친 종목.*코어.*내 종목/ }), '이름과 부위를 고침')
  // 고친 뒤에도 관리 칸은 열려 있다.
  await page.getByRole('button', { name: '지우기', exact: true }).tap()
  const deleteDialog = page.getByRole('dialog', { name: '고친 종목 지우기' })
  await visible(deleteDialog, '기록이 없는 내 종목은 지우기 전에 물음')
  await shot('03-picker-delete-dialog')
  await deleteDialog.getByRole('button', { name: '지우기' }).tap()
  await visible(page.getByText('찾는 종목이 없습니다.'), '지운 종목은 목록에서 빠짐')
  await visible(page.getByRole('button', { name: '선택한 1개 추가' }), '지운 종목은 고른 목록에서도 빠짐')

  // ───────── 기본 종목 숨기기, 다시 보이기
  step('기본 종목 숨기기')
  await search.fill('레그')
  await visible(page.getByRole('button', { name: /^레그 컬.*하체/ }), '레그 컬이 목록에 있음')
  const before = await items.count()
  await page.getByRole('button', { name: '종목 관리: 레그 컬', exact: true }).tap()
  await shot('04-picker-manage-builtin')
  await page.getByRole('button', { name: '숨기기', exact: true }).tap()
  const hiddenToggle = page.getByRole('button', { name: /^숨긴 종목 \d+개$/ })
  await text(hiddenToggle, '숨긴 종목 1개', '숨기면 아래에 "숨긴 종목 1개"')
  await count(items, before - 1, '숨긴 종목은 목록에서 빠짐')
  await eventually(async () => (await exercise('seed:leg-curl'))?.archived, true, '숨긴 것이 저장됨')
  await hiddenToggle.tap()
  await hiddenToggle.scrollIntoViewIfNeeded()
  await noOverflow('숨긴 종목 목록')
  await shot('05-picker-hidden-list')
  await page.getByRole('button', { name: '레그 컬 다시 보이기', exact: true }).tap()
  await visible(page.getByRole('button', { name: /^레그 컬.*하체/ }), '다시 보이게 하면 목록으로 돌아옴')
  await hidden(hiddenToggle, '숨긴 종목이 없으면 그 줄도 사라짐')

  // ───────── 휴식 타이머: 이번 휴식만 15초씩, 길이 고르기
  step('휴식 타이머 조절')
  await search.fill('스쿼트')
  await page.getByRole('button', { name: /^스쿼트/ }).tap()
  await page.getByRole('button', { name: '선택한 2개 추가' }).tap()
  const squat = card('스쿼트')
  const kettlebell = card('케틀벨 스윙')
  await doSet(squat, 1, 60, 5)
  await visible(timer, '세트를 완료하면 타이머')
  await timer.getByRole('button', { name: '+15초' }).tap()
  await restNear(105, '+15초')
  await timer.getByRole('button', { name: '−15초' }).tap()
  await timer.getByRole('button', { name: '−15초' }).tap()
  await restNear(75, '−15초 두 번')
  await timer.getByRole('button', { name: '300초' }).tap()
  await restNear(300, '300초를 고름')
  await noOverflow('휴식 타이머')
  // 타이머가 떠 있는 동안 본문 아래에 두는 여백(pb-56 = 224px)보다 낮아야 마지막 카드를 가리지 않는다.
  const bar = await boxOf(timer.locator('..'))
  check(bar.height <= 224, `타이머 높이가 본문 아래 여백 224px 안 (${bar.height}px)`)
  await touchTargets(phone, '휴식 타이머', timer)
  await shot('06-rest-bar')
  // 고른 길이는 다음 휴식의 기본값이 되므로 90초로 되돌려 둔다.
  await timer.getByRole('button', { name: '90초' }).tap()
  await skip.tap()

  // 가장 긴 휴식(15분)에서도 한 줄에 들어가는지. 화면으로는 오래 걸리니 저장해 둔 타이머를 바꾸고 다시 연다.
  await page.evaluate(() => {
    const now = Date.now()
    sessionStorage.setItem('health.restTimer', JSON.stringify({ startedAt: now, endsAt: now + 899_000 }))
  })
  await page.reload()
  await visible(timer, '15분 가까운 타이머')
  await noOverflow('휴식 타이머(15분)')
  const clock = timer.getByText(/^\d+:\d\d$/)
  const clockFits = await clock.evaluate((el) => el.scrollWidth <= el.clientWidth)
  check(clockFits, `14분대 시간도 잘리지 않음 (${await clock.textContent()})`)
  check(await timer.getByRole('button', { name: '+15초' }).isDisabled(), '15분을 넘게는 늘릴 수 없음')
  await shot('07-rest-bar-15min')
  await skip.tap()

  // ───────── 종목 상세: 이 종목만의 휴식 시간, 메모
  step('종목별 휴식 시간과 메모')
  await squat.getByRole('link', { name: /스쿼트/ }).tap()
  await visible(page.getByRole('heading', { name: '스쿼트', exact: true }), '종목 이름을 누르면 종목 상세')
  await noOverflow('종목 상세(기록 없음)')
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot('08-detail-empty', { fullPage: true })
  const direct = page.getByLabel('휴식 시간 직접 입력')
  await page.getByRole('group', { name: '이 종목의 휴식 시간' }).getByRole('button', { name: '240초' }).tap()
  await eventually(() => direct.inputValue(), '240', '길이를 고르면 입력 칸에도 240')
  await visible(page.getByText('4분', { exact: true }), '몇 분인지 옆에 보임')
  await eventually(async () => (await exercise('seed:squat')).restSeconds, 240, '고른 240초가 저장됨')
  await direct.fill('5')
  await direct.blur()
  await visible(page.getByText('휴식 시간은 10~900초로 정해 주세요.'), '범위를 벗어난 값은 알려 줌')
  check((await exercise('seed:squat')).restSeconds === 240, '범위를 벗어난 값은 저장되지 않음')
  await shot('09-detail-rest-error')
  await direct.fill('210')
  await direct.blur()
  await visible(page.getByText('3분 30초', { exact: true }), '직접 넣은 210초')
  await eventually(async () => (await exercise('seed:squat')).restSeconds, 210, '직접 넣은 210초가 저장됨')
  // 메모를 치자마자 화면을 떠나도 저장된다.
  await page.getByLabel('종목 메모').fill(NOTE)
  await page.getByRole('button', { name: '뒤로' }).tap()
  await visible(squat, '운동 화면으로 돌아옴')
  await eventually(async () => (await exercise('seed:squat')).note, NOTE, '메모는 화면을 떠날 때도 저장됨')
  await text(squat, '바 높이 5번, 안전바 3번 벨트는 80kg부터', '적은 메모가 운동 카드에 보임')

  // 종목에 정한 시간으로 쉬고, 그 휴식에서 고른 길이는 다른 종목의 기본값이 되지 않는다.
  await doSet(squat, 2, 60, 5)
  await restNear(210, '스쿼트는 정해 둔 210초로 쉼')
  await shot('10-rest-bar-own-time')
  await timer.getByRole('button', { name: '120초' }).tap()
  await restNear(120, '이번 휴식을 120초로 바꿈')
  await skip.tap()
  await doSet(kettlebell, 1, 16, 15)
  await restNear(90, '다른 종목은 기본 90초 그대로')
  await skip.tap()

  // ───────── 기록이 있는 종목은 지우지 않고 숨긴다
  step('기록이 있는 종목 숨기기')
  await page.getByRole('button', { name: '마치기' }).tap()
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await visible(page.getByRole('button', { name: '같은 운동 다시 하기' }), '운동을 저장함')
  await open('/stats')
  await page.getByRole('link', { name: /^케틀벨 스윙/ }).first().tap()
  await visible(page.getByRole('heading', { name: '케틀벨 스윙', exact: true }), '케틀벨 스윙 상세')
  // 내 종목의 id는 만들 때 정해지므로 주소(#/exercises/<id>)에서 읽는다.
  const kettlebellId = phone.hash().split('/').pop()
  // 기록이 있으면 메모와 설정이 화면 아래로 밀려서, 머리줄의 버튼으로 바로 내려간다.
  const noteField = page.getByLabel('종목 메모')
  const noteTop = async () => (await boxOf(noteField)).top
  await page.evaluate(() => window.scrollTo(0, 0))
  const pushedDown = await noteTop()
  check(pushedDown > 780, `기록이 있으면 메모 칸은 첫 화면 아래에 있음 (${pushedDown}px)`)
  await page.getByRole('button', { name: '종목 설정' }).tap()
  await eventually(async () => (await noteTop()) < 200, true, '"종목 설정"을 누르면 메모 칸이 머리줄 바로 아래로 옴')
  await noOverflow('종목 상세(기록 있음)')
  await shot('11-detail-settings')
  await visible(page.getByText(/^기록이 있는 종목은 지우지 않고 숨깁니다/), '기록이 있는 내 종목은 지우기 대신 숨기기')
  await count(page.getByRole('button', { name: '지우기', exact: true }), 0, '지우기 버튼은 없음')
  await page.getByRole('button', { name: '숨기기', exact: true }).tap()
  await visible(page.getByText('숨긴 종목', { exact: true }), '숨기면 상세 위에 "숨긴 종목" 안내')
  await eventually(async () => (await exercise(kettlebellId))?.archived, true, '숨긴 것이 저장됨')
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot('12-detail-archived')

  await open('/stats')
  await visible(page.getByRole('link', { name: /^케틀벨 스윙/ }), '통계에는 숨긴 종목의 기록이 남음')
  await open('/routines/new?pick=1')
  await search.fill('케틀벨')
  await visible(page.getByText('찾는 종목이 없습니다.'), '루틴의 종목 선택에 숨긴 종목은 나오지 않음')
  await text(hiddenToggle, '숨긴 종목 1개', '대신 "숨긴 종목"에 있음')
  await shot('13-routine-picker-hidden')
  // 같은 이름으로 내 종목을 추가하면(띄어쓰기는 달라도) 새로 만들지 않고 숨긴 종목이 되살아난다.
  await search.fill('케틀벨스윙')
  await page.getByRole('button', { name: '내 종목 추가' }).tap()
  await page.getByRole('button', { name: '추가', exact: true }).tap()
  await visible(page.getByRole('button', { name: /^케틀벨 스윙.*내 종목/ }), '같은 이름으로 추가하면 숨긴 종목이 다시 보임')
  await hidden(hiddenToggle, '숨긴 종목 줄이 사라짐')

  step('콘솔')
  phone.consoleClean()
}
