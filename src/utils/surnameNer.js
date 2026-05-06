// 基于百家姓的合同领域人名启发式识别
// 数据来源 src/data/chineseSurnames.js（由 scripts/build-surname-table.mjs 从 zh-address-parse 重生成）
// 在合同强信号锚点位置抽取候选 → 用百家姓 + 长度 + 黑名单做候选验证 → 输出匹配区间
import { SINGLE_SURNAMES as SURNAME_LIST } from '../data/chineseSurnames.js'

const SINGLE_SURNAMES = new Set(SURNAME_LIST)

const COMPOUND_SURNAMES = new Set([
  '欧阳', '太史', '端木', '上官', '司马', '东方', '独孤', '南宫', '万俟', '闻人',
  '夏侯', '诸葛', '尉迟', '公羊', '赫连', '澹台', '皇甫', '宗政', '濮阳', '公冶',
  '太叔', '申屠', '公孙', '慕容', '仲孙', '钟离', '长孙', '宇文', '司徒', '鲜于',
  '司空', '闾丘', '子车', '亓官', '司寇', '巫马', '公西', '颛孙', '壤驷', '公良',
  '漆雕', '乐正', '宰父', '谷梁', '拓跋', '夹谷', '轩辕', '令狐', '段干', '百里',
  '呼延', '东郭', '南门', '羊舌', '微生', '左丘', '西门', '东门',
])

// 介词/助词/连词/方位结构字，命中即拒绝姓名候选
// 注意：不包含数字字（一二三四五六七八九十）和常见名字用字（明、今、昨等），因为它们也是常见人名用字（张三、李四、王五、王明）
const NON_NAME_CHARS = new Set([
  '的', '了', '是', '在', '和', '与', '及', '或', '等', '为', '以', '由', '被',
  '使', '将', '把', '从', '向', '到', '至', '于', '对', '所', '其', '则', '若',
  '但', '而', '且', '故', '因', '此', '彼', '该', '兹',
  '里', '面', '边', '处', '间',
  '日', '月', '年', '号', '点', '岁', '元', '币', '块', '角',
  '请', '让', '令', '叫',
  '亿', '零',
])

const TRAILING_ROLE_PATTERN = /^(?:总\s*经\s*理|经\s*理|主\s*任|律\s*师|工\s*程\s*师|顾\s*问|董\s*事|监\s*事|代\s*表|签\s*字|签\s*章|盖\s*章|（\s*盖\s*章\s*）|\(\s*盖\s*章\s*\)|盖\s*章\s*人|签\s*署|经\s*办|审\s*核|复\s*核|审\s*批|提\s*交)/

const DATE_PATTERN = /^\s*\d{4}\s*[-./年]\s*\d{1,2}\s*[-./月]\s*\d{1,2}\s*[日]?/
const DATE_LOOKBEHIND = /\d{4}\s*[-./年]\s*\d{1,2}\s*[-./月]\s*\d{1,2}\s*[日]?\s*$/

const LABEL_SOURCE = [
  '姓\\s*名', '甲\\s*方\\s*代\\s*表', '乙\\s*方\\s*代\\s*表', '丙\\s*方\\s*代\\s*表',
  '联\\s*系\\s*人', '指\\s*定\\s*联\\s*系\\s*人', '签\\s*署\\s*人', '签\\s*字\\s*人',
  '盖\\s*章\\s*人', '法\\s*定\\s*代\\s*表\\s*人', '法\\s*人(?:\\s*代\\s*表)?',
  '授\\s*权\\s*代\\s*表', '授\\s*权\\s*人', '经\\s*办\\s*人', '办\\s*理\\s*人',
  '委\\s*托\\s*人', '受\\s*托\\s*人', '代\\s*理\\s*人', '被\\s*代\\s*理\\s*人',
  '承\\s*租\\s*人', '出\\s*租\\s*人', '承\\s*包\\s*人', '发\\s*包\\s*人',
  '借\\s*款\\s*人', '出\\s*借\\s*人', '贷\\s*款\\s*人',
  '担\\s*保\\s*人', '抵\\s*押\\s*人', '质\\s*押\\s*人', '保\\s*证\\s*人',
  '购\\s*买\\s*人', '买\\s*受\\s*人', '出\\s*售\\s*人', '出\\s*卖\\s*人',
  '供\\s*货\\s*人', '采\\s*购\\s*人',
  '项\\s*目\\s*经\\s*理', '项\\s*目\\s*负\\s*责\\s*人', '负\\s*责\\s*人',
  '审\\s*核\\s*人', '复\\s*核\\s*人', '审\\s*批\\s*人',
  '制\\s*单\\s*人', '开\\s*单\\s*人', '经\\s*手\\s*人', '交\\s*接\\s*人',
  '送\\s*达\\s*人', '见\\s*证\\s*人',
  '户\\s*名', '账\\s*户\\s*名\\s*称', '账\\s*户\\s*名',
  '开\\s*户\\s*人', '持\\s*卡\\s*人',
  '收\\s*款\\s*人', '付\\s*款\\s*人',
].join('|')

const LABEL_ANCHOR_PATTERN = new RegExp(
  `((?:${LABEL_SOURCE})\\s*(?:[：:]|为)?[\\s\\u3000\\r\\n]*)`,
  'g'
)

const SEPARATOR_ANCHOR_PATTERN = /([、，,])\s*/g
const LABEL_NEARBY_PATTERN = new RegExp(LABEL_SOURCE)

const CHINESE_CHAR_RE = /^[\u4e00-\u9fa5]$/

function isChinese(ch) {
  return ch ? CHINESE_CHAR_RE.test(ch) : false
}

function extractNameAt(text, pos) {
  if (pos >= text.length) return null
  const c0 = text[pos]
  if (!isChinese(c0)) return null

  const head2 = text.slice(pos, pos + 2)
  if (head2.length === 2 && isChinese(head2[1]) && COMPOUND_SURNAMES.has(head2)) {
    for (const nameLen of [3, 2, 1]) {
      const totalLen = 2 + nameLen
      const candidate = text.slice(pos, pos + totalLen)
      if (candidate.length !== totalLen) continue
      if (!validateNameBody(candidate, 2)) continue
      if (!validateRightBoundary(text, pos + totalLen)) continue
      return { name: candidate, length: totalLen }
    }
  }

  if (!SINGLE_SURNAMES.has(c0)) return null

  for (const nameLen of [3, 2, 1]) {
    const totalLen = 1 + nameLen
    const candidate = text.slice(pos, pos + totalLen)
    if (candidate.length !== totalLen) continue
    if (!validateNameBody(candidate, 1)) continue
    if (!validateRightBoundary(text, pos + totalLen)) continue
    return { name: candidate, length: totalLen }
  }
  return null
}

// 候选 body 内不允许出现职务/动作子串（防"张三签字"被吞为 4 字名）
const ROLE_SUBSTR_RE = /签字|签章|盖章|签署|经办|审核|复核|审批|提交|总经理|经理|主任|律师|工程师|顾问|董事|监事|代表/

function validateNameBody(candidate, surnameLen) {
  for (let i = surnameLen; i < candidate.length; i += 1) {
    const ch = candidate[i]
    if (!isChinese(ch)) return false
    if (NON_NAME_CHARS.has(ch)) return false
  }
  if (ROLE_SUBSTR_RE.test(candidate)) return false
  return true
}

// 后字非中文 → 通过；后字是黑名单虚词 → 通过；后字以职务词开头 → 通过；其他情况拒绝以防把更长的中文片段误切成姓名
function validateRightBoundary(text, endPos) {
  if (endPos >= text.length) return true
  const next = text[endPos]
  if (!isChinese(next)) return true
  if (NON_NAME_CHARS.has(next)) return true
  const tail = text.slice(endPos, endPos + 6)
  return TRAILING_ROLE_PATTERN.test(tail)
}

function validateLeftBoundary(text, startPos) {
  if (startPos === 0) return true
  return !isChinese(text[startPos - 1])
}

function hasContractSignal(text, start, end) {
  const before = text.slice(Math.max(0, start - 12), start)
  const after = text.slice(end, Math.min(text.length, end + 12))
  const afterTrimmed = after.replace(/^[\s\u3000]+/, '')
  if (DATE_LOOKBEHIND.test(before)) return true
  if (DATE_PATTERN.test(afterTrimmed)) return true
  if (TRAILING_ROLE_PATTERN.test(afterTrimmed)) return true
  if (/[、，,]\s*$/.test(before) || /^\s*[、，,]/.test(after)) return true
  return false
}

export function extractSurnameAnchorEntities(sourceText) {
  if (!sourceText) return []
  const hits = []

  // 预先标记所有标签词覆盖区间，B/C/F 扫描时禁止候选与标签区间重叠（防"法定代表人"中切出"法定"）
  const labelRanges = []
  const allLabelRe = new RegExp(`(?:${LABEL_SOURCE})`, 'g')
  let lm
  while ((lm = allLabelRe.exec(sourceText)) !== null) {
    labelRanges.push({ start: lm.index, end: lm.index + lm[0].length })
  }
  const overlapsLabel = (start, end) => {
    for (const r of labelRanges) {
      if (start < r.end && end > r.start) return true
    }
    return false
  }

  const tryClaim = (start, end, text) => {
    for (const h of hits) {
      if (start < h.end && end > h.start) return
    }
    hits.push({ start, end, text })
  }

  // 锚点 A/E：标签后裸名（含换行/空白）
  let m
  LABEL_ANCHOR_PATTERN.lastIndex = 0
  while ((m = LABEL_ANCHOR_PATTERN.exec(sourceText)) !== null) {
    const candStart = m.index + m[0].length
    const cand = extractNameAt(sourceText, candStart)
    if (cand) {
      tryClaim(candStart, candStart + cand.length, cand.name)
    }
  }

  // 锚点 D：顿号/逗号串联中的姓名
  SEPARATOR_ANCHOR_PATTERN.lastIndex = 0
  while ((m = SEPARATOR_ANCHOR_PATTERN.exec(sourceText)) !== null) {
    const candStart = m.index + m[0].length
    if (!validateLeftBoundary(sourceText, candStart)) continue
    const cand = extractNameAt(sourceText, candStart)
    if (!cand) continue
    const before = sourceText.slice(Math.max(0, candStart - 30), candStart)
    const hasNeighborName = /[、，,]\s*[\u4e00-\u9fa5]{2,4}\s*[、，,]/.test(`${before}${m[0]}`)
    const hasLabelNearby = LABEL_NEARBY_PATTERN.test(before)
    if (hasNeighborName || hasLabelNearby) {
      tryClaim(candStart, candStart + cand.length, cand.name)
    }
  }

  // 锚点 B/C/F：全文扫描 + 强信号约束（职务/日期/分隔符邻接），最容易误伤所以最严格
  for (let i = 0; i < sourceText.length; i += 1) {
    if (!validateLeftBoundary(sourceText, i)) continue
    const cand = extractNameAt(sourceText, i)
    if (!cand) continue
    const end = i + cand.length
    if (overlapsLabel(i, end)) continue
    if (!hasContractSignal(sourceText, i, end)) continue
    tryClaim(i, end, cand.name)
  }

  hits.sort((a, b) => a.start - b.start)
  return hits
}
