import { invoke } from '@tauri-apps/api/core'
import { maskAddress, maskChineseName } from './desensitize'

const ADDRESS_LABEL_CONTEXT_PATTERN = /(?:注册地址|办公地址|联系地址|通讯地址|收货地址|交付地点|项目地址|送达地址|住所地|住\s*所|地\s*址)\s*(?:[：:]|为)?\s*$/
const ADDRESS_DETAIL_PATTERN = /(?:路|街道|大道|街|巷|镇|乡|村|里|号|栋|座|层|室|单元|园|厦|广场|楼|塔|阁|苑|城|大厦|写字楼|商场|商店|中心|园区|公寓)/
const ADDRESS_CHAR_PATTERN = /[\u4e00-\u9fa5A-Za-z0-9\-（）()·&]/
const ADDRESS_BREAK_PATTERN = /[，。,；;]/ 
const ADDRESS_SECTION_BREAK_PATTERN = /^(?:联系电话|电子邮箱|联系人|账户名称|开户银行|账\s*号|邮编|电话|邮箱|第[一二三四五六七八九十]|甲方|乙方|丙方|经甲乙双方|经双方|依据|本合同)/
const ADDRESS_TRAILING_BREAK_PATTERN = /\n\s*(?=(?:联系电话|电子邮箱|联系人|账户名称|开户银行|账\s*号|邮编|电话|邮箱|第[一二三四五六七八九十]|甲方|乙方|丙方|经甲乙双方|经双方|依据|本合同))/

function countTruthy(parts = []) {
  return parts.filter(Boolean).length
}

function sliceByChars(text, start, end) {
  return Array.from(text).slice(start, end).join('')
}

let parseAddressModulePromise = null

async function getParseAddress() {
  if (!parseAddressModulePromise) {
    parseAddressModulePromise = import('zh-address-parse').then((module) => module.default || module)
  }
  return parseAddressModulePromise
}

function trimAddressSpan(text, start, end) {
  const chars = Array.from(text)
  let nextStart = start
  let nextEnd = end

  while (nextStart < nextEnd && /[\s\u3000]/.test(chars[nextStart])) {
    nextStart += 1
  }

  while (nextEnd > nextStart && /[\s\u3000]/.test(chars[nextEnd - 1])) {
    nextEnd -= 1
  }

  return {
    start: nextStart,
    end: nextEnd,
    text: chars.slice(nextStart, nextEnd).join('')
  }
}

function expandAddressEntity(text, entity) {
  const chars = Array.from(text)
  const initial = trimAddressSpan(text, entity.start, entity.end)
  const context = sliceByChars(text, Math.max(0, initial.start - 18), initial.start)
  const hasAddressLabel = ADDRESS_LABEL_CONTEXT_PATTERN.test(context)
  const hasDetailHint = ADDRESS_DETAIL_PATTERN.test(initial.text)

  if (!hasAddressLabel && !hasDetailHint) {
    return initial
  }

  let nextStart = initial.start
  let nextEnd = initial.end

  while (nextStart > 0 && initial.end - nextStart < 48) {
    const previousChar = chars[nextStart - 1]
    if (ADDRESS_CHAR_PATTERN.test(previousChar)) {
      nextStart -= 1
      continue
    }

    if (/[\s\u3000]/.test(previousChar) && nextStart > 1 && ADDRESS_CHAR_PATTERN.test(chars[nextStart - 2])) {
      nextStart -= 1
      continue
    }

    break
  }

  while (nextEnd < chars.length && nextEnd - nextStart < 96) {
    const char = chars[nextEnd]
    const upcoming = sliceByChars(text, nextEnd, Math.min(chars.length, nextEnd + 8)).trimStart()

    if (upcoming && ADDRESS_SECTION_BREAK_PATTERN.test(upcoming)) {
      break
    }

    if (ADDRESS_BREAK_PATTERN.test(char)) {
      break
    }

    if (/[\s\u3000]/.test(char) || ADDRESS_CHAR_PATTERN.test(char)) {
      nextEnd += 1
      continue
    }

    break
  }

  const expanded = trimAddressSpan(text, nextStart, nextEnd)
  const trailingBreakMatch = expanded.text.match(ADDRESS_TRAILING_BREAK_PATTERN)

  if (!trailingBreakMatch || typeof trailingBreakMatch.index !== 'number') {
    return expanded
  }

  return trimAddressSpan(text, expanded.start, expanded.start + trailingBreakMatch.index)
}

async function isAddressCandidate(text, entity) {
  const candidate = entity.text?.replace(/\s+/g, '') || ''
  if (!candidate) {
    return false
  }

  const parseAddress = await getParseAddress()
  const parsed = parseAddress(candidate)
  const parsedScore = countTruthy([parsed.province, parsed.city, parsed.area]) + (parsed.detail ? 1 : 0)
  const hasDetail = ADDRESS_DETAIL_PATTERN.test(candidate) || ADDRESS_DETAIL_PATTERN.test(parsed.detail || '')
  const context = sliceByChars(text, Math.max(0, entity.start - 18), entity.start)
  const hasAddressLabel = ADDRESS_LABEL_CONTEXT_PATTERN.test(context)

  if (hasAddressLabel) {
    return parsedScore >= 1 && candidate.length >= 4
  }

  return hasDetail && parsedScore >= 2 && candidate.length >= 6
}

async function mapEntityToMask(text, entity, enabledTypes) {
  if (!entity?.text || !enabledTypes.includes(entity.type)) {
    return null
  }

  if (entity.type === 'company') {
    return {
      start: entity.start,
      end: entity.end,
      type: '公司名称',
      masked: '我司'
    }
  }

  if (entity.type === 'namedPerson') {
    return {
      start: entity.start,
      end: entity.end,
      type: '姓名',
      masked: maskChineseName(entity.text)
    }
  }

  if (entity.type === 'address') {
    const expandedEntity = expandAddressEntity(text, entity)
    if (!await isAddressCandidate(text, expandedEntity)) {
      return null
    }

    return {
      start: expandedEntity.start,
      end: expandedEntity.end,
      type: '地址',
      masked: maskAddress(expandedEntity.text.replace(/\s+/g, ''))
    }
  }

  return null
}

async function normalizeEntities(text, entities, enabledTypes) {
  const normalized = await Promise.all(
    (entities || []).map(async (item) => mapEntityToMask(text, {
      ...item,
      text: item.text || sliceByChars(text, item.start, item.end)
    }, enabledTypes))
  )

  return normalized
    .filter(Boolean)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start
      }
      return right.end - left.end
    })
}

export async function detectPreciseChineseEntities(text, enabledTypes = []) {
  const targetTypes = enabledTypes.filter((type) => ['company', 'namedPerson', 'address'].includes(type))
  if (!text?.trim() || !targetTypes.length) {
    return []
  }

  try {
    const entities = await invoke('detect_chinese_entities', { text })
    return await normalizeEntities(text, entities, targetTypes)
  } catch (error) {
    console.warn('detect_chinese_entities failed, fallback to JS rules only', error)
    return []
  }
}
