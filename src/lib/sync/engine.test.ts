import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryStore, type MemoryStore } from '../../../worker/memoryStore'
import { handleSync } from '../../../worker/protocol'
import { db } from '../../db'
import { exportBackup, importBackup } from '../backup'
import { ensureSeedExercises } from '../exercises'
import { getLastBackupAt, SETTING_KEYS, setSetting } from '../settings'
import { addExercisesToWorkout, finishWorkout, loadWorkoutDetail, startWorkout, updateSet } from '../workouts'
import { createApi } from './api'
import { formatCode } from './code'
import { deriveKeys, openBackup, sealBackup } from './crypto'
import {
  AUTO_MIN_INTERVAL_MS,
  autoSync,
  connectWithCode,
  disconnectCloud,
  listCloudSnapshots,
  overwriteCloud,
  restoreFromCloud,
  startCloudBackup,
  uploadNow,
  wipeCloud,
  type SyncDeps,
} from './engine'
import { SyncError } from './errors'
import { backupHash } from './hash'
import { getSyncCode, getSyncState } from './state'

const START = Date.UTC(2026, 10, 17, 9, 0, 0)
const HTML = { 'Content-Type': 'text/html' }
const LATER = AUTO_MIN_INTERVAL_MS + 1_000

interface Seen {
  method: string
  url: string
  auth: string | null
}

/** 서버 하나(메모리 보관함 + 실제 규칙)와, 그 서버를 부르는 폰의 도구 */
function setupServer() {
  const store: MemoryStore = createMemoryStore()
  const env = { clock: START, online: true, reachable: true, html: false }
  const seen: Seen[] = []
  const fetchFn = async (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    seen.push({ method: init?.method ?? 'GET', url: input, auth: headers.get('Authorization') })
    if (!env.reachable) throw new TypeError('Failed to fetch')
    // 서버가 없는 호스팅은 어떤 주소든 앱의 index.html을 돌려준다.
    if (env.html) return new Response('<!doctype html><title>헬스 기록</title>', { headers: HTML })
    return handleSync(new Request(`https://health.example${input}`, init), store, () => env.clock)
  }
  const deps: SyncDeps = { api: createApi(fetchFn), now: () => env.clock, online: () => env.online }
  return { store, env, seen, deps }
}

/** 운동 하나를 기록하고 끝낸다. */
async function recordWorkout(startedAt: number, weightKg: number): Promise<string> {
  const id = await startWorkout(startedAt)
  await addExercisesToWorkout(id, ['seed:squat'])
  const detail = await loadWorkoutDetail(id)
  await updateSet(detail!.items[0].sets[0].id, { weightKg, reps: 5, isDone: true })
  await finishWorkout(id, { endedAt: startedAt + 1_000, memo: '' })
  return id
}

/** 다른 폰으로 바꾼 것처럼 이 폰의 저장소를 비운다. */
async function freshPhone(): Promise<void> {
  await db.delete()
  await db.open()
  await ensureSeedExercises()
}

const finishedWeights = async () =>
  (await db.sets.toArray())
    .filter((s) => s.isDone)
    .map((s) => s.weightKg)
    .sort()

beforeEach(freshPhone)

describe('클라우드 백업 시작', () => {
  it('코드를 만들어 등록하고 지금 기록을 올린다', async () => {
    const { store, deps, env } = setupServer()
    await recordWorkout(START - 3_600_000, 100)

    const code = await startCloudBackup(deps)
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{25}$/)
    expect(await getSyncCode()).toBe(code)
    expect(await store.owner()).not.toBeNull()
    expect(store.uploads).toBe(1)
    const state = await getSyncState()
    expect(state).toMatchObject({ claimed: true, version: 1, lastUploadAt: START, hold: null, lastError: null })
    // 규칙 4: 올리면 마지막 백업 시각도 바뀐다.
    expect(await getLastBackupAt()).toBe(env.clock)

    // 서버에는 암호문만 있고, 코드로 풀면 지금 기록이 나온다.
    const bytes = (await store.read(1))!
    expect(Buffer.from(bytes).includes(Buffer.from('seed:squat'))).toBe(false)
    const backup = JSON.parse(await openBackup((await deriveKeys(code)).key, bytes))
    expect(backup.data.workouts).toHaveLength(1)
    expect(backup.data.sets.filter((s: { isDone: boolean }) => s.isDone)).toHaveLength(1)
  })

  it('이미 다른 코드가 주인이면 코드를 남기지 않고 실패한다', async () => {
    const { store, deps } = setupServer()
    await store.claim('someone-else')
    await expect(startCloudBackup(deps)).rejects.toMatchObject({ code: 'already_claimed' })
    expect(await getSyncCode()).toBeNull()
    expect(await db.settings.get(SETTING_KEYS.syncState)).toBeUndefined()
    expect(store.uploads).toBe(0)
  })

  it('서버가 없는 주소(HTML이 돌아옴)에서는 코드를 남기지 않는다', async () => {
    const { deps, env } = setupServer()
    env.html = true
    expect(await deps.api.hello()).toEqual({ kind: 'unavailable' })
    await expect(startCloudBackup(deps)).rejects.toMatchObject({ code: 'unavailable' })
    expect(await getSyncCode()).toBeNull()
  })

  it('등록 요청의 답을 못 받았으면 코드를 지키고, 다음에 올릴 때 등록부터 다시 한다', async () => {
    const { store, deps, env } = setupServer()
    env.reachable = false
    expect(await deps.api.hello()).toEqual({ kind: 'offline' })
    await expect(startCloudBackup(deps)).rejects.toMatchObject({ code: 'network' })
    const code = await getSyncCode()
    expect(code).not.toBeNull()
    const failed = { at: START, code: 'network' }
    expect(await getSyncState()).toMatchObject({ claimed: false, version: null, lastError: failed })

    env.reachable = true
    expect(await uploadNow(deps)).toBe('uploaded')
    expect(await getSyncCode()).toBe(code)
    expect(await getSyncState()).toMatchObject({ claimed: true, version: 1, lastError: null })
    expect(store.uploads).toBe(1)
  })
})

describe('자동 올리기', () => {
  it('기록이 바뀌었을 때만 올리고, 올린 지 얼마 안 됐으면 미룬다', async () => {
    const { store, deps, env } = setupServer()
    await startCloudBackup(deps)
    expect(store.uploads).toBe(1)

    // 바뀐 것이 없으면 시간이 지나도 올리지 않는다.
    env.clock += LATER
    expect(await autoSync('visible', deps)).toEqual({ outcome: 'unchanged' })
    expect(store.uploads).toBe(1)

    await recordWorkout(env.clock, 60)
    expect(await autoSync('visible', deps)).toEqual({ outcome: 'uploaded' })
    expect(store.uploads).toBe(2)
    expect(await getSyncState()).toMatchObject({ version: 2, lastUploadAt: env.clock })

    // 방금 올렸으면 기록이 바뀌어도 몇 분 동안은 미룬다.
    env.clock += 60_000
    await recordWorkout(env.clock, 70)
    expect(await autoSync('open', deps)).toEqual({ outcome: 'throttled', retryInMs: AUTO_MIN_INTERVAL_MS - 60_000 })
    expect(await autoSync('online', deps)).toMatchObject({ outcome: 'throttled' })
    expect(store.uploads).toBe(2)
    env.clock += AUTO_MIN_INTERVAL_MS
    expect(await autoSync('timer', deps)).toEqual({ outcome: 'uploaded' })
    expect(store.uploads).toBe(3)
  })

  it('운동을 끝냈을 때는 미루지 않고 바로 올린다', async () => {
    const { store, deps, env } = setupServer()
    await startCloudBackup(deps)
    env.clock += 30_000
    await recordWorkout(env.clock, 80)
    expect(await autoSync('workout-end', deps)).toEqual({ outcome: 'uploaded' })
    expect(store.uploads).toBe(2)
    // 운동을 취소해서 기록이 그대로면 올리지 않는다.
    expect(await autoSync('workout-end', deps)).toEqual({ outcome: 'unchanged' })
    expect(store.uploads).toBe(2)
  })

  it('꺼져 있거나, 인터넷이 없거나, 운동 중이면 올리지 않는다', async () => {
    const { store, deps, env, seen } = setupServer()
    expect(await autoSync('open', deps)).toEqual({ outcome: 'off' })
    expect(seen).toHaveLength(0)

    await startCloudBackup(deps)
    env.clock += LATER
    await recordWorkout(env.clock, 60)
    const requests = seen.length

    env.online = false
    expect(await autoSync('visible', deps)).toEqual({ outcome: 'offline' })
    env.online = true
    const active = await startWorkout(env.clock)
    expect(await autoSync('visible', deps)).toEqual({ outcome: 'workout' })
    expect(await autoSync('workout-end', deps)).toEqual({ outcome: 'workout' })
    expect(seen).toHaveLength(requests)
    expect(store.uploads).toBe(1)

    await db.workouts.delete(active)
    expect(await autoSync('workout-end', deps)).toEqual({ outcome: 'uploaded' })
  })

  it('실패해도 던지지 않고 이유를 적어 두며, 얼마 뒤 다시 해 본다', async () => {
    const { store, deps, env } = setupServer()
    await startCloudBackup(deps)
    env.clock += LATER
    await recordWorkout(env.clock, 60)

    env.reachable = false
    expect(await autoSync('visible', deps)).toEqual({ outcome: 'failed' })
    const failed = { at: env.clock, code: 'network' }
    expect(await getSyncState()).toMatchObject({ version: 1, lastUploadAt: START, lastError: failed })
    // 실패한 직후에는 다시 두드리지 않는다.
    env.reachable = true
    expect(await autoSync('visible', deps)).toMatchObject({ outcome: 'throttled' })

    env.clock += LATER
    expect(await autoSync('visible', deps)).toEqual({ outcome: 'uploaded' })
    expect(await getSyncState()).toMatchObject({ version: 2, lastError: null })
    expect(store.uploads).toBe(2)
  })

  it('"지금 올리기"는 바뀐 것이 없으면 서버의 버전만 확인하고 올리지 않는다', async () => {
    const { store, deps, env } = setupServer()
    await startCloudBackup(deps)
    expect(await uploadNow(deps)).toBe('unchanged')
    expect(store.uploads).toBe(1)
    await recordWorkout(env.clock, 60)
    // 손으로 올릴 때는 간격을 따지지 않는다.
    expect(await uploadNow(deps)).toBe('uploaded')
    expect(store.uploads).toBe(2)
  })
})

describe('기록의 해시', () => {
  it('만든 시각과 백업 시각 설정은 세지 않고, 기록이 바뀌면 달라진다', async () => {
    await recordWorkout(START, 100)
    const first = await backupHash(await exportBackup(new Date(START)))
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(await backupHash(await exportBackup(new Date(START + 86_400_000)))).toBe(first)

    await setSetting(SETTING_KEYS.lastBackupAt, START + 5)
    await setSetting(SETTING_KEYS.backupSnoozeUntil, START + 9)
    expect(await backupHash(await exportBackup())).toBe(first)

    await setSetting(SETTING_KEYS.restSeconds, 120)
    const second = await backupHash(await exportBackup())
    expect(second).not.toBe(first)
    await recordWorkout(START + 1, 105)
    expect(await backupHash(await exportBackup())).not.toBe(second)
  })
})

describe('새 폰에서 복구 코드로 연결', () => {
  /** 옛 폰이 운동 하나를 올려 둔 서버. 그 뒤 저장소를 비워 새 폰이 된다. */
  async function oldPhoneUploaded() {
    const server = setupServer()
    await recordWorkout(START - 3_600_000, 100)
    const code = await startCloudBackup(server.deps)
    await freshPhone()
    server.env.clock += LATER
    return { ...server, code }
  }

  it('규칙 1: 클라우드에 백업이 있으면 복원하거나 덮어쓰기를 고를 때까지 올리지 않는다', async () => {
    const { store, deps, env, code } = await oldPhoneUploaded()
    const state = await connectWithCode(formatCode(code).toLowerCase(), deps)
    expect(state).toMatchObject({ hold: 'connected', version: null, remote: { version: 1, createdAt: START } })
    expect(await getSyncCode()).toBe(code)

    // 새 폰에 기록이 생겨도 올리지 않는다.
    await recordWorkout(env.clock, 20)
    for (const trigger of ['open', 'visible', 'online', 'workout-end', 'timer'] as const) {
      expect(await autoSync(trigger, deps)).toEqual({ outcome: 'held' })
    }
    expect(await uploadNow(deps)).toBe('held')
    expect(store.uploads).toBe(1)
    expect((await store.snapshots()).map((s) => s.version)).toEqual([1])
  })

  it('규칙 3: 복원하면 옛 폰의 기록으로 바뀌고, 곧바로 다시 올리지 않는다', async () => {
    const { store, deps, env, code } = await oldPhoneUploaded()
    await setSetting(SETTING_KEYS.aiApiKey, 'sk-ant-this-phone')
    await recordWorkout(env.clock, 20)
    await connectWithCode(code, deps)

    const restored = await restoreFromCloud(null, deps)
    expect(restored).toMatchObject({ version: 1 })
    expect(await finishedWeights()).toEqual([100])
    // 이 폰에만 두는 설정은 그대로 남는다.
    expect(await getSyncCode()).toBe(code)
    expect((await db.settings.get(SETTING_KEYS.aiApiKey))?.value).toBe('sk-ant-this-phone')
    // 마지막 백업 시각은 그 스냅샷을 만든 때다.
    expect(await getLastBackupAt()).toBe(START)

    const state = await getSyncState()
    expect(state).toMatchObject({ hold: null, remote: null, version: 1, lastError: null })
    expect(state.hash).toBe(await backupHash(await exportBackup()))
    env.clock += LATER
    expect(await autoSync('visible', deps)).toEqual({ outcome: 'unchanged' })
    expect(await autoSync('workout-end', deps)).toEqual({ outcome: 'unchanged' })
    expect(store.uploads).toBe(1)

    // 그 뒤에 기록이 바뀌면 다음 버전으로 올린다.
    await recordWorkout(env.clock, 105)
    expect(await autoSync('workout-end', deps)).toEqual({ outcome: 'uploaded' })
    expect((await store.snapshots()).map((s) => s.version)).toEqual([2, 1])
  })

  it('덮어쓰기를 고르면 이 폰의 기록이 새 버전으로 올라가고 예전 것도 남는다', async () => {
    const { store, deps, env, code } = await oldPhoneUploaded()
    await recordWorkout(env.clock, 20)
    await connectWithCode(code, deps)

    expect(await overwriteCloud(deps)).toBe('uploaded')
    expect(await getSyncState()).toMatchObject({ hold: null, remote: null, version: 2 })
    expect((await store.snapshots()).map((s) => s.version)).toEqual([2, 1])
    // 그 뒤로는 보통처럼 자동으로 올린다.
    env.clock += LATER
    await recordWorkout(env.clock, 25)
    expect(await autoSync('visible', deps)).toEqual({ outcome: 'uploaded' })

    // 덮어쓴 뒤에도 예전 스냅샷을 골라 가져올 수 있다.
    expect((await listCloudSnapshots(deps)).map((s) => s.version)).toEqual([3, 2, 1])
    await restoreFromCloud(1, deps)
    expect(await finishedWeights()).toEqual([100])
  })

  it('예전 스냅샷을 복원하면 다음 자동 올리기 때 그 기록이 클라우드의 최신이 된다', async () => {
    const { store, deps, env } = setupServer()
    await recordWorkout(START - 1000, 100)
    await startCloudBackup(deps)
    env.clock += LATER
    await recordWorkout(env.clock, 110)
    await uploadNow(deps)

    await restoreFromCloud(1, deps)
    expect(await finishedWeights()).toEqual([100])
    expect(await getSyncState()).toMatchObject({ version: 2, hash: null })
    env.clock += LATER
    expect(await autoSync('visible', deps)).toEqual({ outcome: 'uploaded' })
    expect((await store.snapshots()).map((s) => s.version)).toEqual([3, 2, 1])
    expect(await autoSync('workout-end', deps)).toEqual({ outcome: 'unchanged' })
  })

  it('틀린 코드, 모양이 틀린 코드, 백업이 없는 서버에서는 연결하지 않는다', async () => {
    const { deps, seen } = await oldPhoneUploaded()
    const before = seen.length
    await expect(connectWithCode('ABCDE-12345', deps)).rejects.toMatchObject({ code: 'bad_code' })
    expect(seen).toHaveLength(before)
    await expect(connectWithCode('1'.repeat(25), deps)).rejects.toMatchObject({ code: 'forbidden' })
    expect(await getSyncCode()).toBeNull()

    const empty = setupServer()
    await expect(connectWithCode('1'.repeat(25), empty.deps)).rejects.toMatchObject({ code: 'not_claimed' })
    expect(await getSyncCode()).toBeNull()
  })

  it('주인은 있는데 아직 올린 것이 없으면 멈추지 않고 올린다', async () => {
    const { store, deps } = setupServer()
    const code = '2'.repeat(25)
    await deps.api.claim((await deriveKeys(code)).token)
    expect(await connectWithCode(code, deps)).toMatchObject({ hold: null, remote: null })
    expect(await autoSync('open', deps)).toEqual({ outcome: 'uploaded' })
    expect(store.uploads).toBe(1)
  })
})

describe('규칙 2: 다른 기기가 더 새 백업을 올렸을 때', () => {
  /** 이 폰이 v1을 올린 뒤, 같은 코드의 다른 기기가 v2(운동 55kg)를 올린다. */
  async function otherDeviceUploaded() {
    const server = setupServer()
    const { deps, env } = server
    await recordWorkout(START - 1000, 100)
    const code = await startCloudBackup(deps)
    const { token, key } = await deriveKeys(code)

    // 이 폰의 기록과 연결 상태를 떼어 두고, 빈 저장소에서 다른 기기인 척 v2를 올린다.
    const mine = await exportBackup()
    const link = await db.settings.bulkGet([SETTING_KEYS.syncCode, SETTING_KEYS.syncState])
    await freshPhone()
    await recordWorkout(START, 55)
    env.clock += 1000
    await deps.api.upload(token, await sealBackup(key, JSON.stringify(await exportBackup())), 1)

    // 다시 이 폰으로 돌아온다.
    await importBackup(mine)
    await db.settings.bulkPut(link.filter((row) => row !== undefined))
    expect(await getSyncState()).toMatchObject({ version: 1, hash: await backupHash(await exportBackup()) })
    return { ...server, code }
  }

  it('올리기를 멈추고 클라우드의 새 백업을 알려 준다', async () => {
    const { store, deps, env } = await otherDeviceUploaded()
    env.clock += LATER
    await recordWorkout(env.clock, 102.5)

    expect(await autoSync('workout-end', deps)).toEqual({ outcome: 'conflict' })
    const remote = { version: 2, createdAt: START + 1000 }
    expect(await getSyncState()).toMatchObject({ hold: 'conflict', version: 1, remote })
    expect(store.uploads).toBe(2)
    // 고를 때까지는 자동으로도 손으로도 올리지 않는다.
    env.clock += LATER
    expect(await autoSync('visible', deps)).toEqual({ outcome: 'held' })
    expect(await uploadNow(deps)).toBe('held')
    expect(store.uploads).toBe(2)
  })

  it('복원을 고르면 다른 기기의 기록으로 바뀐다', async () => {
    const { store, deps, env } = await otherDeviceUploaded()
    env.clock += LATER
    await recordWorkout(env.clock, 102.5)
    await autoSync('visible', deps)

    await restoreFromCloud(null, deps)
    expect(await finishedWeights()).toEqual([55])
    expect(await getSyncState()).toMatchObject({ hold: null, version: 2 })
    env.clock += LATER
    expect(await autoSync('visible', deps)).toEqual({ outcome: 'unchanged' })
    expect(store.uploads).toBe(2)
  })

  it('덮어쓰기를 고르면 이 폰의 기록이 최신이 된다', async () => {
    const { store, deps, env, code } = await otherDeviceUploaded()
    env.clock += LATER
    await recordWorkout(env.clock, 102.5)
    await autoSync('visible', deps)

    expect(await overwriteCloud(deps)).toBe('uploaded')
    expect(await getSyncState()).toMatchObject({ hold: null, version: 3 })
    const latest = JSON.parse(await openBackup((await deriveKeys(code)).key, (await store.read(3))!))
    expect(latest.data.sets.map((s: { weightKg: number }) => s.weightKg).sort()).toEqual([100, 102.5])
  })

  it('"지금 올리기"도 기록이 그대로일 때 서버의 버전이 달라졌으면 멈춘다', async () => {
    const { store, deps } = await otherDeviceUploaded()
    expect(await uploadNow(deps)).toBe('conflict')
    expect(await getSyncState()).toMatchObject({ hold: 'conflict', remote: { version: 2 } })
    expect(store.uploads).toBe(2)
  })
})

describe('끊기와 지우기', () => {
  it('연결을 끊으면 이 폰의 코드만 지워지고 클라우드의 백업은 남는다', async () => {
    const { store, deps } = setupServer()
    const code = await startCloudBackup(deps)
    await disconnectCloud()
    expect(await getSyncCode()).toBeNull()
    expect(await db.settings.get(SETTING_KEYS.syncState)).toBeUndefined()
    expect(await autoSync('open', deps)).toEqual({ outcome: 'off' })
    expect((await store.snapshots()).map((s) => s.version)).toEqual([1])
    // 같은 코드로 다시 연결할 수 있다.
    expect(await connectWithCode(code, deps)).toMatchObject({ hold: 'connected' })
  })

  it('클라우드 백업을 지우면 서버가 비고 이 폰의 연결도 끊긴다', async () => {
    const { store, deps } = setupServer()
    await recordWorkout(START, 100)
    await startCloudBackup(deps)
    await wipeCloud(deps)
    expect(await store.owner()).toBeNull()
    expect(await store.snapshots()).toEqual([])
    expect(await getSyncCode()).toBeNull()
    // 이 폰의 기록은 그대로다.
    expect(await finishedWeights()).toEqual([100])
    // 다시 시작하면 새 코드로 새 보관함이 된다.
    await startCloudBackup(deps)
    expect(await getSyncState()).toMatchObject({ version: 1 })
  })

  it('다른 기기가 클라우드 백업을 지웠으면 다시 만들지 않고 실패로 적는다', async () => {
    const { store, deps, env } = setupServer()
    await startCloudBackup(deps)
    await store.wipe()
    env.clock += LATER
    await recordWorkout(env.clock, 60)
    expect(await autoSync('visible', deps)).toEqual({ outcome: 'failed' })
    expect(await getSyncState()).toMatchObject({ lastError: { code: 'not_claimed' } })
    expect(await store.owner()).toBeNull()
    expect(store.uploads).toBe(1)
    // 지우기는 이미 지워져 있어도 연결을 끊고 끝난다.
    await wipeCloud(deps)
    expect(await getSyncCode()).toBeNull()
  })
})

describe('규칙 5: 복구 코드와 토큰이 새지 않는다', () => {
  it('주소, 백업 파일, 오류 글에 들어가지 않는다', async () => {
    const { deps, seen, env } = setupServer()
    await recordWorkout(START, 100)
    const code = await startCloudBackup(deps)
    const { token } = await deriveKeys(code)
    await listCloudSnapshots(deps)
    await restoreFromCloud(1, deps)

    expect(seen.length).toBeGreaterThan(4)
    for (const request of seen) {
      expect(request.url).not.toContain(token)
      expect(request.url).not.toContain(code)
      expect(request.url.startsWith('/api/sync/')).toBe(true)
    }
    // 토큰은 Authorization 머리줄로만 간다.
    expect(seen.filter((r) => r.auth !== null).every((r) => r.auth === `Bearer ${token}`)).toBe(true)

    const exported = JSON.stringify(await exportBackup())
    expect(exported).not.toContain(code)
    expect(exported).not.toContain(token)
    expect(exported).not.toContain(SETTING_KEYS.syncCode)
    expect(exported).not.toContain(SETTING_KEYS.syncState)

    env.reachable = false
    const failures = [
      await uploadNow(deps).catch((e: unknown) => e),
      await restoreFromCloud(null, deps).catch((e: unknown) => e),
      await connectWithCode(code, deps).catch((e: unknown) => e),
    ]
    for (const error of failures) {
      expect(error).toBeInstanceOf(SyncError)
      const text = `${(error as Error).message} ${(error as Error).stack} ${JSON.stringify(error)}`
      expect(text).not.toContain(code)
      expect(text).not.toContain(token)
    }
    expect(JSON.stringify(await getSyncState())).not.toContain(token)
  })
})
