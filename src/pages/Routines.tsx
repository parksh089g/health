import { PageHeader } from '../components/PageHeader'
import { useGoBack } from '../lib/useGoBack'

/** 루틴 목록. (2단계, 만드는 중) */
export default function Routines() {
  const goBack = useGoBack('/')
  return (
    <>
      <PageHeader title="루틴" onBack={goBack} />
      <main className="flex-1 px-4 pt-4">
        <p className="text-muted">준비 중입니다.</p>
      </main>
    </>
  )
}
