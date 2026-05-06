import OpenAI from 'openai'

const TYPE_LABEL_MAP = {
  idCard: '身份证号',
  mobile: '手机号/座机',
  email: '邮箱',
  bankCard: '银行卡号',
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

async function loadLlmDesensitizeConfig() {
  if (!llmConfigPromise) {
    llmConfigPromise = fetch('/llm-desensitize.config.json', {
      cache: 'no-store'
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`读取大模型配置失败：HTTP ${response.status}`)
        }
        return response.json()
      })
      .catch((error) => {
        debugLlmRecognition('配置读取失败', error)
        return {
          enabled: false
        }
      })
  }

  return llmConfigPromise
}

function createOpenAiClient(config) {
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: true
  })
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

function extractJsonFromLlmContent(content) {
  const raw = String(content || '').trim()
  if (!raw) {
    return []
  }

  try {
    return JSON.parse(raw)
  } catch {
    const startCandidates = [raw.indexOf('['), raw.indexOf('{')].filter((index) => index >= 0)
    const endCandidates = [raw.lastIndexOf(']'), raw.lastIndexOf('}')].filter((index) => index >= 0)
    const start = Math.min(...startCandidates)
    const end = Math.max(...endCandidates)

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error(`大模型返回内容中没有可解析 JSON：${raw}`)
    }

    return JSON.parse(raw.slice(start, end + 1))
  }
}

function normalizeLlmEntityResponse(text, payload, enabledTypes) {
  const rawEntities = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.entities)
      ? payload.entities
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
      content: '你是合同脱敏识别助手，只输出严格 JSON。识别身份证号、手机号/座机、邮箱、银行卡号、统一社会信用代码、公司名称、姓名、地址、价格等敏感信息。'
    },
    {
      role: 'user',
      content: `请识别下面合同文本中的敏感信息。只返回 JSON 数组，不要解释，不要使用 Markdown 代码块。JSON 每项包含 text、type、start、end。start/end 使用从 0 开始的 Unicode 字符下标，end 为开区间。仅允许这些 type：${typeList}。\n\n合同文本：\n${text}`
    }
  ]
}

export async function detectLlmSensitiveEntities(text, enabledTypes = []) {
  const config = await loadLlmDesensitizeConfig()
  if (!config?.enabled) {
    debugLlmRecognition('跳过', '大模型配置未开启')
    return []
  }
  if (!config.apiKey) {
    throw new Error('大模型配置缺少 apiKey')
  }

  const client = createOpenAiClient(config)
  const requestPayload = {
    messages: buildLlmMessages(text, enabledTypes),
    model: config.model || 'deepseek-v4-pro',
    thinking: config.thinking,
    reasoning_effort: config.reasoningEffort,
    stream: false
  }

  debugLlmRecognition('OpenAI SDK 请求', {
    baseURL: config.baseUrl,
    payload: requestPayload
  })

  const completion = await client.chat.completions.create(requestPayload)
  debugLlmRecognition('OpenAI SDK 原始输出', completion)

  const content = completion.choices?.[0]?.message?.content || ''
  debugLlmRecognition('OpenAI SDK message.content', content)

  const parsedContent = extractJsonFromLlmContent(content)
  const entities = normalizeLlmEntityResponse(text, parsedContent, enabledTypes)
  debugLlmRecognition('OpenAI SDK 实体输出', entities)

  return entities
}
