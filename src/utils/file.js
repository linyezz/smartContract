import mammoth from 'mammoth'
import { readFile, writeFile } from '@tauri-apps/plugin-fs'
import { open, save } from '@tauri-apps/plugin-dialog'
import { buildMaskedDocument, getExportDescriptor } from './exports'
import { extractPdfText, uint8ArrayToArrayBuffer } from './pdf'

export const ACCEPT_FILE_TYPES = ['pdf', 'doc', 'docx']
export const WORD_LIBRARY_FILE_TYPES = ['docx', 'txt', 'md']

function cloneUint8Array(bytes) {
  return new Uint8Array(bytes)
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
  if (extension === 'pdf') {
    text = await extractPdfText(cloneUint8Array(bytes))
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
    bytes: cloneUint8Array(bytes)
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
