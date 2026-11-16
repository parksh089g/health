import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../components/Dialog'
import { db } from '../db'
import { backupFileName, exportBackup, importBackup, parseBackup, type BackupFile } from '../lib/backup'
import { csvFileName, exportCsv } from '../lib/csv'
import { ensureSeedExercises } from '../lib/exercises'
import { formatFullDate } from '../lib/format'
import {
  REST_OPTIONS,
  SETTING_KEYS,
  getLastBackupAt,
  getRecommendEnabled,
  getRestSeconds,
  setSetting,
} from '../lib/settings'

const BACKUP_MIME = 'application/json'
const CSV_MIME = 'text/csv;charset=utf-8'

function downloadFile(text: string, name: string, type: string = BACKUP_MIME): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 이 기기에서 파일 공유(공유 시트)를 쓸 수 있는지 */
function canShareFiles(): boolean {
  try {
    const probe = new File(['{}'], 'probe.json', { type: BACKUP_MIME })
    return typeof navigator.share === 'function' && navigator.canShare?.({ files: [probe] }) === true
  } catch {
    return false
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

interface Notice {
  tone: 'ok' | 'error'
  text: string
}

export default function Settings() {
  const restSeconds = useLiveQuery(getRestSeconds, [])
  const recommendOn = useLiveQuery(getRecommendEnabled, [])
  const lastBackupAt = useLiveQuery(getLastBackupAt, [])
  const counts = useLiveQuery(async () => {
    const workouts = await db.workouts.filter((w) => w.endedAt !== null).count()
    const sets = await db.sets.filter((s) => s.isDone).count()
    const exercises = await db.exercises.count()
    return { workouts, sets, exercises }
  }, [])

  const fileInput = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [csvNotice, setCsvNotice] = useState<Notice | null>(null)
  const [pending, setPending] = useState<BackupFile | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [shareable] = useState(canShareFiles)
  const [standalone] = useState(isStandalone)

  useEffect(() => {
    let alive = true
    navigator.storage
      ?.persisted?.()
      .then((v) => {
        if (alive) setPersisted(v)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const save = async (via: 'download' | 'share') => {
    setNotice(null)
    try {
      const now = new Date()
      const text = JSON.stringify(await exportBackup(now), null, 2)
      const name = backupFileName(now)
      if (via === 'share') {
        await navigator.share({ files: [new File([text], name, { type: BACKUP_MIME })], title: '헬스 기록 백업' })
      } else {
        downloadFile(text, name)
      }
      await setSetting(SETTING_KEYS.lastBackupAt, now.getTime())
      setNotice({ tone: 'ok', text: `백업 파일(${name})을 내보냈습니다. 폰 밖의 안전한 곳에도 보관해 주세요.` })
    } catch (e) {
      // 공유 창을 그냥 닫은 경우는 오류가 아니다.
      if (e instanceof DOMException && e.name === 'AbortError') return
      setNotice({ tone: 'error', text: '백업 파일을 만들지 못했습니다. 다시 시도해 주세요.' })
    }
  }

  const saveCsv = async () => {
    setCsvNotice(null)
    try {
      const name = csvFileName()
      downloadFile(await exportCsv(), name, CSV_MIME)
      setCsvNotice({ tone: 'ok', text: `${name} 파일을 받았습니다.` })
    } catch {
      setCsvNotice({ tone: 'error', text: 'CSV 파일을 만들지 못했습니다. 다시 시도해 주세요.' })
    }
  }

  const pickFile = async (file: File | undefined) => {
    setNotice(null)
    if (!file) return
    try {
      setPending(parseBackup(await file.text()))
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : '백업 파일을 읽지 못했습니다.' })
    }
  }

  const restore = async () => {
    if (!pending) return
    const backup = pending
    setPending(null)
    try {
      await importBackup(backup)
      await ensureSeedExercises()
      setNotice({ tone: 'ok', text: '백업에서 기록을 복원했습니다.' })
    } catch {
      setNotice({ tone: 'error', text: '복원하지 못했습니다. 기존 기록은 그대로 있습니다.' })
    }
  }

  const pendingExportedAt = pending ? Date.parse(pending.exportedAt) : NaN

  return (
    <div className="px-4 pt-6">
      <h1 className="text-2xl font-bold text-ink">설정</h1>

      <section className="mt-5 rounded-2xl border border-line bg-surface p-4" aria-label="휴식 시간">
        <h2 className="font-bold text-ink">휴식 시간 기본값</h2>
        <p className="mt-1 text-sm text-muted">세트를 완료하면 이 시간으로 휴식 타이머가 시작됩니다.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {REST_OPTIONS.map((sec) => (
            <button
              key={sec}
              type="button"
              aria-pressed={restSeconds === sec}
              onClick={() => void setSetting(SETTING_KEYS.restSeconds, sec)}
              className={`h-12 rounded-xl text-base font-semibold active:opacity-70 ${
                restSeconds === sec ? 'bg-accent text-on-accent' : 'bg-surface-2 text-muted'
              }`}
            >
              {sec}초
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-surface p-4" aria-label="다음 무게 추천">
        <button
          type="button"
          role="switch"
          aria-checked={recommendOn !== false}
          aria-label="다음 무게 추천"
          aria-describedby="recommend-desc"
          disabled={recommendOn === undefined}
          onClick={() => void setSetting(SETTING_KEYS.recommendEnabled, !recommendOn)}
          className="flex min-h-12 w-full items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-bold text-ink">다음 무게 추천</span>
            <span id="recommend-desc" className="mt-1 block break-keep text-sm leading-relaxed text-muted">
              운동 중에 지난 기록을 보고 다음 무게와 횟수를 제안합니다. 목표 횟수를 모든 세트에서 채웠으면 무게를
              올리고(상체 2.5kg, 하체 5kg), 못 채웠으면 같은 무게를 권합니다. 적용을 눌렀을 때만 바뀝니다.
            </span>
          </span>
          {/* 읽어 오는 동안에는 기본값(켜짐)으로 보여 준다. */}
          <Toggle on={recommendOn !== false} />
        </button>
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-surface p-4" aria-label="백업">
        <h2 className="font-bold text-ink">백업</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          기록은 이 폰의 브라우저에만 저장됩니다. 브라우저의 사이트 데이터를 지우면 기록도 함께 사라지니, 가끔 백업
          파일을 받아 두세요.
        </p>
        <p className="mt-3 text-[15px] text-ink">
          마지막 백업:{' '}
          <strong>
            {lastBackupAt === undefined ? '' : lastBackupAt === null ? '아직 없음' : formatFullDate(lastBackupAt)}
          </strong>
        </p>

        <div className="mt-3 grid gap-2">
          <button
            type="button"
            onClick={() => void save('download')}
            className="h-12 rounded-xl bg-accent font-bold text-on-accent active:opacity-80"
          >
            백업 파일 저장
          </button>
          {shareable && (
            <button
              type="button"
              onClick={() => void save('share')}
              className="h-12 rounded-xl bg-surface-2 font-semibold text-ink active:opacity-70"
            >
              공유로 내보내기
            </button>
          )}
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="h-12 rounded-xl bg-surface-2 font-semibold text-ink active:opacity-70"
          >
            백업에서 복원
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="백업 파일 선택"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              void pickFile(file)
            }}
          />
        </div>

        {notice && (
          <p
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`mt-3 text-sm leading-relaxed ${notice.tone === 'error' ? 'text-danger' : 'text-good'}`}
          >
            {notice.text}
          </p>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-surface p-4" aria-label="표로 내보내기">
        <h2 className="font-bold text-ink">표로 내보내기</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          끝난 운동의 세트를 한 줄씩 담은 CSV 파일입니다. 엑셀이나 구글 시트에서 열어 볼 수 있습니다. 복원에는 쓸 수
          없으니 옮길 때는 위의 백업 파일을 쓰세요.
        </p>
        <button
          type="button"
          onClick={() => void saveCsv()}
          className="mt-3 h-12 w-full rounded-xl bg-surface-2 font-semibold text-ink active:opacity-70"
        >
          기록 CSV 내보내기
        </button>
        {csvNotice && (
          <p
            role={csvNotice.tone === 'error' ? 'alert' : 'status'}
            className={`mt-3 text-sm leading-relaxed ${csvNotice.tone === 'error' ? 'text-danger' : 'text-good'}`}
          >
            {csvNotice.text}
          </p>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-surface p-4" aria-label="이 기기의 기록">
        <h2 className="font-bold text-ink">이 기기의 기록</h2>
        {counts && (
          <p className="mt-1 text-[15px] tabular-nums text-ink">
            운동 {counts.workouts}회 · 세트 {counts.sets}개 · 종목 {counts.exercises}개
          </p>
        )}
        {persisted !== null && (
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {persisted
              ? '브라우저가 저장 공간이 부족해도 이 기록을 지우지 않도록 설정되어 있습니다.'
              : '브라우저가 저장 공간이 부족하면 기록을 지울 수 있는 상태입니다. 백업을 받아 두세요.'}
          </p>
        )}
        {!standalone && (
          <p className="mt-2 text-sm leading-relaxed text-muted">
            홈 화면에 추가해서 쓰는 것을 권합니다. 앱처럼 열리고, 브라우저가 기록을 정리해 버릴 가능성도 줄어듭니다.
            아이폰은 Safari의 공유 버튼에서, 안드로이드는 Chrome 메뉴에서 “홈 화면에 추가”를 누르면 됩니다.
          </p>
        )}
      </section>

      <Dialog
        open={pending !== null}
        title="백업에서 복원할까요?"
        onClose={() => setPending(null)}
        actions={[
          { label: '지우고 복원', tone: 'danger', onClick: () => void restore() },
          { label: '취소', onClick: () => setPending(null) },
        ]}
      >
        {pending && (
          <>
            {Number.isFinite(pendingExportedAt) && <>{formatFullDate(pendingExportedAt)}에 만든 백업입니다. </>}
            운동 {pending.data.workouts.filter((w) => w.endedAt !== null).length}회가 들어 있습니다. 지금 이 폰에 있는
            기록은 모두 지워지고 백업 내용으로 바뀝니다.
          </>
        )}
      </Dialog>
    </div>
  )
}

/** 켜고 끄는 스위치 모양. 누르는 곳은 바깥의 버튼이다. */
function Toggle({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative h-8 w-14 shrink-0 rounded-full border transition-colors ${
        on ? 'border-accent bg-accent' : 'border-line bg-surface-2'
      }`}
    >
      <span
        className={`absolute top-[3px] size-6 rounded-full shadow-sm transition-[left] ${
          on ? 'left-[27px] bg-on-accent' : 'left-[3px] bg-muted'
        }`}
      />
    </span>
  )
}
