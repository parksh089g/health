// 내 기록에 물어보기: 체중 창에서 골격근량과 체지방량을 적고, 통계에서 채팅 화면으로 가서 질문을 보낸다.
// Claude가 도구를 불러 기록을 본 뒤 답하는 흐름을 흉내 낸 답(lib/anthropic-mock.js)으로 대신한다. 실제 API는 부르지 않는다.
import { mockAnthropic } from './lib/anthropic-mock.js'

export const title = '내 기록에 물어보기 (체성분 입력, 채팅, 도구 호출, 이어서 묻기, 새 대화)'

const KEY = 'sk-ant-api03-test-key-ABCDEFGHIJ-wxyz'

export async function run(phone) {
  const { page, context, step, check, visible, hidden, eventually } = phone
  const { open, shot, noOverflow, restoreSample, consoleClean } = phone
  const anthropic = await mockAnthropic(context)

  step('준비')
  await restoreSample()
  await page.getByRole('switch', { name: 'AI 추천' }).tap()
  await page.getByLabel('Anthropic API 키').fill(KEY)
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await visible(page.getByText('sk-ant-…wxyz'), '키 저장')

  // ───── 체성분 입력
  step('체성분 입력')
  await open('/stats')
  const weightCard = page.getByRole('region', { name: '체중', exact: true })
  await weightCard.getByRole('button', { name: /오늘 체중/ }).tap()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('체중', { exact: true }).fill('72.4')
  await dialog.getByRole('button', { name: '골격근량, 체지방량도 적기' }).tap()
  await dialog.getByLabel('골격근량(kg)').fill('80')
  await dialog.getByRole('button', { name: '저장' }).tap()
  await visible(dialog.getByRole('alert').getByText('골격근량은 체중보다 작아야 합니다.'), '체중보다 큰 골격근량은 막음')
  await dialog.getByLabel('골격근량(kg)').fill('32.1')
  await dialog.getByLabel('체지방량(kg)').fill('14.2')
  await visible(dialog.getByText(/체지방률 19\.6%/), '체지방률 계산')
  await shot('01-composition-dialog')
  await dialog.getByRole('button', { name: '저장' }).tap()
  await hidden(dialog, '저장하면 창이 닫힘')
  await visible(weightCard.getByText(/체성분 · 골격근 32\.1kg · 체지방 14\.2kg\(19\.6%\)/), '체중 카드에 체성분')
  await open('/body-weight')
  await visible(page.getByText('골격근 32.1kg · 체지방 14.2kg(19.6%)'), '체중 기록 목록에 체성분')

  // ───── 채팅 화면
  step('채팅 화면')
  await open('/stats')
  await page.getByRole('link', { name: /내 기록에 물어보기/ }).tap()
  await visible(page.getByRole('heading', { name: '기록에 대해 물어보세요' }), '처음 안내')
  await visible(page.getByText(/Opus 5\.5로 한 번에 약 \$0\.07/), '보내기 전 어림 요금')
  await page.getByRole('button', { name: '지난달 벤치프레스 최고 무게가 얼마였지?' }).tap()
  const input = page.getByLabel('질문')
  check((await input.inputValue()) === '지난달 벤치프레스 최고 무게가 얼마였지?', '예시를 누르면 입력 칸에 채움')
  check(anthropic.messageRequests().length === 0, '예시를 눌러도 요청하지 않음')
  await noOverflow('채팅 처음')
  await shot('02-ask-intro')

  // 첫 번째 답: 도구 호출, 두 번째 답: 글
  anthropic.replyWithMessage({
    model: 'claude-opus-5-5',
    stopReason: 'tool_use',
    blocks: [
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'get_exercise_bests',
        input: { exercise: '벤치프레스', from: '2026-10-01', to: '2026-10-31' },
      },
    ],
  })
  const release = anthropic.replyWithMessage({
    model: 'claude-opus-5-5',
    hold: true,
    blocks: [{ type: 'text', text: '지난달 벤치프레스 최고 무게는 **70kg**이에요.\n\n- 10월에 벤치프레스를 3번 했어요\n- 9월보다 2.5kg 올랐어요' }],
  })
  await page.getByRole('button', { name: '보내기' }).tap()
  await visible(page.getByRole('status').getByText(/기록을 보는 중: 벤치프레스 최고 기록/), '도구를 부르는 동안 본 기록 표시')
  await shot('03-ask-busy')
  release()
  await visible(page.getByText('지난달 벤치프레스 최고 무게는 70kg이에요.'), '답(굵은 글씨 표시 없이)')
  await visible(page.getByText(/Opus 5\.5 · 약 \$0\.\d\d · 본 기록: 벤치프레스 최고 기록/), '답 아래 모델, 요금, 본 기록')

  const [first, second] = anthropic.messageRequests().map((r) => JSON.parse(r.body))
  check(first.tools.length === 7 && first.tools.every((t) => t.strict === true), '도구 7개를 strict로 보냄')
  check(first.messages[0].content.includes('체성분(') && first.messages[0].content.includes('골격근 32.1kg'), '첫 질문에 체성분을 붙임')
  check(first.cache_control?.type === 'ephemeral', '캐시를 씀')
  const result = second.messages.at(-1).content[0]
  check(result.type === 'tool_result' && result.tool_use_id === 'toolu_1', '두 번째 요청에 도구 결과')
  check(/벤치프레스/.test(result.content), `도구 결과에 기록: ${result.content.slice(0, 60)}`)
  await noOverflow('채팅 답')
  await shot('04-ask-answer')

  // ───── 이어서 묻기
  step('이어서 묻기')
  await visible(page.getByText(/이어서 물으면 앞의 대화도 함께 보내요/), '이어 묻기 요금 안내')
  anthropic.replyWithMessage({
    model: 'claude-opus-5-5',
    blocks: [
      {
        type: 'text',
        text: '체지방률 19.6%에 골격근량 32.1kg이라 근육을 지키면서 천천히 감량하는 쪽이 좋아요.\n\n- 월: 스쿼트 4×6 100kg, 벤치프레스 4×6 77.5kg\n- 수: 데드리프트 3×5, 풀업 4×8\n- 금: 전신 서킷과 유산소 20분\n\n한 달에 체지방 1kg 안팎을 목표로 잡아요.',
      },
    ],
  })
  await input.fill('체성분까지 보고 앞으로 4주 계획 세워 줘')
  await input.press('Enter')
  await visible(page.getByText(/한 달에 체지방 1kg 안팎/), '계획 답')
  const third = JSON.parse(anthropic.messageRequests().at(-1).body)
  check(third.messages.length === 5, `이어 묻기는 앞의 대화를 함께 보냄(메시지 ${third.messages.length}개)`)
  await visible(page.getByRole('listitem').getByText(/^월: 스쿼트 4×6/), '"- " 줄은 목록으로')
  await shot('05-ask-plan', { fullPage: true })

  // ───── 다른 화면에 다녀와도 대화가 남음
  await open('/stats')
  await open('/ask')
  await visible(page.getByText(/한 달에 체지방 1kg 안팎/), '다시 열어도 대화가 남음')

  // ───── 오류
  step('오류')
  anthropic.replyWithError({ status: 401, type: 'authentication_error', message: 'invalid x-api-key' })
  await input.fill('지난주 운동 몇 번 했어?')
  await page.getByRole('button', { name: '보내기' }).tap()
  await visible(page.getByRole('alert').getByText(/API 키가 맞지 않습니다/), '오류 안내')
  await eventually(() => input.inputValue(), '지난주 운동 몇 번 했어?', '실패한 질문을 입력 칸에 되돌림')

  // ───── 새 대화
  step('새 대화')
  await page.getByRole('button', { name: '새 대화' }).tap()
  await visible(page.getByRole('heading', { name: '기록에 대해 물어보세요' }), '새 대화는 처음 화면')
  consoleClean({ ignore: [/status of 401/] })
}
