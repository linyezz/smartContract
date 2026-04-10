import * as pdfjsLib from 'pdfjs-dist'
import { readFile } from '@tauri-apps/plugin-fs'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

function uint8ArrayToArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function normalizeBinaryPayload(payload) {
  if (!payload) {
    return null
  }

  if (payload instanceof Uint8Array) {
    return new Uint8Array(payload)
  }

  if (Array.isArray(payload)) {
    return new Uint8Array(payload)
  }

  if (typeof payload === 'object' && typeof payload.length === 'number') {
    return new Uint8Array(Array.from(payload))
  }

  return null
}

function cloneBinaryPayload(payload) {
  const normalized = normalizeBinaryPayload(payload)
  return normalized ? new Uint8Array(normalized) : null
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildReplacementRules(hitList = []) {
  return [...hitList]
    .filter((item) => item?.original && item?.masked && item.original !== item.masked)
    .sort((a, b) => b.original.length - a.original.length)
    .map((item) => ({
      ...item,
      pattern: new RegExp(escapeRegExp(item.original), 'g')
    }))
}

function applyMaskToText(value, replacementRules) {
  let nextValue = value
  let changed = false

  replacementRules.forEach((rule) => {
    if (rule.pattern.test(nextValue)) {
      nextValue = nextValue.replace(rule.pattern, rule.masked)
      changed = true
    }
    rule.pattern.lastIndex = 0
  })

  return {
    text: nextValue,
    changed
  }
}

export async function readPdfBytes(fileSource) {
  const binaryPayload = cloneBinaryPayload(fileSource)
  if (binaryPayload) {
    return binaryPayload
  }
  const bytes = await readFile(fileSource)
  return new Uint8Array(bytes)
}

export async function loadPdfDocument(fileSource) {
  const bytes = await readPdfBytes(fileSource)
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) })
  const pdf = await loadingTask.promise
  return {
    pdf,
    bytes: new Uint8Array(bytes)
  }
}

export async function extractPdfText(bytes) {
  const loadingTask = pdfjsLib.getDocument({ data: await readPdfBytes(bytes) })
  const pdf = await loadingTask.promise
  const pageTexts = []
  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex)
    const content = await page.getTextContent()
    pageTexts.push(content.items.map((item) => item.str).join(' '))
  }
  return pageTexts.join('\n\n')
}

function drawMaskedTextLayer({
  context,
  viewport,
  textContent,
  replacementRules
}) {
  const { Util } = pdfjsLib

  textContent.items.forEach((item) => {
    const { text: maskedText, changed } = applyMaskToText(item.str, replacementRules)
    if (!changed) {
      return
    }

    const transform = Util.transform(viewport.transform, item.transform)
    const rawHeight = item.height ? item.height * viewport.scale : 0
    const fontHeight = rawHeight || Math.hypot(transform[2], transform[3]) || Math.hypot(transform[0], transform[1]) || 12
    const textWidth = Math.max(item.width * viewport.scale, maskedText.length * Math.max(fontHeight * 0.55, 8))
    const x = transform[4]
    const y = transform[5]
    const boxTop = y - fontHeight
    const paddingX = Math.max(fontHeight * 0.18, 2)
    const paddingY = Math.max(fontHeight * 0.12, 2)
    const style = textContent.styles?.[item.fontName] || {}
    const fontFamily = style.fontFamily || 'sans-serif'

    context.save()
    context.fillStyle = '#ffffff'
    context.fillRect(
      x - paddingX,
      boxTop - paddingY,
      textWidth + paddingX * 2,
      fontHeight + paddingY * 2
    )
    context.font = `${fontHeight}px ${fontFamily}`
    context.fillStyle = '#111827'
    context.textBaseline = 'alphabetic'
    context.fillText(maskedText, x, y)
    context.restore()
  })
}

async function renderPdfPage(page, scale) {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)

  await page.render({
    canvasContext: context,
    viewport
  }).promise

  return {
    canvas,
    context,
    viewport
  }
}

export async function renderPdfPreviewPages(fileSource, hitList = [], options = {}) {
  const scale = options.scale || 1.35
  const { pdf } = await loadPdfDocument(fileSource)
  const replacementRules = buildReplacementRules(hitList)
  const pages = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const original = await renderPdfPage(page, scale)
    const maskedCanvas = document.createElement('canvas')
    maskedCanvas.width = original.canvas.width
    maskedCanvas.height = original.canvas.height
    const maskedContext = maskedCanvas.getContext('2d')
    maskedContext.drawImage(original.canvas, 0, 0)

    if (replacementRules.length) {
      const textContent = await page.getTextContent()
      drawMaskedTextLayer({
        context: maskedContext,
        viewport: original.viewport,
        textContent,
        replacementRules
      })
    }

    pages.push({
      pageNumber,
      width: original.canvas.width,
      height: original.canvas.height,
      originalDataUrl: original.canvas.toDataURL('image/png'),
      maskedDataUrl: maskedCanvas.toDataURL('image/png')
    })
  }

  return pages
}

export async function buildStyledMaskedPdfBytes(fileSource, hitList = []) {
  const pages = await renderPdfPreviewPages(fileSource, hitList, { scale: 2 })
  const [{ jsPDF }] = await Promise.all([
    import('jspdf')
  ])

  const firstPage = pages[0]
  const pdf = new jsPDF({
    orientation: firstPage.width >= firstPage.height ? 'l' : 'p',
    unit: 'pt',
    format: [firstPage.width, firstPage.height]
  })

  pages.forEach((page, index) => {
    if (index > 0) {
      pdf.addPage([page.width, page.height], page.width >= page.height ? 'l' : 'p')
    }
    pdf.addImage(page.maskedDataUrl, 'PNG', 0, 0, page.width, page.height)
  })

  return new Uint8Array(pdf.output('arraybuffer'))
}

export function isPdfSource(extension) {
  return String(extension || '').toLowerCase() === 'pdf'
}

export { uint8ArrayToArrayBuffer }
