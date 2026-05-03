import { useMemo } from 'react'
import { buildBom } from '../lib/bom'
import { downloadJson, downloadText, formatBomCsv, slug } from '../lib/exporters'
import type { PlanstudioProject } from '../types/project'

type BomPanelProps = {
  project: PlanstudioProject
  open: boolean
  onClose: () => void
}

export function BomPanel({ project, open, onClose }: BomPanelProps) {
  const built = useMemo(() => buildBom(project), [project])
  if (!open) return null

  return (
    <div className="modal-backdrop" role="dialog" aria-modal aria-labelledby="bom-title">
      <div className="modal">
        <div className="modal-header">
          <h2 id="bom-title">Shopping list / BOM</h2>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="btn-row" style={{ marginBottom: '1rem' }}>
          <button
            type="button"
            className="btn secondary"
            onClick={() => downloadJson(`${slug(project.name)}-bom`, built.bom)}
          >
            Download BOM (JSON)
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() =>
              downloadText(
                `${slug(project.name)}-bom.csv`,
                formatBomCsv(built.lines),
              )
            }
          >
            Download BOM (CSV)
          </button>
        </div>
        {built.sections.map((sec) => (
          <div key={sec.title} className="bom-sec" style={{ marginBottom: '1.25rem' }}>
            <h3 className="bom-sec-title">{sec.title}</h3>
            <p className="bom-sub">
              Section total: <strong>€{sec.subtotalBilled.toFixed(2)}</strong>
            </p>
            {sec.subsections.map((sub) => (
              <div key={sub.title} className="bom-subsec">
                <h4 className="bom-subtitle">{sub.title}</h4>
                <BomTable lines={sub.lines} subtotalBilled={sub.subtotalBilled} />
              </div>
            ))}
          </div>
        ))}
        <div className="bom-totals" style={{ marginTop: '1.25rem' }}>
          <p>
            <strong>Grand total:</strong> €{built.grandTotalBilled.toFixed(2)}
          </p>
        </div>
      </div>
    </div>
  )
}

type BomTableProps = {
  lines: import('../lib/bom').BomLine[]
  subtotalBilled: number
}

function BomTable({ lines, subtotalBilled }: BomTableProps) {
  if (!lines.length) return <p className="muted small">(empty)</p>
  return (
    <div>
      <table className="bom-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Unit €</th>
            <th>Line €</th>
            <th>Room / note</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td>{l.name}</td>
              <td>{l.unitPrice.toFixed(2)}</td>
              <td>{l.lineTotal.toFixed(2)}</td>
              <td>
                {l.room}
                {l.note ? <span className="muted small"> · {l.note}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="bom-sub muted small" style={{ margin: '0.4rem 0' }}>
        Subsection total: €{subtotalBilled.toFixed(2)}
      </p>
    </div>
  )
}
