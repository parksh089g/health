import { describe, expect, it } from 'vitest'
import { formatBytes, formatSnapshotDay, formatWhen, syncErrorText } from './text'

describe('클라우드 백업의 글', () => {
  it('실패한 이유마다 안내가 있고, 모르는 이유도 글이 나온다', () => {
    expect(syncErrorText('network')).toContain('인터넷 연결')
    expect(syncErrorText('forbidden')).toContain('복구 코드가 맞지 않습니다')
    expect(syncErrorText('already_claimed')).toContain('이미 클라우드 백업이 있습니다')
    expect(syncErrorText('bad_backup', '이 앱의 백업 파일이 아닙니다.')).toBe('이 앱의 백업 파일이 아닙니다.')
    expect(syncErrorText('bad_backup')).toContain('읽지 못했습니다')
    expect(syncErrorText('server_error')).toContain('잠시 뒤 다시')
    expect(syncErrorText('unknown')).toContain('잠시 뒤 다시')
  })

  it('크기와 때를 짧게 적는다', () => {
    expect(formatBytes(10)).toBe('1KB')
    expect(formatBytes(2_048)).toBe('2KB')
    expect(formatBytes(1_500_000)).toBe('1.4MB')
    const ts = new Date(2026, 10, 17, 21, 41).getTime()
    expect(formatWhen(ts)).toBe('2026년 11월 17일 오후 9:41')
    expect(formatSnapshotDay(ts, ts)).toBe('11월 17일 (화) 오후 9:41')
    expect(formatSnapshotDay(ts, new Date(2027, 0, 2).getTime())).toBe('2026년 11월 17일 (화) 오후 9:41')
  })
})
