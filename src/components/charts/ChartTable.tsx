interface ChartTableProps {
  caption: string
  headers: [string, string]
  rows: [string, string][]
}

/** 그래프와 같은 내용을 표로. 화면에는 보이지 않고 화면 읽기 프로그램이 읽는다. */
export function ChartTable({ caption, headers, rows }: ChartTableProps) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{headers[0]}</th>
          <th scope="col">{headers[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([a, b], i) => (
          <tr key={i}>
            <th scope="row">{a}</th>
            <td>{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
