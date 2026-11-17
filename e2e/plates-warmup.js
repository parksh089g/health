// 원판 계산과 웜업 세트 만들기: 스쿼트 100kg로 운동을 시작해 원판 계산 창을 보고, 설정에서 원판과 바 무게를 바꾸면
// 계산이 따라 바뀌는지 본다. 웜업 세트를 만들어 넣은 뒤 저장된 세트와 순서를 확인하고, 일부를 끝낸 뒤 다시 만들어 본다.
// 덤벨 종목(웜업만), 맨몸 종목(도구 없음), 좁은 화면(320px), 기록 상세까지 이어서 본다.
import { boxOf, touchTargets } from './lib/layout.js'
import { readRow } from './lib/store.js'

export const title = '원판 계산과 웜업 세트 만들기 (바·원판 설정, 한쪽 원판, 웜업 세트 넣기와 바꾸기)'

/** 종목 카드(WorkoutExercise)의 세트를 저장소에서 순서대로 읽는다. */
function storedSets(page, exerciseId) {
  return page.evaluate(
    (exerciseId) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('health-log')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const idb = open.result
          const tx = idb.transaction(['workoutExercises', 'sets'])
          const wes = tx.objectStore('workoutExercises').getAll()
          const sets = tx.objectStore('sets').getAll()
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => {
            idb.close()
            const ids = wes.result.filter((we) => we.exerciseId === exerciseId).map((we) => we.id)
            resolve(sets.result.filter((s) => ids.includes(s.workoutExerciseId)).sort((a, b) => a.order - b.order))
          }
        }
      }),
    exerciseId,
  )
}

/** 세트를 'W20x10', 완료했으면 'W20x10!'처럼 줄인다. */
const brief = (sets) =>
  sets.map((s) => `${s.isWarmup ? 'W' : ''}${s.weightKg ?? ''}x${s.reps ?? ''}${s.isDone ? '!' : ''}`)

export async function run(phone) {
  const { page, step, check, visible, hidden, text, attr, count, eventually } = phone
  const { open, shot, noOverflow, fill, card, skipRest } = phone
  const search = page.getByLabel('종목 이름으로 찾기')
  const weight = (exerciseCard, label) => exerciseCard.getByLabel(`${label}세트 무게`, { exact: true })
  const reps = (exerciseCard, label) => exerciseCard.getByLabel(`${label}세트 횟수`, { exact: true })
  const warmupButton = (exerciseCard) => exerciseCard.getByRole('button', { name: '웜업 세트 만들기' })
  const plateButton = (exerciseCard) => exerciseCard.getByRole('button', { name: '원판 계산' })
  const addSetButton = (exerciseCard) => exerciseCard.getByRole('button', { name: '세트 추가' })
  const chips = (exerciseCard) => exerciseCard.getByRole('button', { name: /세트 설정/ }).allTextContents()
  const sheet = page.getByRole('dialog', { name: '원판 계산' })
  const sheetRows = sheet.getByRole('list', { name: '세트 무게별 원판' }).getByRole('listitem')
  const sheetRow = (kg) => sheetRows.filter({ hasText: new RegExp(`^${String(kg).replace('.', '\\.')}kg`) })
  const warmupDialog = page.getByRole('dialog', { name: '웜업 세트 만들기' })
  const planRows = () => warmupDialog.getByRole('list', { name: '넣을 웜업 세트' }).getByRole('listitem').allTextContents()
  const plateSettings = page.getByRole('region', { name: '바와 원판' })
  const plateToggle = (kg) => plateSettings.getByRole('button', { name: `${kg}kg 원판`, exact: true })
  const setting = async (key) => (await readRow(page, 'settings', key))?.value ?? null

  // ───────── 운동 시작: 스쿼트(바벨), 덤벨 컬(덤벨), 풀업(맨몸), 플랭크(시간)
  step('준비')
  await open('/')
  await page.getByRole('button', { name: '운동 시작' }).tap()
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  for (const name of ['스쿼트', '덤벨 컬', '풀업', '플랭크']) {
    await search.fill(name)
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().tap()
  }
  await page.getByRole('button', { name: '선택한 4개 추가' }).tap()
  const squat = card('스쿼트')
  const curl = card('덤벨 컬')
  const pullUp = card('풀업')
  const plank = card('플랭크')
  await visible(squat, '스쿼트 카드')

  // ───────── 카드 아래 도구 버튼
  step('도구 버튼')
  await visible(warmupButton(squat), '바벨 종목: 웜업 버튼')
  await visible(plateButton(squat), '바벨 종목: 원판 버튼')
  await visible(warmupButton(curl), '덤벨 종목: 웜업 버튼')
  await count(plateButton(curl), 0, '덤벨 종목에는 원판 버튼이 없음')
  for (const [name, exerciseCard] of [['맨몸 종목(풀업)', pullUp], ['시간 종목(플랭크)', plank]]) {
    await count(warmupButton(exerciseCard), 0, `${name}에는 웜업 버튼이 없음`)
    await count(plateButton(exerciseCard), 0, `${name}에는 원판 버튼이 없음`)
  }
  // 도구가 없는 카드는 "세트 추가"가 줄을 다 쓴다(이전과 같은 모양).
  const pullUpAdd = await boxOf(addSetButton(pullUp))
  const pullUpField = await boxOf(pullUp.getByRole('button', { name: '1세트 완료' }))
  const pullUpChip = await boxOf(pullUp.getByRole('button', { name: /^1세트 설정/ }))
  check(
    pullUpAdd.left === pullUpChip.left && pullUpAdd.right === pullUpField.right,
    `도구가 없는 카드: 세트 추가가 카드 폭을 다 씀 (${pullUpAdd.left}~${pullUpAdd.right}, 세트 줄 ${pullUpChip.left}~${pullUpField.right})`,
  )
  // 도구가 둘 다 있는 카드에서도 "세트 추가"가 가장 넓다.
  const squatAdd = await boxOf(addSetButton(squat))
  const squatWarmup = await boxOf(warmupButton(squat))
  const squatPlate = await boxOf(plateButton(squat))
  check(
    squatAdd.width > squatWarmup.width && squatAdd.width > squatPlate.width,
    `세트 추가(${squatAdd.width}px)가 웜업(${squatWarmup.width}px), 원판(${squatPlate.width}px)보다 넓음`,
  )
  check(squatAdd.top === squatWarmup.top && squatAdd.top === squatPlate.top, '세 버튼이 한 줄에 놓임')
  await touchTargets(phone, '스쿼트 카드', squat)
  await noOverflow('운동 중(도구 버튼)')
  await shot('01-card-tools', { of: squat })

  // ───────── 무게가 없을 때
  step('무게가 없을 때')
  await warmupButton(squat).tap()
  await text(warmupDialog, '본 세트에 무게를 먼저 적어 주세요', '무게가 없으면 까닭을 알려 줌')
  await shot('02-warmup-no-weight')
  await warmupDialog.getByRole('button', { name: '확인' }).tap()
  await hidden(warmupDialog, '확인을 누르면 닫힘')
  check((await storedSets(page, 'seed:squat')).length === 3, '세트는 그대로 3개')

  await plateButton(squat).tap()
  await text(sheet, '세트에 무게를 적으면 여기에 나옵니다.', '무게가 없으면 원판 창에 안내만')
  await sheet.getByRole('button', { name: '닫기' }).tap()
  await hidden(sheet, '원판 창이 닫힘')

  // ───────── 원판 계산
  step('원판 계산')
  await fill(weight(squat, 1), 100)
  await fill(reps(squat, 1), 5)
  await fill(weight(squat, 2), 100)
  await fill(reps(squat, 2), 5)
  await fill(weight(squat, 3), 101)
  await fill(reps(squat, 3), 5)
  await plateButton(squat).tap()
  await visible(sheet, '원판 버튼을 누르면 원판 계산 창')
  await text(sheet, '바 20kg에 한쪽마다 끼울 원판입니다.', '쓰는 바 무게가 보임')
  await text(sheet, '원판 25, 20, 15, 10, 5, 2.5, 1.25kg', '가진 원판이 보임')
  await count(sheetRows, 2, '세트 무게가 겹치지 않게 두 줄(100kg, 101kg)')
  await text(sheetRow(100), '한쪽에 25 + 15', '100kg: 한쪽에 25 + 15')
  await text(sheetRow(101), '한쪽에 25 + 15', '101kg: 넘지 않는 가장 가까운 무게로')
  await text(sheetRow(101), '100kg까지 맞출 수 있어요 (1kg 남음)', '101kg: 남는 무게를 알려 줌')

  // 다른 무게 적어 보기
  const other = sheet.getByLabel('다른 무게', { exact: true })
  const result = sheet.getByRole('status')
  await other.tap()
  await other.fill('62.5')
  await text(result, '한쪽에 20 + 1.25', '다른 무게 62.5kg: 한쪽에 20 + 1.25')
  await noOverflow('원판 계산 창')
  await touchTargets(phone, '원판 계산 창', sheet, { selector: 'button, a' })
  await shot('03-plate-sheet')
  await other.fill('20')
  await text(result, '원판 없이 바만', '바 무게와 같으면 바만')
  await other.fill('15')
  await text(result, '바(20kg)보다 가벼워요', '바보다 가벼우면 그렇다고 알려 줌')
  await other.press('Enter')

  // ───────── 설정에서 원판과 바 무게 바꾸기
  step('바와 원판 설정')
  await sheet.getByRole('link', { name: '바·원판 설정' }).tap()
  await visible(plateSettings, '설정의 바와 원판 칸')
  const settingsBox = await boxOf(plateSettings)
  check(settingsBox.top >= 0 && settingsBox.top < 300, `원판 창에서 넘어오면 바와 원판 칸이 보이는 곳에 있음 (위에서 ${settingsBox.top}px)`)
  await attr(plateSettings.getByRole('button', { name: '20kg', exact: true }), 'aria-pressed', 'true', '기본 바 무게 20kg')
  await attr(plateToggle(25), 'aria-pressed', 'true', '25kg 원판은 기본으로 켜짐')
  await attr(plateToggle(0.5), 'aria-pressed', 'false', '0.5kg 원판은 기본으로 꺼짐')
  check((await setting('plates')) === null, '바꾸기 전에는 원판 설정이 저장되어 있지 않음(기본값)')
  await touchTargets(phone, '바와 원판 설정', plateSettings)
  await noOverflow('설정')
  await shot('04-plate-settings', { of: plateSettings })

  await plateToggle(25).tap()
  await attr(plateToggle(25), 'aria-pressed', 'false', '25kg 원판을 끔')
  await eventually(() => setting('plates'), [20, 15, 10, 5, 2.5, 1.25], '저장된 원판에서 25kg가 빠짐')
  await page.goBack()
  await visible(squat, '뒤로 가면 운동 화면')
  await plateButton(squat).tap()
  await text(sheetRow(100), '한쪽에 20 + 20', '25kg 원판을 끄면 100kg: 한쪽에 20 + 20')
  await text(sheet, '원판 20, 15, 10, 5, 2.5, 1.25kg', '가진 원판 목록도 바뀜')

  // 바 무게: 15kg 버튼, 직접 입력
  await sheet.getByRole('link', { name: '바·원판 설정' }).tap()
  await plateSettings.getByRole('button', { name: '15kg', exact: true }).tap()
  await eventually(() => setting('barWeightKg'), 15, '바 무게 15kg 저장')
  const barInput = plateSettings.getByLabel('바 무게 직접 입력')
  await eventually(() => barInput.inputValue(), '15', '직접 입력 칸도 15로 따라감')
  await fill(barInput, '7.5')
  await eventually(() => setting('barWeightKg'), 7.5, '직접 적은 바 무게 7.5kg 저장')
  await attr(plateSettings.getByRole('button', { name: '15kg', exact: true }), 'aria-pressed', 'false', '버튼 선택은 풀림')
  await barInput.tap()
  await barInput.fill('60')
  await visible(plateSettings.getByText('1~50kg로 정해 주세요.'), '범위를 벗어나면 안내')
  await barInput.press('Enter')
  await eventually(() => barInput.inputValue(), '7.5', '맞지 않는 값은 적기 전 값으로 되돌림')
  check((await setting('barWeightKg')) === 7.5, '저장된 값은 7.5kg 그대로')
  await page.goBack()
  await plateButton(squat).tap()
  await text(sheet, '바 7.5kg에 한쪽마다 끼울 원판입니다.', '원판 창의 바 무게가 7.5kg로')
  await text(sheetRow(100), '한쪽에 20 + 20 + 5 + 1.25', '바 7.5kg: 100kg는 한쪽에 20 + 20 + 5 + 1.25')
  await shot('05-plate-sheet-custom')

  // 원판은 하나 이상 켜 두어야 한다. 다시 기본(20kg 바, 원판 전부)으로 돌린다.
  await sheet.getByRole('link', { name: '바·원판 설정' }).tap()
  for (const kg of [20, 15, 10, 5, 2.5]) await plateToggle(kg).tap()
  await eventually(() => setting('plates'), [1.25], '원판을 하나만 남김')
  await plateToggle(1.25).tap()
  await visible(plateSettings.getByText('원판은 하나 이상 켜 두어야 합니다.'), '마지막 원판은 끌 수 없음')
  check(JSON.stringify(await setting('plates')) === '[1.25]', '저장된 원판은 그대로')
  for (const kg of [25, 20, 15, 10, 5, 2.5]) await plateToggle(kg).tap()
  await plateSettings.getByRole('button', { name: '20kg', exact: true }).tap()
  await eventually(() => setting('plates'), [25, 20, 15, 10, 5, 2.5, 1.25], '원판을 다시 모두 켬(무거운 것부터 저장)')
  await eventually(() => setting('barWeightKg'), 20, '바 무게를 20kg로 되돌림')
  await page.goBack()

  // ───────── 웜업 세트 만들기
  step('웜업 세트 만들기')
  await warmupButton(squat).tap()
  await text(warmupDialog, '본 세트 100kg에 맞춰 첫 본 세트 앞에 넣습니다.', '기준 무게가 보임')
  await eventually(
    planRows,
    ['20kg × 10회원판 없이 바만', '40kg × 8회한쪽에 10', '60kg × 5회한쪽에 20', '80kg × 3회한쪽에 25 + 5'],
    '넣을 웜업 세트를 먼저 보여 줌(바만, 40%, 60%, 80%)',
  )
  await noOverflow('웜업 세트 만들기 창')
  await touchTargets(phone, '웜업 세트 만들기 창', warmupDialog)
  await shot('06-warmup-plan')
  await warmupDialog.getByRole('button', { name: '취소' }).tap()
  check((await storedSets(page, 'seed:squat')).length === 3, '취소하면 세트가 그대로')

  await warmupButton(squat).tap()
  await warmupDialog.getByRole('button', { name: '넣기', exact: true }).tap()
  await hidden(warmupDialog, '넣으면 창이 닫힘')
  await eventually(
    () => chips(squat),
    ['W···', 'W···', 'W···', 'W···', '1···', '2···', '3···'],
    '웜업 세트 4개가 본 세트 앞에 들어감',
  )
  await eventually(
    async () => brief(await storedSets(page, 'seed:squat')),
    ['W20x10', 'W40x8', 'W60x5', 'W80x3', '100x5', '100x5', '101x5'],
    '저장된 세트: 웜업 4개(무게와 횟수 채움, 완료 아님) 뒤에 본 세트',
  )
  const afterInsert = await storedSets(page, 'seed:squat')
  check(afterInsert.map((s) => s.order).join() === '0,1,2,3,4,5,6', '세트 순서가 0부터 빈틈없음')
  await noOverflow('운동 중(웜업 세트)')
  await shot('07-warmup-inserted', { of: squat })

  // 원판 창에는 웜업 무게도 함께 나온다
  await plateButton(squat).tap()
  await count(sheetRows, 6, '원판 창에 웜업 무게까지 여섯 줄')
  await text(sheetRow(20), '원판 없이 바만', '20kg: 원판 없이 바만')
  await text(sheetRow(80), '한쪽에 25 + 5', '80kg: 한쪽에 25 + 5')
  await noOverflow('원판 계산 창(여섯 줄)')
  await shot('08-plate-sheet-full')
  await sheet.getByRole('button', { name: '닫기' }).tap()

  // ───────── 일부를 끝낸 뒤 다시 만들기
  step('웜업 세트 바꾸기')
  // 바만 드는 웜업 세트를 끝내고, 본 세트 무게를 110kg로 올린 뒤 다시 만든다.
  await squat.getByRole('button', { name: 'W세트 완료', exact: true }).first().tap()
  await skipRest()
  await fill(weight(squat, 1), 110)
  await warmupButton(squat).tap()
  await text(warmupDialog, '본 세트 110kg에 맞춰', '바뀐 본 세트 무게가 기준')
  await eventually(
    planRows,
    ['45kg × 8회한쪽에 10 + 2.5', '65kg × 5회한쪽에 20 + 2.5', '90kg × 3회한쪽에 25 + 10'],
    '이미 한 바 세트는 빼고 그보다 무거운 것만',
  )
  await text(warmupDialog, '아직 하지 않은 웜업 세트 3개는 지우고 새로 넣습니다.', '하지 않은 웜업 세트를 바꾼다고 알려 줌')
  await shot('09-warmup-replace')
  await warmupDialog.getByRole('button', { name: '바꿔 넣기' }).tap()
  await eventually(
    async () => brief(await storedSets(page, 'seed:squat')),
    ['W20x10!', 'W45x8', 'W65x5', 'W90x3', '110x5', '100x5', '101x5'],
    '완료한 웜업 세트는 남고 하지 않은 것만 바뀜',
  )
  const afterReplace = await storedSets(page, 'seed:squat')
  check(afterReplace.map((s) => s.order).join() === '0,1,2,3,4,5,6', '바꾼 뒤에도 순서가 빈틈없음')
  check(afterReplace[0].id === afterInsert[0].id, '완료한 웜업 세트는 같은 세트(지우고 다시 만들지 않음)')
  check(afterReplace[4].id === afterInsert[4].id, '본 세트도 같은 세트')

  // ───────── 덤벨 종목
  step('덤벨 종목의 웜업')
  await fill(weight(curl, 1), 12)
  await fill(reps(curl, 1), 10)
  await warmupButton(curl).tap()
  await eventually(planRows, ['5kg × 8회', '7kg × 5회', '10kg × 3회'], '덤벨 12kg: 1kg 단위로 5, 7, 10kg(원판 글 없음)')
  await shot('10-warmup-dumbbell')
  await warmupDialog.getByRole('button', { name: '넣기', exact: true }).tap()
  await eventually(
    async () => brief(await storedSets(page, 'seed:dumbbell-curl')),
    ['W5x8', 'W7x5', 'W10x3', '12x10', 'x', 'x'],
    '덤벨 컬: 웜업 3개가 본 세트 앞에',
  )

  // ───────── 좁은 화면
  step('좁은 화면(320px)')
  await page.setViewportSize({ width: 320, height: 780 })
  await noOverflow('운동 중 320px')
  const narrowAdd = await boxOf(addSetButton(squat))
  const narrowPlate = await boxOf(plateButton(squat))
  const narrowCard = await boxOf(squat)
  check(
    narrowPlate.right <= narrowCard.right && narrowAdd.width >= 88,
    `320px: 버튼이 카드 안에 있고 세트 추가가 잘리지 않음 (세트 추가 ${narrowAdd.width}px)`,
  )
  const addFits = await addSetButton(squat).evaluate((el) => el.scrollWidth <= el.clientWidth)
  check(addFits, '320px: 세트 추가 글자가 넘치지 않음')
  await shot('11-narrow-card', { of: squat })
  await plateButton(squat).tap()
  await count(sheetRows, 7, '320px: 원판 창에 일곱 줄')
  const narrowSheet = await boxOf(sheet)
  check(narrowSheet.left >= 0 && narrowSheet.right <= 320 && narrowSheet.top >= 0, '320px: 원판 창이 화면 안에 있음')
  await noOverflow('원판 계산 창 320px')
  await touchTargets(phone, '원판 계산 창 320px', sheet, { selector: 'button, a' })
  await shot('12-narrow-plate-sheet')
  await sheet.getByRole('button', { name: '닫기' }).tap()
  await warmupButton(squat).tap()
  await visible(warmupDialog, '320px: 웜업 세트 만들기 창')
  await noOverflow('웜업 세트 만들기 창 320px')
  await shot('13-narrow-warmup')
  await warmupDialog.getByRole('button', { name: '취소' }).tap()
  await page.setViewportSize({ width: 360, height: 780 })

  // ───────── 볼륨과 기록 상세
  step('볼륨과 기록 상세')
  // 웜업 45kg × 8과 본 세트 110kg × 5를 끝낸다. 볼륨은 본 세트만 센다.
  await squat.getByRole('button', { name: 'W세트 완료', exact: true }).nth(1).tap()
  await skipRest()
  await squat.getByRole('button', { name: '1세트 완료', exact: true }).tap()
  await skipRest()
  await page.getByRole('button', { name: '마치기' }).tap()
  await visible(page.getByRole('heading', { name: '운동 완료' }), '운동 완료 화면')
  const stat = (label) => page.getByRole('main').locator('dl > div').filter({ hasText: label }).locator('dd')
  await text(stat('완료한 세트'), '3개', '완료한 세트 3개(웜업 2, 본 세트 1)')
  await text(stat('총 볼륨'), '550kg', '볼륨은 본 세트만(110×5), 웜업 20×10과 45×8은 빠짐')
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await visible(page.getByRole('button', { name: '같은 운동 다시 하기' }), '기록 상세')
  await eventually(
    async () => brief(await storedSets(page, 'seed:squat')),
    ['W20x10!', 'W45x8!', '110x5!'],
    '마치면 하지 않은 웜업 세트는 기록에서 빠짐',
  )
  // 지난 기록에서는 원판 계산만 쓸 수 있다.
  await visible(plateButton(squat), '기록 상세: 원판 버튼')
  await count(warmupButton(squat), 0, '기록 상세에는 웜업 버튼이 없음')
  await plateButton(squat).tap()
  await count(sheetRows, 3, '기록 상세의 원판 창: 세 줄')
  await text(sheetRow(110), '한쪽에 25 + 20', '110kg: 한쪽에 25 + 20')
  await noOverflow('기록 상세')
  await shot('14-history-plates')
  await sheet.getByRole('button', { name: '닫기' }).tap()

  // 다음 운동의 추천은 웜업이 아니라 본 세트(110kg × 5)를 본다.
  await page.getByRole('button', { name: '같은 운동 다시 하기' }).tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '새 운동 화면')
  await visible(
    squat.getByRole('group', { name: '다음 무게 추천' }).getByText('추천 115kg × 5'),
    '추천은 본 세트 기준(110kg에서 5kg 올림)',
  )

  step('콘솔')
  phone.consoleClean()
}
