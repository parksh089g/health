// 기본 흐름: 처음 연 앱에서 운동을 시작해 세트를 적고, 휴식 타이머, 운동 완료, 기록 보기와 수정,
// 백업과 복원, 어두운 화면, 오프라인까지 실제로 쓰는 순서대로 눌러 본다.
import { SEED_EXERCISES } from '../src/seed.ts'
import { BACKUP_VERSION } from './lib/phone.js'

export const title = '기본 흐름 (운동 기록, 휴식 타이머, 기록, 백업과 복원, 오프라인)'

// 종목 수는 앱의 기본 종목 목록(src/seed.ts)에서 센다. 종목을 더해도 점검을 고칠 필요가 없다.
// Node가 .ts 파일을 그대로 읽으므로(22.18 이상) seed.ts는 타입 말고는 다른 파일을 가져오지 않아야 한다.
const seedCount = SEED_EXERCISES.length
const legsCount = SEED_EXERCISES.filter((e) => e.bodyPart === 'legs').length
const benchCount = SEED_EXERCISES.filter((e) => e.name.includes('벤치')).length

export async function run(phone) {
  const { page, context, baseUrl, step, check, note, visible, hidden, text, attr, count, eventually } = phone
  const { open, hash, shot, noOverflow, fill, card, setValues, restTimer: timer, download, consoleProblems } = phone
  const main = page.getByRole('main')
  const startButton = page.getByRole('button', { name: '운동 시작' })
  const cardOrder = () => main.getByRole('heading', { level: 3 }).allTextContents()

  // ───────── 홈 (빈 상태)
  step('홈(처음)')
  await page.goto(baseUrl)
  await visible(page.getByRole('heading', { name: '헬스 기록' }), '앱 제목')
  await visible(startButton, '운동 시작 버튼')
  await visible(page.getByText('아직 기록이 없습니다.'), '빈 상태 안내')
  check((await page.title()) === '헬스 기록', `문서 제목 = 헬스 기록 (실제: ${await page.title()})`)
  await noOverflow('홈')
  await shot('01-home-empty')

  // ───────── 운동 시작
  step('운동 시작')
  await startButton.tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '운동 중 화면')
  await visible(page.getByText('오늘 할 종목을 추가해 주세요.'), '종목 없음 안내')
  check(/^#\/workout\/[0-9a-f-]{36}$/.test(hash()), `주소가 운동 화면 (${hash()})`)
  const workoutHash = hash()

  // ───────── 종목 선택
  step('종목 선택')
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  await visible(page.getByRole('heading', { name: '종목 선택' }), '종목 선택 화면')
  const items = main.getByRole('listitem')
  const search = page.getByLabel('종목 이름으로 찾기')
  const bodyParts = page.getByRole('group', { name: '부위' })
  await visible(items, '종목 목록')
  await count(items, seedCount, `기본 종목 ${seedCount}개`)
  await noOverflow('종목 선택')
  await shot('02-picker')

  await bodyParts.getByRole('button', { name: '하체' }).tap()
  await count(items, legsCount, `하체 종목 ${legsCount}개`)
  await page.getByRole('button', { name: /^스쿼트/ }).tap()

  await bodyParts.getByRole('button', { name: '전체' }).tap()
  await search.fill('벤치')
  await count(items, benchCount, `"벤치" 검색 결과 ${benchCount}개`)
  await page.getByRole('button', { name: /^벤치프레스/ }).tap()
  await visible(page.getByRole('button', { name: '선택한 2개 추가' }), '선택한 2개 추가 버튼')

  // 내 종목 추가
  await search.fill('케틀벨 스윙')
  await visible(page.getByText('찾는 종목이 없습니다.'), '검색 결과 없음 안내')
  await page.getByRole('button', { name: '내 종목 추가' }).tap()
  const nameInput = page.getByRole('textbox', { name: '이름', exact: true })
  check((await nameInput.inputValue()) === '케틀벨 스윙', '검색어가 새 종목 이름에 채워짐')
  await page.getByRole('combobox', { name: '부위' }).selectOption('legs')
  await page.getByRole('combobox', { name: '기구' }).selectOption('other')
  await shot('03-picker-custom-form')
  await page.getByRole('button', { name: '추가', exact: true }).tap()
  await visible(page.getByRole('button', { name: '선택한 3개 추가' }), '내 종목이 선택에 더해짐')
  await visible(page.getByRole('button', { name: /^케틀벨 스윙.*내 종목/ }), '내 종목 표시')
  await shot('04-picker-selected')
  await page.getByRole('button', { name: '선택한 3개 추가' }).tap()

  // ───────── 세트 입력
  step('세트 입력')
  await visible(page.getByRole('heading', { name: '운동 중' }), '운동 화면으로 돌아옴')
  check(hash() === workoutHash, '같은 운동 주소')
  await visible(card('스쿼트'), '스쿼트 카드')
  await visible(card('벤치프레스'), '벤치프레스 카드')
  await visible(card('케틀벨 스윙'), '케틀벨 스윙 카드')
  await eventually(cardOrder, ['스쿼트', '벤치프레스', '케틀벨 스윙'], '고른 순서대로')
  const squat = card('스쿼트')
  await count(squat.getByRole('button', { name: /세트 완료$/ }), 3, '빈 세트 3개')

  // 횟수 없이 완료를 누르면 완료되지 않고 횟수 칸으로 간다
  await squat.getByRole('button', { name: '1세트 완료' }).tap()
  check(
    (await squat.getByRole('button', { name: '1세트 완료' }).getAttribute('aria-pressed')) === 'false',
    '횟수 없이는 완료되지 않음',
  )
  check(
    await squat.getByLabel('1세트 횟수', { exact: true }).evaluate((el) => document.activeElement === el),
    '횟수 칸으로 포커스 이동',
  )
  await hidden(page.getByRole('timer'), '타이머 뜨지 않음', 1000)

  await fill(squat.getByLabel('1세트 무게', { exact: true }), '60')
  await fill(squat.getByLabel('1세트 횟수', { exact: true }), '8')
  await squat.getByRole('button', { name: '1세트 완료' }).tap()
  await attr(squat.getByRole('button', { name: '1세트 완료' }), 'aria-pressed', 'true', '1세트 완료 표시')

  // ───────── 휴식 타이머
  step('휴식 타이머')
  await visible(timer, '세트 완료 후 타이머 시작')
  await text(timer, /1:(30|2\d)/, '기본 90초에서 시작')
  await shot('05-workout-rest-timer')
  await timer.getByRole('button', { name: '60초' }).tap()
  await text(timer, /1:00|0:5\d/, '60초로 바꾸면 남은 시간이 줄어듦')
  await timer.getByRole('button', { name: '건너뛰기' }).tap()
  await hidden(timer, '건너뛰면 타이머가 사라짐')

  // 소수 무게, 쉼표 입력
  step('세트 입력 2')
  const weight2 = squat.getByLabel('2세트 무게', { exact: true })
  await weight2.tap()
  await weight2.pressSequentially('62,5')
  check((await weight2.inputValue()) === '62.5', `쉼표를 소수점으로 받음 (${await weight2.inputValue()})`)
  await weight2.press('Enter')
  // 횟수를 치자마자(화면에 반영되기 전에) 완료를 눌러도 완료된다.
  // 입력과 누르기 사이에 화면이 다시 그려질 틈을 주지 않으려고 브라우저 안에서 한 번에 한다.
  const reps2 = squat.getByLabel('2세트 횟수', { exact: true })
  const done2 = squat.getByRole('button', { name: '2세트 완료' })
  await reps2.evaluate((input, button) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    input.focus()
    setValue.call(input, '6')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    button.click()
  }, await done2.elementHandle())
  await attr(done2, 'aria-pressed', 'true', '횟수를 치자마자 완료를 눌러도 완료됨')
  check((await reps2.inputValue()) === '6', '친 횟수가 남아 있음')
  check(
    await page.evaluate(() => !(document.activeElement instanceof HTMLInputElement)),
    '완료하면 입력 칸에서 포커스가 빠짐(키보드 내려감)',
  )
  await text(timer, /1:00|0:5\d/, '바꾼 60초가 다음 휴식의 기본값')
  await timer.getByRole('button', { name: '건너뛰기' }).tap()

  // 글자는 들어가지 않는다
  const reps3 = squat.getByLabel('3세트 횟수', { exact: true })
  await reps3.tap()
  await reps3.pressSequentially('4a.5')
  check((await reps3.inputValue()) === '45', `횟수 칸은 숫자만 (${await reps3.inputValue()})`)
  await reps3.fill('4')
  await reps3.press('Enter')
  await fill(squat.getByLabel('3세트 무게', { exact: true }), '65')
  // 3세트는 완료 체크를 하지 않고 둔다.

  // 벤치: 1세트를 웜업으로
  const bench = card('벤치프레스')
  await bench.getByRole('button', { name: /^1세트\. 누르면 웜업/ }).tap()
  await visible(bench.getByRole('button', { name: /^웜업 세트/ }), '웜업으로 바뀜')
  await fill(bench.getByLabel('W세트 무게', { exact: true }), '20')
  await fill(bench.getByLabel('W세트 횟수', { exact: true }), '10')
  await bench.getByRole('button', { name: 'W세트 완료' }).tap()
  await timer.getByRole('button', { name: '건너뛰기' }).tap()
  await fill(bench.getByLabel('1세트 무게', { exact: true }), '40')
  await fill(bench.getByLabel('1세트 횟수', { exact: true }), '10')
  await bench.getByRole('button', { name: '1세트 완료' }).tap()
  await timer.getByRole('button', { name: '건너뛰기' }).tap()

  // 세트 추가는 앞 세트 값을 따라간다. 세트 삭제는 마지막 세트를 지운다.
  await bench.getByRole('button', { name: '세트 추가' }).tap()
  await visible(bench.getByLabel('3세트 무게', { exact: true }), '세트가 하나 늘어남')
  await bench.getByRole('button', { name: '세트 삭제' }).tap()
  await hidden(bench.getByLabel('3세트 무게', { exact: true }), '마지막 세트가 지워짐')

  // 케틀벨 스윙은 빼기
  await card('케틀벨 스윙').getByRole('button', { name: '빼기' }).tap()
  const removeDialog = page.getByRole('dialog', { name: '케틀벨 스윙 빼기' })
  await visible(removeDialog, '빼기 확인 창')
  await shot('06-workout-remove-dialog')
  await removeDialog.getByRole('button', { name: '빼기' }).tap()
  await hidden(card('케틀벨 스윙'), '종목이 빠짐')
  await page.evaluate(() => window.scrollTo(0, 0))
  await noOverflow('운동 중')
  await shot('07-workout-filled')

  // 새로고침해도 입력이 남아 있다
  await page.reload()
  await visible(card('스쿼트'), '새로고침 뒤에도 운동이 그대로')
  check((await weight2.inputValue()) === '62.5', '입력한 값이 남아 있음')

  // ───────── 운동 완료
  step('운동 완료')
  await page.getByRole('button', { name: '마치기' }).tap()
  await visible(page.getByRole('heading', { name: '운동 완료' }), '운동 완료 화면')
  const stat = (label) => page.locator('dl > div').filter({ hasText: label }).locator('dd')
  await text(stat('종목'), '2개', '종목 2개')
  await text(stat('완료한 세트'), '4개', '완료한 세트 4개')
  await text(stat('총 볼륨'), '1,255kg', '볼륨 1,255kg (웜업 제외)')
  await visible(page.getByText('완료 체크를 하지 않은 세트가 1개 있습니다.'), '미완료 세트 안내')
  await shot('08-done-pending')
  await page.getByRole('button', { name: '모두 완료로 표시' }).tap()
  await text(stat('완료한 세트'), '5개', '모두 완료 뒤 5개')
  await text(stat('총 볼륨'), '1,515kg', '볼륨 1,515kg')
  await hidden(page.getByText('완료 체크를 하지 않은 세트가'), '미완료 안내가 사라짐')
  await page.getByLabel('메모').fill('컨디션 좋았음')
  await noOverflow('운동 완료')
  await shot('09-done')
  await page.getByRole('button', { name: '저장', exact: true }).tap()

  // ───────── 기록 상세
  step('기록 상세')
  const again = page.getByRole('button', { name: '같은 운동 다시 하기' })
  await visible(again, '기록 상세 화면')
  check(/^#\/history\/[0-9a-f-]{36}$/.test(hash()), `주소가 기록 상세 (${hash()})`)
  await text(main, '종목 2개 · 5세트 · 볼륨 1,515kg', '요약 줄')
  check((await page.getByLabel('메모').inputValue()) === '컨디션 좋았음', '메모가 저장됨')
  check((await card('스쿼트').getByLabel('3세트 무게', { exact: true }).inputValue()) === '65', '3세트 값이 남아 있음')
  check((await page.getByRole('button', { name: /세트 완료$/ }).count()) === 0, '기록 화면에는 완료 버튼이 없음')
  await noOverflow('기록 상세')
  await shot('10-history-detail')

  // 지난 기록 수정: 무게를 바꾸면 요약이 바뀐다
  await fill(card('스쿼트').getByLabel('3세트 무게', { exact: true }), '70')
  await text(main, '볼륨 1,535kg', '수정하면 볼륨이 다시 계산됨')

  // 뒤로 가면 홈(완료 화면이나 운동 화면으로 돌아가지 않는다)
  await page.getByRole('button', { name: '뒤로' }).tap()
  step('홈(기록 1건)')
  await visible(page.getByRole('heading', { name: '헬스 기록' }), '뒤로 가면 홈')
  await visible(startButton, '진행 중인 운동 없음')
  await text(page.getByRole('region', { name: '이번 주 운동' }), '1회', '이번 주 1회')
  await text(page.getByRole('region', { name: '최근 운동' }), '스쿼트, 벤치프레스', '최근 운동에 표시')
  await text(page.getByRole('region', { name: '최근 운동' }), '5세트 · 1,535kg', '최근 운동 요약')
  await shot('11-home-with-record')

  // ───────── 다음 운동: 지난 세트 자동 채우기
  step('자동 채우기')
  await startButton.tap()
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  await page.getByRole('button', { name: /^스쿼트/ }).tap()
  await page.getByRole('button', { name: '선택한 1개 추가' }).tap()
  await visible(squat, '스쿼트 카드')
  await eventually(() => setValues(squat, [1, 2, 3]), '60x8 62.5x6 70x4', '지난 값으로 채워짐')
  await text(squat, '지난번 60×8 · 62.5×6 · 70×4', '지난번 기록 표시')
  await count(squat.getByRole('button', { name: /세트 완료$/, pressed: true }), 0, '채워진 세트는 아직 완료가 아님')
  await shot('12-workout-prefilled')

  // 이미 넣은 종목은 다시 고를 수 없다
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  check(await page.getByRole('button', { name: /^스쿼트.*추가됨/ }).isDisabled(), '이미 넣은 종목은 비활성')
  await page.getByRole('button', { name: '뒤로' }).tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '선택 화면에서 뒤로')

  // ───────── 휴식이 끝났을 때 (새로고침해도 타이머가 이어진다)
  step('휴식 끝')
  await squat.getByRole('button', { name: '1세트 완료' }).tap()
  await visible(timer, '타이머 시작')
  await attr(squat.getByRole('button', { name: '1세트 완료' }), 'aria-pressed', 'true', '완료 표시')
  // 끝나기 2초 전으로 맞춘 타이머를 저장해 두고, 앱이 덮어쓰기 전에 바로 새로고침한다.
  await page.evaluate(() => {
    const now = Date.now()
    sessionStorage.setItem('health.restTimer', JSON.stringify({ startedAt: now - 58_000, endsAt: now + 2_000 }))
  })
  await page.reload()
  await visible(timer, '새로고침 뒤에도 타이머가 이어짐')
  await text(timer, '끝!', '시간이 다 되면 끝 표시')
  await shot('13-rest-finished')
  await hidden(timer, '끝 표시는 잠시 뒤 스스로 사라짐', 12_000)

  // ───────── 홈에서 이어서 하기, 운동 취소
  step('이어서 하기와 취소')
  await page.getByRole('button', { name: '뒤로' }).tap()
  const active = page.getByRole('region', { name: '진행 중인 운동' })
  await visible(active, '홈에 진행 중인 운동')
  await text(active, '종목 1개 · 완료한 세트 1개', '진행 상황')
  await shot('14-home-active')
  await page.getByRole('button', { name: '이어서 하기' }).tap()
  await visible(squat, '운동 화면으로 복귀')
  await page.getByRole('button', { name: '운동 취소' }).tap()
  const cancelDialog = page.getByRole('dialog', { name: '운동을 취소할까요?' })
  await visible(cancelDialog, '취소 확인 창')
  await cancelDialog.getByRole('button', { name: '취소하고 지우기' }).tap()
  await visible(startButton, '취소 뒤 홈, 진행 중인 운동 없음')
  await text(page.getByRole('region', { name: '이번 주 운동' }), '1회', '취소한 운동은 세지 않음')

  // 완료한 세트 없이 마치려 하면 저장할 수 없다
  step('빈 운동 마치기')
  await startButton.tap()
  await page.getByRole('button', { name: '마치기' }).tap()
  await visible(page.getByText('완료한 세트가 없어서 저장할 기록이 없습니다.'), '저장할 기록 없음 안내')
  check((await page.getByRole('button', { name: '저장', exact: true }).count()) === 0, '저장 버튼 없음')
  await shot('15-done-empty')
  await page.getByRole('button', { name: '기록하지 않고 끝내기' }).tap()
  await page.getByRole('dialog').getByRole('button', { name: '끝내고 지우기' }).tap()
  await visible(startButton, '홈으로 돌아옴')

  // ───────── 기록 탭
  step('기록 탭')
  await page.getByRole('link', { name: '기록', exact: true }).tap()
  await visible(page.getByRole('heading', { name: '기록', exact: true }), '기록 화면')
  const rows = page.locator('section a[href^="#/history/"]')
  await count(rows, 1, '기록 1건')
  await shot('16-history')
  await rows.first().tap()
  await visible(again, '기록 상세')

  // 같은 운동 다시 하기
  step('같은 운동 다시 하기')
  await again.tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '새 운동 시작')
  await eventually(cardOrder, ['스쿼트', '벤치프레스'], '같은 종목, 같은 순서')
  await visible(bench.getByRole('button', { name: /^웜업 세트/ }), '웜업 표시도 따라옴')
  check((await bench.getByLabel('1세트 무게', { exact: true }).inputValue()) === '40', '벤치 값도 채워짐')

  // 진행 중인 운동이 있을 때 다시 하기를 누르면 안내가 뜬다
  await page.getByRole('button', { name: '뒤로' }).tap()
  await visible(again, '뒤로 가면 보던 기록으로')
  await again.tap()
  const activeDialog = page.getByRole('dialog', { name: '진행 중인 운동이 있습니다' })
  await visible(activeDialog, '진행 중인 운동 안내')
  await activeDialog.getByRole('button', { name: '진행 중인 운동 열기' }).tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '진행 중인 운동으로 이동')
  await page.getByRole('button', { name: '운동 취소' }).tap()
  await page.getByRole('dialog').getByRole('button', { name: '취소하고 지우기' }).tap()
  await visible(startButton, '정리 뒤 홈')

  // ───────── 설정과 백업
  step('설정과 백업')
  await page.getByRole('link', { name: '설정', exact: true }).tap()
  await visible(page.getByRole('heading', { name: '설정' }), '설정 화면')
  const restGroup = page.getByRole('region', { name: '휴식 시간' })
  const records = page.getByRole('region', { name: '이 기기의 기록' })
  const backupSection = page.getByRole('region', { name: '백업' })
  // 기본 종목에 내 종목(케틀벨 스윙) 하나를 더한 수
  const exerciseCount = seedCount + 1
  await visible(restGroup.getByRole('button', { name: '60초', pressed: true }), '타이머에서 바꾼 60초가 기본값')
  await restGroup.getByRole('button', { name: '120초' }).tap()
  await visible(restGroup.getByRole('button', { name: '120초', pressed: true }), '120초 선택')
  await text(records, `운동 1회 · 세트 5개 · 종목 ${exerciseCount}개`, '기록 수')
  await text(backupSection, '마지막 백업: 아직 없음', '백업 전 표시')
  await noOverflow('설정')
  await shot('17-settings')

  const backupFile = await download(page.getByRole('button', { name: '백업 파일 저장' }))
  check(/^health-backup-\d{4}-\d{2}-\d{2}\.json$/.test(backupFile.name), `파일 이름 (${backupFile.name})`)
  const backup = JSON.parse(backupFile.text)
  check(
    backup.format === 'health-log-backup' && backup.version === BACKUP_VERSION,
    `백업 형식과 버전 ${BACKUP_VERSION} (실제: ${backup.format}, ${backup.version})`,
  )
  check(Array.isArray(backup.data.routines) && Array.isArray(backup.data.bodyWeights), '백업에 루틴과 체중 기록 목록이 있음')
  check(
    backup.data.workouts.length === 1 && backup.data.sets.length === 5,
    `백업 내용: 운동 ${backup.data.workouts.length}, 세트 ${backup.data.sets.length}`,
  )
  check(backup.data.exercises.length === exerciseCount, `백업 종목 ${exerciseCount}개 (실제 ${backup.data.exercises.length})`)
  await visible(page.getByRole('status'), '백업 완료 알림')
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
  })
  await text(backupSection, `마지막 백업: ${today}`, '마지막 백업 날짜')
  await shot('18-settings-after-backup')

  // 기록을 지운 뒤 복원
  step('복원')
  await page.getByRole('link', { name: '기록', exact: true }).tap()
  await rows.first().tap()
  await page.getByRole('button', { name: '이 기록 삭제' }).tap()
  const deleteDialog = page.getByRole('dialog', { name: '이 기록을 삭제할까요?' })
  await deleteDialog.getByRole('button', { name: '삭제', exact: true }).tap()
  await visible(page.getByText('아직 기록이 없습니다.'), '삭제 뒤 기록 없음')

  await page.getByRole('link', { name: '설정', exact: true }).tap()
  const filePicker = page.getByLabel('백업 파일 선택')
  const jsonFile = (name, content) => ({ name, mimeType: 'application/json', buffer: Buffer.from(content) })
  // 엉뚱한 파일은 거절한다
  await filePicker.setInputFiles(jsonFile('other.json', '{"hello":"world"}'))
  await text(page.getByRole('alert'), '이 앱의 백업 파일이 아닙니다.', '다른 파일은 거절')
  await filePicker.setInputFiles(jsonFile(backupFile.name, backupFile.text))
  const restoreDialog = page.getByRole('dialog', { name: '백업에서 복원할까요?' })
  await visible(restoreDialog, '복원 확인 창')
  await text(restoreDialog, '운동 1회가 들어 있습니다.', '백업 내용 안내')
  await shot('19-restore-dialog')
  await restoreDialog.getByRole('button', { name: '지우고 복원' }).tap()
  await text(page.getByRole('status'), '백업에서 기록을 복원했습니다.', '복원 완료 알림')
  await text(records, `운동 1회 · 세트 5개 · 종목 ${exerciseCount}개`, '복원 뒤 기록 수')
  await page.getByRole('link', { name: '기록', exact: true }).tap()
  await count(rows, 1, '복원한 기록이 목록에 보임')
  await rows.first().tap()
  await text(main, '종목 2개 · 5세트 · 볼륨 1,535kg', '복원한 기록 내용')
  await shot('20-history-restored')

  // ───────── 어두운 화면
  step('어두운 화면')
  await open('/')
  await visible(startButton, '홈')
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const lightBackground = await background()
  await page.emulateMedia({ colorScheme: 'dark' })
  const darkBackground = await background()
  await page.emulateMedia({ colorScheme: 'light' })
  check(
    darkBackground !== lightBackground && darkBackground !== 'rgba(0, 0, 0, 0)',
    `폰이 어두운 화면이면 배경이 바뀜 (${lightBackground} → ${darkBackground})`,
  )
  await shot('21-home')

  // ───────── 오프라인
  step('오프라인')
  const serviceWorker = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported'
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 10_000)),
    ])
    return registration ? `${registration.active?.state} scope=${registration.scope}` : 'timeout'
  })
  check(/^activat(ed|ing) scope=/.test(serviceWorker), `서비스 워커 동작 (${serviceWorker})`)
  // 서비스 워커가 이 화면을 맡을 때까지 기다린다. 그래야 인터넷을 끊고 새로고침해도 열린다.
  await page
    .waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10_000 })
    .catch(() => {})
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.href
    if (!href) return null
    const res = await fetch(href)
    return { href, ok: res.ok, json: await res.json() }
  })
  check(manifest?.ok === true && manifest.json.name === '헬스 기록', `매니페스트 (${manifest?.href})`)
  const startUrl = manifest ? new URL(manifest.json.start_url, manifest.href).href : ''
  check(startUrl === new URL('./', baseUrl).href, `매니페스트 시작 주소가 앱 위치 (${startUrl})`)

  // 인터넷이 끊긴 동안의 콘솔 줄(실패한 요청 등)은 예상한 것이라 점검에서 뺀다.
  const beforeOffline = consoleProblems.length
  await context.setOffline(true)
  await page.reload()
  await visible(page.getByRole('heading', { name: '헬스 기록' }), '인터넷 없이도 열림')
  await text(page.getByRole('region', { name: '최근 운동' }), '스쿼트, 벤치프레스', '오프라인에서도 기록이 보임')
  await startButton.tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '오프라인에서 운동 시작')
  await page.getByRole('button', { name: '운동 취소' }).tap()
  await page.getByRole('dialog').getByRole('button', { name: '취소하고 지우기' }).tap()
  await visible(startButton, '오프라인에서 취소')
  await context.setOffline(false)
  const offlineNoise = consoleProblems.splice(beforeOffline)
  if (offlineNoise.length) note(`오프라인 중 콘솔 ${offlineNoise.length}건: ${offlineNoise.join(' | ')}`)

  step('콘솔')
  phone.consoleClean()
}
