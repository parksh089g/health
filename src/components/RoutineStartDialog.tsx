import { useNavigate } from 'react-router-dom'
import type { StartRoutineNotice } from '../lib/useStartRoutine'
import { Dialog } from './Dialog'

/** 루틴으로 시작하지 못했을 때의 안내 창. 진행 중인 운동이 있으면 그 운동을 열 수 있다. */
export function RoutineStartDialog({ notice, onClose }: { notice: StartRoutineNotice | null; onClose: () => void }) {
  const navigate = useNavigate()

  if (notice?.kind === 'error') {
    return (
      <Dialog open title="운동을 시작하지 못했습니다" onClose={onClose} actions={[{ label: '닫기', onClick: onClose }]}>
        {notice.message}
      </Dialog>
    )
  }

  return (
    <Dialog
      open={notice !== null}
      title="진행 중인 운동이 있습니다"
      onClose={onClose}
      actions={[
        {
          label: '진행 중인 운동 열기',
          tone: 'primary',
          onClick: () => {
            if (notice) navigate(`/workout/${notice.workoutId}`)
          },
        },
        { label: '닫기', onClick: onClose },
      ]}
    >
      그 운동을 마치거나 취소한 뒤에 루틴으로 새 운동을 시작할 수 있습니다.
    </Dialog>
  )
}
