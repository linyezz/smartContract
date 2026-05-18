import { invoke } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import OpenAI from 'openai'

const TYPE_LABEL_MAP = {
  idCard: '身份证号',
  mobile: '手机号/座机',
  email: '邮箱',
  bankCard: '银行卡号',
  taxpayerId: '纳税人识别号',
  accountBank: '开户行',
  uscc: '统一社会信用代码',
  company: '公司名称',
  namedPerson: '姓名',
  address: '地址',
  price: '价格'
}
const isDev = import.meta.env.DEV

let llmConfigPromise = null

function debugLlmRecognition(stage, payload) {
  if (!isDev) {
    return
  }

  console.groupCollapsed(`[LLM脱敏识别] ${stage}`)
  console.log(payload)
  console.groupEnd()
}

function warnLlmRecognition(stage, payload) {
  console.warn(`[LLM脱敏识别] ${stage}`, payload)
}

function maskSecret(value) {
  const raw = String(value || '')
  if (!raw) {
    return ''
  }
  return `${raw.slice(0, 6)}***${raw.slice(-4)}`
}

function buildDebugConfig(config) {
  return {
    enabled: Boolean(config?.enabled),
    baseUrl: config?.baseUrl || '',
    model: config?.model || '',
    hasApiKey: Boolean(config?.apiKey),
    apiKeyPreview: maskSecret(config?.apiKey),
    thinking: config?.thinking,
    reasoningEffort: config?.reasoningEffort,
    timeoutSeconds: config?.timeoutSeconds
  }
}

function buildDebugError(error) {
  return {
    name: error?.name || '',
    message: error?.message || String(error),
    status: error?.status,
    code: error?.code,
    type: error?.type,
    headers: error?.headers,
    cause: error?.cause,
    stack: error?.stack
  }
}

async function loadLlmConfigFromPublicAsset() {
  const response = await fetch('/llm-desensitize.config.json', {
    cache: 'no-store'
  })
  if (!response.ok) {
    throw new Error(`读取前端大模型配置失败：HTTP ${response.status}`)
  }
  return response.json()
}

async function loadLlmDesensitizeConfig() {
  if (!llmConfigPromise) {
    llmConfigPromise = loadLlmConfigFromPublicAsset()
      .then((config) => {
        debugLlmRecognition('配置读取成功：前端静态资源', buildDebugConfig(config))
        return config
      })
      .catch(async (assetError) => {
        debugLlmRecognition('前端静态配置读取失败，尝试读取 Tauri 资源配置', buildDebugError(assetError))
        warnLlmRecognition('配置读取失败，已跳过 JS SDK 大模型识别', buildDebugError(assetError))
        return {
          enabled: false
        }
      })
  }

  return llmConfigPromise
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__)
}

function createOpenAiClient(config) {
  const options = {
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: true
  }

  if (isTauriRuntime()) {
    options.fetch = tauriFetch
  }

  return new OpenAI(options)
}

function normalizeLlmType(value) {
  const normalized = String(value || '').trim()
  const aliasMap = {
    身份证号: 'idCard',
    身份证: 'idCard',
    手机号: 'mobile',
    座机: 'mobile',
    '手机号/座机': 'mobile',
    电话: 'mobile',
    邮箱: 'email',
    银行卡号: 'bankCard',
    银行账号: 'bankCard',
    账号: 'bankCard',
    纳税人识别号: 'taxpayerId',
    纳税人识别码: 'taxpayerId',
    税务登记号: 'taxpayerId',
    税号: 'taxpayerId',
    开户行: 'accountBank',
    开户银行: 'accountBank',
    收款银行: 'accountBank',
    付款银行: 'accountBank',
    开户网点: 'accountBank',
    开户支行: 'accountBank',
    统一社会信用代码: 'uscc',
    社会信用代码: 'uscc',
    公司名称: 'company',
    企业名称: 'company',
    姓名: 'namedPerson',
    人名: 'namedPerson',
    地址: 'address',
    价格: 'price',
    金额: 'price'
  }
  return TYPE_LABEL_MAP[normalized] ? normalized : aliasMap[normalized] || ''
}

function sliceByChars(text, start, end) {
  return Array.from(text).slice(start, end).join('')
}

function byteIndexToCharIndex(text, byteIndex) {
  return Array.from(text.slice(0, byteIndex)).length
}

function findEntitySpan(text, entityText) {
  const trimmed = String(entityText || '').trim()
  if (!trimmed) {
    return null
  }

  const byteIndex = text.indexOf(trimmed)
  if (byteIndex < 0) {
    return null
  }

  const start = byteIndexToCharIndex(text, byteIndex)
  return {
    start,
    end: start + Array.from(trimmed).length
  }
}

function stripMarkdownJsonFence(value) {
  return String(value || '')
    .trim()
    .replace(/^```(?:json|JSON)?\s*/u, '')
    .replace(/\s*```$/u, '')
    .trim()
}

function removeTrailingJsonCommas(value) {
  return String(value || '').replace(/,\s*([}\]])/gu, '$1')
}

function normalizePossiblyEscapedJson(value) {
  const raw = String(value || '')
  if (!raw.includes('"text"') && !raw.includes('"type"') && (raw.includes('\\"text\\"') || raw.includes('\\"type\\"'))) {
    return raw.replace(/\\"/gu, '"')
  }
  return raw
}

function repairLlmJsonNumericFields(value) {
  return String(value || '').replace(
    /("(?:start|end)"\s*:\s*-?\d+)[^\r\n,}\]]*(?=,)/gu,
    '$1'
  )
}

function findBalancedJsonSlice(value) {
  const raw = String(value || '')
  const openers = new Set(['[', '{'])
  const closerMap = {
    '[': ']',
    '{': '}'
  }

  for (let start = 0; start < raw.length; start += 1) {
    const opener = raw[start]
    if (!openers.has(opener)) {
      continue
    }

    const stack = [closerMap[opener]]
    let inString = false
    let escaped = false

    for (let index = start + 1; index < raw.length; index += 1) {
      const char = raw[index]

      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = !inString
        continue
      }
      if (inString) {
        continue
      }
      if (openers.has(char)) {
        stack.push(closerMap[char])
        continue
      }
      if (char === stack[stack.length - 1]) {
        stack.pop()
        if (!stack.length) {
          return raw.slice(start, index + 1)
        }
      }
    }
  }

  return ''
}

function prepareLlmJsonText(value) {
  return removeTrailingJsonCommas(
    repairLlmJsonNumericFields(
      normalizePossiblyEscapedJson(
        stripMarkdownJsonFence(value)
      )
    )
  )
}

function collectBalancedJsonObjects(value) {
  const raw = String(value || '')
  const objects = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]

    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) {
      continue
    }
    if (char === '{') {
      if (depth === 0) {
        start = index
      }
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        objects.push(raw.slice(start, index + 1))
        start = -1
      }
    }
  }

  return objects
}

function parseLlmJsonObjectsFallback(value, originalError) {
  const objectSlices = collectBalancedJsonObjects(value)
  const parsedObjects = []
  const errors = []

  for (const objectSlice of objectSlices) {
    try {
      parsedObjects.push(JSON.parse(removeTrailingJsonCommas(objectSlice)))
    } catch (error) {
      errors.push({
        error: buildDebugError(error),
        objectSlice
      })
    }
  }

  if (parsedObjects.length) {
    debugLlmRecognition('JSON 解析兜底：按对象片段恢复数组', {
      originalError: buildDebugError(originalError),
      totalObjectSlices: objectSlices.length,
      recoveredCount: parsedObjects.length,
      droppedCount: errors.length,
      errors
    })
    return parsedObjects
  }

  throw originalError
}

function parseLlmJsonCandidate(value) {
  const cleaned = prepareLlmJsonText(value)
  try {
    return JSON.parse(cleaned)
  } catch (error) {
    return parseLlmJsonObjectsFallback(cleaned, error)
  }
}

function extractJsonFromLlmContent(content) {
  const raw = String(content || '').trim()
  if (!raw) {
    return []
  }

  try {
    return parseLlmJsonCandidate(raw)
  } catch (directError) {
    const preparedRaw = prepareLlmJsonText(raw)
    const jsonSlice = findBalancedJsonSlice(preparedRaw)
    if (!jsonSlice) {
      debugLlmRecognition('JSON 解析失败：未找到完整 JSON 片段', {
        error: buildDebugError(directError),
        rawContent: raw,
        preparedRaw
      })
      throw new Error(`大模型返回内容中没有可解析 JSON：${raw}`)
    }

    try {
      return parseLlmJsonCandidate(jsonSlice)
    } catch (sliceError) {
      debugLlmRecognition('JSON 解析失败：完整片段解析失败', {
        directError: buildDebugError(directError),
        sliceError: buildDebugError(sliceError),
        rawContent: raw,
        jsonSlice
      })
      throw sliceError
    }
  }
}

function normalizeLlmEntityResponse(text, payload, enabledTypes) {
  const rawEntities = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.entities)
      ? payload.entities
      : payload && typeof payload === 'object'
        ? [payload]
        : []

  return rawEntities
    .map((item) => {
      const type = normalizeLlmType(item?.type)
      if (!type) {
        return null
      }

      let start = Number(item?.start)
      let end = Number(item?.end)
      const textFromRange = Number.isFinite(start) && Number.isFinite(end) && end > start
        ? sliceByChars(text, start, end)
        : ''

      if (!textFromRange || (item?.text && String(item.text).trim() !== textFromRange.trim())) {
        const span = findEntitySpan(text, item?.text)
        if (!span) {
          return null
        }
        start = span.start
        end = span.end
      }

      return {
        start,
        end,
        text: sliceByChars(text, start, end),
        type,
        masked: '***',
        source: 'llm'
      }
    })
    .filter(Boolean)
}

function buildLlmMessages(text, enabledTypes = []) {
  const typeList = enabledTypes.join(', ')
  return [
    {
      role: 'system',
      content: '你是合同脱敏识别助手，只输出严格 JSON。识别身份证号、手机号/座机、邮箱、银行卡号、纳税人识别号、开户行、统一社会信用代码、公司名称、姓名、地址、价格等敏感信息。'
    },
    {
      role: 'user',
      content: `请识别下面合同文本中的敏感信息。只返回 JSON 数组，不要解释，不要使用 Markdown 代码块。JSON 每项包含 text、type、start、end。start/end 使用从 0 开始的 Unicode 字符下标，end 为开区间。仅允许这些 type：${typeList}。\n\n合同文本：\n${text}`
    }
  ]
}

async function detectLlmSensitiveEntitiesWithNativeCommand(text, enabledTypes = [], config = undefined) {
  return invoke('detect_llm_sensitive_entities', {
    payload: {
      text,
      enabledTypes,
      config
    }
  })
}

export async function detectLlmSensitiveEntities(text, enabledTypes = []) {
  debugLlmRecognition('进入 detectLlmSensitiveEntities', {
    textLength: Array.from(text || '').length,
    textPreview: String(text || '').slice(0, 500),
    enabledTypes,
    isTauriRuntime: isTauriRuntime(),
    hasTauriInternals: typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__),
    hasTauriGlobal: typeof window !== 'undefined' && Boolean(window.__TAURI__)
  })

  if (!text?.trim()) {
    debugLlmRecognition('跳过', '文本为空')
    return []
  }
  if (!enabledTypes.length) {
    debugLlmRecognition('跳过', '未启用任何脱敏类型')
    return []
  }

  try {
    const entities = await detectLlmSensitiveEntitiesWithNativeCommand(text, enabledTypes)
    debugLlmRecognition('Rust 原生命令实体输出', entities)
    return entities
  } catch (error) {
    debugLlmRecognition('Rust 原生命令不可用，尝试前端配置和 JS SDK', buildDebugError(error))
  }

  const config = await loadLlmDesensitizeConfig()
  debugLlmRecognition('配置读取成功', buildDebugConfig(config))

  if (!config?.enabled) {
    debugLlmRecognition('跳过', '大模型配置未开启 enabled=false')
    warnLlmRecognition('跳过：大模型配置未开启', buildDebugConfig(config))
    return []
  }
  if (!config.apiKey) {
    debugLlmRecognition('跳过', '大模型配置缺少 apiKey')
    warnLlmRecognition('跳过：大模型配置缺少 apiKey', buildDebugConfig(config))
    throw new Error('大模型配置缺少 apiKey')
  }
  const client = createOpenAiClient(config)
  const requestPayload = {
    messages: buildLlmMessages(text, enabledTypes),
    model: config.model || 'deepseek-v4-flash',
    thinking: config.thinking,
    reasoning_effort: config.reasoningEffort,
    stream: false
  }

  debugLlmRecognition('OpenAI SDK 请求', {
    baseURL: config.baseUrl,
    transport: isTauriRuntime() ? 'tauri-plugin-http' : 'browser-fetch',
    payload: requestPayload
  })

  let completion
  try {
    completion = await client.chat.completions.create(requestPayload)
  } catch (error) {
    debugLlmRecognition('OpenAI SDK 调用报错', buildDebugError(error))
    throw error
  }
  debugLlmRecognition('OpenAI SDK 原始输出', completion)

  const content = completion.choices?.[0]?.message?.content || ''
  debugLlmRecognition('OpenAI SDK message.content', content)

  const parsedContent = extractJsonFromLlmContent(content)
  const entities = normalizeLlmEntityResponse(text, parsedContent, enabledTypes)
  debugLlmRecognition('OpenAI SDK 实体输出', entities)

  return entities
}
