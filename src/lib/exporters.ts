import JSZip from 'jszip'
import type { Stage } from 'konva/lib/Stage'
import type { BomLine } from './bom'

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`
  a.rel = 'noopener'
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadDataUrl(filename: string, dataUrl: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`
  a.rel = 'noopener'
  a.click()
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.click()
  URL.revokeObjectURL(url)
}

async function zipPngEntries(entries: { filename: string; dataUrl: string }[]): Promise<Blob> {
  const zip = new JSZip()
  for (const { filename, dataUrl } of entries) {
    const blob = await fetch(dataUrl).then((r) => r.blob())
    const safeName = filename.replace(/^.*[/\\]/, '') || 'image.png'
    zip.file(safeName, blob)
  }
  return zip.generateAsync({ type: 'blob' })
}

/** One PNG → single file; multiple → one `.zip` with the same leaf names as separate downloads. */
export async function downloadPngBatch(
  zipBasename: string,
  entries: { filename: string; dataUrl: string }[],
): Promise<void> {
  if (entries.length === 0) return
  if (entries.length === 1) {
    const e = entries[0]!
    downloadDataUrl(e.filename, e.dataUrl)
    return
  }
  const blob = await zipPngEntries(entries)
  const zipName = zipBasename.endsWith('.zip') ? zipBasename : `${zipBasename}.zip`
  downloadBlob(zipName, blob)
}

export function stageToPngDataUrl(
  stage: Stage,
  options?: { pixelRatio?: number },
) {
  return stage.toDataURL({
    pixelRatio: options?.pixelRatio ?? 2,
    mimeType: 'image/png',
  })
}

export function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'drawing'
}

export function downloadText(
  filename: string,
  content: string,
  mime = 'text/csv',
) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.click()
  URL.revokeObjectURL(url)
}

function escCsv(f: string): string {
  if (f.includes('"') || f.includes(',') || f.includes('\n')) {
    return `"${f.replace(/"/g, '""')}"`
  }
  return f
}

export function formatBomCsv(
  lines: Pick<
    BomLine,
    'name' | 'qty' | 'unitPrice' | 'lineTotal' | 'room' | 'floor' | 'sectionPath'
  >[],
): string {
  const header = [
    'name',
    'qty',
    'unitPrice',
    'lineTotal',
    'room',
    'floor',
    'sectionPath',
  ].join(',')
  const body = lines.map((l) =>
    [
      escCsv(l.name),
      String(l.qty),
      String(l.unitPrice),
      String(l.lineTotal),
      escCsv(l.room),
      escCsv(l.floor),
      escCsv(l.sectionPath),
    ].join(','),
  )
  return [header, ...body].join('\n')
}
