<template>
  <div class="page-shell layout-shell">
    <header class="content-card topbar">
      <div>
        <p class="topbar-brand">极易合同智能脱敏</p>
        <p class="topbar-subtitle">本地化处理合同内容，敏感信息不出端</p>
      </div>
      <div class="topbar-actions">
        <RouterLink to="/" class="nav-link" :class="{ active: route.name === 'home' }">首页</RouterLink>
        <RouterLink to="/history" class="nav-link" :class="{ active: route.name === 'history' }">历史记录</RouterLink>
        <RouterLink to="/profile" class="nav-link" :class="{ active: route.name === 'profile' }">个人中心</RouterLink>
        <div class="user-chip">
          <span>{{ authStore.currentUser?.name }}</span>
          <small>{{ authStore.currentUser?.title }}</small>
        </div>
      </div>
    </header>
    <main class="layout-main">
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router'
import { useAuthStore } from '../store/auth'

const route = useRoute()
const authStore = useAuthStore()
</script>

<style scoped>
.layout-shell {
  max-width: var(--content-width);
  margin: 0 auto;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 24px;
  margin-bottom: 20px;
}

.topbar-brand {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.topbar-subtitle {
  margin: 8px 0 0;
  color: var(--text-secondary);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.nav-link {
  padding: 10px 16px;
  border-radius: 999px;
  color: var(--text-secondary);
  font-weight: 600;
}

.nav-link.active {
  color: white;
  background: linear-gradient(135deg, var(--brand) 0%, #5a8cff 100%);
}

.user-chip {
  min-width: 136px;
  padding: 10px 14px;
  border-radius: 16px;
  background: rgba(47, 111, 237, 0.08);
}

.user-chip span,
.user-chip small {
  display: block;
}

.user-chip small {
  margin-top: 4px;
  color: var(--text-secondary);
}

@media (max-width: 960px) {
  .topbar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
