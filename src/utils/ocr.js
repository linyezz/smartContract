import { invoke } from '@tauri-apps/api/core'
import { renderPdfPagesForOcr } from './pdf'

function safeStringify(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function normalizeUserFacingError(message, fallback) {
  const text = String(message || '').trim()
  if (!text) {
    return fallback
  }

  return text
    .replace(/\[(OCRmyPDF|RapidOCR worker)\]\s*/g, '')
    .replace(/OCRmyPDF/g, '扫描件识别')
    .replace(/RapidOCR worker/g, '扫描件识别')
    .replace(/worker/gi, '识别服务')
    .replace(/ocrmypdf/gi, '扫描件识别')
}

function extractInvokeErrorMessage(error, label, fallbackMessage) {
  if (error instanceof Error) {
    const message = error.message?.trim()
    return normalizeUserFacingError(message || error.name || 'Error', fallbackMessage)
  }

  if (typeof error === 'string') {
    const message = error.trim()
    return normalizeUserFacingError(message || '未知错误', fallbackMessage)
  }

  if (error && typeof error === 'object') {
    const candidates = [
      error.message,
      error.error,
      error.details,
      error.reason
    ]
      .map((item) => String(item || '').trim())
      .filter(Boolean)

    if (candidates.length) {
      return normalizeUserFacingError(candidates.join(' | '), fallbackMessage)
    }

    const serialized = safeStringify(error)
    if (serialized) {
      return normalizeUserFacingError(serialized, fallbackMessage)
    }
  }

  const rawMessage = String(error ?? '').trim()
  return normalizeUserFacingError(rawMessage || '未知错误', fallbackMessage)
}

export async function runPdfOcr(options = {}) {
  const payload = {
    inputPath: options.inputPath || '',
    sourceBytes: options.sourceBytes || null,
    fileName: options.fileName || '',
    language: options.language || 'chi_sim+eng'
  }

  try {
    return await invoke('ocr_pdf_document', { payload })
  } catch (error) {
    throw new Error(extractInvokeErrorMessage(error, 'OCRmyPDF', '扫描件识别失败，请稍后重试。'))
  }
}

export async function runLocalOcrWorker(options = {}) {
  const payload = {
    fileName: options.fileName || '',
    pages: options.pages || []
  }

  try {
    return await invoke('ocr_pages_with_worker', { payload })
  } catch (error) {
    throw new Error(extractInvokeErrorMessage(error, 'RapidOCR worker', '扫描件识别失败，请稍后重试。'))
  }
}

export async function runPdfOcrWithWorker(fileSource, options = {}) {
  const pages = await renderPdfPagesForOcr(fileSource, options.pageNumbers || [], {
    scale: options.scale || 2
  })

  return runLocalOcrWorker({
    fileName: options.fileName || '',
    pages
  })
}
