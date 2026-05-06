<template>
  <div class="word-preview-shell" :class="{ fullscreen: isFullscreen }">
    <div class="word-toolbar">
      <span class="zoom-label">{{ extensionLabel }} 预览 · 缩放 {{ Math.round(zoom * 100) }}%</span>
      <div class="word-toolbar-actions">
        <el-button size="small" @click="zoomOut" :disabled="zoom <= minZoom">缩小</el-button>
        <el-button size="small" @click="resetZoom">重置</el-button>
        <el-button size="small" type="primary" plain @click="zoomIn" :disabled="zoom >= maxZoom">放大</el-button>
      </div>
    </div>

    <div class="word-compare">
      <div class="word-panel">
        <p class="preview-title">原文页面</p>
        <div class="word-preview-frame">
          <div ref="originalRef" class="word-document" :class="{ hidden: loading || Boolean(error) }"></div>
          <div v-if="loading" class="word-state">页面加载中...</div>
          <div v-else-if="error" class="word-state error">{{ error }}</div>
        </div>
      </div>

      <div class="word-panel">
        <p class="preview-title">脱敏后页面</p>
        <div class="word-preview-frame">
          <div ref="maskedRef" class="word-document" :class="{ hidden: loading || Boolean(error) }"></div>
          <div v-if="loading" class="word-state">页面加载中...</div>
          <div v-else-if="error" class="word-state error">{{ error }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { renderAsync } from 'docx-preview'
import { buildMaskedDocument } from '../utils/exports'

const props = defineProps({
  sourceBytes: {
    type: [Uint8Array, Array],
    default: null
  },
  sourcePath: {
    type: String,
    default: ''
  },
  fileName: {
    type: String,
    default: ''
  },
  extension: {
    type: String,
    default: 'doc'
  },
  hitList: {
    type: Array,
    default: () => []
  },
  maskedText: {
    type: String,
    default: ''
  },
  isFullscreen: {
    type: Boolean,
    default: false
  }
})

const originalRef = ref(null)
const maskedRef = ref(null)
const loading = ref(false)
const error = ref('')
const zoom = ref(1)
const minZoom = 0.6
const maxZoom = 1.8
const zoomStep = 0.15
const extensionLabel = computed(() => String(props.extension || 'doc').toUpperCase())

function toUint8Array(payload) {
  if (payload instanceof Uint8Array) {
    return payload
  }
  if (Array.isArray(payload)) {
    return new Uint8Array(payload)
  }
  return new Uint8Array()
}

function zoomIn() {
  zoom.value = Math.min(maxZoom, Number((zoom.value + zoomStep).toFixed(2)))
}

function zoomOut() {
  zoom.value = Math.max(minZoom, Number((zoom.value - zoomStep).toFixed(2)))
}

function resetZoom() {
  zoom.value = 1
}

function clearPreview() {
  if (originalRef.value) {
    originalRef.value.innerHTML = ''
  }
  if (maskedRef.value) {
    maskedRef.value.innerHTML = ''
  }
}

async function convertOfficeHtml(bytes) {
  return invoke('convert_office_document_to_html', {
    payload: {
      sourceBytes: Array.from(bytes),
      fileName: props.fileName || `document.${props.extension || 'doc'}`,
      extension: props.extension || 'doc'
    }
  })
}

async function renderDocx(container, bytes) {
  if (!container) {
    throw new Error('DOCX 预览容器尚未初始化，请稍后重试。')
  }

  container.innerHTML = ''
  await renderAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), container, null, {
    className: 'docx-render',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    breakPages: true,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true
  })
}

async function renderHtml(container, bytes) {
  if (!container) {
    throw new Error('DOC 预览容器尚未初始化，请稍后重试。')
  }

  const html = await convertOfficeHtml(bytes)
  container.innerHTML = `<div class="legacy-word-html">${html}</div>`
}

async function renderWord(container, bytes) {
  if (props.extension === 'docx') {
    await renderDocx(container, bytes)
    return
  }
  await renderHtml(container, bytes)
}

async function loadPreview() {
  const sourceBytes = toUint8Array(props.sourceBytes)
  if (!sourceBytes.length) {
    clearPreview()
    error.value = ''
    return
  }

  loading.value = true
  error.value = ''
  await nextTick()
  clearPreview()

  try {
    const maskedBytes = await buildMaskedDocument(props.fileName, props.extension, props.maskedText, {
      sourcePath: props.sourcePath,
      sourceBytes,
      hitList: props.hitList
    }).then((result) => result.bytes)

    await nextTick()
    await renderWord(originalRef.value, sourceBytes)
    await renderWord(maskedRef.value, maskedBytes)
  } catch (previewError) {
    clearPreview()
    error.value = previewError?.message || 'Word 文档预览加载失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.sourceBytes, props.sourcePath, props.fileName, props.extension, props.hitList, props.maskedText],
  () => {
    void loadPreview()
  },
  { immediate: true, deep: true }
)
</script>

<style scoped>
.word-preview-shell {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.word-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(241, 245, 249, 0.92));
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.word-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.zoom-label {
  font-size: 13px;
  color: var(--text-secondary);
}

.word-compare {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.word-panel {
  min-width: 0;
}

.word-preview-frame {
  position: relative;
  min-height: 180px;
}

.word-document {
  max-height: 540px;
  overflow: auto;
  padding: 12px;
  border-radius: 16px;
  background: #f8fafc;
  border: 1px solid rgba(148, 163, 184, 0.22);
  transform-origin: top left;
}

.word-document.hidden {
  visibility: hidden;
  pointer-events: none;
}

.word-preview-shell.fullscreen .word-document {
  max-height: calc(100vh - 210px);
}

.word-document :deep(.docx-wrapper) {
  background: transparent;
  padding: 0;
  transform: scale(v-bind(zoom));
  transform-origin: top left;
}

.word-document :deep(.docx) {
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
  margin: 0 0 14px;
}

.word-document :deep(.legacy-word-html) {
  width: calc(100% / v-bind(zoom));
  transform: scale(v-bind(zoom));
  transform-origin: top left;
  padding: 32px;
  background: white;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
  color: #111827;
  line-height: 1.7;
}

.word-state {
  min-height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  background: #f8fafc;
  border-radius: 16px;
  border: 1px dashed rgba(148, 163, 184, 0.35);
}

.word-state.error {
  color: #b42318;
}

@media (max-width: 1080px) {
  .word-compare {
    grid-template-columns: 1fr;
  }
}
</style>
