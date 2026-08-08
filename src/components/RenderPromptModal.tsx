import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  buildFloorRenderPrompt,
  DEFAULT_RENDER_PROMPT_OPTIONS,
  RENDER_PROMPT_LIGHTING,
  RENDER_PROMPT_STYLES,
  RENDER_PROMPT_TARGETS,
  RENDER_PROMPT_VIEWS,
  renderPromptBaseName,
  type RenderPromptLighting,
  type RenderPromptOptions,
  type RenderPromptStyle,
  type RenderPromptTarget,
  type RenderPromptView,
} from '../lib/renderPrompt'
import { renderFloorPlanImagePngDataUrl } from '../lib/renderFloorPlanImage'
import { downloadBlob, slug } from '../lib/exporters'
import { useProjectStore } from '../store/projectStore'

type RenderPromptModalProps = {
  onClose: () => void
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(header ?? '')?.[1] ?? 'image/png'
  const bin = atob(b64 ?? '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/**
 * Builds the render brief plus the reference plan image for one floor. The image carries
 * the layout, so the text can stay descriptive rather than reciting coordinates.
 */
export function RenderPromptModal({ onClose }: RenderPromptModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const project = useProjectStore((s) => s.project)
  const activeFloorId = useProjectStore((s) => s.activeFloorId)

  const floors = useMemo(
    () =>
      [...project.floors].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
      ),
    [project.floors],
  )

  const [floorId, setFloorId] = useState(
    () => floors.find((f) => f.id === activeFloorId)?.id ?? floors[0]?.id ?? '',
  )
  const [options, setOptions] = useState<RenderPromptOptions>(
    DEFAULT_RENDER_PROMPT_OPTIONS,
  )
  const [toast, setToast] = useState<string | null>(null)
  /** Manual edits survive until an option changes or the user discards them. */
  const [override, setOverride] = useState<string | null>(null)

  const floor = floors.find((f) => f.id === floorId) ?? floors[0]

  const planImage = useMemo(
    () =>
      floor
        ? renderFloorPlanImagePngDataUrl(floor, project.editorSettings, {
            showDevices: options.includeElectrical,
            projectName: project.name,
          })
        : null,
    [floor, project.editorSettings, project.name, options.includeElectrical],
  )

  const generated = useMemo(
    () =>
      floor ? buildFloorRenderPrompt(project, floor, options, planImage != null) : '',
    [project, floor, options, planImage],
  )
  const text = override ?? generated

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (!el.open) {
      try {
        el.showModal()
      } catch {
        /* Already open — nothing to do. */
      }
    }
    return () => {
      if (el.open) el.close()
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 1900)
    return () => window.clearTimeout(t)
  }, [toast])

  const patch = (p: Partial<RenderPromptOptions>) => {
    setOverride(null)
    setOptions((prev) => ({ ...prev, ...p }))
  }

  const onCopyText = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setToast('Prompt copied')
    } catch {
      const el = document.getElementById('render-prompt-text') as HTMLTextAreaElement | null
      el?.select()
      setToast('Press ⌘C / Ctrl+C to copy')
    }
  }

  const onCopyImage = async () => {
    if (!planImage) return
    try {
      const item = new ClipboardItem({ 'image/png': dataUrlToBlob(planImage) })
      await navigator.clipboard.write([item])
      setToast('Plan image copied')
    } catch {
      /* Firefox / insecure contexts have no image clipboard — downloading always works. */
      setToast('Clipboard blocked — use Download plan PNG')
    }
  }

  const onDownloadText = () => {
    if (!floor) return
    downloadBlob(
      `${slug(renderPromptBaseName(project, floor))}-prompt.md`,
      new Blob([text], { type: 'text/markdown;charset=utf-8' }),
    )
  }

  const onDownloadImage = () => {
    if (!floor || !planImage) return
    downloadBlob(
      `${slug(renderPromptBaseName(project, floor))}-plan.png`,
      dataUrlToBlob(planImage),
    )
  }

  const targetHint = RENDER_PROMPT_TARGETS.find((t) => t.id === options.target)?.hint

  const dialog = (
    <dialog
      ref={dialogRef}
      className="render-prompt-dialog"
      aria-labelledby="render-prompt-title"
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="render-prompt-inner panel-block">
        <h2 id="render-prompt-title" className="side-heading">
          3D render prompt
        </h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Attach the plan image <em>and</em> paste the prompt. The drawing carries the
          layout — room shapes, wall thickness and finish, real door swings and window
          openings — so the text stays descriptive instead of reciting coordinates.
        </p>

        <div className="field-row">
          <label className="field">
            <span>Floor</span>
            <select
              value={floorId}
              onChange={(e) => {
                setOverride(null)
                setFloorId(e.target.value)
              }}
            >
              {floors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Written for</span>
            <select
              value={options.target}
              onChange={(e) => patch({ target: e.target.value as RenderPromptTarget })}
            >
              {RENDER_PROMPT_TARGETS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {targetHint ? (
          <p className="muted small" style={{ marginTop: -4 }}>
            {targetHint}
          </p>
        ) : null}

        <div className="field-row">
          <label className="field">
            <span>View</span>
            <select
              value={options.view}
              onChange={(e) => patch({ view: e.target.value as RenderPromptView })}
            >
              {RENDER_PROMPT_VIEWS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Style</span>
            <select
              value={options.style}
              onChange={(e) => patch({ style: e.target.value as RenderPromptStyle })}
            >
              {RENDER_PROMPT_STYLES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Lighting</span>
            <select
              value={options.lighting}
              onChange={(e) =>
                patch({ lighting: e.target.value as RenderPromptLighting })
              }
            >
              {RENDER_PROMPT_LIGHTING.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field check">
          <input
            type="checkbox"
            checked={options.includeElectrical}
            onChange={(e) => patch({ includeElectrical: e.target.checked })}
          />
          <span>Include lights, switches, outlets and cameras from the electrical plan</span>
        </label>
        <label className="field">
          <span>Additional direction (optional)</span>
          <input
            value={options.extraNotes}
            placeholder="e.g. Scandinavian palette, oak floors, matte black fittings"
            onChange={(e) => patch({ extraNotes: e.target.value })}
          />
        </label>

        <div className="render-prompt-split">
          <div className="render-prompt-col">
            <span className="render-prompt-col-label">
              Reference plan (attach this image)
            </span>
            {planImage ? (
              <img
                className="render-prompt-plan"
                src={planImage}
                alt={`Floor plan of ${floor?.label ?? 'floor'} to attach to the prompt`}
              />
            ) : (
              <p className="muted small">Plan image unavailable in this browser.</p>
            )}
            <div className="btn-row" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn secondary"
                onClick={() => void onCopyImage()}
                disabled={!planImage}
              >
                Copy image
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={onDownloadImage}
                disabled={!planImage}
              >
                Download plan PNG
              </button>
            </div>
          </div>
          <div className="render-prompt-col">
            <span className="render-prompt-col-label">
              Prompt{override != null ? ' (edited)' : ''}
            </span>
            <textarea
              id="render-prompt-text"
              className="render-prompt-text"
              value={text}
              spellCheck={false}
              onChange={(e) => setOverride(e.target.value)}
            />
            <div className="btn-row" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn primary" onClick={() => void onCopyText()}>
                Copy prompt
              </button>
              <button type="button" className="btn secondary" onClick={onDownloadText}>
                Download .md
              </button>
              {override != null ? (
                <button type="button" className="btn ghost" onClick={() => setOverride(null)}>
                  Discard edits
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="btn-row" style={{ marginTop: '0.75rem', alignItems: 'center' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
          {toast ? (
            <span className="muted small" role="status">
              {toast}
            </span>
          ) : null}
        </div>
      </div>
    </dialog>
  )

  return createPortal(dialog, document.body)
}
