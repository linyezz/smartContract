import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'
import { readFile, writeFile } from '@tauri-apps/plugin-fs'
import { open, save } from '@tauri-apps/plugin-dialog'
import { buildMaskedDocument, getExportDescriptor } from './exports'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

export const ACCEPT_FILE_TYPES = ['pdf', 'doc', 'docx']

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

function uint8ArrayToArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

async function extractPdfText(bytes) {
  const loadingTask = pdfjsLib.getDocument({ data: bytes })
  const pdf = await loadingTask.promise
  const pageTexts = []
  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex)
    const content = await page.getTextContent()
    pageTexts.push(content.items.map((item) => item.str).join(' '))
  }
  return pageTexts.join('\n\n')
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
  const bytes = await readFile(fileSource)
  const size = bytes.byteLength ?? bytes.length
  if (size > 50 * 1024 * 1024) {
    throw new Error('文件超过 50MB，请更换更小的合同文件。')
  }

  const fileName = fileSource.split('/').pop() || '未命名文件'
  const extension = fileName.split('.').pop()?.toLowerCase() || ''

  let text = ''
  if (extension === 'pdf') {
    text = await extractPdfText(bytes)
  } else if (extension === 'docx') {
    text = await extractDocxText(bytes)
  } else if (extension === 'doc') {
    text = extractLegacyDocText(bytes)
  } else {
    throw new Error('暂不支持该文件格式。')
  }

  return {
    path: fileSource,
    fileName,
    extension,
    size,
    sizeLabel: bytesToMegabytes(size),
    text: text.trim()
  }
}

export async function saveMaskedResult(defaultName, content) {
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
  const { bytes, exportExtension } = await buildMaskedDocument(defaultName, extension, content)
  await writeFile(target, bytes)
  return {
    saved: true,
    path: target,
    exportExtension
  }
}
