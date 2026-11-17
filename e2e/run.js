// 빌드한 앱을 휴대폰 크기 화면에서 실제로 쓰는 순서대로 끝까지 눌러 보는 점검(e2e).
//
//   npm run e2e                  빌드한 뒤 모든 시나리오
//   node e2e/run.js              이미 빌드해 둔 dist/ 로 모든 시나리오
//   node e2e/run.js ai smoke     고른 시나리오만
//
// dist/ 를 vite preview로 비어 있는 포트에 띄우고, 시나리오마다 새 화면(빈 저장소)에서 돌린 뒤 서버를 내린다.
// 점검이 하나라도 틀리면 종료 코드 1로 끝난다.
// 화면 사진은 e2e/screenshots/<시나리오>/ 에 밝은 화면과 어두운 화면(-dark)으로 남는다(git에는 올리지 않는다).
//
// 시나리오를 더하려면 title과 run(phone)을 내보내는 파일을 만들고 아래 SCENARIOS에 넣는다.
// phone에 들어 있는 것은 lib/phone.js(화면과 앱 동작)와 lib/checks.js(점검)에 있다.
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { chromium } from 'playwright'
import { preview } from 'vite'
import * as aiCoach from './ai-coach.js'
import * as ai from './ai.js'
import * as assistedMachines from './assisted-machines.js'
import * as bodyBackup from './body-backup.js'
import * as cardioStopwatch from './cardio-stopwatch.js'
import * as exercisesRest from './exercises-rest.js'
import { createChecks } from './lib/checks.js'
import { openPhone } from './lib/phone.js'
import * as measure from './measure.js'
import * as platesWarmup from './plates-warmup.js'
import * as routinesStats from './routines-stats.js'
import * as smoke from './smoke.js'
import * as supersets from './supersets.js'
import * as weeklyGoal from './weekly-goal.js'
import * as workoutCard from './workout-card.js'

const SCENARIOS = {
  smoke,
  'routines-stats': routinesStats,
  ai,
  'workout-card': workoutCard,
  'exercises-rest': exercisesRest,
  'body-backup': bodyBackup,
  'ai-coach': aiCoach,
  measure,
  'cardio-stopwatch': cardioStopwatch,
  'plates-warmup': platesWarmup,
  'weekly-goal': weeklyGoal,
  supersets,
  'assisted-machines': assistedMachines,
}

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SHOTS = path.join(ROOT, 'e2e', 'screenshots')

/** 여러 줄인 Playwright 오류(무엇을, 어떤 요소를 기다리다 멈췄는지)를 요약에 넣을 한 줄로 줄인다. */
const oneLine = (message) =>
  stripVTControlCharacters(message)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' ')

async function runScenario(browser, baseUrl, name) {
  const scenario = SCENARIOS[name]
  const shotsDir = path.join(SHOTS, name)
  rmSync(shotsDir, { recursive: true, force: true })
  console.log(`\n━━ ${name}: ${scenario.title}`)

  const checks = createChecks()
  const phone = await openPhone(browser, { baseUrl, shotsDir, checks })
  const startedAt = Date.now()
  try {
    await scenario.run(phone)
  } catch (error) {
    // 누를 요소를 찾지 못한 경우 등. 그때의 화면을 남기고 다음 시나리오로 넘어간다.
    checks.fail(`시나리오가 중간에 멈춤: ${oneLine(error.message)}`)
    console.error(error)
    await phone.shot('stopped').catch(() => {})
  } finally {
    await phone.close()
  }
  return { name, total: checks.total, problems: checks.problems, seconds: Math.round((Date.now() - startedAt) / 1000) }
}

async function main() {
  const asked = process.argv.slice(2)
  const unknown = asked.filter((name) => !(name in SCENARIOS))
  if (unknown.length) {
    console.error(`없는 시나리오: ${unknown.join(', ')} (있는 것: ${Object.keys(SCENARIOS).join(', ')})`)
    return 2
  }
  const names = asked.length ? asked : Object.keys(SCENARIOS)

  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.error('dist/ 가 없습니다. npm run e2e 로 돌리거나 먼저 npm run build 를 해 주세요.')
    return 2
  }
  // 포트 0은 비어 있는 포트를 알아서 잡는다.
  const server = await preview({ root: ROOT, logLevel: 'warn', preview: { host: '127.0.0.1', port: 0 } })
  const baseUrl = server.resolvedUrls.local[0]
  console.log(`dist/ 를 ${baseUrl} 에 띄움`)

  const results = []
  const browser = await chromium.launch()
  try {
    for (const name of names) results.push(await runScenario(browser, baseUrl, name))
  } finally {
    await browser.close()
    await server.close()
  }

  console.log('\n━━ 결과')
  for (const r of results) console.log(`${r.name}: 점검 ${r.total}개, 문제 ${r.problems.length}건 (${r.seconds}초)`)
  const problems = results.flatMap((r) => r.problems.map((problem) => `${r.name} ${problem}`))
  if (problems.length === 0) {
    console.log('모든 점검 통과')
    return 0
  }
  console.log(`\n문제 ${problems.length}건 (화면 사진: e2e/screenshots/):\n- ${problems.join('\n- ')}`)
  return 1
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error('점검을 돌리지 못함:', error)
    process.exit(2)
  },
)
