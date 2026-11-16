import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import {
  BACKUP_REMIND_AFTER_DAYS,
  BACKUP_SNOOZE_DAYS,
  daysSinceBackup,
  shouldRemindBackup,
  snoozeBackupReminder,
} from './backupReminder'
import { backupFileName } from './backup'
import { saveBackupFile } from './saveFile'
import { getBackupSnoozeUntil, getLastBackupAt } from './settings'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const DAY = 86_400_000
const NOW = new Date(2026, 10, 16, 15, 0).getTime()

describe('백업 알림 규칙', () => {
  const base = { now: NOW, lastBackupAt: null, snoozeUntil: null, finishedWorkouts: 3 }

  it('끝낸 운동이 있는데 백업한 적이 없으면 알린다', () => {
    expect(shouldRemindBackup(base)).toBe(true)
    expect(shouldRemindBackup({ ...base, finishedWorkouts: 1 })).toBe(true)
  })

  it('끝낸 운동이 없으면 알리지 않는다', () => {
    expect(shouldRemindBackup({ ...base, finishedWorkouts: 0 })).toBe(false)
    expect(shouldRemindBackup({ ...base, finishedWorkouts: 0, lastBackupAt: NOW - 100 * DAY })).toBe(false)
  })

  it('마지막 백업이 14일보다 오래됐을 때만 알린다', () => {
    expect(BACKUP_REMIND_AFTER_DAYS).toBe(14)
    expect(shouldRemindBackup({ ...base, lastBackupAt: NOW })).toBe(false)
    expect(shouldRemindBackup({ ...base, lastBackupAt: NOW - 13 * DAY })).toBe(false)
    expect(shouldRemindBackup({ ...base, lastBackupAt: NOW - 14 * DAY })).toBe(false)
    expect(shouldRemindBackup({ ...base, lastBackupAt: NOW - 14 * DAY - 1 })).toBe(true)
    expect(shouldRemindBackup({ ...base, lastBackupAt: NOW - 60 * DAY })).toBe(true)
  })

  it('백업 시각이 앞날이어도(시계가 바뀐 경우) 알리지 않는다', () => {
    expect(shouldRemindBackup({ ...base, lastBackupAt: NOW + DAY })).toBe(false)
  })

  it('"나중에"로 미뤄 둔 동안에는 알리지 않고, 그 시각이 되면 다시 알린다', () => {
    const old = NOW - 30 * DAY
    expect(shouldRemindBackup({ ...base, lastBackupAt: old, snoozeUntil: NOW + 1 })).toBe(false)
    expect(shouldRemindBackup({ ...base, snoozeUntil: NOW + 7 * DAY })).toBe(false)
    expect(shouldRemindBackup({ ...base, lastBackupAt: old, snoozeUntil: NOW })).toBe(true)
    expect(shouldRemindBackup({ ...base, lastBackupAt: old, snoozeUntil: NOW - DAY })).toBe(true)
  })

  it('미루는 기간이 지났어도 그사이 백업했으면 알리지 않는다', () => {
    expect(shouldRemindBackup({ ...base, lastBackupAt: NOW - 2 * DAY, snoozeUntil: NOW - DAY })).toBe(false)
  })

  it('지난 날수는 내림으로 센다', () => {
    expect(daysSinceBackup(NOW, NOW - 14 * DAY - 1)).toBe(14)
    expect(daysSinceBackup(NOW, NOW - 21 * DAY - 5 * 3_600_000)).toBe(21)
    expect(daysSinceBackup(NOW, NOW + DAY)).toBe(0)
  })
})

describe('나중에', () => {
  it('7일 뒤까지 미룬다', async () => {
    expect(await getBackupSnoozeUntil()).toBeNull()

    await snoozeBackupReminder(NOW)

    const until = await getBackupSnoozeUntil()
    expect(BACKUP_SNOOZE_DAYS).toBe(7)
    expect(until).toBe(NOW + 7 * DAY)
    const input = { lastBackupAt: null, snoozeUntil: until, finishedWorkouts: 1 }
    expect(shouldRemindBackup({ ...input, now: NOW + 6 * DAY })).toBe(false)
    expect(shouldRemindBackup({ ...input, now: NOW + 7 * DAY })).toBe(true)
  })
})

describe('백업 파일 저장', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** 브라우저의 내려받기 링크를 흉내 낸다. 눌린 링크의 파일 이름을 모은다. */
  function stubDownload(): string[] {
    const clicked: string[] = []
    vi.stubGlobal('document', {
      createElement: () => {
        const a = { href: '', download: '', click: () => clicked.push(a.download), remove: () => undefined }
        return a
      },
      body: { appendChild: () => undefined },
    })
    return clicked
  }

  it('파일을 내려받고 마지막 백업 시각을 적는다', async () => {
    const clicked = stubDownload()
    const now = new Date(NOW)

    const name = await saveBackupFile('download', now)

    expect(name).toBe(backupFileName(now))
    expect(clicked).toEqual([name])
    expect(await getLastBackupAt()).toBe(NOW)
    // 방금 백업했으니 알림은 사라진다.
    expect(shouldRemindBackup({ now: NOW, lastBackupAt: NOW, snoozeUntil: null, finishedWorkouts: 5 })).toBe(false)
  })

  it('파일을 만들지 못하면 백업 시각을 바꾸지 않는다', async () => {
    vi.stubGlobal('document', {
      createElement: () => {
        throw new Error('막힘')
      },
    })

    await expect(saveBackupFile('download', new Date(NOW))).rejects.toThrow('막힘')
    expect(await getLastBackupAt()).toBeNull()
  })
})
