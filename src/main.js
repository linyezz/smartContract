import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'

import App from './App.vue'
import router from './router'
import './styles/global.css'
import { initializePersistence } from './utils/storage'

async function bootstrap() {
  await initializePersistence()

  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)
  app.use(ElementPlus)
  app.mount('#app')
}

function renderFatalError(error) {
  const target = document.querySelector('#app')
  if (!target) {
    return
  }

  target.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#eef3fb;font-family:PingFang SC,Microsoft YaHei,sans-serif;">
      <div style="max-width:760px;width:100%;background:#fff;border:1px solid rgba(64,86,138,.12);border-radius:24px;padding:28px;box-shadow:0 18px 45px rgba(47,111,237,.12);">
        <h1 style="margin:0 0 12px;font-size:28px;color:#1f2a44;">应用启动失败</h1>
        <p style="margin:0 0 16px;color:#5f6b85;line-height:1.8;">桌面客户端已启动，但前端初始化过程中出现异常。请保留此信息继续排查。</p>
        <pre style="margin:0;padding:16px;border-radius:16px;background:#f8fbff;border:1px solid rgba(64,86,138,.12);white-space:pre-wrap;word-break:break-word;color:#1f2a44;">${String(error?.stack || error?.message || error)}</pre>
      </div>
    </div>
  `
}

window.addEventListener('error', (event) => {
  console.error(event.error || event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason)
})

bootstrap().catch((error) => {
  console.error(error)
  renderFatalError(error)
})
