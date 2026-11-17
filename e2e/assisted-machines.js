// 새 머신 종목과 보조 머신: 어시스트 풀업은 보조 무게가 낮을수록 어려운 종목이라
// 무게 칸이 "보조 무게"이고, 볼륨에 들어가지 않으며, 다음 추천은 보조 무게를 줄이는 쪽으로 나오는지 본다.
import { touchTargets } from './lib/layout.js'
import { readRow } from './lib/store.js'

export const title = '머신 종목과 보조 머신 (어시스트 풀업의 보조 무게, 볼륨 제외, 보조를 줄이는 추천)'

export async function run(phone) {
  const { page, baseUrl, step, check, visible, text, count, eventually } = phone
  const { shot, noOverflow, fill, card, skipRest } = phone
  const search = page.getByLabel('종목 이름으로 찾기')
  const pick = async (name) => {
    await search.fill(name)
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().tap()
  }

  // ───────── 종목 고르기
  step('새 머신 종목과 보조 머신 고르기')
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '운동 시작' }).tap()
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  await search.fill('어시스트')
  for (const name of ['어시스트 풀업', '어시스트 친업', '어시스트 딥스']) {
    await visible(page.getByRole('button', { name: new RegExp(`^${name}\\s*(등|가슴) · 보조 머신$`) }), `기본 종목 ${name}`)
  }
  await noOverflow('종목 선택(어시스트)')
  await shot('01-picker-assisted')
  await pick('어시스트 풀업')
  await pick('인클라인 머신 벤치프레스')
  await page.getByRole('button', { name: '선택한 2개 추가' }).tap()
  check((await readRow(page, 'exercises', 'seed:assisted-pull-up'))?.equipment === 'assisted', '어시스트 풀업은 보조 머신으로 저장')
  check((await readRow(page, 'exercises', 'seed:incline-machine-press'))?.equipment === 'machine', '인클라인 머신 벤치프레스는 머신')

  // ───────── 보조 무게 적기
  step('보조 무게 적기')
  const pullUp = card('어시스트 풀업')
  const press = card('인클라인 머신 벤치프레스')
  await visible(pullUp.getByText('보조 무게', { exact: true }), '무게 칸 이름이 "보조 무게"')
  await count(pullUp.getByRole('button', { name: '웜업 세트 만들기' }), 0, '보조 머신에는 웜업 만들기가 없음')
  await count(pullUp.getByRole('button', { name: '원판 계산' }), 0, '보조 머신에는 원판 계산이 없음')
  await visible(press.getByRole('button', { name: '웜업 세트 만들기' }), '머신 벤치프레스에는 웜업 만들기가 있음')
  await pullUp.getByRole('button', { name: '세트 추가' }).tap()
  for (const n of [1, 2]) {
    await fill(pullUp.getByLabel(`${n}세트 보조 무게`, { exact: true }), 20)
    await fill(pullUp.getByLabel(`${n}세트 횟수`, { exact: true }), 8)
    await pullUp.getByRole('button', { name: `${n}세트 완료`, exact: true }).tap()
    await skipRest()
  }
  await fill(press.getByLabel('1세트 무게', { exact: true }), 40)
  await fill(press.getByLabel('1세트 횟수', { exact: true }), 10)
  await press.getByRole('button', { name: '1세트 완료', exact: true }).tap()
  await skipRest()
  await noOverflow('운동 중(보조 머신)')
  await touchTargets(phone, '보조 머신 카드', pullUp)
  await shot('02-workout-assisted', { fullPage: true })

  // ───────── 볼륨에 들어가지 않는다
  step('운동 마치기: 보조 무게는 볼륨에 들어가지 않음')
  await page.getByRole('button', { name: '마치기' }).tap()
  const stat = (label) => page.getByRole('main').locator('dl > div').filter({ hasText: label }).locator('dd')
  await text(stat('총 볼륨'), '400kg', '총 볼륨은 머신 벤치프레스의 40kg×10만(보조 무게는 빠짐)')
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await visible(page.getByText('종목 2개 · 3세트 · 볼륨 400kg'), '기록 상세도 볼륨 400kg')

  // ───────── 다음 추천은 보조를 줄인다
  step('다음 운동: 보조 무게를 줄이는 추천')
  await page.getByRole('button', { name: '같은 운동 다시 하기' }).tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '새 운동 화면')
  await visible(pullUp.getByText('지난번 보조 20×8 · 보조 20×8'), '지난번 줄에 "보조"가 붙음')
  const rec = pullUp.getByRole('group', { name: '다음 무게 추천' })
  await visible(rec, '보조 머신에도 다음 추천이 있음')
  await visible(rec.getByText(/17\.5kg × 8/), '보조 20kg에서 8회를 채웠으니 17.5kg × 8')
  await visible(rec.getByText(/보조를 줄여 봐요/), '이유: 보조를 줄여 봐요')
  await rec.getByRole('button', { name: /적용$/ }).tap()
  await eventually(() => pullUp.getByLabel('1세트 보조 무게', { exact: true }).inputValue(), '17.5', '적용하면 보조 무게가 17.5로')
  await shot('03-next-recommendation')

  // ───────── 종목 상세
  step('종목 상세: 기록은 최다 횟수만')
  await pullUp.getByRole('link', { name: /어시스트 풀업/ }).tap()
  await visible(page.getByText('최다 횟수').first(), '개인 기록에 최다 횟수')
  await count(page.getByText('최고 중량'), 0, '보조 무게로는 최고 중량 기록을 세지 않음')
  await count(page.getByText('추정 1RM'), 0, '추정 1RM도 없음')
  await visible(page.getByText(/보조 무게가 낮을수록 어렵습니다/), '추천 설명이 보조 머신에 맞음')
  await noOverflow('종목 상세(어시스트 풀업)')
  await shot('04-detail-assisted', { fullPage: true })
}
