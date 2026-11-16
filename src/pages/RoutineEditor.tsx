import { PageHeader } from '../components/PageHeader'
import { useGoBack } from '../lib/useGoBack'

/** 루틴 만들기와 고치기. 주소의 id가 new면 새 루틴. (2단계, 만드는 중) */
export default function RoutineEditor() {
  const goBack = useGoBack('/routines')
  return (
    <>
      <PageHeader title="루틴" onBack={goBack} />
      <main className="flex-1 px-4 pt-4">
        <p className="text-muted">준비 중입니다.</p>
      </main>
    </>
  )
}
