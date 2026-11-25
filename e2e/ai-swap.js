// AI 대체 종목: 운동 중 종목 카드의 "대체"에서 까닭을 고르고, 제안받은 종목으로 바꿔 본다.
// Anthropic API는 흉내 낸 답으로 대신한다(lib/anthropic-mock.js). 실제 API는 부르지 않는다.
import { mockAnthropic } from './lib/anthropic-mock.js'
import { readRow } from './lib/store.js'

export const title = 'AI 대체 종목 (까닭 고르기, 추천, 바꾸기)'

const KEY = 'sk-ant-api03-test-key-ABCDEFGHIJ-wxyz'
const NOTES = '왼쪽 어깨가 좋지 않아요'

export async function run(phone) {
  const { page, context, step, check, visible, count, eventually } = phone
  const { open, shot, noOverflow, card, restoreSample } = phone
  const anthropic = await mockAnthropic(context)

  step('준비')
  await restoreSample()
  await open('/')
  await page.getByRole('button', { name: '운동 시작' }).tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '운동 화면')
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  await page.getByLabel('종목 이름으로 찾기').fill('벤치프레스')
  await page.getByRole('button', { name: /^벤치프레스/ }).first().tap()
  await page.getByRole('button', { name: '선택한 1개 추가' }).tap()
  const bench = card('벤치프레스')
  const swapButton = bench.getByRole('button', { name: '대체 종목 추천' })
  await visible(bench, '벤치 카드')
  const workoutUrl = page.url()
  await count(swapButton, 0, 'AI를 꺼 두면 대체 버튼 없음')

  step('AI 켜기')
  await open('/settings')
  await page.getByRole('switch', { name: 'AI 추천' }).tap()
  await page.getByLabel('Anthropic API 키').fill(KEY)
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await visible(page.getByText('sk-ant-…wxyz'), '키 저장')
  await page.getByLabel(/참고할 점/).fill(NOTES)
  await page.getByLabel(/참고할 점/).blur()
  await eventually(() => readRow(page, 'settings', 'aiProfile').then((r) => r?.value?.notes), NOTES, '부상 메모 저장')
  await page.goto(workoutUrl)
  await visible(swapButton, '켜면 대체 버튼')

  step('대체 종목 추천')
  await swapButton.tap()
  const dialog = page.getByRole('dialog', { name: '벤치프레스 대신할 종목' })
  await visible(dialog, '대체 창')
  const ask = dialog.getByRole('button', { name: '대체 종목 추천받기' })
  check(await ask.isDisabled(), '까닭을 고르기 전에는 잠김')
  await visible(dialog.getByText(/Sonnet 5\.5로 한 번에 약 \$0\.02/), 'Opus 대신 Sonnet 요금 안내')
  await dialog.getByRole('button', { name: '기구가 차 있어요' }).tap()
  await dialog.getByLabel('덧붙일 말 (선택)').fill('덤벨 자리는 비어 있어요')
  await noOverflow('대체 창')
  await shot('01-swap-ask', { of: dialog })

  anthropic.replyWithMessage({
    model: 'claude-sonnet-5-5',
    json: (body) => {
      const prompt = body.messages[0].content
      const key = (name) => prompt.match(new RegExp(`(E\\d+) ${name} \\(`))?.[1]
      return {
        alternatives: [
          { key: key('덤벨 벤치프레스'), weightKg: 24, reps: 8, reason: '같은 미는 동작이고 덤벨 자리가 비어 있어요' },
          { key: key('체스트 프레스 머신'), weightKg: 50, reps: 8, reason: '궤적이 정해져 있어 어깨 부담이 적어요' },
        ],
        note: '첫 세트는 가볍게 감을 잡아 보세요.',
      }
    },
  })
  await ask.tap()
  const options = dialog.getByRole('list', { name: '대체 종목' })
  await visible(options.getByText('시작 24kg × 8회'), '덤벨 벤치 시작 무게')
  await visible(options.getByText('시작 50kg × 8회'), '머신 시작 무게')
  await visible(dialog.getByText('첫 세트는 가볍게 감을 잡아 보세요.'), '한마디')

  const [request] = anthropic.messageRequests()
  const body = JSON.parse(request.body)
  const prompt = body.messages[0].content
  check(body.model === 'claude-sonnet-5-5', `Sonnet으로 요청 (${body.model})`)
  check(prompt.includes('바꾸려는 종목: 벤치프레스'), '바꾸려는 종목')
  check(prompt.includes('바꾸는 까닭: 지금 그 기구를 다른 사람이 쓰고 있어'), '까닭')
  check(prompt.includes('사용자가 덧붙인 말: 덤벨 자리는 비어 있어요'), '덧붙인 말')
  check(prompt.includes(NOTES), '부상 메모')
  check(!prompt.includes(' 스쿼트 ('), '다른 부위 종목은 보내지 않음')
  await noOverflow('대체 결과')
  await shot('02-swap-options', { of: dialog })

  step('바꾸기')
  await dialog.getByRole('button', { name: '덤벨 벤치프레스(으)로 바꾸기' }).tap()
  await count(dialog, 0, '바꾸면 창이 닫힘')
  const dumbbell = card('덤벨 벤치프레스')
  await visible(dumbbell, '덤벨 벤치 카드')
  await count(card('벤치프레스'), 0, '벤치 카드는 없어짐')
  const weights = await dumbbell.getByLabel(/^\d+세트 무게$/).evaluateAll((els) => els.map((e) => e.value))
  check(weights.length > 0 && weights.every((v) => v === '24'), `시작 무게로 채움 (${weights.join(', ')})`)
  await shot('03-swapped')
}
