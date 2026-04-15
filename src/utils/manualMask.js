function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function buildMaskWithAsterisks(value, fallbackLength = 3) {
  const source = String(value ?? '')
  const masked = source.replace(/[^\s]/g, '*')
  const visibleLength = masked.replace(/\s/g, '').length

  if (visibleLength > 0) {
    return masked
  }

  return '*'.repeat(Math.max(fallbackLength, 1))
}

export function buildManualItemId(prefix = 'manual') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeManualTextSelection(selection, sourceText) {
  const fullText = String(sourceText || '')
  const maxLength = fullText.length
  const start = clamp(Number(selection?.start ?? 0), 0, maxLength)
  const end = clamp(Number(selection?.end ?? 0), 0, maxLength)

  if (end <= start) {
    return null
  }

  const original = fullText.slice(start, end)
  if (!original.trim()) {
    return null
  }

  return {
    id: selection?.id || buildManualItemId('manual-text'),
    source: 'manual',
    type: '手动选词',
    original,
    masked: buildMaskWithAsterisks(original),
    start,
    end
  }
}

export function applyManualTextSelections(text, selections = []) {
  let nextText = String(text || '')
  const orderedSelections = [...selections]

  orderedSelections
    .filter((item) => item && typeof item.start === 'number' && typeof item.end === 'number' && item.end > item.start)
    .sort((left, right) => right.start - left.start)
    .forEach((item) => {
      nextText = `${nextText.slice(0, item.start)}${item.masked}${nextText.slice(item.end)}`
    })

  return nextText
}

export function selectionOverlapsExisting(selections = [], candidate, ignoredId = '') {
  if (!candidate) {
    return false
  }

  return selections.some((item) => {
    if (!item || item.id === ignoredId) {
      return false
    }

    return candidate.start < item.end && candidate.end > item.start
  })
}

export function buildManualPdfRegionHit(region, index = 0) {
  const pageNumber = Number(region?.pageNumber || 0)
  const stars = '*'.repeat(Math.max(Number(region?.stars || 6), 3))

  return {
    id: region?.id || buildManualItemId('manual-region'),
    source: 'manual',
    type: '手动区域',
    target: 'pdf-region',
    original: region?.original || `第 ${pageNumber} 页手动区域 ${index + 1}`,
    masked: stars,
    pageNumber,
    rect: {
      left: Number(region?.rect?.left || 0),
      top: Number(region?.rect?.top || 0),
      width: Number(region?.rect?.width || 0),
      height: Number(region?.rect?.height || 0)
    }
  }
}

export function buildManualPdfRegionHitList(regions = []) {
  return regions
    .map((item, index) => buildManualPdfRegionHit(item, index))
    .filter((item) => item.pageNumber > 0 && item.rect.width > 0 && item.rect.height > 0)
}

export function cloneManualSelections(items = []) {
  return items.map((item) => ({
    ...item,
    rect: item?.rect ? { ...item.rect } : undefined
  }))
}

export function dedupeManualHitList(items = []) {
  const seen = new Set()

  return items.filter((item) => {
    const key = JSON.stringify({
      source: item?.source,
      type: item?.type,
      original: item?.original,
      masked: item?.masked,
      target: item?.target,
      pageNumber: item?.pageNumber,
      rect: item?.rect,
      start: item?.start,
      end: item?.end
    })

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}
