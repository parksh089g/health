import { PageHeader } from '../components/PageHeader'
import { useGoBack } from '../lib/useGoBack'

/** 루틴에 넣을 종목 고르기. (2단계, 만드는 중) */
export default function RoutineExercisePicker() {
  const goBack = useGoBack('/routines')
  return (
    <>
      <PageHeader title="종목 선택" onBack={goBack} />
      <main className="flex-1 px-4 pt-4">
        <p className="text-muted">준비 중입니다.</p>
      </main>
    </>
  )
}
