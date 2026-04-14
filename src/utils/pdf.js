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

function normalizeTextChunk(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function rebuildPageText(content) {
  const items = content.items
    .map((item) => {
      const x = item.transform?.[4] || 0
      const y = item.transform?.[5] || 0
      const width = item.width || 0
      return {
        text: normalizeTextChunk(item.str),
        raw: item.str || '',
        x,
        y,
        width
      }
    })
    .filter((item) => item.text)
    .sort((a, b) => {
      if (Math.abs(b.y - a.y) > 2) {
        return b.y - a.y
      }
      return a.x - b.x
    })

  const lines = []
  const lineTolerance = 2.5

  items.forEach((item) => {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= lineTolerance)
    if (line) {
      line.items.push(item)
      line.y = (line.y + item.y) / 2
    } else {
      lines.push({
        y: item.y,
        items: [item]
      })
    }
  })

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const chunks = line.items.sort((a, b) => a.x - b.x)
      let cursor = 0
      let text = ''

      chunks.forEach((chunk, index) => {
        if (index > 0) {
          const gap = chunk.x - cursor
          if (gap > 20) {
            text += '  '
          } else if (gap > 4) {
            text += ' '
          }
        }
        text += chunk.raw || chunk.text
        cursor = chunk.x + chunk.width
      })

      return text.replace(/[ \t]+$/g, '').trim()
    })
    .filter(Boolean)
    .join('\n')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeSearchText(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .trim()
}

function buildFlexiblePattern(value) {
  const normalizedValue = normalizeSearchText(value)
  if (!normalizedValue) {
    return null
  }

  return new RegExp(escapeRegExp(normalizedValue), 'g')
}

function buildReplacementRules(hitList = []) {
  return [...hitList]
    .filter((item) => item?.original && item?.masked && item.original !== item.masked)
    .sort((a, b) => b.original.length - a.original.length)
    .map((item) => ({
      ...item,
      pattern: new RegExp(escapeRegExp(item.original), 'g'),
      visualPattern: buildFlexiblePattern(item.original)
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
  const { text } = await extractPdfTextWithDiagnostics(bytes)
  return text
}

function buildPdfTextDiagnostics(pageSummaries) {
  const totalPages = pageSummaries.length
  const pagesWithText = pageSummaries.filter((page) => page.hasUsableText).length
  const pagesWithoutText = totalPages - pagesWithText
  const totalNormalizedChars = pageSummaries.reduce((sum, page) => sum + page.normalizedCharCount, 0)
  const blankPageRatio = totalPages ? pagesWithoutText / totalPages : 0

  let kind = 'text'
  if (totalPages > 0 && pagesWithText === 0) {
    kind = 'image-only'
  } else if (pagesWithoutText > 0) {
    kind = 'mixed'
  }

  const warnings = []
  if (kind === 'image-only') {
    warnings.push('该 PDF 疑似为扫描件或图片型 PDF，当前版本无法直接识别其中的文字内容。')
  } else if (kind === 'mixed') {
    warnings.push('该 PDF 只有部分页面包含文字层，未带文字层的扫描页仍需要 OCR 才能识别。')
  }

  return {
    kind,
    totalPages,
    pagesWithText,
    pagesWithoutText,
    totalNormalizedChars,
    blankPageRatio,
    hasUsableText: pagesWithText > 0,
    ocrRecommended: kind !== 'text',
    warnings
  }
}

export async function extractPdfTextWithDiagnostics(bytes) {
  const loadingTask = pdfjsLib.getDocument({ data: await readPdfBytes(bytes) })
  const pdf = await loadingTask.promise
  const pageTexts = []
  const pageSummaries = []
  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex)
    const content = await page.getTextContent()
    const pageText = rebuildPageText(content)
    const normalizedCharCount = normalizeSearchText(pageText).length
    const itemCount = content.items?.length || 0
    const hasUsableText = normalizedCharCount >= 8 || itemCount >= 3

    pageTexts.push(pageText)
    pageSummaries.push({
      pageNumber: pageIndex,
      text: pageText,
      itemCount,
      textLength: pageText.length,
      normalizedCharCount,
      hasUsableText
    })
  }

  return {
    text: pageTexts.join('\n\n'),
    diagnostics: buildPdfTextDiagnostics(pageSummaries),
    pages: pageSummaries
  }
}

function buildViewportChunks(textContent, viewport) {
  const { Util } = pdfjsLib
  return textContent.items
    .map((item) => {
      const transform = Util.transform(viewport.transform, item.transform)
      const rawHeight = item.height ? item.height * viewport.scale : 0
      const fontHeight = rawHeight || Math.hypot(transform[2], transform[3]) || Math.hypot(transform[0], transform[1]) || 12
      const width = item.width * viewport.scale
      return {
        text: item.str || '',
        x: transform[4],
        y: transform[5],
        width,
        fontHeight,
        fontName: item.fontName
      }
    })
    .filter((item) => item.text)
    .sort((a, b) => {
      if (Math.abs(a.y - b.y) > 2.5) {
        return a.y - b.y
      }
      return a.x - b.x
    })
}

function buildViewportLines(textContent, viewport) {
  const chunks = buildViewportChunks(textContent, viewport)
  const lines = []
  const tolerance = 2.5

  chunks.forEach((chunk) => {
    const line = lines.find((candidate) => Math.abs(candidate.y - chunk.y) <= tolerance)
    if (line) {
      line.chunks.push(chunk)
      line.y = (line.y + chunk.y) / 2
    } else {
      lines.push({
        y: chunk.y,
        chunks: [chunk]
      })
    }
  })

  return lines
    .sort((a, b) => a.y - b.y)
    .map((line) => {
      const orderedChunks = line.chunks.sort((a, b) => a.x - b.x)
      let cursor = 0
      let text = ''
      const charChunkIndexes = []

      orderedChunks.forEach((chunk, index) => {
        if (index > 0) {
          const gap = chunk.x - cursor
          const spacer = gap > 20 ? '  ' : gap > 4 ? ' ' : ''
          text += spacer
          for (let i = 0; i < spacer.length; i += 1) {
            charChunkIndexes.push(-1)
          }
        }

        text += chunk.text
        for (let i = 0; i < chunk.text.length; i += 1) {
          charChunkIndexes.push(index)
        }
        cursor = chunk.x + chunk.width
      })

      return {
        y: line.y,
        text,
        chunks: orderedChunks,
        charChunkIndexes
      }
    })
}

function drawLineMatch(context, line, textContent, replacementRule, replacementText, startIndex, endIndex) {
  const indexes = line.charChunkIndexes
    .slice(startIndex, endIndex)
    .filter((value) => value >= 0)

  if (!indexes.length) {
    return
  }

  const firstChunk = line.chunks[indexes[0]]
  const lastChunk = line.chunks[indexes[indexes.length - 1]]
  if (!firstChunk || !lastChunk) {
    return
  }

  const style = textContent.styles?.[firstChunk.fontName] || {}
  const fontFamily = style.fontFamily || 'sans-serif'
  const fontHeight = Math.max(...indexes.map((index) => line.chunks[index].fontHeight), firstChunk.fontHeight)
  const x = firstChunk.x
  const y = firstChunk.y
  const rawWidth = lastChunk.x + lastChunk.width - firstChunk.x
  const width = replacementText
    ? Math.max(rawWidth, replacementText.length * fontHeight * 0.55)
    : rawWidth
  const paddingX = Math.max(fontHeight * 0.18, 2)
  const paddingY = Math.max(fontHeight * 0.12, 2)

  context.save()
  context.fillStyle = '#ffffff'
  context.fillRect(
    x - paddingX,
    y - fontHeight - paddingY,
    width + paddingX * 2,
    fontHeight + paddingY * 2
  )
  if (replacementText) {
    context.font = `${fontHeight}px ${fontFamily}`
    context.fillStyle = '#111827'
    context.textBaseline = 'alphabetic'
    context.fillText(replacementText, x, y)
  }
  context.restore()
}

function buildPageTextMap(lines) {
  const refs = []
  let text = ''

  lines.forEach((line, lineIndex) => {
    for (let charIndex = 0; charIndex < line.text.length; charIndex += 1) {
      const currentChar = line.text[charIndex]
      if (/\s/.test(currentChar)) {
        continue
      }
      text += currentChar
      refs.push({ lineIndex, charIndex })
    }
  })

  return {
    text,
    refs
  }
}

function normalizeOcrBox(line, pageAnalysis) {
  const imageWidth = Number(pageAnalysis?.ocrImageWidth || 0)
  const imageHeight = Number(pageAnalysis?.ocrImageHeight || 0)
  if (!imageWidth || !imageHeight) {
    return null
  }

  const left = Number(line?.left ?? 0)
  const top = Number(line?.top ?? 0)
  const right = Number(line?.right ?? 0)
  const bottom = Number(line?.bottom ?? 0)
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
    return null
  }

  return {
    left: Math.max(left, 0),
    top: Math.max(top, 0),
    right: Math.min(right, imageWidth),
    bottom: Math.min(bottom, imageHeight),
    imageWidth,
    imageHeight
  }
}

function buildOcrPageTextMap(pageAnalysis) {
  const lines = (pageAnalysis?.ocrLines || [])
    .map((line, lineIndex) => {
      const box = normalizeOcrBox(line, pageAnalysis)
      const normalizedText = normalizeSearchText(line?.text || '')
      if (!box || !normalizedText) {
        return null
      }

      return {
        lineIndex,
        text: line.text || '',
        normalizedText,
        charCount: normalizedText.length,
        box
      }
    })
    .filter(Boolean)

  const refs = []
  let text = ''

  lines.forEach((line, lineIndex) => {
    for (let charIndex = 0; charIndex < line.charCount; charIndex += 1) {
      text += line.normalizedText[charIndex]
      refs.push({ lineIndex, charIndex })
    }
  })

  return {
    text,
    refs,
    lines
  }
}

function drawOcrLineMatch(context, line, replacementText, startIndex, endIndex, canvasWidth, canvasHeight) {
  const boxWidth = Math.max(line.box.right - line.box.left, 1)
  const boxHeight = Math.max(line.box.bottom - line.box.top, 1)
  const charCount = Math.max(line.charCount, 1)
  const startRatio = Math.max(0, Math.min(startIndex / charCount, 1))
  const endRatio = Math.max(startRatio, Math.min(endIndex / charCount, 1))
  const left = line.box.left + boxWidth * startRatio
  const right = line.box.left + boxWidth * endRatio
  const width = Math.max(right - left, boxHeight * 0.9)
  const scaleX = canvasWidth / line.box.imageWidth
  const scaleY = canvasHeight / line.box.imageHeight
  const x = left * scaleX
  const y = line.box.top * scaleY
  const drawWidth = width * scaleX
  const drawHeight = boxHeight * scaleY
  const fontSize = Math.max(Math.min(drawHeight * 0.72, 32), 12)
  const paddingX = Math.max(drawHeight * 0.18, 3)
  const paddingY = Math.max(drawHeight * 0.12, 2)
  const rectX = Math.max(x - paddingX, 0)
  const rectY = Math.max(y - paddingY, 0)
  const rectWidth = Math.min(drawWidth + paddingX * 2, canvasWidth - rectX)
  const rectHeight = Math.min(drawHeight + paddingY * 2, canvasHeight - rectY)

  context.save()
  context.fillStyle = '#ffffff'
  context.fillRect(rectX, rectY, rectWidth, rectHeight)

  if (replacementText) {
    context.font = `${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
    context.fillStyle = '#111827'
    context.textBaseline = 'middle'
    context.fillText(
      replacementText,
      x,
      Math.min(y + drawHeight / 2, canvasHeight - fontSize * 0.5)
    )
  }
  context.restore()
}

function drawOcrPageMatch(context, ocrPageTextMap, replacementRule, startIndex, endIndex, canvasWidth, canvasHeight) {
  const positions = ocrPageTextMap.refs
    .slice(startIndex, endIndex)
    .filter(Boolean)

  if (!positions.length) {
    return
  }

  const groups = []
  positions.forEach((position) => {
    const lastGroup = groups[groups.length - 1]
    if (!lastGroup || lastGroup.lineIndex !== position.lineIndex) {
      groups.push({
        lineIndex: position.lineIndex,
        startIndex: position.charIndex,
        endIndex: position.charIndex + 1
      })
      return
    }

    lastGroup.endIndex = position.charIndex + 1
  })

  const maskedText = normalizeSearchText(replacementRule.masked)
  const groupCounts = groups.map((group) => ocrPageTextMap.refs
    .slice(startIndex, endIndex)
    .filter((position) => position?.lineIndex === group.lineIndex)
    .length)
  const totalOriginalCount = groupCounts.reduce((sum, count) => sum + count, 0) || 1

  groups.forEach((group, index) => {
    const line = ocrPageTextMap.lines[group.lineIndex]
    if (!line) {
      return
    }

    const consumedOriginalCount = groupCounts
      .slice(0, index)
      .reduce((sum, count) => sum + count, 0)
    const nextOriginalCount = consumedOriginalCount + groupCounts[index]
    const replacementStart = Math.round(maskedText.length * consumedOriginalCount / totalOriginalCount)
    const replacementEnd = index === groups.length - 1
      ? maskedText.length
      : Math.round(maskedText.length * nextOriginalCount / totalOriginalCount)
    const replacementText = maskedText.slice(replacementStart, replacementEnd)

    drawOcrLineMatch(
      context,
      line,
      replacementText,
      group.startIndex,
      group.endIndex,
      canvasWidth,
      canvasHeight
    )
  })
}

function drawPageMatch(context, lines, textContent, replacementRule, refs, startIndex, endIndex) {
  const positions = refs
    .slice(startIndex, endIndex)
    .filter(Boolean)

  if (!positions.length) {
    return
  }

  const groups = []
  positions.forEach((position) => {
    const lastGroup = groups[groups.length - 1]
    if (!lastGroup || lastGroup.lineIndex !== position.lineIndex) {
      groups.push({
        lineIndex: position.lineIndex,
        startIndex: position.charIndex,
        endIndex: position.charIndex + 1
      })
      return
    }

    lastGroup.endIndex = position.charIndex + 1
  })

  const maskedText = normalizeSearchText(replacementRule.masked)
  const groupCounts = groups.map((group) => refs
    .slice(startIndex, endIndex)
    .filter((position) => position?.lineIndex === group.lineIndex)
    .length)
  const totalOriginalCount = groupCounts.reduce((sum, count) => sum + count, 0) || 1

  groups.forEach((group, index) => {
    const line = lines[group.lineIndex]
    if (!line) {
      return
    }

    const consumedOriginalCount = groupCounts
      .slice(0, index)
      .reduce((sum, count) => sum + count, 0)
    const nextOriginalCount = consumedOriginalCount + groupCounts[index]
    const replacementStart = Math.round(maskedText.length * consumedOriginalCount / totalOriginalCount)
    const replacementEnd = index === groups.length - 1
      ? maskedText.length
      : Math.round(maskedText.length * nextOriginalCount / totalOriginalCount)
    const replacementText = maskedText.slice(replacementStart, replacementEnd)

    drawLineMatch(
      context,
      line,
      textContent,
      replacementRule,
      replacementText,
      group.startIndex,
      group.endIndex
    )
  })
}

function drawMaskedTextLayer({
  context,
  viewport,
  textContent,
  replacementRules
}) {
  const lines = buildViewportLines(textContent, viewport)
  const pageTextMap = buildPageTextMap(lines)

  replacementRules.forEach((rule) => {
    if (!rule.visualPattern) {
      return
    }

    const matches = [...pageTextMap.text.matchAll(rule.visualPattern)]
    matches.forEach((match) => {
      const startIndex = match.index || 0
      const endIndex = startIndex + match[0].length
      drawPageMatch(context, lines, textContent, rule, pageTextMap.refs, startIndex, endIndex)
    })
    rule.visualPattern.lastIndex = 0
  })
}

function drawMaskedOcrLayer({
  context,
  pageAnalysis,
  replacementRules,
  canvasWidth,
  canvasHeight
}) {
  const ocrPageTextMap = buildOcrPageTextMap(pageAnalysis)
  if (!ocrPageTextMap.text) {
    return
  }

  replacementRules.forEach((rule) => {
    if (!rule.visualPattern) {
      return
    }

    const matches = [...ocrPageTextMap.text.matchAll(rule.visualPattern)]
    matches.forEach((match) => {
      const startIndex = match.index || 0
      const endIndex = startIndex + match[0].length
      drawOcrPageMatch(
        context,
        ocrPageTextMap,
        rule,
        startIndex,
        endIndex,
        canvasWidth,
        canvasHeight
      )
    })
    rule.visualPattern.lastIndex = 0
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
  const pageAnalysisMap = new Map((options.pageAnalyses || []).map((page) => [page.pageNumber, page]))
  const pages = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const original = await renderPdfPage(page, scale)
    const pageAnalysis = pageAnalysisMap.get(pageNumber)
    const maskedCanvas = document.createElement('canvas')
    maskedCanvas.width = original.canvas.width
    maskedCanvas.height = original.canvas.height
    const maskedContext = maskedCanvas.getContext('2d')
    maskedContext.drawImage(original.canvas, 0, 0)

    if (replacementRules.length) {
      const shouldUseOcrOverlay = Boolean(pageAnalysis?.ocrLines?.length)
      if (shouldUseOcrOverlay) {
        drawMaskedOcrLayer({
          context: maskedContext,
          pageAnalysis,
          replacementRules,
          canvasWidth: maskedCanvas.width,
          canvasHeight: maskedCanvas.height
        })
      } else {
        const textContent = await page.getTextContent()
        const hasTextLayer = Boolean(textContent.items?.length)
        if (hasTextLayer) {
          drawMaskedTextLayer({
            context: maskedContext,
            viewport: original.viewport,
            textContent,
            replacementRules
          })
        }
      }
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

export async function renderPdfPagesForOcr(fileSource, pageNumbers = [], options = {}) {
  const scale = options.scale || 2
  const { pdf } = await loadPdfDocument(fileSource)
  const targetPageNumbers = pageNumbers.length
    ? new Set(pageNumbers.map((pageNumber) => Number(pageNumber)).filter(Boolean))
    : null
  const pages = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (targetPageNumbers && !targetPageNumbers.has(pageNumber)) {
      continue
    }

    const page = await pdf.getPage(pageNumber)
    const rendered = await renderPdfPage(page, scale)
    pages.push({
      pageNumber,
      width: rendered.canvas.width,
      height: rendered.canvas.height,
      imageDataUrl: rendered.canvas.toDataURL('image/png')
    })
  }

  return pages
}

export async function buildStyledMaskedPdfBytes(fileSource, hitList = [], pageAnalyses = []) {
  const pages = await renderPdfPreviewPages(fileSource, hitList, { scale: 2, pageAnalyses })
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
