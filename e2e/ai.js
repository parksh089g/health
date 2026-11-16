// AI 추천: 설정에서 켜고 키를 넣은 뒤, 운동 중 AI 추천과 통계의 기록 분석을 받아 본다.
// Anthropic API는 흉내 낸 답으로 대신한다(lib/anthropic-mock.js). 실제 API는 부르지 않는다.
import { mockAnthropic } from './lib/anthropic-mock.js'

export const title = 'AI 추천 (설정, 운동 중 추천, 기록 분석, 사용량과 백업)'

const KEY = 'sk-ant-api03-test-key-ABCDEFGHIJ-wxyz'
const BENCH_SETS = ['W', 1, 2, 3, 4]

export async function run(phone) {
  const { page, context, step, check, visible, eventually } = phone
  const { open, shot, noOverflow, card, setValues, download, restoreSample } = phone
  const anthropic = await mockAnthropic(context)

  // ───── 샘플 기록
  step('준비')
  await restoreSample()

  // ───── 꺼져 있을 때
  step('AI 꺼짐')
  const aiSwitch = page.getByRole('switch', { name: 'AI 추천' })
  const keyInput = page.getByLabel('Anthropic API 키')
  const reviewHeading = page.getByRole('heading', { name: 'AI 기록 분석' })
  check((await aiSwitch.getAttribute('aria-checked')) === 'false', '기본은 꺼짐')
  check((await keyInput.count()) === 0, '꺼져 있으면 키 입력 칸 없음')
  await open('/stats')
  await visible(page.getByRole('heading', { name: '통계', exact: true }), '통계')
  check((await reviewHeading.count()) === 0, '꺼져 있으면 통계에 AI 분석 없음')

  // ───── 설정
  step('설정')
  await open('/settings')
  await aiSwitch.tap()
  await visible(keyInput, '켜면 키 입력 칸')
  await page.getByRole('region', { name: 'AI 추천' }).scrollIntoViewIfNeeded()
  await shot('01-settings-empty')
  await keyInput.fill(KEY)
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await visible(page.getByText('sk-ant-…wxyz'), '키는 앞뒤만 보임')
  check((await page.getByText(KEY).count()) === 0, '전체 키는 화면에 없음')
  const models = page.getByRole('group', { name: 'AI 모델' })
  await models.getByRole('button', { name: 'Sonnet 5.5' }).tap()
  await visible(page.getByText(/요금 절반 · 운동 추천 한 번에 약 \$0\.03/), 'Sonnet 요금 안내')
  await page.getByRole('button', { name: '연결 확인' }).tap()
  await visible(page.getByText('연결됐습니다. Claude Sonnet 5.5를 쓸 수 있어요.'), '연결 확인 성공')
  const modelRequest = anthropic.requests.find((r) => r.path === '/v1/models/claude-sonnet-5-5')
  check(modelRequest?.headers['authorization'] === `Bearer ${KEY}`, '연결 확인에 키를 보냄')
  check(modelRequest?.headers['anthropic-dangerous-direct-browser-access'] === 'true', '브라우저 직접 호출 헤더')
  await models.getByRole('button', { name: 'Opus 5.5' }).tap()
  await noOverflow('설정')
  await shot('02-settings-ready')

  // ───── 운동 중 AI 추천
  step('운동 중 AI 추천')
  await open('/')
  await page.getByRole('button', { name: '운동 시작' }).tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '운동 화면')
  const coach = page.getByRole('region', { name: 'AI 코치' })
  await visible(coach.getByRole('button', { name: '종목을 추가하면 받을 수 있어요' }), '종목이 없으면 버튼 잠김')
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  for (const name of ['벤치프레스', '풀업']) {
    await page.getByLabel('종목 이름으로 찾기').fill(name)
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().tap()
  }
  await page.getByRole('button', { name: '선택한 2개 추가' }).tap()
  const bench = card('벤치프레스')
  const ruleBar = bench.getByRole('group', { name: '다음 무게 추천' })
  const aiBar = bench.getByRole('group', { name: 'AI 추천' })
  await visible(bench, '벤치 카드')
  await eventually(() => setValues(bench, BENCH_SETS), '40x8 75x8 75x8 75x8 70x10', '벤치 지난 기록으로 채움')
  await visible(ruleBar, 'AI 전에는 규칙 추천')
  await visible(coach.getByText(/Opus 5\.5로 한 번에 약 \$0\.06/), '요청 전 요금 안내')

  anthropic.replyWithMessage({
    model: 'claude-opus-5-5',
    delayMs: 3000,
    json: {
      summary: '어제 하체를 했으니 오늘 상체는 계획대로 가도 좋아요. 마지막 세트는 자세가 무너지면 멈추세요.',
      exercises: [
        { key: 'E1', weightKg: 77.5, reps: 8, reason: '75kg 8회를 세 번 채워서 2.5kg 올려요' },
        { key: 'E2', weightKg: null, reps: 11, reason: '지난번 10회였으니 1회 더 해 봐요' },
      ],
    },
  })
  await coach.getByRole('button', { name: 'AI 추천 받기' }).tap()
  await visible(coach.getByText('Claude가 기록을 보고 있어요. 보통 10~30초 걸려요.'), '기다리는 동안 안내')
  await shot('03-workout-loading')
  // 기다리는 동안 다른 화면에 갔다 와도 이어서 기다리고 다시 보내지 않는다.
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  await visible(page.getByLabel('종목 이름으로 찾기'), '종목 선택 화면')
  await page.goBack()
  await visible(coach.getByRole('button', { name: '받는 중' }), '돌아와도 받는 중')
  await visible(coach.getByText(/어제 하체를 했으니/), 'AI 요약')

  // 앱이 보낸 요청
  const [request] = anthropic.messageRequests()
  const body = JSON.parse(request.body)
  const prompt = body.messages[0].content
  const beta = request.headers['anthropic-beta'] ?? ''
  check(request.headers['authorization'] === `Bearer ${KEY}`, '요청에 키')
  check(request.headers['anthropic-dangerous-direct-browser-access'] === 'true', '브라우저 직접 호출 헤더')
  check(beta.includes('server-side-fallback-2026-07-01'), `거절 시 대체 모델 베타 (${beta})`)
  check(
    body.model === 'claude-opus-5-5' && body.fallbacks === 'default',
    `모델과 fallbacks (${body.model}, ${body.fallbacks})`,
  )
  check(
    body.output_config?.format?.type === 'json_schema' && body.output_config?.effort === 'medium',
    '구조화된 출력과 effort',
  )
  check(!('thinking' in body) && !('temperature' in body), 'thinking/temperature 안 보냄')
  check(body.stream === true, '스트리밍으로 받음')
  check(prompt.includes('[E1] 벤치프레스') && prompt.includes('[E2] 풀업'), '종목이 글에 들어감')
  check(!request.body.includes(KEY), '본문에 키 없음')
  check(JSON.stringify(body.output_config.format.schema).includes('"enum":["E1","E2"]'), '스키마의 key 목록')

  // 받은 추천
  await visible(aiBar.getByText('77.5kg × 8'), '벤치 AI 추천 77.5kg × 8')
  check((await ruleBar.count()) === 0, 'AI 추천이 있으면 규칙 추천은 숨김')
  await visible(card('풀업').getByRole('group', { name: 'AI 추천' }).getByText('11회'), '풀업 AI 11회')
  await noOverflow('운동 중')
  await shot('04-workout-ai')
  await aiBar.getByRole('button', { name: /적용$/ }).tap()
  await eventually(
    () => setValues(bench, BENCH_SETS),
    '40x8 77.5x8 77.5x8 77.5x8 70x10',
    '적용: 75kg 세트만 77.5kg로, 백오프 70×10은 그대로',
  )
  await visible(aiBar.getByRole('button', { name: '추천 적용됨' }), '적용됨')

  // 다시 열어도 같은 답(새 요청 없음)
  await page.reload()
  await visible(coach.getByText(/어제 하체를 했으니/), '다시 열어도 답이 남음')
  check(anthropic.messageRequests().length === 1, '다시 열 때 요청하지 않음')
  await shot('05-workout-ai-applied', { fullPage: true })

  // ───── 통계: 오류 뒤 성공
  step('통계 AI 분석')
  await open('/stats')
  const review = page.getByRole('region', { name: 'AI 기록 분석' })
  await visible(review, 'AI 기록 분석 카드')
  anthropic.replyWithError({ status: 401, type: 'authentication_error', message: 'invalid x-api-key' })
  await review.getByRole('button', { name: '기록 분석 받기' }).tap()
  await visible(review.getByRole('alert').getByText(/API 키가 맞지 않습니다/), '키 오류 안내')
  await shot('06-stats-error')

  const analysis = {
    headline: '10주 동안 주 3회 가까이 꾸준히 했고, 큰 종목이 모두 올랐어요.',
    good: ['벤치프레스가 67.5kg에서 77.5kg까지 올랐어요.', '한 주만 빼고 매주 운동했어요.'],
    watch: ['스쿼트는 최근 3번 110kg에서 5회를 다 채우지 못했어요.', '어깨 세트가 다른 부위의 절반이에요.'],
    suggestions: ['스쿼트를 100kg 5×5로 낮춰 2주 다시 쌓아 보세요.', '사이드 레터럴 레이즈를 주 2회 3세트씩 더해 보세요.'],
  }
  // 중간에 거절되어 다른 모델이 이어 답한 경우: 쓰다 만 글, fallback 블록, 새 답 순서로 온다.
  anthropic.replyWithMessage({
    model: 'claude-opus-4-8',
    delayMs: 600,
    blocks: [
      { type: 'text', text: '{"headline":"쓰다 만' },
      {
        type: 'fallback',
        from: { model: 'claude-opus-5-5' },
        to: { model: 'claude-opus-4-8' },
        trigger: { type: 'refusal' },
      },
      { type: 'text', text: JSON.stringify(analysis) },
    ],
  })
  await review.getByRole('button', { name: '기록 분석 받기' }).tap()
  await visible(review.getByText(/주 3회 가까이 꾸준히/), '분석 결과')
  await visible(review.getByRole('heading', { name: '살펴볼 점' }), '살펴볼 점')
  check((await review.getByRole('alert').count()) === 0, '성공하면 오류 안내가 사라짐')
  const reviewBody = JSON.parse(anthropic.messageRequests().at(-1).body)
  check(reviewBody.messages[0].content.includes('주별 기록(최근 8주'), '분석 요청에 주별 기록')
  await review.scrollIntoViewIfNeeded()
  await noOverflow('통계')
  await shot('07-stats-review')
  await shot('07-stats-review-card', { of: review })

  // ───── 사용량, 백업, 끄기
  step('사용량과 백업')
  await open('/settings')
  await visible(page.getByText(/이번 달 2회 · 약 \$0\.\d\d/), '이번 달 2회')
  const backupText = (await download(page.getByRole('button', { name: '백업 파일 저장' }))).text
  check(!backupText.includes('sk-ant'), '백업 파일에 키 없음')
  check(
    JSON.parse(backupText).data.settings.some((row) => row.key === 'aiEnabled' && row.value === true),
    '켜기 설정은 백업에 있음',
  )
  await aiSwitch.tap()
  await open('/stats')
  await visible(page.getByRole('heading', { name: '통계', exact: true }), '통계')
  check((await reviewHeading.count()) === 0, '끄면 통계에서 사라짐')

  step('콘솔')
  // 일부러 받은 401 답은 브라우저가 콘솔에 오류로 남긴다.
  phone.consoleClean({ ignore: [/status of 401/] })
}
