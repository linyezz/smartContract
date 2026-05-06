/**
 * 从 Excel（账号管理）文件中提取「真实姓名」列，
 * 清洗后输出到 src/data/nameDictionary.js，作为内置中文姓名字典。
 *
 * 用法（任选其一）：
 *   node scripts/build-name-dictionary.mjs <xlsx1> [xlsx2] ...
 *   node scripts/build-name-dictionary.mjs   # 默认读取 ~/Downloads/账号管理 (3).xlsx 与 (4).xlsx
 *
 * 实现：直接基于 Node 内置 zlib 解压 xlsx，不引入外部依赖；
 * 工作表使用 inlineStr 保存文本，按行扫描表头匹配「真实姓名」/「姓名」列。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')
const OUTPUT_PATH = resolve(PROJECT_ROOT, 'src/data/nameDictionary.js')

// ---------- xlsx (zip) 解析 ---------- //

function parseZip(buffer) {
  // 在 EOCD 处定位 central directory
  const view = buffer
  const sig = 0x06054b50
  let eocdPos = -1
  for (let i = view.length - 22; i >= Math.max(0, view.length - 65557); i--) {
    if (view.readUInt32LE(i) === sig) {
      eocdPos = i
      break
    }
  }
  if (eocdPos < 0) {
    throw new Error('Invalid xlsx: EOCD not found')
  }
  const cdEntries = view.readUInt16LE(eocdPos + 10)
  const cdOffset = view.readUInt32LE(eocdPos + 16)

  const entries = new Map()
  let p = cdOffset
  for (let i = 0; i < cdEntries; i++) {
    if (view.readUInt32LE(p) !== 0x02014b50) {
      throw new Error('Invalid central directory entry')
    }
    const compMethod = view.readUInt16LE(p + 10)
    const compSize = view.readUInt32LE(p + 20)
    const fileNameLen = view.readUInt16LE(p + 28)
    const extraLen = view.readUInt16LE(p + 30)
    const commentLen = view.readUInt16LE(p + 32)
    const localHeaderOffset = view.readUInt32LE(p + 42)
    const fileName = view.slice(p + 46, p + 46 + fileNameLen).toString('utf8')

    // 局部头：定位真实数据起点
    const lh = localHeaderOffset
    if (view.readUInt32LE(lh) !== 0x04034b50) {
      throw new Error('Invalid local file header')
    }
    const lhFileNameLen = view.readUInt16LE(lh + 26)
    const lhExtraLen = view.readUInt16LE(lh + 28)
    const dataStart = lh + 30 + lhFileNameLen + lhExtraLen
    const compData = view.slice(dataStart, dataStart + compSize)

    let content
    if (compMethod === 0) {
      content = compData
    } else if (compMethod === 8) {
      content = inflateRawSync(compData)
    } else {
      throw new Error(`Unsupported compression method ${compMethod} for ${fileName}`)
    }
    entries.set(fileName, content)

    p += 46 + fileNameLen + extraLen + commentLen
  }
  return entries
}

// ---------- 极简 XML 行扫描 ---------- //
// xlsx 的 sheet1.xml 结构稳定：<row r="N"><c r="A1" t="inlineStr"><is><t>...</t></is></c>...</row>
// 我们直接按 <row>...</row> 块、再按 <c ...>...</c> 单元格切。

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([\da-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

function colLetterToIndex(letters) {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function extractRowsFromSheet(xml) {
  const rows = []
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let m
  while ((m = rowRe.exec(xml)) !== null) {
    const rowXml = m[1]
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^/]*)\/>/g
    const cells = {}
    let cm
    while ((cm = cellRe.exec(rowXml)) !== null) {
      const attrs = cm[1] || cm[3] || ''
      const inner = cm[2] || ''
      const refMatch = /\br="([A-Z]+)\d+"/.exec(attrs)
      if (!refMatch) continue
      const colIdx = colLetterToIndex(refMatch[1])
      const tMatch = /\bt="([^"]+)"/.exec(attrs)
      const t = tMatch ? tMatch[1] : null
      let val = ''
      if (t === 'inlineStr') {
        const tParts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1])
        val = decodeXml(tParts.join(''))
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)
        val = v ? decodeXml(v[1]) : ''
      }
      cells[colIdx] = val
    }
    rows.push(cells)
  }
  return rows
}

// ---------- 姓名清洗 ---------- //

const NAME_RE = /^[\u4e00-\u9fa5]{2,4}$/

function cleanName(raw) {
  if (!raw) return null
  let s = String(raw).trim()
  if (!s) return null
  // 去除括号及备注：王加中（已离职）/ 王珊（女）/ 张宇（北京） 等
  s = s.replace(/[（(].*?[)）]/g, '').trim()
  // 去除尾部数字：刘颖3 / 王颖1
  s = s.replace(/\d+$/, '').trim()
  // 去除尾部空白与全角空格
  s = s.replace(/\s+/g, '')
  if (NAME_RE.test(s)) return s
  return null
}

// ---------- 主流程 ---------- //

function extractNamesFromXlsx(xlsxPath) {
  const buf = readFileSync(xlsxPath)
  const entries = parseZip(buf)
  const sheet = entries.get('xl/worksheets/sheet1.xml')
  if (!sheet) {
    throw new Error(`No xl/worksheets/sheet1.xml in ${xlsxPath}`)
  }
  const xml = sheet.toString('utf8')
  const rows = extractRowsFromSheet(xml)

  let nameCol = null
  const names = []
  for (const row of rows) {
    if (nameCol === null) {
      for (const [idx, val] of Object.entries(row)) {
        if (val === '真实姓名' || val === '姓名') {
          nameCol = Number(idx)
          break
        }
      }
      continue
    }
    const raw = row[nameCol]
    const cleaned = cleanName(raw)
    if (cleaned) names.push(cleaned)
  }
  return names
}

function main() {
  const argv = process.argv.slice(2)
  const inputs = argv.length
    ? argv
    : [
        `${process.env.HOME}/Downloads/账号管理 (3).xlsx`,
        `${process.env.HOME}/Downloads/账号管理 (4).xlsx`
      ]

  const all = new Set()
  for (const f of inputs) {
    if (!existsSync(f)) {
      console.warn(`[skip] 文件不存在: ${f}`)
      continue
    }
    const ns = extractNamesFromXlsx(f)
    console.log(`[ok] ${basename(f)} 提取 ${ns.length} 个有效姓名`)
    for (const n of ns) all.add(n)
  }

  const sorted = [...all].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  console.log(`合并去重后共 ${sorted.length} 个姓名`)

  const dir = dirname(OUTPUT_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const header = `// 自动生成：由 scripts/build-name-dictionary.mjs 生成
// 数据来源：内部账号管理 Excel（真实姓名列）
// 用途：作为中文姓名脱敏的内置字典，提高识别率（仅本地匹配，不出网络）
// 重新生成：node scripts/build-name-dictionary.mjs <xlsx...>
`
  const body = `export const BUILT_IN_CHINESE_NAMES = Object.freeze(${JSON.stringify(sorted, null, 0)})\n`
  writeFileSync(OUTPUT_PATH, `${header}\n${body}`, 'utf8')
  console.log(`已写入 ${OUTPUT_PATH}`)
}

main()
