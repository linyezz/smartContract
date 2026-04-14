import mammoth from 'mammoth'
import { readFile, writeFile } from '@tauri-apps/plugin-fs'
import { open, save } from '@tauri-apps/plugin-dialog'
import { buildMaskedDocument, getExportDescriptor } from './exports'
import { extractPdfTextWithDiagnostics, uint8ArrayToArrayBuffer } from './pdf'

export const ACCEPT_FILE_TYPES = ['pdf', 'doc', 'docx']
export const WORD_LIBRARY_FILE_TYPES = ['docx', 'txt', 'md']

function cloneUint8Array(bytes) {
  return new Uint8Array(bytes)
}

function countNormalizedChars(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .trim()
    .length
}

async function buildPdfContractSnapshot(base, bytes, extra = {}) {
  const normalizedBytes = cloneUint8Array(bytes)
  const extraction = await extractPdfTextWithDiagnostics(normalizedBytes)

  return {
    ...base,
    text: extraction.text.trim(),
    analysis: {
      type: 'pdf',
      ...extraction.diagnostics,
      pages: extraction.pages
    },
    bytes: normalizedBytes,
    ...extra
  }
}

async function toUint8ArrayFromWebFile(file) {
  const buffer = await file.arrayBuffer()
  return new Uint8Array(buffer)
}

function normalizeNameFromPath(path) {
  return String(path || '').split('/').pop() || '未命名文件'
}

async function resolveFilePayload(fileSource) {
  if (typeof fileSource === 'string') {
    const bytes = await readFile(fileSource)
    return {
      path: fileSource,
      fileName: normalizeNameFromPath(fileSource),
      bytes
    }
  }

  if (fileSource instanceof File) {
    const bytes = await toUint8ArrayFromWebFile(fileSource)
    return {
      path: fileSource.path || '',
      fileName: fileSource.name || '未命名文件',
      bytes
    }
  }

  throw new Error('无法识别文件来源。')
}

export async function pickFile() {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: '合同文件',
        extensions: ACCEPT_FILE_TYPES
      }
    ]
  })
  return typeof selected === 'string' ? selected : null
}

function bytesToMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function extractDocxText(bytes) {
  const result = await mammoth.extractRawText({
    arrayBuffer: uint8ArrayToArrayBuffer(bytes)
  })
  return result.value
}

function extractLegacyDocText(bytes) {
  const preview = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  return preview.replace(/\0/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function readContractFile(fileSource) {
  const payload = await resolveFilePayload(fileSource)
  const bytes = cloneUint8Array(payload.bytes)
  const size = bytes.byteLength ?? bytes.length
  if (size > 50 * 1024 * 1024) {
    throw new Error('文件超过 50MB，请更换更小的合同文件。')
  }

  const fileName = payload.fileName
  const extension = fileName.split('.').pop()?.toLowerCase() || ''

  let text = ''
  let analysis = null
  if (extension === 'pdf') {
    const pdfSnapshot = await buildPdfContractSnapshot({
      path: payload.path,
      fileName,
      extension,
      size,
      sizeLabel: bytesToMegabytes(size)
    }, cloneUint8Array(bytes))

    return {
      ...pdfSnapshot,
      ocr: {
        applied: false
      }
    }
  } else if (extension === 'docx') {
    text = await extractDocxText(cloneUint8Array(bytes))
  } else if (extension === 'doc') {
    text = extractLegacyDocText(bytes)
  } else {
    throw new Error('暂不支持该文件格式。')
  }

  return {
    path: payload.path,
    fileName,
    extension,
    size,
    sizeLabel: bytesToMegabytes(size),
    text: text.trim(),
    analysis,
    bytes: cloneUint8Array(bytes)
  }
}

export async function applyPdfOcrResult(contractFile, ocrResult) {
  if (!contractFile || contractFile.extension !== 'pdf') {
    throw new Error('只有 PDF 文件支持应用 OCR 结果。')
  }
  if (!ocrResult?.outputPath) {
    throw new Error('OCR 结果缺少输出文件路径。')
  }

  const ocrBytes = await readFile(ocrResult.outputPath)
  return buildPdfContractSnapshot({
    ...contractFile
  }, ocrBytes, {
    ocr: {
      applied: true,
      tool: ocrResult.tool || 'ocrmypdf',
      outputPath: ocrResult.outputPath,
      language: ocrResult.language || 'chi_sim+eng',
      commandLabel: ocrResult.commandLabel || '',
      sidecarText: ocrResult.sidecarText || ''
    }
  })
}

export function applyPdfWorkerOcrResult(contractFile, workerResult) {
  if (!contractFile || contractFile.extension !== 'pdf') {
    throw new Error('只有 PDF 文件支持应用本地 OCR 结果。')
  }

  const originalPages = contractFile.analysis?.pages || []
  const workerPages = new Map((workerResult?.pages || []).map((page) => [page.pageNumber, page]))

  const mergedPages = originalPages.map((page) => {
    const workerPage = workerPages.get(page.pageNumber)
    const nextText = page.hasUsableText ? page.text || '' : workerPage?.text || page.text || ''
    const normalizedCharCount = countNormalizedChars(nextText)

    return {
      ...page,
      text: nextText,
      textLength: nextText.length,
      normalizedCharCount,
      hasUsableText: normalizedCharCount >= 8 || page.hasUsableText,
      ocrApplied: Boolean(workerPage),
      ocrLineCount: workerPage?.lineCount || 0,
      ocrAvgScore: workerPage?.avgScore ?? null,
      ocrImageWidth: workerPage?.imageWidth || null,
      ocrImageHeight: workerPage?.imageHeight || null,
      ocrLines: (workerPage?.lines || []).map((line) => ({
        text: line.text || '',
        score: line.score ?? null,
        left: Number(line.left || 0),
        top: Number(line.top || 0),
        right: Number(line.right || 0),
        bottom: Number(line.bottom || 0)
      }))
    }
  })

  const pagesWithText = mergedPages.filter((page) => page.hasUsableText).length
  const totalPages = mergedPages.length
  const pagesWithoutText = totalPages - pagesWithText
  const mergedText = mergedPages
    .map((page) => page.text || '')
    .filter((text) => text.trim())
    .join('\n\n')
    .trim()

  return {
    ...contractFile,
    text: mergedText,
    analysis: {
      ...contractFile.analysis,
      kind: pagesWithoutText === 0 ? 'text' : pagesWithText === 0 ? 'image-only' : 'mixed',
      totalPages,
      pagesWithText,
      pagesWithoutText,
      totalNormalizedChars: mergedPages.reduce((sum, page) => sum + page.normalizedCharCount, 0),
      blankPageRatio: totalPages ? pagesWithoutText / totalPages : 0,
      hasUsableText: pagesWithText > 0,
      ocrRecommended: pagesWithoutText > 0,
      pages: mergedPages
    },
    ocr: {
      applied: true,
      tool: workerResult?.tool || 'rapidocr',
      engine: workerResult?.engine || 'rapidocr_onnxruntime',
      commandLabel: workerResult?.commandLabel || '',
      pageCount: workerPages.size
    }
  }
}

export async function readWordLibraryFile(fileSource) {
  const payload = await resolveFilePayload(fileSource)
  const bytes = payload.bytes
  const size = bytes.byteLength ?? bytes.length
  const fileName = payload.fileName
  const extension = fileName.split('.').pop()?.toLowerCase() || ''

  let text = ''
  if (extension === 'docx') {
    text = await extractDocxText(bytes)
  } else if (extension === 'txt' || extension === 'md') {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } else {
    throw new Error('仅支持导入 DOCX、TXT、MD 文本文件。')
  }

  return {
    path: payload.path,
    fileName,
    extension,
    size,
    sizeLabel: bytesToMegabytes(size),
    text: text.trim()
  }
}

export async function saveMaskedResult(defaultName, content, options = {}) {
  const extension = defaultName.split('.').pop()?.toLowerCase() || 'docx'
  const exportInfo = getExportDescriptor(defaultName, extension)
  const target = await save({
    defaultPath: exportInfo.defaultFileName,
    filters: [{ name: exportInfo.filterName, extensions: exportInfo.filters }]
  })
  if (!target) {
    return {
      saved: false,
      path: ''
    }
  }
  const { bytes, exportExtension } = await buildMaskedDocument(defaultName, extension, content, options)
  await writeFile(target, bytes)
  return {
    saved: true,
    path: target,
    exportExtension
  }
}
