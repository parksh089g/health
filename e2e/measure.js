// 시간 종목과 추가 무게: 플랭크를 초로 적고, 풀업에 추가 무게를 달아 운동을 마친 뒤,
// 다음 운동에서 지난 값 채우기와 추천, 새 기록, 기록 상세, 종목 상세, 루틴, 내 종목 만들기, CSV까지 눌러 본다.

export const title = '시간 종목과 추가 무게 (플랭크를 초로 기록, 풀업 추가 무게 추천, 기록과 종목 상세)'

export async function run(phone) {
  const { page, baseUrl, step, check, visible, hidden, text, attr, count, eventually } = phone
  const { open, shot, noOverflow, fill, card, skipRest, download } = phone
  const main = page.getByRole('main')
  const search = page.getByLabel('종목 이름으로 찾기')
  /** 종목 카드 안의 규칙 추천 줄 */
  const recommendation = (name) => card(name).getByRole('group', { name: '다음 무게 추천' })
  /** 카드의 세트 칸 값. 예: field(plank, 1, '시간') */
  const field = (exerciseCard, n, name) => exerciseCard.getByLabel(`${n}세트 ${name}`, { exact: true })
  const done = (exerciseCard, n) => exerciseCard.getByRole('button', { name: `${n}세트 완료`, exact: true })
  /** 세트 값을 '무게x값'으로 이어 붙인다. 예: '10x5 x8' */
  const values = async (exerciseCard, weightName, amountName, labels) => {
    const out = []
    for (const n of labels) {
      out.push(`${await field(exerciseCard, n, weightName).inputValue()}x${await field(exerciseCard, n, amountName).inputValue()}`)
    }
    return out.join(' ')
  }
  const complete = async (exerciseCard, n) => {
    await done(exerciseCard, n).tap()
    await attr(done(exerciseCard, n), 'aria-pressed', 'true', `${n}세트 완료 표시`)
    await skipRest()
  }

  // ───────── 종목 고르기
  step('종목 선택')
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '운동 시작' }).tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '운동 중 화면')
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  await search.fill('플랭크')
  await visible(page.getByRole('button', { name: /^플랭크\s*코어 · 맨몸 · 시간 종목/ }), '플랭크는 시간 종목으로 표시')
  await visible(page.getByRole('button', { name: /^사이드 플랭크/ }), '사이드 플랭크도 기본 종목')
  await page.getByRole('button', { name: /^플랭크/ }).tap()
  await search.fill('풀업')
  await page.getByRole('button', { name: /^풀업/ }).tap()
  await search.fill('매달리기')
  await visible(page.getByRole('button', { name: /^매달리기\s*등 · 맨몸 · 시간 종목/ }), '매달리기도 기본 종목')
  await search.fill('월 싯')
  await visible(page.getByRole('button', { name: /^월 싯\s*하체 · 맨몸 · 시간 종목/ }), '월 싯도 기본 종목')
  await shot('01-picker-time')
  await page.getByRole('button', { name: '선택한 2개 추가' }).tap()

  // ───────── 플랭크: 초로 적기
  step('플랭크를 초로 기록')
  const plank = card('플랭크')
  const pullUp = card('풀업')
  await visible(plank, '플랭크 카드')
  await visible(plank.getByText('시간', { exact: true }), '횟수 대신 시간 칸')
  await count(plank.getByLabel(/세트 횟수$/), 0, '플랭크에는 횟수 칸이 없음')
  await count(plank.getByLabel(/세트 시간$/), 3, '시간 칸 3개')

  // 시간 없이 완료를 누르면 완료되지 않고 시간 칸으로 간다
  await done(plank, 1).tap()
  check((await done(plank, 1).getAttribute('aria-pressed')) === 'false', '시간 없이는 완료되지 않음')
  check(await field(plank, 1, '시간').evaluate((el) => document.activeElement === el), '시간 칸으로 포커스 이동')

  await fill(field(plank, 1, '시간'), '60')
  await complete(plank, 1)
  await fill(field(plank, 2, '시간'), '45')
  await complete(plank, 2)
  // 3세트는 비워 둔다(마칠 때 기록에서 빠진다).

  // ───────── 풀업: 추가 무게
  step('풀업에 추가 무게')
  await visible(pullUp.getByText('추가 무게', { exact: true }), '무게 칸 이름이 추가 무게')
  await fill(field(pullUp, 1, '추가 무게'), '10')
  await fill(field(pullUp, 1, '횟수'), '5')
  await complete(pullUp, 1)
  await fill(field(pullUp, 2, '추가 무게'), '10')
  await fill(field(pullUp, 2, '횟수'), '5')
  await complete(pullUp, 2)
  // 3세트는 무게를 비운 맨몸 세트
  await fill(field(pullUp, 3, '횟수'), '8')
  await complete(pullUp, 3)
  await noOverflow('운동 중')
  await shot('02-workout', { fullPage: true })

  // 세트 번호를 누르면 뜨는 창의 요약
  await plank.getByRole('button', { name: /^1세트 설정/ }).tap()
  await visible(page.getByRole('dialog', { name: '1세트 설정' }).getByText('60초', { exact: true }), '세트 창에 60초')
  await page.getByRole('dialog', { name: '1세트 설정' }).getByRole('button', { name: '닫기' }).tap()
  await pullUp.getByRole('button', { name: /^1세트 설정/ }).tap()
  await visible(page.getByRole('dialog', { name: '1세트 설정' }).getByText('+10kg × 5회'), '세트 창에 +10kg × 5회')
  await page.getByRole('dialog', { name: '1세트 설정' }).getByRole('button', { name: '닫기' }).tap()

  // ───────── 마치기
  step('운동 마치기')
  await page.getByRole('button', { name: '마치기' }).tap()
  await visible(page.getByRole('heading', { name: '운동 완료' }), '운동 완료 화면')
  const stat = (label) => main.locator('dl > div').filter({ hasText: label }).locator('dd')
  await text(stat('완료한 세트'), '5개', '완료한 세트 5개(시간 세트 포함)')
  await text(stat('총 볼륨'), '100kg', '볼륨은 추가 무게×횟수만(10×5×2)')
  await hidden(page.getByText(/완료 체크를 하지 않은 세트/), '빈 세트는 남은 세트로 세지 않음', 1000)
  await page.getByRole('button', { name: '저장', exact: true }).tap()

  // ───────── 기록 상세
  step('기록 상세')
  await visible(page.getByRole('button', { name: '같은 운동 다시 하기' }), '기록 상세')
  await visible(page.getByText('종목 2개 · 5세트 · 볼륨 100kg'), '요약: 종목 2개 · 5세트 · 볼륨 100kg')
  await eventually(() => values(plank, '추가 무게', '시간', [1, 2]), 'x60 x45', '플랭크: 60초, 45초')
  await count(plank.getByLabel(/세트 시간$/), 2, '적지 않은 3세트는 빠짐')
  await eventually(() => values(pullUp, '추가 무게', '횟수', [1, 2, 3]), '10x5 10x5 x8', '풀업: +10×5, +10×5, 맨몸 8회')
  await noOverflow('기록 상세')
  await shot('03-history-detail', { fullPage: true })

  step('기록 목록')
  await open('/history')
  await visible(page.getByText('플랭크, 풀업'), '기록 목록에 종목 이름')
  await visible(page.getByText(/5세트 · 100kg/), '기록 목록에 5세트 · 100kg')

  // ───────── 다음 운동: 지난 값과 추천
  step('다음 운동의 추천')
  await page.getByRole('link', { name: /플랭크, 풀업/ }).tap()
  await page.getByRole('button', { name: '같은 운동 다시 하기' }).tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '새 운동 화면')
  await eventually(() => values(plank, '추가 무게', '시간', [1, 2]), 'x60 x45', '플랭크: 지난번 시간으로 채움')
  await visible(plank.getByText('지난번 60초 · 45초'), '플랭크 지난번 줄')
  await visible(recommendation('플랭크').getByText('추천 65초'), '플랭크 추천 65초(최고 60초 + 5초)')
  await eventually(() => values(pullUp, '추가 무게', '횟수', [1, 2, 3]), '10x5 10x5 x8', '풀업: 지난번 값으로 채움')
  await visible(pullUp.getByText('지난번 +10×5 · +10×5 · 8회'), '풀업 지난번 줄')
  await visible(recommendation('풀업').getByText('추천 +12.5kg × 5'), '풀업 추천 +12.5kg × 5(추가 무게를 올림)')
  await noOverflow('다음 운동')
  await shot('04-next-recommend', { fullPage: true })

  await recommendation('풀업').getByRole('button', { name: '추천 +12.5kg × 5 적용' }).tap()
  await eventually(
    () => values(pullUp, '추가 무게', '횟수', [1, 2, 3]),
    '12.5x5 12.5x5 x8',
    '적용: 추가 무게 세트만 12.5kg로, 맨몸 세트는 그대로',
  )
  await visible(recommendation('풀업').getByRole('button', { name: '추천 적용됨' }), '풀업 적용됨 표시')
  await recommendation('플랭크').getByRole('button', { name: '추천 65초 적용' }).tap()
  await eventually(() => values(plank, '추가 무게', '시간', [1, 2]), 'x65 x65', '적용: 남은 세트의 시간이 65초로')

  // ───────── 새 기록
  step('새 기록')
  await complete(plank, 1)
  await visible(plank.getByRole('img', { name: '새 기록: 최장 시간' }), '65초를 완료하면 최장 시간 새 기록')
  await complete(pullUp, 1)
  await visible(pullUp.getByRole('img', { name: '새 기록: 최고 추가 무게' }), '+12.5kg를 완료하면 최고 추가 무게 새 기록')
  await shot('05-next-pr', { fullPage: true })
  await page.getByRole('button', { name: '마치기' }).tap()
  const newRecords = page.getByRole('region', { name: '새 기록' })
  await visible(newRecords, '완료 화면에 새 기록')
  await text(newRecords, /최장 시간\s*65초\s*이전 60초/, '최장 시간 65초(이전 60초)')
  await text(newRecords, /최고 추가 무게\s*\+12\.5kg\s*이전 \+10kg/, '최고 추가 무게 +12.5kg(이전 +10kg)')
  check(!/추정 1RM|최고 볼륨/.test((await newRecords.textContent()) ?? ''), '맨몸 종목과 시간 종목에는 추정 1RM, 볼륨 기록이 없음')
  // 적어 두었지만 완료하지 않은 세트(플랭크 2세트, 풀업 2·3세트)를 한꺼번에 완료한다.
  await visible(page.getByText('완료 체크를 하지 않은 세트가 3개 있습니다.'), '시간만 적은 세트도 남은 세트로 셈')
  await shot('06-done', { fullPage: true })
  await page.getByRole('button', { name: '모두 완료로 표시' }).tap()
  await text(stat('완료한 세트'), '5개', '모두 완료로 표시하면 5개')
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await visible(page.getByText('종목 2개 · 5세트 · 볼륨 125kg'), '두 번째 기록 요약')

  // ───────── 종목 상세
  step('종목 상세')
  await plank.getByRole('link', { name: /플랭크/ }).tap()
  await visible(page.getByRole('heading', { name: '플랭크', exact: true }), '플랭크 상세')
  await visible(page.getByText('코어 · 맨몸 · 시간 종목'), '시간 종목 표시')
  await visible(page.getByRole('link', { name: /^최장 시간 65초/ }), '개인 기록 최장 시간 65초')
  await count(page.getByRole('link', { name: /^(추정 1RM|최고 중량|최고 볼륨)/ }), 0, '시간 종목에는 무게 기록이 없음')
  await visible(page.getByRole('group', { name: '그래프로 볼 값' }).getByRole('button', { name: '총 시간' }), '그래프: 최장 시간과 총 시간')
  await visible(page.getByText('65초×2'), '지난 기록에 65초×2')
  await visible(page.getByLabel('목표 시간', { exact: true }), '목표는 목표 시간(초)')
  await count(page.getByLabel('증량 단위', { exact: true }), 0, '시간 종목에는 증량 단위가 없음')
  await noOverflow('플랭크 상세')
  await shot('07-plank-detail', { fullPage: true })

  await open('/stats')
  await page.getByRole('link', { name: /^풀업/ }).first().tap()
  await visible(page.getByRole('heading', { name: '풀업', exact: true }), '풀업 상세')
  await visible(page.getByRole('link', { name: /^최고 추가 무게 \+12\.5kg/ }), '개인 기록 최고 추가 무게 +12.5kg')
  await visible(page.getByRole('link', { name: /^최다 횟수 8회/ }), '개인 기록 최다 횟수 8회(맨몸 세트)')
  await count(page.getByRole('link', { name: /^(추정 1RM|최고 볼륨)/ }), 0, '맨몸 종목에는 추정 1RM, 볼륨 기록이 없음')
  await visible(page.getByText('+12.5×5×2 · 8회'), '지난 기록에 +12.5×5×2 · 8회')
  await noOverflow('풀업 상세')
  await shot('08-pull-up-detail', { fullPage: true })

  // ───────── 루틴: 목표 시간
  step('루틴의 목표 시간')
  await open('/routines/new')
  await page.getByLabel('루틴 이름').fill('코어')
  await page.getByRole('button', { name: '종목 추가' }).tap()
  await search.fill('플랭크')
  await page.getByRole('button', { name: /^플랭크/ }).tap()
  await page.getByRole('button', { name: '선택한 1개 추가' }).tap()
  const plankRow = page.getByRole('listitem', { name: '플랭크', exact: true })
  await visible(plankRow.getByText('목표 시간', { exact: true }), '루틴에서는 목표 시간')
  await plankRow.getByLabel('플랭크 목표 시간').fill('90')
  await visible(plankRow.getByText('초', { exact: true }), '단위는 초')
  await noOverflow('루틴 편집')
  await shot('09-routine-time')
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await page.waitForURL((url) => !url.hash.includes('/routines/new'))
  await open('/')
  await page.getByRole('button', { name: '코어 루틴 시작' }).tap()
  await visible(plank.getByText('목표 90초'), '운동 카드에 목표 90초')
  // 지난번 65초×2는 목표 90초를 못 채웠으니 목표 시간을 추천한다.
  await visible(recommendation('플랭크').getByText('추천 90초'), '목표를 못 채웠으면 목표 시간을 추천')
  await shot('10-routine-workout')
  await page.getByRole('button', { name: '운동 취소' }).tap()
  await page.getByRole('dialog').getByRole('button', { name: '취소하고 지우기' }).tap()
  await visible(page.getByRole('button', { name: '운동 시작' }), '운동을 취소하고 홈으로')

  // ───────── 내 종목: 횟수 / 시간
  step('내 종목 만들기')
  await page.getByRole('button', { name: '운동 시작' }).tap()
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  await search.fill('L싯')
  await page.getByRole('button', { name: '내 종목 추가' }).tap()
  const measure = page.getByRole('group', { name: '기록 방식' })
  await attr(measure.getByRole('button', { name: '횟수' }), 'aria-pressed', 'true', '기본은 횟수')
  await page.getByRole('combobox', { name: '부위' }).selectOption('core')
  await page.getByRole('combobox', { name: '기구' }).selectOption('bodyweight')
  await measure.getByRole('button', { name: '시간' }).tap()
  await attr(measure.getByRole('button', { name: '시간' }), 'aria-pressed', 'true', '시간을 고름')
  await noOverflow('내 종목 추가')
  await shot('11-custom-time-form')
  await page.getByRole('button', { name: '추가', exact: true }).tap()
  await visible(page.getByRole('button', { name: /^L싯\s*코어 · 맨몸 · 시간 종목 · 내 종목/ }), '내 종목이 시간 종목으로 만들어짐')
  await page.getByRole('button', { name: '선택한 1개 추가' }).tap()
  const lsit = card('L싯')
  await visible(field(lsit, 1, '시간'), 'L싯 카드에 시간 칸')

  // 운동에 넣은 종목은 기록이 있는 것이라 횟수와 시간을 바꿀 수 없다.
  await lsit.getByRole('link', { name: /L싯/ }).tap()
  await page.getByRole('button', { name: '이름·부위·기구 바꾸기' }).tap()
  await visible(page.getByText('기록이 있는 종목은 횟수와 시간을 바꿀 수 없습니다.'), '기록이 있으면 바꿀 수 없다는 안내')
  check(await page.getByRole('group', { name: '기록 방식' }).getByRole('button', { name: '횟수' }).isDisabled(), '횟수 버튼이 잠김')
  await page.getByRole('group', { name: '기록 방식' }).scrollIntoViewIfNeeded()
  await shot('12-measure-locked')
  await page.getByRole('button', { name: '취소', exact: true }).tap()
  await page.goBack()
  await page.getByRole('button', { name: '운동 취소' }).tap()
  await page.getByRole('dialog').getByRole('button', { name: '취소하고 지우기' }).tap()
  await visible(page.getByRole('button', { name: '운동 시작' }), '홈으로 돌아옴')

  // ───────── CSV
  step('CSV')
  await open('/settings')
  const csvButton = page.getByRole('button', { name: '기록 CSV 내보내기' })
  await csvButton.scrollIntoViewIfNeeded()
  const csv = await download(csvButton)
  check(csv.text.includes('중량(kg),횟수,시간(초),RPE,운동 메모'), 'CSV에 시간(초) 칸')
  check(csv.text.includes('플랭크,코어,맨몸,1,,,,60,,'), 'CSV에 플랭크 60초 줄(횟수는 비움)')
  check(csv.text.includes('풀업,등,맨몸,1,,12.5,5,,,'), 'CSV에 풀업 +12.5×5 줄(시간은 비움)')
  check(csv.text.includes('풀업,등,맨몸,3,,,8,,,'), 'CSV에 맨몸 8회 줄(무게는 비움)')

  step('콘솔')
  phone.consoleClean()
}
