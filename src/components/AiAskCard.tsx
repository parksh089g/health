import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { getAiEnabled } from '../lib/settings'
import { ChevronRightIcon, SparkleIcon } from './icons'

/** 통계 화면에서 "내 기록에 물어보기"로 가는 카드. AI 추천을 켰을 때만 보인다. */
export function AiAskCard() {
  const enabled = useLiveQuery(getAiEnabled, [])
  if (!enabled) return null
  return (
    <Link
      to="/ask"
      className="mt-3 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 active:bg-surface-2"
    >
      <SparkleIcon className="size-5 shrink-0 text-accent" />
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-ink">내 기록에 물어보기</span>
        <span className="block break-keep text-sm leading-snug text-muted">
          "지난달 벤치 최고 무게는?"처럼 묻거나, 체성분까지 보고 운동 계획을 세워 달라고 해 보세요.
        </span>
      </span>
      <ChevronRightIcon className="size-5 shrink-0 text-muted" />
    </Link>
  )
}
