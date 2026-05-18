import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const readEnv = (name, fallback = '') => String(process.env[name] || fallback).trim()

const apiKey = readEnv('LLM_DESENSITIZE_API_KEY') || readEnv('DEEPSEEK_API_KEY')
const enabledFromEnv = readEnv('LLM_DESENSITIZE_ENABLED') || undefined
const requireApiKey = ['1', 'true', 'TRUE', 'yes', 'YES'].includes(
  readEnv('LLM_DESENSITIZE_REQUIRE_API_KEY')
)
const enabled = enabledFromEnv === undefined
  ? Boolean(apiKey)
  : ['1', 'true', 'TRUE', 'yes', 'YES'].includes(enabledFromEnv)

if (requireApiKey && !apiKey) {
  console.error('[LLM脱敏识别] 缺少 API Key，无法生成发布包配置。请配置 GitHub Secret: LLM_DESENSITIZE_API_KEY 或 DEEPSEEK_API_KEY。')
  process.exit(1)
}

const config = {
  enabled,
  baseUrl: readEnv('LLM_DESENSITIZE_BASE_URL', 'https://model-api.ecmax.cn/v1'),
  apiKey,
  model: readEnv('LLM_DESENSITIZE_RELEASE_MODEL', 'deepseek-v4-flash'),
  thinking: {
    type: readEnv('LLM_DESENSITIZE_THINKING_TYPE', 'enabled')
  },
  reasoningEffort: readEnv('LLM_DESENSITIZE_REASONING_EFFORT', 'high'),
  timeoutSeconds: Number(readEnv('LLM_DESENSITIZE_TIMEOUT_SECONDS', 60))
}

const targets = [
  path.join(projectRoot, 'public', 'llm-desensitize.config.json'),
  path.join(projectRoot, 'src-tauri', 'llm-desensitize.config.json')
]

for (const target of targets) {
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

console.log('[LLM脱敏识别] 已生成配置', {
  enabled: config.enabled,
  baseUrl: config.baseUrl,
  model: config.model,
  modelEnv: 'LLM_DESENSITIZE_RELEASE_MODEL',
  hasModelEnv: Boolean(readEnv('LLM_DESENSITIZE_RELEASE_MODEL')),
  hasApiKey: Boolean(config.apiKey),
  targets
})
