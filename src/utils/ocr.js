import { invoke } from '@tauri-apps/api/core'
import { renderPdfPagesForOcr } from './pdf'

function safeStringify(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function extractInvokeErrorMessage(error, label) {
  if (error instanceof Error) {
    const message = error.message?.trim()
    return message ? `[${label}] ${message}` : `[${label}] ${error.name || 'Error'}`
  }

  if (typeof error === 'string') {
    const message = error.trim()
    return message ? `[${label}] ${message}` : `[${label}] 未知错误`
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
      return `[${label}] ${candidates.join(' | ')}`
    }

    const serialized = safeStringify(error)
    if (serialized) {
      return `[${label}] ${serialized}`
    }
  }

  const fallback = String(error ?? '').trim()
  return `[${label}] ${fallback || '未知错误'}`
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
    throw new Error(extractInvokeErrorMessage(error, 'OCRmyPDF'))
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
    throw new Error(extractInvokeErrorMessage(error, 'RapidOCR worker'))
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
