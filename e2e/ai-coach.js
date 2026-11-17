// AI 코치: 설정의 내 정보, 끝난 운동의 AI 피드백, 루틴 화면의 "AI로 루틴 만들기"를 받아 본다.
// Anthropic API는 흉내 낸 답으로 대신한다(lib/anthropic-mock.js). 실제 API는 부르지 않는다.
// 운동 중 AI 추천과 통계의 기록 분석은 ai 시나리오가 본다.
import { mockAnthropic } from './lib/anthropic-mock.js'
import { touchTargets } from './lib/layout.js'
import { sampleBackup } from './lib/sample-backup.js'
import { patchRows, putRows, readRow } from './lib/store.js'

export const title = 'AI 코치 (내 정보, 운동 뒤 피드백, AI로 루틴 만들기)'

const KEY = 'sk-ant-api03-test-key-ABCDEFGHIJ-wxyz'
const DAY = 24 * 60 * 60 * 1000
/** 점검용 폰의 시간대(Asia/Seoul)로 본 그 시각의 날짜(YYYY-MM-DD) */
const dateKey = (ts) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(ts)
const NOTES = '왼쪽 어깨가 좋지 않아 머리 위로 미는 동작은 피하고 싶어요'
const ROUTINE_REQUEST = '주 3회 상체/하체 분할, 어깨에 무리 없는 종목으로'
const LONG_ROUTINE = '상체 B 이름이 아주 길어서 줄이 넘어가는 루틴'
/** 44px 묶음 안에 든 SegmentedControl의 버튼은 누르는 곳 점검에서 뺀다. */
const TARGETS = { selector: 'button, textarea, input', except: '[role=group] button' }

export async function run(phone) {
  const { page, context, step, check, visible, attr, count, eventually } = phone
  const { open, shot, noOverflow, restoreSample } = phone
  const anthropic = await mockAnthropic(context)
  const now = Date.now()

  // ───── 샘플 기록, 체중, RPE, 종목 메모
  step('준비')
  await restoreSample()
  // 피드백을 받을 운동: 샘플의 마지막 운동(어제). 그 첫 종목의 본 세트에 RPE를, 종목에 메모를 넣어 둔다.
  const sample = sampleBackup(now).data
  const workout = sample.workouts.reduce((last, w) => (w.startedAt > last.startedAt ? w : last))
  const [firstExercise] = sample.workoutExercises
    .filter((we) => we.workoutId === workout.id)
    .sort((a, b) => a.order - b.order)
  const workingSetIds = sample.sets
    .filter((s) => s.workoutExerciseId === firstExercise.id && !s.isWarmup)
    .map((s) => s.id)
  // 체중은 어제와 그 4주 전.
  const weighedOn = { latest: dateKey(now - DAY), before: dateKey(now - 29 * DAY) }
  await putRows(page, {
    bodyWeights: [
      { date: weighedOn.before, weightKg: 73.6, updatedAt: 1 },
      { date: weighedOn.latest, weightKg: 72.4, updatedAt: 2 },
    ],
  })
  await patchRows(page, 'sets', workingSetIds, { rpe: 8.5 })
  await patchRows(page, 'exercises', [firstExercise.exerciseId], { note: '시트 4칸, 그립 넓게' })
  await page.reload()

  const aiSwitch = page.getByRole('switch', { name: 'AI 추천' })
  const again = page.getByRole('button', { name: '같은 운동 다시 하기' })
  const noRoutines = page.getByRole('heading', { name: '아직 루틴이 없습니다' })
  const feedbackHeading = page.getByRole('heading', { name: 'AI 피드백' })
  const openBuilder = page.getByRole('button', { name: 'AI로 루틴 만들기' })
  const openWorkout = () => open(`/history/${workout.id}`)

  // ───── 꺼져 있을 때
  step('AI 꺼짐')
  await openWorkout()
  await visible(again, '기록 상세')
  await count(feedbackHeading, 0, '꺼져 있으면 기록 상세에 AI 피드백 없음')
  await open('/routines')
  await visible(noRoutines, '루틴 화면(빈 상태)')
  await count(openBuilder, 0, '꺼져 있으면 루틴 화면에 AI 없음')
  await open('/settings')
  await attr(aiSwitch, 'aria-checked', 'false', '설정의 AI 추천은 꺼짐')
  const section = page.getByRole('region', { name: 'AI 추천' })
  const profileHeading = section.getByRole('heading', { name: '내 정보' })
  await count(profileHeading, 0, '꺼져 있으면 설정에 내 정보 없음')

  // ───── 설정: 내 정보
  step('내 정보')
  await aiSwitch.tap()
  await visible(profileHeading, '켜면 내 정보')
  // 키가 없으면 루틴 화면에는 아직 보이지 않고, 기록 상세에는 설정으로 가라는 안내가 나온다.
  await open('/routines')
  await visible(noRoutines, '루틴 화면')
  await count(openBuilder, 0, '키가 없으면 루틴 화면에 AI 없음')
  await openWorkout()
  const feedback = page.getByRole('region', { name: 'AI 피드백' })
  await visible(
    feedback.getByText('에서 Anthropic API 키를 넣으면 이 운동의 피드백을 받을 수 있어요.'),
    '키가 없으면 기록 상세에 설정 안내',
  )
  await open('/settings')
  await page.getByLabel('Anthropic API 키').fill(KEY)
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await visible(page.getByText('sk-ant-…wxyz'), '키 저장')

  const choice = (group, name) => section.getByRole('group', { name: group }).getByRole('button', { name, exact: true })
  const chosen = (group) => section.getByRole('group', { name: group }).locator('[aria-pressed=true]').allTextContents()
  await choice('목표', '근력').tap()
  await eventually(() => chosen('목표'), ['근력'], '목표를 고름')
  await choice('목표', '근비대').tap()
  await eventually(() => chosen('목표'), ['근비대'], '다른 목표를 누르면 하나만 남음')
  await choice('운동 경력', '중급').tap()
  await eventually(() => chosen('운동 경력'), ['중급'], '운동 경력을 고름')
  await choice('주당 운동 횟수', '5').tap()
  await eventually(() => chosen('주당 운동 횟수'), ['5'], '주당 운동 횟수를 고름')
  await choice('주당 운동 횟수', '5').tap()
  await eventually(() => chosen('주당 운동 횟수'), [], '고른 것을 다시 누르면 지워짐')
  await choice('주당 운동 횟수', '4').tap()
  await eventually(() => chosen('주당 운동 횟수'), ['4'], '새로 고름')
  const notes = section.getByLabel('참고할 점')
  await notes.fill(NOTES)
  await notes.blur()
  await eventually(
    async () => (await readRow(page, 'settings', 'aiProfile'))?.value,
    { goal: 'hypertrophy', experience: 'intermediate', daysPerWeek: 4, notes: NOTES },
    '내 정보가 바로 저장됨',
  )
  await visible(
    section.getByText(/힘든 정도\(RPE\).*체중 기록.*내 정보가 Anthropic으로 전송됩니다/s),
    '무엇을 보내는지 안내',
  )
  await page.reload()
  await eventually(() => notes.inputValue(), NOTES, '다시 열어도 참고할 점이 남아 있음')
  await eventually(() => chosen('운동 경력'), ['중급'], '다시 열어도 운동 경력이 남아 있음')
  await noOverflow('설정(내 정보)')
  await touchTargets(phone, '설정의 AI 추천', section, TARGETS)
  await profileHeading.scrollIntoViewIfNeeded()
  await shot('01-settings-profile')

  // ───── 기록 상세: 운동 뒤 피드백
  step('운동 뒤 피드백')
  await openWorkout()
  await visible(feedback.getByText(/Opus 5\.5로 한 번에 약 \$0\.04가 들어요/), '요청 전 요금 안내')
  check(anthropic.messageRequests().length === 0, '화면을 여는 것만으로는 요청하지 않음')
  await shot('02-feedback-empty')
  anthropic.replyWithError({ status: 401, type: 'authentication_error', message: 'invalid x-api-key' })
  await feedback.getByRole('button', { name: 'AI 피드백 받기' }).tap()
  await visible(feedback.getByRole('alert').getByText(/API 키가 맞지 않습니다/), '키 오류 안내')

  // 답은 "받는 중"인 화면을 다 본 뒤에 보낸다.
  const sendFeedback = anthropic.replyWithMessage({
    model: 'claude-opus-5-5',
    hold: true,
    json: {
      headline: '지난번보다 스쿼트가 안정됐고, 전체 볼륨도 늘어난 좋은 운동이었어요.',
      points: [
        '스쿼트 110kg 5회를 네 세트 채웠어요. RPE 8.5였으니 마지막 세트까지 5회를 채우면 올려 볼 만해요.',
        '딥스는 세트가 갈수록 횟수가 떨어졌어요. 휴식을 30초 늘려 보세요.',
        '어깨가 좋지 않다고 하셨으니 프레스 종목은 통증 없는 범위에서만 해요.',
      ],
    },
  })
  await feedback.getByRole('button', { name: 'AI 피드백 받기' }).tap()
  await visible(
    feedback.getByText('Claude가 이 운동을 지난 기록과 비교하고 있어요. 보통 10~30초 걸려요.'),
    '기다리는 동안 안내',
  )
  await shot('03-feedback-loading')
  // 기다리는 동안 다른 화면에 갔다 와도 이어서 기다린다.
  await open('/history')
  await visible(page.getByRole('heading', { name: '기록', exact: true }), '기록 목록으로 나감')
  await page.goBack()
  await visible(feedback.getByRole('button', { name: '받는 중' }), '돌아와도 받는 중')
  sendFeedback()
  await visible(feedback.getByText(/스쿼트가 안정됐고/), '피드백 총평')
  await count(feedback.getByRole('listitem'), 3, '피드백 항목 3개')
  await count(feedback.getByRole('alert'), 0, '성공하면 오류 안내가 사라짐')
  await visible(feedback.getByRole('button', { name: '피드백 다시 받기' }), '받은 뒤에는 "다시 받기"')

  // 앱이 보낸 요청
  const feedbackRequest = anthropic.messageRequests().at(-1)
  const feedbackBody = JSON.parse(feedbackRequest.body)
  const feedbackPrompt = feedbackBody.messages[0].content
  const weightLine = `- 체중: 72.4kg(${weighedOn.latest} 기록), 약 4주 전 73.6kg(${weighedOn.before})에서 -1.2kg`
  check(feedbackPrompt.includes(`피드백을 받을 운동: ${workout.date}`), `요청에 이 운동 (${workout.date})`)
  check(
    feedbackPrompt.includes('- 목표: 근비대(근육 키우기)') &&
      feedbackPrompt.includes('- 주당 운동 목표: 4회') &&
      feedbackPrompt.includes(NOTES),
    '요청에 내 정보',
  )
  check(feedbackPrompt.includes(weightLine), `요청에 체중과 4주 변화 (${weightLine})`)
  check(
    feedbackPrompt.includes('(RPE 8.5)') && feedbackPrompt.includes('종목 메모: 시트 4칸, 그립 넓게'),
    '요청에 RPE와 종목 메모',
  )
  check(feedbackPrompt.includes('지난 기록(오래된 것부터):'), '요청에 같은 종목의 지난 기록')
  check(
    feedbackRequest.headers['authorization'] === `Bearer ${KEY}` && !feedbackRequest.body.includes(KEY),
    '키는 헤더에만, 본문에는 없음',
  )
  check(feedbackBody.output_config?.format?.type === 'json_schema' && feedbackBody.stream === true, '구조화된 출력과 스트리밍')
  const sent = anthropic.messageRequests().length
  check(sent === 2, `요청은 누른 만큼만, 갔다 와도 다시 보내지 않음 (${sent}번)`)
  await noOverflow('기록 상세(AI 피드백)')
  await touchTargets(phone, 'AI 피드백 카드', feedback, TARGETS)
  await shot('04-feedback')
  await page.reload()
  await visible(feedback.getByText(/스쿼트가 안정됐고/), '다시 열어도 답이 남음')
  check(anthropic.messageRequests().length === 2, '다시 열 때 요청하지 않음')

  // ───── 루틴: AI로 루틴 만들기
  step('AI로 루틴 만들기')
  await open('/routines')
  await visible(noRoutines, '루틴 화면(빈 상태)')
  await openBuilder.tap()
  const builder = page.getByRole('region', { name: 'AI로 루틴 만들기' })
  const requestField = builder.getByLabel('어떤 루틴을 원하나요?')
  await visible(builder.getByText(/Opus 5\.5로 한 번에 약 \$0\.08가 들어요/), '요청 전 요금 안내')
  check(await builder.getByRole('button', { name: '루틴 제안 받기' }).isDisabled(), '요청을 적기 전에는 버튼 잠김')
  await shot('05-routines-empty', { fullPage: true })
  await requestField.fill(ROUTINE_REQUEST)

  // 답의 종목은 요청 글의 "고를 수 있는 종목"에 적힌 key(E1, E2 …)로 가리킨다.
  // 걸러져야 하는 것도 섞는다: 목록에 없는 key, 범위를 벗어난 세트 수, 남는 종목이 없는 루틴.
  let routinePrompt = ''
  const sendRoutines = anthropic.replyWithMessage({
    model: 'claude-opus-5-5',
    hold: true,
    json: (requestBody) => {
      routinePrompt = requestBody.messages[0].content
      const keyOf = (name) => {
        const line = routinePrompt.split('\n').find((l) => new RegExp(`^E\\d+ ${name} \\(`).test(l))
        return line ? line.split(' ')[0] : 'E999'
      }
      return {
        routines: [
          {
            name: '상체 A',
            rationale: '어깨 부담이 적은 밀기와 당기기를 같은 양으로 넣었어요.',
            items: [
              { key: keyOf('벤치프레스'), sets: 4, reps: 8 },
              { key: keyOf('랫풀다운'), sets: 4, reps: 10 },
              { key: keyOf('시티드 로우'), sets: 3, reps: 12 },
              { key: 'E999', sets: 3, reps: 12 },
              { key: keyOf('바벨 컬'), sets: 30, reps: 12 },
            ],
          },
          {
            name: '하체 날',
            rationale: '스쿼트를 이어 가면서 뒤쪽 근육을 보탰어요.',
            items: [
              { key: keyOf('스쿼트'), sets: 5, reps: 5 },
              { key: keyOf('레그 프레스'), sets: 3, reps: 10 },
              { key: keyOf('레그 컬'), sets: 3, reps: null },
            ],
          },
          { name: '빈 루틴', rationale: '', items: [{ key: 'E998', sets: 3, reps: 10 }] },
          {
            name: LONG_ROUTINE,
            rationale: '가벼운 날이에요.',
            items: [
              { key: keyOf('풀업'), sets: 3, reps: 8 },
              { key: keyOf('덤벨 벤치프레스'), sets: 3, reps: 12 },
            ],
          },
        ],
      }
    },
  })
  await builder.getByRole('button', { name: '루틴 제안 받기' }).tap()
  await visible(builder.getByText('Claude가 루틴을 짜고 있어요. 보통 20~40초 걸려요.'), '기다리는 동안 안내')
  await shot('06-routines-loading')
  await open('/')
  await visible(page.getByRole('heading', { name: '헬스 기록' }), '홈으로 나감')
  await open('/routines')
  await visible(builder.getByRole('button', { name: '받는 중' }), '돌아와도 받는 중')
  check((await requestField.inputValue()) === ROUTINE_REQUEST, '돌아와도 적은 요청이 남음')
  sendRoutines()
  await visible(builder.getByRole('heading', { name: '제안받은 루틴 3개' }), '제안 3개(남는 종목이 없는 루틴은 버림)')

  // 앱이 보낸 요청
  const routineRequest = anthropic.messageRequests().at(-1)
  const routineSchema = JSON.stringify(JSON.parse(routineRequest.body).output_config.format.schema)
  check(routinePrompt.includes(`요청: ${ROUTINE_REQUEST}`), '요청 글에 사용자가 적은 요청')
  check(
    routinePrompt.includes('- 목표: 근비대(근육 키우기)') && routinePrompt.includes('- 체중: 72.4kg'),
    '요청 글에 내 정보와 체중',
  )
  check(/^E1 .+\(가슴, /m.test(routinePrompt) && routinePrompt.includes('고를 수 있는 종목'), '요청 글에 종목 목록')
  check(/최근 8주 \d+회, 마지막 /.test(routinePrompt), '요청 글에 최근 훈련 요약')
  check(!routineRequest.body.includes(KEY), '본문에 키 없음')
  check(
    routineSchema.includes('"enum":["E1","E2"') && !/minimum|maximum|maxItems/.test(routineSchema),
    '스키마의 key 목록, 범위 키워드 없음',
  )

  // 받은 제안
  const proposal = (name) =>
    builder.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: `${name} 저장하기` }) })
  const upperA = proposal('상체 A')
  await visible(upperA.getByText('벤치프레스'), '상체 A에 벤치프레스')
  await visible(upperA.getByText('4세트 × 8회'), '세트와 횟수')
  // 제안마다 이름과 종목 수. 상체 A는 다섯을 받았지만 모르는 key와 세트 수가 30인 바벨 컬이 빠져 셋이 남는다.
  await eventually(
    () => builder.getByRole('checkbox').evaluateAll((els) => els.map((el) => el.textContent)),
    ['상체 A종목 3개', '하체 날종목 3개', `${LONG_ROUTINE}종목 2개`],
    '모르는 key와 세트 수가 범위를 벗어난 종목은 빠짐',
  )
  await count(upperA.getByText('바벨 컬'), 0, '세트 수가 30인 바벨 컬은 없음')
  await visible(proposal('하체 날').getByText('3세트', { exact: true }), '횟수가 없는 종목은 세트만')
  await count(noRoutines, 1, '제안만 받고는 루틴이 만들어지지 않음')
  await noOverflow('루틴 제안')
  await touchTargets(phone, '루틴 제안', builder, TARGETS)
  // 전체를 찍을 때는 맨 위에서 찍어야 붙어 있는 머리줄이 가운데에 끼지 않는다.
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot('07-routines-proposals', { fullPage: true })

  // 하나를 빼고 저장
  const lowerBox = builder.getByRole('checkbox', { name: '하체 날 저장하기' })
  const saveTwo = builder.getByRole('button', { name: '고른 2개 루틴으로 저장' })
  await lowerBox.tap()
  await attr(lowerBox, 'aria-checked', 'false', '제안을 눌러 저장에서 뺌')
  await visible(saveTwo, '고른 수가 버튼에 보임')
  await page.reload()
  await visible(builder.getByRole('heading', { name: '제안받은 루틴 3개' }), '다시 열어도 제안이 남음')
  check(anthropic.messageRequests().length === 3, `다시 열 때 요청하지 않음 (${anthropic.messageRequests().length}번)`)
  await lowerBox.tap()
  await saveTwo.tap()
  await visible(builder.getByText('루틴 2개를 저장했습니다. 루틴 목록에서 바로 시작할 수 있어요.'), '저장 안내')
  const startButtons = page.getByRole('button', { name: /루틴 시작$/ })
  const savedRoutines = () => startButtons.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
  await eventually(savedRoutines, ['상체 A 루틴 시작', `${LONG_ROUTINE} 루틴 시작`], '고른 루틴 2개만 제안 순서대로 저장됨')
  await visible(builder.getByRole('heading', { name: '제안받은 루틴 1개' }), '저장한 것은 제안에서 빠짐')
  await page.evaluate(() => window.scrollTo(0, 0))
  await noOverflow('루틴 목록(긴 루틴 이름)')
  await shot('08-routines-saved', { fullPage: true })

  await page.getByRole('link', { name: /^상체 A/ }).tap()
  await visible(page.getByRole('listitem', { name: '랫풀다운', exact: true }), '저장한 루틴은 보통 루틴처럼 열어 고칠 수 있음')
  await page.goBack()
  await builder.getByRole('button', { name: '저장하지 않고 제안 지우기' }).tap()
  await visible(openBuilder, '제안을 지우면 버튼으로 돌아감')
  await count(startButtons, 2, '제안을 지워도 저장한 루틴은 그대로')

  // ───── 사용량, 끄기
  step('사용량과 끄기')
  await open('/settings')
  await visible(page.getByText(/이번 달 2회 · 약 \$0\.\d\d/), '이번 달 2회(오류 난 요청은 세지 않음)')
  await aiSwitch.tap()
  await attr(aiSwitch, 'aria-checked', 'false', 'AI 추천을 끔')
  await open('/routines')
  await visible(startButtons, '루틴 목록')
  await count(openBuilder, 0, '끄면 루틴 화면에서 사라짐')
  await openWorkout()
  await visible(again, '기록 상세')
  await count(feedbackHeading, 0, '끄면 기록 상세에서 사라짐')

  step('콘솔')
  // 일부러 받은 401 답은 브라우저가 콘솔에 오류로 남긴다.
  phone.consoleClean({ ignore: [/status of 401/] })
}
