import { PageHeader } from '../components/PageHeader'
import { useGoBack } from '../lib/useGoBack'

/** 종목 상세. 기록 추이 그래프, 개인 기록, 지난 기록, 목표 횟수와 증량 단위. (2단계, 만드는 중) */
export default function ExerciseDetail() {
  const goBack = useGoBack('/stats')
  return (
    <>
      <PageHeader title="종목" onBack={goBack} />
      <main className="flex-1 px-4 pt-4">
        <p className="text-muted">준비 중입니다.</p>
      </main>
    </>
  )
}
