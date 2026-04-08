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
  bankCard: {
    label: '银行卡号',
    pattern: /(?<!\d)(\d{12,19})(?!\d)/g,
    replacer: (value) => `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`
  },
  uscc: {
    label: '统一社会信用代码',
    pattern: /(?<![A-Z0-9])([0-9A-Z]{18})(?![A-Z0-9])/g,
    replacer: (value) => `${value.slice(0, 4)}${'*'.repeat(10)}${value.slice(-4)}`
  },
  company: {
    label: '公司名称',
    pattern: /(?:甲方|乙方|丙方|我方|采购方|供应商)[：:\s]*([\u4e00-\u9fa5A-Za-z0-9（）()·]{4,40}(?:公司|集团|事务所|中心|研究院))/g,
    replacer: (value, companyName) => value.replace(companyName, '我司')
  },
  namedPerson: {
    label: '姓名',
    pattern: /(?:姓名|甲方代表|乙方代表|联系人|签署人)[：:\s]*([\u4e00-\u9fa5]{2,6})/g,
    replacer: (value, name) => value.replace(name, `${name[0]}${'*'.repeat(Math.max(name.length - 1, 1))}`)
  },
  address: {
    label: '地址',
    pattern: /([\u4e00-\u9fa5A-Za-z0-9\-]{4,60}(?:省|市|区|县|路|街道|大道|镇|乡)[\u4e00-\u9fa5A-Za-z0-9\-]{2,80})/g,
    replacer: (value) => {
      if (value.length <= 4) {
        return value
      }
      return `${value.slice(0, 2)}${'*'.repeat(Math.max(value.length - 4, 1))}${value.slice(-2)}`
    }
  }
}

export const presetTypeOptions = Object.entries(presetTypes).map(([value, item]) => ({
  value,
  label: item.label
}))

function applyRule(sourceText, rule, hitList) {
  return sourceText.replace(rule.pattern, (...args) => {
    const value = args[0]
    const masked = rule.replacer(...args)
    if (value !== masked) {
      hitList.push({
        type: rule.label,
        original: value,
        masked
      })
    }
    return masked
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
  customWords
}) {
  const hitList = []
  let maskedText = text

  if (enableSmart) {
    enabledTypes.forEach((type) => {
      const rule = presetTypes[type]
      if (rule) {
        maskedText = applyRule(maskedText, rule, hitList)
      }
    })
  }

  maskedText = maskCustomWords(maskedText, customWords, hitList)

  return {
    maskedText,
    hitList
  }
}
