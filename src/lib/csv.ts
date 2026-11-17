import { db } from '../db'
import { bodyPartLabel, equipmentLabel } from './exercises'
import { formatTime, toDateKey } from './format'

/**
 * 기록을 CSV(엑셀, 구글 시트에서 여는 표)로 내보낸다. 끝난 운동의 세트 하나가 한 줄이다.
 * 횟수 종목은 횟수 칸에, 시간 종목은 시간(초) 칸에 값이 들어간다. 맨몸 종목의 중량은 추가 무게다.
 * 유산소 종목은 시간(초) 칸과 맨 뒤의 거리(km), 층, 강도 칸에 값이 들어간다(새 칸은 예전 파일과 칸 순서가 어긋나지 않게 뒤에 붙였다).
 * 복원용이 아니라 보거나 옮겨 쓰기 위한 것이므로, 복원은 JSON 백업으로 한다.
 */

export const CSV_COLUMNS = [
  '날짜',
  '시작',
  '종목',
  '부위',
  '기구',
  '세트',
  '웜업',
  '중량(kg)',
  '횟수',
  '시간(초)',
  'RPE',
  '운동 메모',
  '거리(km)',
  '층',
  '강도',
] as const

/** 쉼표, 따옴표, 줄바꿈이 있으면 따옴표로 감싼다. 수식으로 읽히는 글자로 시작하면 앞에 '를 붙인다. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvLine(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',')
}

/** 끝난 운동의 모든 세트를 CSV 글자로 만든다. 오래된 운동부터, 운동 안에서는 종목과 세트 순서대로. */
export async function exportCsv(): Promise<string> {
  const [workouts, wes, sets, exercises] = await Promise.all([
    db.workouts.toArray(),
    db.workoutExercises.toArray(),
    db.sets.toArray(),
    db.exercises.toArray(),
  ])
  const exerciseById = new Map(exercises.map((e) => [e.id, e]))
  const wesByWorkout = new Map<string, typeof wes>()
  for (const we of wes) {
    const list = wesByWorkout.get(we.workoutId)
    if (list) list.push(we)
    else wesByWorkout.set(we.workoutId, [we])
  }
  const setsByWe = new Map<string, typeof sets>()
  for (const s of sets) {
    const list = setsByWe.get(s.workoutExerciseId)
    if (list) list.push(s)
    else setsByWe.set(s.workoutExerciseId, [s])
  }

  const lines = [csvLine([...CSV_COLUMNS])]
  const finished = workouts.filter((w) => w.endedAt !== null).sort((a, b) => a.startedAt - b.startedAt)
  for (const w of finished) {
    const own = (wesByWorkout.get(w.id) ?? []).sort((a, b) => a.order - b.order)
    for (const we of own) {
      const ex = exerciseById.get(we.exerciseId)
      const done = (setsByWe.get(we.id) ?? []).filter((s) => s.isDone).sort((a, b) => a.order - b.order)
      let n = 0
      for (const s of done) {
        lines.push(
          csvLine([
            toDateKey(w.startedAt),
            formatTime(w.startedAt),
            ex?.name ?? '지워진 종목',
            ex ? bodyPartLabel(ex.bodyPart) : '',
            ex ? equipmentLabel(ex.equipment) : '',
            s.isWarmup ? 'W' : ++n,
            s.isWarmup ? '예' : '',
            s.weightKg,
            s.reps,
            // 시간 종목(플랭크 등)의 버틴 시간, 유산소 종목의 운동 시간. 횟수 종목은 비워 둔다.
            s.durationSec,
            s.rpe,
            w.memo,
            // 유산소 종목의 거리, 오른 층수, 기구의 강도. 그 밖의 종목은 비워 둔다.
            s.distanceKm,
            s.floors,
            s.level,
          ]),
        )
      }
    }
  }
  // 엑셀이 한글을 제대로 읽도록 맨 앞에 BOM을 붙이고, 줄은 CRLF로 끝낸다.
  return `﻿${lines.join('\r\n')}\r\n`
}

export function csvFileName(now: Date = new Date()): string {
  return `health-records-${toDateKey(now)}.csv`
}
