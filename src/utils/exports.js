import dayjs from 'dayjs'
import { BaseDirectory, appLocalDataDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, stat, writeFile } from '@tauri-apps/plugin-fs'
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'

function sanitizeFileName(fileName) {
  return fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
}

function sanitizeFolderSegment(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
  return normalized || fallback
}

function describeError(stage, error) {
  const message = error?.message || String(error)
  return new Error(`[${stage}] ${message}`)
}

function resolveExportExtension(extension) {
  return extension === 'pdf' ? 'pdf' : 'docx'
}

function buildExportName(fileName, extension, stamp = dayjs().format('YYYYMMDD-HHmmss')) {
  const baseName = sanitizeFileName(fileName).replace(/\.[^.]+$/, '')
  return `${stamp}-${baseName}-脱敏结果.${resolveExportExtension(extension)}`
}

function resolveUserExportFolder(user = {}) {
  const userId = sanitizeFolderSegment(user.id, 'unknown-user')
  const userName = sanitizeFolderSegment(user.name || user.username, '未命名用户')
  return `exports/${userId}-${userName}`
}

function toUint8Array(payload) {
  if (payload instanceof Uint8Array) {
    return payload
  }
  return new Uint8Array(payload)
}

function buildParagraphsFromText(text, Paragraph, TextRun) {
  const lines = text.split(/\r?\n/)
  return lines.map((line) => new Paragraph({
    spacing: { after: 180 },
    children: [
      new TextRun({
        text: line || ' ',
        size: 24
      })
    ]
  }))
}

async function generateDocxBytes(maskedText) {
  try {
    const { Document, Packer, Paragraph, TextRun } = await import('docx')
    const document = new Document({
      sections: [
        {
          properties: {},
          children: buildParagraphsFromText(maskedText, Paragraph, TextRun)
        }
      ]
    })

    const buffer = await Packer.toArrayBuffer(document)
    return new Uint8Array(buffer)
  } catch (error) {
    throw describeError('DOCX生成', error)
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function generatePdfBytes(fileName, maskedText) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('@html2canvas/html2canvas'),
    import('jspdf')
  ]).catch((error) => {
    throw describeError('PDF依赖加载', error)
  })
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-100000px'
  container.style.top = '0'
  container.style.width = '794px'
  container.style.padding = '48px'
  container.style.background = '#ffffff'
  container.style.color = '#1f2937'
  container.style.fontFamily = '"PingFang SC", "Microsoft YaHei", sans-serif'
  container.style.lineHeight = '1.8'
  container.style.boxSizing = 'border-box'
  container.innerHTML = `
    <div style="font-size:28px;font-weight:700;margin-bottom:24px;">${escapeHtml(fileName)}</div>
    ${maskedText
      .split(/\r?\n/)
      .map((line) => `<p style="margin:0 0 14px;white-space:pre-wrap;word-break:break-word;">${escapeHtml(line || ' ')}</p>`)
      .join('')}
  `

  document.body.appendChild(container)

  try {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const canvas = await html2canvas(container, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false
    }).catch((error) => {
      throw describeError('PDF画布生成', error)
    })

    const imageData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({
      orientation: 'p',
      unit: 'pt',
      format: 'a4'
    })

    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 24
    const contentWidth = pageWidth - margin * 2
    const contentHeight = (canvas.height * contentWidth) / canvas.width
    let remainingHeight = contentHeight
    let positionY = margin

    pdf.addImage(imageData, 'PNG', margin, positionY, contentWidth, contentHeight)
    remainingHeight -= pageHeight - margin * 2

    while (remainingHeight > 0) {
      positionY = margin - (contentHeight - remainingHeight)
      pdf.addPage()
      pdf.addImage(imageData, 'PNG', margin, positionY, contentWidth, contentHeight)
      remainingHeight -= pageHeight - margin * 2
    }

    return toUint8Array(pdf.output('arraybuffer'))
  } finally {
    container.remove()
  }
}

export function getExportDescriptor(fileName, extension) {
  const exportExtension = resolveExportExtension(extension)
  return {
    exportExtension,
    defaultFileName: `${sanitizeFileName(fileName).replace(/\.[^.]+$/, '')}-脱敏结果.${exportExtension}`,
    filterName: exportExtension === 'pdf' ? 'PDF 文件' : 'Word 文档',
    filters: [exportExtension]
  }
}

export async function buildMaskedDocument(fileName, extension, maskedText) {
  const exportExtension = resolveExportExtension(extension)
  const bytes = exportExtension === 'pdf'
    ? await generatePdfBytes(fileName, maskedText)
    : await generateDocxBytes(maskedText)

  return {
    bytes,
    exportExtension
  }
}

export async function exportMaskedResultToArchive(fileName, extension, maskedText, options = {}) {
  const folder = resolveUserExportFolder(options.user)
  try {
    await mkdir(folder, {
      baseDir: BaseDirectory.AppLocalData,
      recursive: true
    })
  } catch (error) {
    throw describeError('创建归档目录', error)
  }

  const { bytes, exportExtension } = await buildMaskedDocument(fileName, extension, maskedText)
  const stamp = dayjs().format('YYYYMMDD-HHmmss')
  let fileNameToUse = buildExportName(fileName, extension, stamp)
  let relativePath = `${folder}/${fileNameToUse}`
  let index = 1

  try {
    while (await exists(relativePath, { baseDir: BaseDirectory.AppLocalData })) {
      fileNameToUse = buildExportName(fileName, extension, `${stamp}-${index}`)
      relativePath = `${folder}/${fileNameToUse}`
      index += 1
    }
  } catch (error) {
    throw describeError('检查归档文件是否存在', error)
  }

  try {
    await writeFile(relativePath, bytes, {
      baseDir: BaseDirectory.AppLocalData
    })
  } catch (error) {
    throw describeError('写入归档文件', error)
  }

  let rootPath = ''
  let absolutePath = ''
  try {
    rootPath = await appLocalDataDir()
    absolutePath = await join(rootPath, relativePath)
  } catch (error) {
    throw describeError('解析归档路径', error)
  }

  return {
    exportExtension,
    relativePath,
    absolutePath,
    folder
  }
}

export async function openLocalPath(path) {
  const normalizedPath = String(path || '').trim()
  if (!normalizedPath) {
    throw new Error('路径为空，无法打开。')
  }

  const existsOnDisk = await verifyLocalPath(normalizedPath)
  if (!existsOnDisk) {
    throw new Error(`文件不存在或尚未写入磁盘：${normalizedPath}`)
  }

  try {
    await revealItemInDir(normalizedPath)
    return
  } catch (error) {
    try {
      await openPath(normalizedPath)
      return
    } catch (fallbackError) {
      throw describeError(
        '打开路径',
        fallbackError?.message ? `${error?.message || 'reveal失败'}；${fallbackError.message}` : error
      )
    }
  }
}

export async function verifyLocalPath(path) {
  const normalizedPath = String(path || '').trim()
  if (!normalizedPath) {
    return false
  }
  try {
    await stat(normalizedPath)
    return true
  } catch {
    return false
  }
}
