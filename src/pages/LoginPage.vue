<template>
  <div class="login-shell">
    <div class="login-hero">
      <div class="tag-pill">本地存储 · 无服务端依赖</div>
      <h1>极易合同智能脱敏</h1>
      <p>
        针对法务团队设计的合同脱敏桌面客户端，支持 PDF、DOC、DOCX
        文件解析、智能识别敏感字段、历史追踪和本地成员权限管理。
      </p>
      <!-- <div class="hero-panel content-card">
        <p>默认管理员账号</p>
        <strong class="mono-text">admin / 123456</strong>
      </div>
      <div class="hero-panel content-card subtle">
        <p>企业微信登录</p>
        <strong>支持自动同步企微用户 ID、名称与头像</strong>
      </div> -->
    </div>

    <div class="content-card login-card">
      <div class="login-tabs">
        <button
          type="button"
          class="login-tab"
          :class="{ active: activeTab === 'wecom' }"
          @click="activeTab = 'wecom'"
        >
          企业微信登录
        </button>
        <button
          type="button"
          class="login-tab"
          :class="{ active: activeTab === 'password' }"
          @click="activeTab = 'password'"
        >
          账号登录
        </button>
      </div>

      <template v-if="activeTab === 'wecom'">
        <h2>企业微信登录</h2>
        <!-- <p class="section-subtitle">
          点击后会拉起企微扫码授权，登录成功后会自动写入本地成员信息。
        </p> -->
        <!-- <div class="tips-card">
          <p class="tips-title">授权说明</p>
          <p>
            请使用已开通权限的企业微信账号扫码登录。首次登录会自动在本地创建成员，并保存姓名、用户标识与头像信息。
          </p>
        </div> -->
        <el-button
          type="primary"
          size="large"
          class="login-button"
          :loading="wecomLoading"
          @click="handleWecomLogin"
        >
          企业微信扫码登录
        </el-button>
      </template>

      <template v-else>
        <h2>账号登录</h2>
        <p class="section-subtitle">管理员和手动创建成员可继续使用本地账号体系登录。</p>
        <el-form :model="form" @submit.prevent="handlePasswordLogin">
          <el-form-item label="账号">
            <el-input v-model="form.username" placeholder="请输入账号" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input
              v-model="form.password"
              type="password"
              show-password
              placeholder="请输入密码"
            />
          </el-form-item>
          <el-button
            type="primary"
            size="large"
            class="login-button"
            @click="handlePasswordLogin"
          >
            进入系统
          </el-button>
        </el-form>
      </template>

      <div v-if="debugMessage" class="debug-card">
        <p class="debug-title">调试信息</p>
        <pre>{{ debugMessage }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, reactive, ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'
import { openWecomLoginWindow, WECOM_LOGIN_EVENT } from '../utils/wecom'

const router = useRouter()
const authStore = useAuthStore()
authStore.bootstrap()

const activeTab = ref('wecom')
const wecomLoading = ref(false)
const debugMessage = ref('')
const form = reactive({
  username: '',
  password: ''
})

let loginPopup = null
let unlistenWecomEvent = null

async function closeLoginPopup() {
  loginPopup = null
}

async function handlePasswordLogin() {
  const result = authStore.loginByPassword(form.username.trim(), form.password)
  if (!result.success) {
    ElMessage.error(result.message)
    return
  }
  debugMessage.value = ''
  ElMessage.success(`欢迎回来，${result.user.name}`)
  router.push({ name: 'home' })
}

async function handleWecomUuid(uuid) {
  if (!uuid || wecomLoading.value) {
    return
  }

  wecomLoading.value = true
  debugMessage.value = ''
  await closeLoginPopup()

  const result = await authStore.loginByWecomUuid(uuid)
  wecomLoading.value = false

  if (!result.success) {
    debugMessage.value = result.message
    ElMessage.error(result.message)
    return
  }

  ElMessage.success(`欢迎回来，${result.user.name}`)
  router.push({ name: 'home' })
}

async function handleWecomLogin() {
  debugMessage.value = ''
  try {
    await openWecomLoginWindow()
    loginPopup = { opened: true }
    ElMessage.success('企业微信登录窗口已打开，请在新窗口中完成扫码。')
  } catch (error) {
    const message = error?.message || '未能拉起企微登录窗口，请检查桌面端窗口权限配置。'
    debugMessage.value = String(message)
    ElMessage.error(String(message))
  }
}

listen(WECOM_LOGIN_EVENT, (event) => {
  const uuid = event.payload?.uuid
  debugMessage.value = event.payload?.sourceUrl ? `收到企微登录回调：${event.payload.sourceUrl}` : ''
  void handleWecomUuid(uuid)
}).then((unlisten) => {
  unlistenWecomEvent = unlisten
})

onBeforeUnmount(() => {
  if (unlistenWecomEvent) {
    void unlistenWecomEvent()
  }
  void closeLoginPopup()
})
</script>

<style scoped>
.login-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(320px, 1.1fr) minmax(360px, 0.9fr);
  gap: 24px;
  align-items: stretch;
  width: min(1240px, calc(100vw - 48px));
  margin: 0 auto;
  padding: 32px 0;
}

.login-hero {
  padding: 44px;
  border-radius: 32px;
  background:
    linear-gradient(160deg, rgba(26, 63, 147, 0.94), rgba(47, 111, 237, 0.82)),
    linear-gradient(180deg, #1a3f93, #2f6fed);
  color: white;
  box-shadow: 0 28px 60px rgba(29, 78, 216, 0.22);
}

.login-hero h1 {
  margin: 26px 0 16px;
  font-size: 52px;
  line-height: 1.12;
}

.login-hero p {
  margin: 0;
  line-height: 1.8;
  color: rgba(255, 255, 255, 0.86);
}

.hero-panel {
  margin-top: 20px;
  padding: 22px;
  color: white;
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.14);
}

.hero-panel.subtle {
  background: rgba(255, 255, 255, 0.08);
}

.hero-panel p,
.hero-panel strong {
  margin: 0;
}

.hero-panel strong {
  display: inline-block;
  margin-top: 8px;
  font-size: 18px;
}

.login-card {
  align-self: center;
  padding: 32px;
}

.login-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 24px;
  padding: 6px;
  border-radius: 18px;
  background: rgba(47, 111, 237, 0.08);
}

.login-tab {
  border: none;
  border-radius: 14px;
  padding: 12px 14px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.login-tab.active {
  background: white;
  color: var(--brand);
  box-shadow: 0 10px 22px rgba(47, 111, 237, 0.12);
}

.login-card h2 {
  margin: 0 0 8px;
  font-size: 30px;
}

.login-button {
  width: 100%;
  margin-top: 8px;
}

.tips-card {
  margin: 20px 0 8px;
  padding: 18px 20px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(47, 111, 237, 0.05), rgba(47, 111, 237, 0.02));
  border: 1px solid rgba(47, 111, 237, 0.1);
}

.tips-card p {
  margin: 0;
  line-height: 1.8;
}

.tips-title {
  margin-bottom: 8px;
  color: var(--text-primary);
  font-weight: 700;
}

.debug-card {
  margin-top: 18px;
  padding: 16px;
  border-radius: 18px;
  background: #fff7f7;
  border: 1px solid rgba(239, 68, 68, 0.18);
}

.debug-title {
  margin: 0 0 8px;
  color: #b42318;
  font-weight: 700;
}

.debug-card pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: #7a271a;
  font-family: SFMono-Regular, Consolas, monospace;
}

@media (max-width: 920px) {
  .login-shell {
    grid-template-columns: 1fr;
  }

  .login-hero {
    padding: 32px 24px;
  }

  .login-hero h1 {
    font-size: 36px;
  }
}
</style>
