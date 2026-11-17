import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SnapshotMeta } from '../../worker/wire'
import { createApi, type Hello } from '../lib/sync/api'
import { CODE_LENGTH, formatCode } from '../lib/sync/code'
import {
  connectWithCode,
  disconnectCloud,
  listCloudSnapshots,
  overwriteCloud,
  restoreFromCloud,
  startCloudBackup,
  uploadNow,
  wipeCloud,
} from '../lib/sync/engine'
import { SyncError } from '../lib/sync/errors'
import { getSyncCode, getSyncState, type SyncState } from '../lib/sync/state'
import { formatBytes, formatSnapshotDay, formatWhen, syncErrorText } from '../lib/sync/text'
import { Dialog, type DialogAction } from './Dialog'

interface Notice {
  tone: 'ok' | 'error'
  text: string
}

/** 지금 하고 있는 일. 하는 동안에는 다른 버튼을 막는다. */
type Busy = 'start' | 'connect' | 'upload' | 'list' | 'restore' | 'overwrite' | 'disconnect' | 'wipe'

/** 확인 창으로 물어볼 일 */
type Confirm =
  | { kind: 'restore'; snapshot: SnapshotMeta }
  | { kind: 'overwrite' }
  | { kind: 'disconnect' }
  /** armed: 한 번 눌러서, 한 번 더 누르면 지워지는 상태 */
  | { kind: 'wipe'; armed: boolean }

const PRIMARY = 'h-12 rounded-xl bg-accent font-bold text-on-accent active:opacity-80 disabled:opacity-40'
/** 지금 상태를 알리는 글 상자(쓸 수 없음, 이미 백업이 있음). 바탕색은 쓰는 곳에서 더한다. */
const INFO = 'mt-3 break-keep rounded-xl px-3 py-2.5 text-sm leading-relaxed text-ink'
const SECONDARY = 'h-12 rounded-xl bg-surface-2 font-semibold text-ink active:opacity-70 disabled:opacity-40'

function errorNotice(e: unknown): Notice {
  return {
    tone: 'error',
    text: e instanceof SyncError ? syncErrorText(e.code, e.detail) : syncErrorText('unknown'),
  }
}

/**
 * 이 주소에 클라우드 백업 서버가 있는지 알아본다. 알아보는 동안은 undefined. 인터넷이 끊겨 있으면 묻지 않는다.
 * 두 번째 값은 다시 알아보게 하는 함수다(보관함의 주인이 바뀌는 일을 한 뒤에 부른다).
 */
function useHello(): [Hello | undefined, () => void] {
  const [hello, setHello] = useState<Hello | undefined>(() =>
    navigator.onLine === false ? { kind: 'offline' } : undefined,
  )
  // 가장 나중에 물은 것의 답만 쓴다.
  const asked = useRef(0)
  const [ask] = useState(() => () => {
    const mine = ++asked.current
    if (navigator.onLine === false) return
    void createApi()
      .hello()
      .then((result) => {
        if (asked.current === mine) setHello(result)
      })
  })
  useEffect(() => {
    const onOffline = () => {
      asked.current += 1
      setHello({ kind: 'offline' })
    }
    ask()
    window.addEventListener('online', ask)
    window.addEventListener('offline', onOffline)
    return () => {
      asked.current += 1
      window.removeEventListener('online', ask)
      window.removeEventListener('offline', onOffline)
    }
  }, [ask])
  return [
    hello,
    () => {
      setHello(navigator.onLine === false ? { kind: 'offline' } : undefined)
      ask()
    },
  ]
}

/**
 * 설정 화면의 클라우드 백업 칸. (5단계)
 * 꺼져 있으면 시작하기와 복구 코드로 연결하기, 켜져 있으면 올린 때와 실패한 이유, 지금 올리기, 클라우드에서 가져오기,
 * 복구 코드 보기, 연결 끊기, 클라우드 백업 삭제가 있다. 하는 일은 src/lib/sync/engine.ts에 있다.
 */
export function SyncSettings() {
  const link = useLiveQuery(async () => {
    const [code, state] = await Promise.all([getSyncCode(), getSyncState()])
    return { code, state }
  }, [])
  const [hello, askHello] = useHello()
  const [busy, setBusy] = useState<Busy | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  /** 복구 코드를 화면에 보여 주는지 */
  const [revealed, setRevealed] = useState(false)
  /** 방금 시작해서 코드를 적어 두라고 알리는 중인지 */
  const [fresh, setFresh] = useState(false)
  /** 복구 코드를 적는 칸. 닫혀 있으면 null */
  const [draft, setDraft] = useState<string | null>(null)
  /** 가져올 수 있는 스냅샷 목록. 닫혀 있으면 null */
  const [snapshots, setSnapshots] = useState<SnapshotMeta[] | null>(null)

  /** 일을 하나 하고 결과를 알린다. 하는 동안에는 버튼을 막는다. */
  const run = async (what: Busy, job: () => Promise<Notice | null>) => {
    if (busy !== null) return
    setBusy(what)
    setNotice(null)
    try {
      setNotice(await job())
    } catch (e) {
      setNotice(errorNotice(e))
    } finally {
      setBusy(null)
      // 시작, 연결 끊기, 삭제는 보관함에 주인이 있는지를 바꾸거나 다르게 보이게 한다.
      if (what === 'start' || what === 'disconnect' || what === 'wipe') askHello()
    }
  }

  const start = () =>
    run('start', async () => {
      // 서버에 등록은 됐는데 올리기에서 실패했어도 코드는 폰에 남으므로, 그때도 코드를 보여 준다.
      setRevealed(true)
      setFresh(true)
      try {
        await startCloudBackup()
      } catch (e) {
        if ((await getSyncCode()) === null) {
          setRevealed(false)
          setFresh(false)
        }
        throw e
      }
      return null
    })

  const connect = () =>
    run('connect', async () => {
      const state = await connectWithCode(draft ?? '')
      setDraft(null)
      if (state.remote === null) {
        // 클라우드가 비어 있으면 덮어쓸 것이 없으니 바로 이 폰의 기록을 올린다.
        await uploadNow()
        return { tone: 'ok', text: '연결했습니다. 클라우드에 백업이 없어서 이 폰의 기록을 올렸습니다.' }
      }
      // 클라우드에 백업이 있으면 바로 복원할지 묻는다. 닫아도 고를 때까지는 올리지 않는다.
      setConfirm({ kind: 'restore', snapshot: state.remote })
      return null
    })

  const upload = () =>
    run('upload', async () => {
      const outcome = await uploadNow()
      if (outcome === 'uploaded') return { tone: 'ok', text: '지금 기록을 클라우드에 올렸습니다.' }
      if (outcome === 'unchanged') return { tone: 'ok', text: '클라우드의 백업이 이미 지금 기록과 같습니다.' }
      if (outcome === 'conflict') return { tone: 'error', text: '클라우드에 더 새로운 백업이 있어 올리지 않았습니다.' }
      return null
    })

  const openSnapshots = () =>
    run('list', async () => {
      const list = await listCloudSnapshots()
      setSnapshots(list)
      return list.length === 0 ? { tone: 'error', text: '클라우드에 아직 백업이 없습니다.' } : null
    })

  const restore = (snapshot: SnapshotMeta) =>
    run('restore', async () => {
      const restored = await restoreFromCloud(snapshot.version)
      setSnapshots(null)
      return { tone: 'ok', text: `클라우드의 백업(${formatWhen(restored.createdAt)})으로 복원했습니다.` }
    })

  const overwrite = () =>
    run('overwrite', async () => {
      const outcome = await overwriteCloud()
      return outcome === 'uploaded'
        ? { tone: 'ok', text: '이 폰의 기록을 클라우드에 올렸습니다. 앞으로 자동으로 올립니다.' }
        : { tone: 'error', text: '그 사이에 클라우드의 백업이 또 바뀌었습니다. 다시 골라 주세요.' }
    })

  const disconnect = () =>
    run('disconnect', async () => {
      await disconnectCloud()
      setRevealed(false)
      setFresh(false)
      setSnapshots(null)
      return { tone: 'ok', text: '이 폰의 연결을 끊었습니다. 클라우드의 백업은 그대로 있습니다.' }
    })

  const wipe = () =>
    run('wipe', async () => {
      await wipeCloud()
      setRevealed(false)
      setFresh(false)
      setSnapshots(null)
      return { tone: 'ok', text: '클라우드 백업을 모두 삭제했습니다. 이 폰의 기록은 그대로 있습니다.' }
    })

  const copyCode = async () => {
    const code = link?.code
    if (!code) return
    try {
      await navigator.clipboard.writeText(formatCode(code))
      setNotice({ tone: 'ok', text: '복구 코드를 복사했습니다. 폰 밖의 안전한 곳에 붙여 넣어 두세요.' })
    } catch {
      setRevealed(true)
      setNotice({ tone: 'error', text: '복사하지 못했습니다. 코드를 보고 직접 적어 주세요.' })
    }
  }

  const close = () => setConfirm(null)
  const confirmed = (job: () => void) => () => {
    close()
    job()
  }
  const cancel: DialogAction = { label: '취소', onClick: close }
  const remote = link?.state.remote ?? null

  /** 서버에 닿을 수 있어 버튼을 눌러도 되는지 */
  const usable = hello?.kind === 'ok' && busy === null

  return (
    // 다른 칸처럼 region으로 두지 않고 group으로 둔다. 이름에 "백업"이 들어 있어서, region이면 아래의 "백업" 칸을
    // 이름으로 찾는 곳(e2e/smoke.js)이 이 칸을 먼저 집는다.
    // 같은 까닭으로, 누르지 않아도 보이는 안내에는 role="status"를 달지 않는다(눌러서 생긴 결과에만 단다).
    <section role="group" className="mt-4 rounded-2xl border border-line bg-surface p-4" aria-label="클라우드 백업">
      <h2 className="font-bold text-ink">클라우드 백업</h2>

      {link !== undefined && link.code === null && (
        <>
          <p className="mt-1 break-keep text-sm leading-relaxed text-muted">
            기록 전체를 이 앱을 올려 둔 내 Cloudflare에 자동으로 올려 둡니다. 폰을 잃어버리거나 브라우저의 사이트
            데이터가 지워져도 새 폰에서 되찾을 수 있습니다.
          </p>
          <p className="mt-2 break-keep text-sm leading-relaxed text-muted">
            올리기 전에 폰에서 복구 코드로 암호화하므로 서버에는 암호문만 남습니다. 복구 코드는 백업을 되찾는 하나뿐인
            열쇠라서, 잃어버리면 클라우드의 백업은 다시 열 수 없습니다.
          </p>

          {hello?.kind === 'unavailable' && (
            <p className={`${INFO} bg-surface-2`}>
              이 주소에서는 클라우드 백업을 쓸 수 없습니다. Cloudflare에 배포한 주소로 열었을 때만 쓸 수 있습니다.
            </p>
          )}
          {hello?.kind === 'offline' && (
            <p className={`${INFO} bg-surface-2`}>
              인터넷에 연결되어 있을 때 시작할 수 있습니다.
            </p>
          )}
          {hello?.kind === 'ok' && hello.claimed && (
            <p className={`${INFO} bg-accent-soft`}>
              이 주소에는 이미 클라우드 백업이 있습니다. 쓰던 폰의 설정 화면에 있는 복구 코드로 연결해 주세요.
            </p>
          )}

          {draft === null ? (
            <div className="mt-3 grid gap-2">
              {!(hello?.kind === 'ok' && hello.claimed) && (
                <button type="button" disabled={!usable} onClick={() => void start()} className={PRIMARY}>
                  {busy === 'start' ? '시작하는 중' : '클라우드 백업 시작'}
                </button>
              )}
              <button
                type="button"
                disabled={!usable}
                onClick={() => {
                  setNotice(null)
                  setDraft('')
                }}
                className={hello?.kind === 'ok' && hello.claimed ? PRIMARY : SECONDARY}
              >
                복구 코드로 연결
              </button>
            </div>
          ) : (
            <form
              className="mt-3 grid gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void connect()
              }}
            >
              <label className="grid gap-1.5 text-sm text-muted">
                쓰던 폰의 복구 코드
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`글자와 숫자 ${CODE_LENGTH}자`}
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="복구 코드"
                  className="h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3 font-mono text-[15px] uppercase text-ink outline-none placeholder:font-sans placeholder:normal-case placeholder:text-muted focus:border-accent"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={busy !== null} onClick={() => setDraft(null)} className={SECONDARY}>
                  취소
                </button>
                <button type="submit" disabled={!usable || draft.trim() === ''} className={PRIMARY}>
                  {busy === 'connect' ? '연결하는 중' : '연결'}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {link !== undefined && link.code !== null && (
        <>
          <p className="mt-1 break-keep text-sm leading-relaxed text-muted">
            앱을 열 때와 운동을 끝냈을 때, 바뀐 기록이 있으면 암호화해서 자동으로 올립니다.
          </p>
          <p className="mt-3 text-[15px] text-ink">
            <span className="block text-sm text-muted">이 폰에서 마지막으로 올린 때</span>{' '}
            <strong className="block tabular-nums">
              {link.state.lastUploadAt === null ? '아직 없음' : formatWhen(link.state.lastUploadAt)}
            </strong>
          </p>
          {link.state.lastError && (
            <p role="alert" className="mt-2 break-keep text-sm leading-relaxed text-danger">
              {formatWhen(link.state.lastError.at)}에 올리지 못했습니다. {syncErrorText(link.state.lastError.code)}
            </p>
          )}
          {hello?.kind === 'offline' && (
            <p className="mt-2 break-keep text-sm leading-relaxed text-muted">
              지금은 인터넷에 연결되어 있지 않습니다. 연결되면 다시 올립니다.
            </p>
          )}
          {hello?.kind === 'unavailable' && (
            <p className="mt-2 break-keep text-sm leading-relaxed text-danger">
              이 주소에서 클라우드 백업 서버를 찾지 못했습니다.
            </p>
          )}

          {link.state.hold !== null && (
            <HoldBanner
              state={link.state}
              disabled={!usable}
              onRestore={() => {
                if (remote) setConfirm({ kind: 'restore', snapshot: remote })
                else void openSnapshots()
              }}
              onOverwrite={() => setConfirm({ kind: 'overwrite' })}
            />
          )}

          <div className="mt-3 grid gap-2">
            <button
              type="button"
              disabled={!usable || link.state.hold !== null}
              onClick={() => void upload()}
              className={PRIMARY}
            >
              {busy === 'upload' ? '올리는 중' : '지금 올리기'}
            </button>
            <button
              type="button"
              disabled={!usable}
              aria-expanded={snapshots !== null}
              onClick={() => (snapshots === null ? void openSnapshots() : setSnapshots(null))}
              className={SECONDARY}
            >
              {busy === 'list' ? '불러오는 중' : busy === 'restore' ? '복원하는 중' : '클라우드에서 가져오기'}
            </button>
          </div>

          {snapshots !== null && snapshots.length > 0 && (
            <SnapshotList
              snapshots={snapshots}
              disabled={!usable}
              onPick={(snapshot) => setConfirm({ kind: 'restore', snapshot })}
            />
          )}

          <div className="mt-4 border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-ink">복구 코드</h3>
            {fresh && (
              <p role="status" className="mt-1 break-keep text-sm font-semibold leading-relaxed text-ink">
                복구 코드를 만들었습니다. 이 코드를 지금 폰 밖(종이, 비밀번호 관리 앱 등)에 적어 두세요.
              </p>
            )}
            <CodeBox code={link.code} revealed={revealed} />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={revealed}
                onClick={() => setRevealed(!revealed)}
                className="h-11 rounded-xl bg-surface-2 text-sm font-semibold text-ink active:opacity-70"
              >
                {revealed ? '코드 숨기기' : '코드 보기'}
              </button>
              <button
                type="button"
                onClick={() => void copyCode()}
                className="h-11 rounded-xl bg-surface-2 text-sm font-semibold text-ink active:opacity-70"
              >
                코드 복사
              </button>
            </div>
            <p className="mt-2 break-keep text-xs leading-relaxed text-muted">
              새 폰에서는 설정의 “복구 코드로 연결”에 이 코드를 적으면 백업을 되찾습니다. 코드를 잃어버리면 클라우드의
              백업을 열 수 없고, 코드를 아는 사람은 백업을 볼 수 있으니 남에게 보여 주지 마세요.
            </p>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirm({ kind: 'disconnect' })}
              className="h-11 rounded-xl text-sm font-semibold text-ink active:bg-surface-2 disabled:opacity-40"
            >
              이 폰 연결 끊기
            </button>
            <button
              type="button"
              disabled={!usable}
              onClick={() => setConfirm({ kind: 'wipe', armed: false })}
              className="h-11 rounded-xl text-sm font-semibold text-danger active:bg-surface-2 disabled:opacity-40"
            >
              클라우드 백업 삭제
            </button>
          </div>
        </>
      )}

      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`mt-3 break-keep text-sm leading-relaxed ${notice.tone === 'error' ? 'text-danger' : 'text-good'}`}
        >
          {notice.text}
        </p>
      )}

      <Dialog
        open={confirm?.kind === 'restore'}
        title="클라우드의 백업으로 복원할까요?"
        onClose={close}
        actions={[
          {
            label: '지우고 복원',
            tone: 'danger',
            onClick: confirmed(() => {
              if (confirm?.kind === 'restore') void restore(confirm.snapshot)
            }),
          },
          cancel,
        ]}
      >
        {confirm?.kind === 'restore' && (
          <p className="break-keep">
            {formatWhen(confirm.snapshot.createdAt)}에 올린 백업입니다. 지금 이 폰에 있는 기록은 모두 지워지고 이
            백업의 내용으로 바뀝니다.
          </p>
        )}
      </Dialog>

      <Dialog
        open={confirm?.kind === 'overwrite'}
        title="클라우드의 백업을 덮어쓸까요?"
        onClose={close}
        actions={[{ label: '이 폰의 기록으로 덮어쓰기', tone: 'danger', onClick: confirmed(() => void overwrite()) }, cancel]}
      >
        <p className="break-keep">
          이 폰의 기록이 클라우드의 가장 새 백업이 됩니다.
          {remote && <> 지금 클라우드에 있는 백업({formatWhen(remote.createdAt)})은 예전 백업으로 밀려납니다.</>} 예전
          백업은 새것부터 10개까지만 남습니다.
        </p>
      </Dialog>

      <Dialog
        open={confirm?.kind === 'disconnect'}
        title="이 폰의 연결을 끊을까요?"
        onClose={close}
        actions={[{ label: '연결 끊기', tone: 'danger', onClick: confirmed(() => void disconnect()) }, cancel]}
      >
        <p className="break-keep">
          이 폰에서 복구 코드를 지우고 자동 올리기를 멈춥니다. 클라우드의 백업은 그대로 남아 있어서 복구 코드로 다시
          연결할 수 있습니다. 복구 코드를 폰 밖에 적어 두었는지 먼저 확인해 주세요.
        </p>
      </Dialog>

      <Dialog
        open={confirm?.kind === 'wipe'}
        title="클라우드 백업을 모두 삭제할까요?"
        onClose={close}
        actions={[
          confirm?.kind === 'wipe' && confirm.armed
            ? { label: '한 번 더 누르면 삭제됩니다', tone: 'danger', onClick: confirmed(() => void wipe()) }
            : { label: '모두 삭제', tone: 'danger', onClick: () => setConfirm({ kind: 'wipe', armed: true }) },
          cancel,
        ]}
      >
        <p className="break-keep">
          클라우드에 올린 백업이 모두 지워지고 되돌릴 수 없습니다. 지금 복구 코드도 더는 쓸 수 없게 됩니다. 이 폰의
          기록은 그대로 남습니다.
        </p>
      </Dialog>
    </section>
  )
}

/** 올리기를 멈추고 있을 때: 왜 멈췄는지와 두 가지 선택(복원, 덮어쓰기). */
function HoldBanner({
  state,
  disabled,
  onRestore,
  onOverwrite,
}: {
  state: SyncState
  disabled: boolean
  onRestore: () => void
  onOverwrite: () => void
}) {
  const when = state.remote ? formatWhen(state.remote.createdAt) : null
  let text: ReactNode
  if (state.hold === 'conflict') {
    text = (
      <>
        클라우드에 다른 기기가 올린 더 새로운 백업이 있습니다{when && <> ({when})</>}. 어느 쪽을 남길지 정할 때까지
        이 폰의 기록은 올리지 않습니다.
      </>
    )
  } else {
    text = (
      <>
        클라우드에 이미 백업이 있습니다{when && <> ({when})</>}. 그 백업으로 복원할지, 이 폰의 기록으로 덮어쓸지 정할
        때까지 이 폰의 기록은 올리지 않습니다.
      </>
    )
  }
  return (
    <div role="group" aria-label="클라우드의 백업과 이 폰의 기록 중 고르기" className="mt-3 rounded-xl bg-accent-soft p-3">
      <p className="break-keep text-sm leading-relaxed text-ink">{text}</p>
      <div className="mt-2 grid gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onRestore}
          className="h-11 rounded-xl bg-accent text-[15px] font-bold text-on-accent active:opacity-80 disabled:opacity-40"
        >
          클라우드의 백업으로 복원
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onOverwrite}
          className="h-11 rounded-xl bg-surface text-[15px] font-semibold text-ink active:opacity-70 disabled:opacity-40"
        >
          이 폰의 기록으로 덮어쓰기
        </button>
      </div>
    </div>
  )
}

/** 클라우드에 남아 있는 스냅샷. 누르면 그 백업으로 복원할지 묻는다. */
function SnapshotList({
  snapshots,
  disabled,
  onPick,
}: {
  snapshots: SnapshotMeta[]
  disabled: boolean
  onPick: (snapshot: SnapshotMeta) => void
}) {
  return (
    <div className="mt-3">
      <p className="break-keep text-sm leading-relaxed text-muted">
        가져올 백업을 골라 주세요. 새것부터 10개까지 남아 있습니다.
      </p>
      <ul className="mt-2 grid gap-1.5" aria-label="클라우드의 백업 목록">
        {snapshots.map((snapshot, i) => (
          <li key={snapshot.version}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(snapshot)}
              className="flex min-h-12 w-full items-center gap-2 rounded-xl bg-surface-2 px-3 text-left active:opacity-70 disabled:opacity-40"
            >
              <span className="min-w-0 flex-1 text-[15px] tabular-nums text-ink">
                {formatSnapshotDay(snapshot.createdAt)}
              </span>
              {i === 0 && (
                <span className="shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent">
                  최신
                </span>
              )}
              <span className="shrink-0 text-xs tabular-nums text-muted">{formatBytes(snapshot.size)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 복구 코드를 다섯 자씩 끊어 보여 준다. 숨기면 점으로 가린다. */
function CodeBox({ code, revealed }: { code: string; revealed: boolean }) {
  const groups = formatCode(code).split('-')
  return (
    <p
      role="group"
      aria-label="복구 코드"
      className="mt-2 flex flex-wrap justify-center gap-x-2 gap-y-1 rounded-xl bg-surface-2 px-2 py-3 font-mono text-[15px] font-semibold text-ink"
    >
      {groups.map((group, i) => (
        <span key={i} aria-hidden={!revealed}>
          {revealed ? group : '•'.repeat(group.length)}
        </span>
      ))}
      {!revealed && <span className="sr-only">가려져 있음</span>}
    </p>
  )
}
