<template>
  <div class="login-shell">
    <div class="login-hero">
      <div class="tag-pill">本地存储 · 无服务端依赖</div>
      <h1>极易合同智能脱敏</h1>
      <p>
        针对法务团队设计的合同脱敏桌面客户端，支持 PDF、DOC、DOCX
        文件解析、智能识别敏感字段、历史追踪和本地成员权限管理。
      </p>
      <div class="hero-panel content-card">
        <p>默认管理员账号</p>
        <strong class="mono-text">admin / 123456</strong>
      </div>
    </div>

    <div class="content-card login-card">
      <h2>账号登录</h2>
      <p class="section-subtitle">企微登录暂未启用，当前使用本地账号体系。</p>
      <el-form :model="form" @submit.prevent="handleLogin">
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
        <el-button type="primary" size="large" class="login-button" @click="handleLogin">
          进入系统
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'

const router = useRouter()
const authStore = useAuthStore()
authStore.bootstrap()

const form = reactive({
  username: 'admin',
  password: '123456'
})

function handleLogin() {
  const result = authStore.loginByPassword(form.username.trim(), form.password)
  if (!result.success) {
    ElMessage.error(result.message)
    return
  }
  ElMessage.success(`欢迎回来，${result.user.name}`)
  router.push({ name: 'home' })
}
</script>

<style scoped>
.login-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 24px;
  align-items: stretch;
  max-width: 1180px;
  margin: 0 auto;
  padding: 32px 24px;
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
  margin-top: 28px;
  padding: 22px;
  color: white;
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.14);
}

.hero-panel p,
.hero-panel strong {
  margin: 0;
}

.hero-panel strong {
  display: inline-block;
  margin-top: 8px;
  font-size: 20px;
}

.login-card {
  align-self: center;
  padding: 32px;
}

.login-card h2 {
  margin: 0 0 8px;
  font-size: 30px;
}

.login-button {
  width: 100%;
  margin-top: 8px;
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
