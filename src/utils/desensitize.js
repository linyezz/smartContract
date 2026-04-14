import * as bankcard from 'bankcard'

const COMPANY_PATTERN = /(?<![\u4e00-\u9fa5A-Za-z0-9])([\u4e00-\u9fa5A-Za-z0-9（）()·&\s]{4,120}?(?:有\s*限\s*责\s*任\s*公\s*司|股\s*份\s*有\s*限\s*公\s*司|有\s*限\s*公\s*司|公\s*司|集\s*团|事\s*务\s*所|中\s*心|研\s*究\s*院))(?![\u4e00-\u9fa5A-Za-z0-9])/g
const LABELED_NAME_PATTERN = /((?:姓\s*名|甲\s*方\s*代\s*表|乙\s*方\s*代\s*表|联\s*系\s*人|指\s*定\s*联\s*系\s*人|签\s*署\s*人|法\s*定\s*代\s*表\s*人|收\s*货\s*人|接\s*货\s*人)\s*(?:[：:]|为)\s*)([\u4e00-\u9fa5][\s\u3000]*[\u4e00-\u9fa5](?:[\s\u3000]*[\u4e00-\u9fa5]){0,4})/g
const HONORIFIC_NAME_PATTERN = /(?<![\u4e00-\u9fa5])([\u4e00-\u9fa5]{2,4})(?=\s*(?:先生|女士))/g
const EMAIL_PATTERN = /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,})(?![A-Za-z0-9._%+-])/g
const BANK_CARD_CANDIDATE_PATTERN = /(?<!\d)(?:\d[\s\u3000\r\n-]{0,4}){11,24}\d(?!\d)/g
const BANK_ACCOUNT_LABEL_SOURCE =
  '账\\s*号|账号|开户账号|银行账号|收款账号|银行卡号|银行账户|银行帐户|收款账户|收款帐户|对公账号|对公账户|对公帐户|账户号|账户号码|帐户号|帐户号码|付款账号|付款账户|付款帐户|结算账号|结算账户|结算帐户|汇款账号|汇款账户|汇款帐户'
const BANK_CARD_SECTION_STOP_SOURCE =
  '\\d+\\.\\d+|第[一二三四五六七八九十]|甲方|乙方|丙方|开户银行|账户名称|联系电话|电子邮箱|联系地址|地址'
const BANK_ACCOUNT_LABEL_PATTERN = new RegExp(`(?:${BANK_ACCOUNT_LABEL_SOURCE})`)
const BANK_ACCOUNT_CONTEXT_PATTERN = /(?:开户银行|开户行|收款银行|付款银行|银行|账户名称|账户名|户名|账号|账户|帐户|收款|汇款|对公|付款|结算)/
const LABELED_BANK_CARD_PATTERN = new RegExp(
  `((?:${BANK_ACCOUNT_LABEL_SOURCE})\\s*(?:[：:]|为)?\\s*)((?:\\d[\\s\\u3000\\r\\n-]{0,4}){11,24}\\d)(?=(?:\\s*$|\\s*[，。,；;]|\\n\\s*(?:${BANK_CARD_SECTION_STOP_SOURCE})))`,
  'g'
)
const ADDRESS_BODY_SOURCE =
  '(?:[\\u4e00-\\u9fa5]{2,12}(?:省|市|自治区|特别行政区))?(?:[\\u4e00-\\u9fa5]{2,12}(?:市|州|盟))?(?:[\\u4e00-\\u9fa5]{2,12}(?:区|县|旗))?(?:[\\u4e00-\\u9fa5A-Za-z0-9]{2,24}(?:街道|大道|路|街|巷|镇|乡|村|里))[\\u4e00-\\u9fa5A-Za-z0-9号弄室层栋座单元园厦广场楼馆塔阁苑城店铺写字楼商场大厦\\-]{1,80}'
const ADDRESS_HINT_PATTERN = /(?:省|市|自治区|特别行政区|州|盟|区|县|旗|街道|大道|路|街|巷|镇|乡|村|里|号|栋|座|层|室|单元|园|厦|广场|楼|塔|阁|苑|城|大厦|写字楼|商场|商店|中心|园区|公寓)/
const ADDRESS_DETAIL_TAIL_SOURCE = '[\\u4e00-\\u9fa5A-Za-z0-9号弄室层栋座单元园厦广场楼馆塔阁苑城店铺写字楼商场大厦\\-\\s]{1,80}'
const MULTILINE_ADDRESS_CANDIDATE_SOURCE = '[\\u4e00-\\u9fa5A-Za-z0-9号弄室层栋座单元园厦广场楼馆塔阁苑城店铺写字楼商场大厦\\-\\s]{4,120}?'
const ADDRESS_SECTION_STOP_SOURCE =
  '联系电话|电子邮箱|联系人|账户名称|开户银行|账\\s*号|邮编|电话|邮箱|第[一二三四五六七八九十]|甲方|乙方|丙方|经甲乙双方|经双方|依据|本合同'
const ADDRESS_BOUNDARY_PATTERN = new RegExp(`(?<![\\u4e00-\\u9fa5A-Za-z0-9])(${ADDRESS_BODY_SOURCE})(?![\\u4e00-\\u9fa5A-Za-z0-9])`, 'g')
const RELAXED_ADDRESS_BOUNDARY_PATTERN = new RegExp(
  `(?<![\\u4e00-\\u9fa5A-Za-z0-9])((?:[\\u4e00-\\u9fa5]{2,12}\\s*(?:省|市|自治区|特别行政区))?(?:[\\u4e00-\\u9fa5]{2,12}\\s*(?:市|州|盟))?(?:[\\u4e00-\\u9fa5]{2,12}\\s*(?:区|县|旗))?(?:[\\u4e00-\\u9fa5A-Za-z0-9]{2,24}\\s*(?:街道|大道|路|街|巷|镇|乡|村|里))${ADDRESS_DETAIL_TAIL_SOURCE})(?=(?:\\s*$|\\s*[，。,；;]|\\n\\s*(?:${ADDRESS_SECTION_STOP_SOURCE})))`,
  'g'
)
const LABELED_ADDRESS_PATTERN = new RegExp(
  `((?:注册地址|办公地址|联系地址|通讯地址|收货地址|交付地点|项目地址|送达地址|住所地|住\\s*所|地\\s*址)\\s*(?:[：:]|为)\\s*)(${ADDRESS_BODY_SOURCE})`,
  'g'
)
const LABELED_MULTILINE_ADDRESS_PATTERN = new RegExp(
  `((?:注册地址|办公地址|联系地址|通讯地址|收货地址|交付地点|项目地址|送达地址|住所地|住\\s*所|地\\s*址)\\s*(?:[：:]|为)\\s*)(${MULTILINE_ADDRESS_CANDIDATE_SOURCE})(?=(?:\\s*$|\\s*[，。,；;]|\\n\\s*(?:${ADDRESS_SECTION_STOP_SOURCE})))`,
  'g'
)
const PRICE_LABEL_SOURCE =
  '人民币|价税合计|合同(?:总)?金额|总价|金额|单价|合计金额|货物价格|结算金额|不含税金额|含税金额|服务费(?:合计)?|租金|报价|成交价|优惠后价格|价格|费用'
const CURRENCY_PREFIX_SOURCE = '人民币|RMB|CNY|USD|HKD|EUR|￥|¥|\\$'
const PRICE_UNIT_SOURCE = '元|万元|亿元|万|亿'
const LABELED_PRICE_PATTERN = new RegExp(
  `((?:${PRICE_LABEL_SOURCE})[：:\\s（(含税税）)]{0,16})((?:${CURRENCY_PREFIX_SOURCE})\\s*)?(\\d{1,3}(?:[,\\s，]\\d{3})+|\\d+)(\\.\\d{1,2})?(\\s*(?:${PRICE_UNIT_SOURCE})?(?:整)?(?:\\/(?:月|年|天|次))?)?(?=(?:\\s*(?:含税|不含税|[，。,；;）)]|$)))`,
  'g'
)
const CURRENCY_PRICE_PATTERN = new RegExp(
  `((?:${CURRENCY_PREFIX_SOURCE})\\s*)(\\d{1,3}(?:[,\\s，]\\d{3})+|\\d+)(\\.\\d{1,2})?(\\s*(?:${PRICE_UNIT_SOURCE})?(?:整)?(?:\\/(?:月|年|天|次))?)`,
  'g'
)
const UNIT_PRICE_PATTERN = new RegExp(
  `(\\d{1,3}(?:[,\\s，]\\d{3})+|\\d+)(\\.\\d{1,2})?(\\s*(?:${PRICE_UNIT_SOURCE})(?:整)?(?:\\/(?:月|年|天|次))?)`,
  'g'
)
const PRICE_RANGE_PATTERN = new RegExp(
  `((?:${CURRENCY_PREFIX_SOURCE})?\\s*)(\\d{1,3}(?:[,\\s，]\\d{3})+|\\d+)(\\.\\d{1,2})?\\s*([-~至])\\s*((?:${CURRENCY_PREFIX_SOURCE})?\\s*)(\\d{1,3}(?:[,\\s，]\\d{3})+|\\d+)(\\.\\d{1,2})?(\\s*(?:${PRICE_UNIT_SOURCE})(?:整)?(?:\\/(?:月|年|天|次))?)`,
  'g'
)
const INLINE_TABLE_PRICE_PATTERN = /(单价\s*)(\d+(?:\.\d{1,2})?)(.*?合计(?:金额)?\s*)(\d+(?:\.\d{1,2})?)/g
const CHINESE_PRICE_PATTERN = /(大\s*写[：:\s]*)([零壹贰叁肆伍陆柒捌玖拾佰仟万亿兆角分\s]{2,40}(?:元|圆)(?:[零壹贰叁肆伍陆柒捌玖拾佰仟万亿兆角分整\s]{0,12}))/g
const STANDALONE_CHINESE_PRICE_PATTERN = /(?<![\u4e00-\u9fa5])([零壹贰叁肆伍陆柒捌玖拾佰仟万亿兆角分\s]{2,40}(?:元|圆)(?:[零壹贰叁肆伍陆柒捌玖拾佰仟万亿兆角分整\s]{0,12}))(?![\u4e00-\u9fa5])/g

const presetTypes = {
  idCard: {
    label: '身份证号',
    pattern: /(?<!\d)(\d{17}[\dXx])(?!\d)/g,
    replacer: (value) => `${value.slice(0, 3)}${'*'.repeat(14)}${value.slice(-1)}`
  },
  mobile: {
    label: '手机号/座机',
    pattern: /(?<!\d)(1[3-9]\d{9}|0\d{2,3}-?\d{7,8})(?!\d)/g,
    replacer: (value) => {
      if (value.includes('-')) {
        const digits = value.replace(/\D/g, '')
        return value.replace(digits.slice(3, -2), '*'.repeat(Math.max(digits.length - 5, 1)))
      }
      return `${value.slice(0, 3)}****${value.slice(-4)}`
    }
  },
  email: {
    label: '邮箱',
    pattern: EMAIL_PATTERN,
    replacer: (value) => maskEmail(value)
  },
  bankCard: {
    label: '银行卡号',
    pattern: BANK_CARD_CANDIDATE_PATTERN,
    replacer: (value) => maskBankCardValue(value)
  },
  uscc: {
    label: '统一社会信用代码',
    pattern: /(?<![A-Z0-9])([0-9A-Z]{18})(?![A-Z0-9])/g,
    replacer: (value) => `${value.slice(0, 4)}${'*'.repeat(10)}${value.slice(-4)}`
  },
  company: {
    label: '公司名称',
    pattern: COMPANY_PATTERN,
    replacer: () => '我司'
  },
  namedPerson: {
    label: '姓名',
    pattern: LABELED_NAME_PATTERN,
    replacer: (value, prefix, name) => `${prefix}${maskChineseName(name)}`
  },
  address: {
    label: '地址',
    pattern: ADDRESS_BOUNDARY_PATTERN,
    replacer: (value) => maskAddress(value)
  },
  price: {
    label: '价格',
    pattern: UNIT_PRICE_PATTERN,
    replacer: (value) => maskPriceValue(value)
  }
}

export function maskChineseName(value) {
  const chars = (value.match(/[\u4e00-\u9fa5]/g) || [])
  if (!chars.length) {
    return value
  }
  return `${chars[0]}${'*'.repeat(Math.max(chars.length - 1, 1))}`
}

function maskVisibleSegment(value) {
  if (!value) {
    return value
  }
  if (value.length <= 2) {
    return `${value[0]}*`
  }
  return `${value[0]}${'*'.repeat(Math.max(value.length - 2, 1))}${value.slice(-1)}`
}

function maskEmail(value) {
  const [localPart = '', domainPart = ''] = value.split('@')
  if (!domainPart) {
    return '***'
  }

  const domainSegments = domainPart.split('.')
  const host = domainSegments.shift() || ''
  const suffix = domainSegments.length ? `.${domainSegments.join('.')}` : ''
  return `${maskVisibleSegment(localPart)}@${maskVisibleSegment(host)}${suffix}`
}

function normalizeBankCardCandidate(value) {
  return String(value || '').replace(/\D/g, '')
}

function maskBankCardDigits(value) {
  if (value.length <= 8) {
    return `${value.slice(0, 1)}${'*'.repeat(Math.max(value.length - 2, 1))}${value.slice(-1)}`
  }
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(value.length - 8, 1))}${value.slice(-4)}`
}

function maskBankCardValue(value) {
  const digits = normalizeBankCardCandidate(value)
  const maskedDigits = maskBankCardDigits(digits)
  let digitIndex = 0

  return String(value || '').replace(/\d/g, () => {
    const replacement = maskedDigits[digitIndex]
    digitIndex += 1
    return replacement || '*'
  })
}

function isBankCardCandidate(value) {
  const digits = normalizeBankCardCandidate(value)
  if (digits.length < 12 || digits.length > 24) {
    return false
  }

  const validation = bankcard.validateCardInfo(digits)
  return Boolean(validation?.validated)
}

function hasBankContextAround(sourceText, offset, valueLength) {
  const safeOffset = Number(offset || 0)
  const safeLength = Number(valueLength || 0)
  const start = Math.max(safeOffset - 20, 0)
  const end = Math.min(safeOffset + safeLength + 20, sourceText.length)
  return BANK_ACCOUNT_CONTEXT_PATTERN.test(sourceText.slice(start, end))
}

function isLikelyBankAccountByBin(value) {
  const digits = normalizeBankCardCandidate(value)
  if (digits.length < 12 || digits.length > 24) {
    return false
  }

  return Boolean(bankcard.searchCardBin(digits))
}

function isLikelyBankCardInLabelContext(value, label = '') {
  const digits = normalizeBankCardCandidate(value)
  if (digits.length < 12 || digits.length > 24) {
    return false
  }

  if (isBankCardCandidate(digits) || isLikelyBankAccountByBin(digits)) {
    return true
  }

  return digits.length >= 12 && BANK_ACCOUNT_LABEL_PATTERN.test(label)
}

function isLikelyStandaloneBankAccount(value, offset, sourceText) {
  const digits = normalizeBankCardCandidate(value)
  if (digits.length < 14 || digits.length > 24) {
    return false
  }

  if (isBankCardCandidate(digits) || isLikelyBankAccountByBin(digits)) {
    return true
  }

  if (!sourceText || !hasBankContextAround(sourceText, offset, value.length)) {
    return false
  }

  return digits.length >= 16
}

export function maskAddress(value) {
  if (value.length <= 6) {
    return `${value.slice(0, 1)}${'*'.repeat(Math.max(value.length - 2, 1))}${value.slice(-1)}`
  }
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(value.length - 4, 1))}${value.slice(-2)}`
}

function normalizeAddressCandidate(value) {
  return String(value || '').replace(/[ \t]+$/g, '').trim()
}

function isLikelyAddress(value) {
  const normalized = normalizeAddressCandidate(value)
  return normalized.replace(/\s+/g, '').length >= 4 && ADDRESS_HINT_PATTERN.test(normalized)
}

function maskPriceValue(value) {
  const numericMatch = value.match(
    new RegExp(`^(.*?)(\\d[\\d,\\s，]*(?:\\.\\d{1,2})?)(\\s*(?:${PRICE_UNIT_SOURCE})?(?:整)?(?:\\/(?:月|年|天|次))?)$`)
  )
  if (numericMatch) {
    const [, prefix, , suffix] = numericMatch
    return `${prefix}***${suffix}`
  }

  const chineseMatch = value.match(/^(.*?)([零壹贰叁肆伍陆柒捌玖拾佰仟万亿兆角分\s]*)(元|圆)([零壹贰叁肆伍陆柒捌玖拾佰仟万亿兆角分整\s]*)$/)
  if (chineseMatch) {
    const [, prefix, , unit, suffix] = chineseMatch
    return `${prefix}***${unit}${suffix}`
  }

  return '***'
}

export const presetTypeOptions = Object.entries(presetTypes).map(([value, item]) => ({
  value,
  label: item.label
}))

function applyRule(sourceText, rule, hitList, source = 'regex') {
  return sourceText.replace(rule.pattern, (...args) => {
    const value = args[0]
    const masked = rule.replacer(...args)
    if (value !== masked) {
      hitList.push({
        source,
        type: rule.label,
        original: value,
        masked
      })
    }
    return masked
  })
}

function applyRegex(sourceText, pattern, label, replacer, hitList, source = 'regex') {
  return sourceText.replace(pattern, (...args) => {
    const value = args[0]
    const masked = replacer(...args)
    if (value !== masked) {
      hitList.push({
        source,
        type: label,
        original: value,
        masked
      })
    }
    return masked
  })
}

function applyCompanyRule(sourceText, hitList) {
  return applyRegex(sourceText, COMPANY_PATTERN, '公司名称', () => '我司', hitList)
}

function applyNamedPersonRule(sourceText, hitList) {
  let nextText = applyRegex(
    sourceText,
    LABELED_NAME_PATTERN,
    '姓名',
    (value, prefix, name) => `${prefix}${maskChineseName(name)}`,
    hitList
  )

  nextText = applyRegex(
    nextText,
    HONORIFIC_NAME_PATTERN,
    '姓名',
    (value) => maskChineseName(value),
    hitList
  )

  return nextText
}

function applyBankCardRule(sourceText, hitList) {
  let nextText = applyRegex(
    sourceText,
    LABELED_BANK_CARD_PATTERN,
    '银行账号',
    (value, prefix, accountNumber) => {
      if (!isLikelyBankCardInLabelContext(accountNumber, prefix)) {
        return value
      }
      return `${prefix}${maskBankCardValue(accountNumber)}`
    },
    hitList
  )

  nextText = applyRegex(
    nextText,
    BANK_CARD_CANDIDATE_PATTERN,
    '银行账号',
    (value, offset, fullText) => {
      if (!isLikelyStandaloneBankAccount(value, offset, fullText)) {
        return value
      }
      return maskBankCardValue(value)
    },
    hitList
  )

  return nextText
}

function applyAddressRule(sourceText, hitList) {
  let nextText = applyRegex(
    sourceText,
    LABELED_MULTILINE_ADDRESS_PATTERN,
    '地址',
    (value, prefix, address) => {
      const candidate = normalizeAddressCandidate(address)
      if (!isLikelyAddress(candidate)) {
        return value
      }
      return `${prefix}${maskAddress(candidate.replace(/\s+/g, ''))}`
    },
    hitList
  )

  nextText = applyRegex(
    nextText,
    LABELED_ADDRESS_PATTERN,
    '地址',
    (value, prefix, address) => `${prefix}${maskAddress(address)}`,
    hitList
  )

  nextText = applyRegex(
    nextText,
    RELAXED_ADDRESS_BOUNDARY_PATTERN,
    '地址',
    (value) => {
      const candidate = normalizeAddressCandidate(value)
      if (!isLikelyAddress(candidate)) {
        return value
      }
      return maskAddress(candidate.replace(/\s+/g, ''))
    },
    hitList
  )

  nextText = applyRegex(nextText, ADDRESS_BOUNDARY_PATTERN, '地址', (value) => maskAddress(value), hitList)
  return nextText
}

function maskTrailingPriceTokens(line) {
  const tokenPattern = /\d+(?:\.\d+)?/g
  const matches = [...line.matchAll(tokenPattern)]
  if (matches.length < 2) {
    return line
  }

  const tailMatches = matches.slice(-2)
  let nextLine = line

  tailMatches.reverse().forEach((match) => {
    const value = match[0]
    const index = match.index
    if (typeof index !== 'number') {
      return
    }
    nextLine = `${nextLine.slice(0, index)}***${nextLine.slice(index + value.length)}`
  })

  return nextLine
}

function applyTablePriceRule(sourceText, hitList) {
  const lines = sourceText.split('\n')
  let tableMode = false

  const nextLines = lines.map((line) => {
    const trimmed = line.trim()

    if (!trimmed) {
      tableMode = false
      return line
    }

    if (/单价.*合计金额|采购产品明细表/.test(trimmed)) {
      tableMode = true
      return line
    }

    if (!tableMode) {
      return line
    }

    if (/^备注\b|^版本号/.test(trimmed)) {
      tableMode = false
      return line
    }

    if (/^\d+\s+/.test(trimmed)) {
      const masked = maskTrailingPriceTokens(line)
      if (masked !== line) {
        hitList.push({
          type: '价格',
          original: line,
          masked
        })
      }
      return masked
    }

    return line
  })

  return nextLines.join('\n')
}

function applyPriceRule(sourceText, hitList) {
  let nextText = applyTablePriceRule(sourceText, hitList)

  nextText = applyRegex(
    nextText,
    INLINE_TABLE_PRICE_PATTERN,
    '价格',
    (value, unitPrefix, unitValue, totalPrefix, totalValue) => `${unitPrefix}***${totalPrefix}***`,
    hitList
  )

  nextText = applyRegex(
    nextText,
    PRICE_RANGE_PATTERN,
    '价格',
    (value, leftPrefix = '', leftInteger = '', leftDecimal = '', separator = '-', rightPrefix = '', rightInteger = '', rightDecimal = '', suffix = '') =>
      `${leftPrefix}***${separator}${rightPrefix || ''}***${suffix}`,
    hitList
  )

  nextText = applyRegex(
    nextText,
    LABELED_PRICE_PATTERN,
    '价格',
    (value, prefix, currencyPrefix = '', integerPart, decimalPart = '', suffix = '') =>
      `${prefix}${currencyPrefix || ''}***${suffix}`,
    hitList
  )

  nextText = applyRegex(nextText, CHINESE_PRICE_PATTERN, '价格', (value, prefix, amount) => {
    const unitMatch = amount.match(/(元|圆)([零壹贰叁肆伍陆柒捌玖拾佰仟万亿兆角分整\s]*)$/)
    if (!unitMatch) {
      return `${prefix}***`
    }
    return `${prefix}***${unitMatch[1]}${unitMatch[2]}`
  }, hitList)

  nextText = applyRegex(nextText, STANDALONE_CHINESE_PRICE_PATTERN, '价格', (value, amount) => {
    const unitMatch = amount.match(/(元|圆)([零壹贰叁肆伍陆柒捌玖拾佰仟万亿兆角分整\s]*)$/)
    if (!unitMatch) {
      return '***'
    }
    return `***${unitMatch[1]}${unitMatch[2]}`
  }, hitList)

  nextText = applyRegex(nextText, CURRENCY_PRICE_PATTERN, '价格', (value) => maskPriceValue(value), hitList)
  nextText = applyRegex(nextText, UNIT_PRICE_PATTERN, '价格', (value) => maskPriceValue(value), hitList)
  return nextText
}

function normalizeExternalEntities(entities = []) {
  return [...entities]
    .filter((item) => item && typeof item.start === 'number' && typeof item.end === 'number' && item.end > item.start)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start
      }
      return right.end - left.end
    })
    .reduce((result, current) => {
      const previous = result[result.length - 1]
      if (!previous || current.start >= previous.end) {
        result.push(current)
      }
      return result
    }, [])
}

function applyExternalEntities(sourceText, entities = [], hitList) {
  const chars = Array.from(sourceText)
  const replacements = normalizeExternalEntities(entities)

  replacements
    .slice()
    .sort((left, right) => right.start - left.start)
    .forEach((item) => {
      const original = chars.slice(item.start, item.end).join('')
      if (!original) {
        return
      }
      chars.splice(item.start, item.end - item.start, item.masked)
      hitList.push({
        source: 'external',
        type: item.type,
        original,
        masked: item.masked
      })
    })

  return chars.join('')
}

function applySelectedSmartRules(sourceText, enabledTypes, hitList) {
  let maskedText = sourceText

  enabledTypes.forEach((type) => {
    const rule = presetTypes[type]
    if (rule) {
      if (type === 'company') {
        maskedText = applyCompanyRule(maskedText, hitList)
      } else if (type === 'namedPerson') {
        maskedText = applyNamedPersonRule(maskedText, hitList)
      } else if (type === 'bankCard') {
        maskedText = applyBankCardRule(maskedText, hitList)
      } else if (type === 'address') {
        maskedText = applyAddressRule(maskedText, hitList)
      } else if (type === 'price') {
        maskedText = applyPriceRule(maskedText, hitList)
      } else {
        maskedText = applyRule(maskedText, rule, hitList)
      }
    }
  })

  return maskedText
}

function dedupeHitList(hitList) {
  const seen = new Set()
  return hitList.filter((item) => {
    const key = `${item.type}::${item.original}::${item.masked}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export function maskCustomWords(text, words = [], hitList) {
  let result = text
  words
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .forEach((word) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(escaped, 'g')
      result = result.replace(pattern, (value) => {
        hitList.push({
          source: 'custom',
          type: '自定义词',
          original: value,
          masked: '***'
        })
        return '***'
      })
    })
  return result
}

export function desensitizeText({
  text,
  enableSmart,
  enabledTypes,
  customWords,
  externalEntities = []
}) {
  const hitList = []
  let maskedText = text

  if (enableSmart) {
    maskedText = applyExternalEntities(maskedText, externalEntities, hitList)
    maskedText = applySelectedSmartRules(maskedText, enabledTypes, hitList)
  }

  maskedText = maskCustomWords(maskedText, customWords, hitList)

  return {
    maskedText,
    hitList: dedupeHitList(hitList)
  }
}
