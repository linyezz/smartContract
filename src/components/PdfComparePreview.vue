<template>
  <div class="pdf-preview-shell" :class="{ fullscreen: isFullscreen }">
    <div class="pdf-compare" :class="{ 'masked-only': hideOriginalPreview }">
      <div v-if="!hideOriginalPreview" class="pdf-panel">
        <div class="panel-header">
          <p class="preview-title">原文页面</p>
          <div v-if="showToolbar" class="panel-toolbar">
            <el-button size="small" plain @click="hideOriginalPreview = true">收起源文件</el-button>
            <span class="zoom-label">缩放 {{ Math.round(originalZoom * 100) }}%</span>
            <el-button size="small" @click="zoomOut('original')" :disabled="originalZoom <= minZoom">缩小</el-button>
            <el-button size="small" @click="resetZoom('original')">重置</el-button>
            <el-button size="small" type="primary" plain @click="zoomIn('original')" :disabled="originalZoom >= maxZoom">放大</el-button>
          </div>
        </div>
        <div v-if="loading" class="pdf-state">页面加载中...</div>
        <div v-else-if="error" class="pdf-state error">{{ error }}</div>
        <div v-else class="pdf-pages">
          <div v-for="page in originalPages" :key="`origin-${page.pageNumber}`" class="pdf-page-card">
            <img
              :src="page.originalDataUrl"
              :alt="`原文第 ${page.pageNumber} 页`"
              class="pdf-page-image"
              :style="originalImageStyle"
            />
          </div>
        </div>
      </div>

      <div class="pdf-panel">
        <div class="panel-header">
          <p class="preview-title">{{ hideOriginalPreview ? '脱敏后页面 · 全宽预览' : '脱敏后页面' }}</p>
          <div v-if="showToolbar" class="panel-toolbar">
            <el-button size="small" plain @click="toggleOriginalPreview">
              {{ hideOriginalPreview ? '显示源文件' : '收起源文件' }}
            </el-button>
            <span class="zoom-label">缩放 {{ Math.round(maskedZoom * 100) }}%</span>
            <el-button size="small" @click="zoomOut('masked')" :disabled="maskedZoom <= minZoom">缩小</el-button>
            <el-button size="small" @click="resetZoom('masked')">重置</el-button>
            <el-button size="small" type="primary" plain @click="zoomIn('masked')" :disabled="maskedZoom >= maxZoom">放大</el-button>
          </div>
        </div>
        <div v-if="loading" class="pdf-state">页面加载中...</div>
        <div v-else-if="error" class="pdf-state error">{{ error }}</div>
        <div v-else class="pdf-pages">
          <div v-for="page in maskedPages" :key="`masked-${page.pageNumber}`" class="pdf-page-card">
            <img
              :src="page.maskedDataUrl"
              :alt="`脱敏后第 ${page.pageNumber} 页`"
              class="pdf-page-image"
              :style="maskedImageStyle"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { renderPdfPreviewPages } from '../utils/pdf'

const props = defineProps({
  sourcePath: {
    type: String,
    default: ''
  },
  sourceBytes: {
    type: [Uint8Array, Array],
    default: null
  },
  hitList: {
    type: Array,
    default: () => []
  },
  pageAnalyses: {
    type: Array,
    default: () => []
  },
  maskedText: {
    type: String,
    default: ''
  },
  fileName: {
    type: String,
    default: ''
  },
  extension: {
    type: String,
    default: 'pdf'
  },
  showToolbar: {
    type: Boolean,
    default: true
  },
  isFullscreen: {
    type: Boolean,
    default: false
  }
})

const loading = ref(false)
const error = ref('')
const originalPages = ref([])
const maskedPages = ref([])
const originalZoom = ref(1)
const maskedZoom = ref(1)
const hideOriginalPreview = ref(false)
const minZoom = 0.6
const maxZoom = 2.4
const zoomStep = 0.2

const originalImageStyle = computed(() => ({
  width: `${originalZoom.value * 100}%`,
  maxWidth: 'none'
}))
const maskedImageStyle = computed(() => ({
  width: `${maskedZoom.value * 100}%`,
  maxWidth: 'none'
}))

function getZoomRef(target) {
  return target === 'masked' ? maskedZoom : originalZoom
}

function zoomIn(target) {
  const zoom = getZoomRef(target)
  zoom.value = Math.min(maxZoom, Number((zoom.value + zoomStep).toFixed(2)))
}

function zoomOut(target) {
  const zoom = getZoomRef(target)
  zoom.value = Math.max(minZoom, Number((zoom.value - zoomStep).toFixed(2)))
}

function resetZoom(target) {
  getZoomRef(target).value = 1
}

function toggleOriginalPreview() {
  hideOriginalPreview.value = !hideOriginalPreview.value
}

async function loadPreview() {
  if (!props.sourcePath && !props.sourceBytes) {
    originalPages.value = []
    maskedPages.value = []
    error.value = ''
    return
  }

  loading.value = true
  error.value = ''

  try {
    originalPages.value = await renderPdfPreviewPages(props.sourceBytes || props.sourcePath, [], {
      pageAnalyses: props.pageAnalyses
    })
    maskedPages.value = await renderPdfPreviewPages(props.sourceBytes || props.sourcePath, props.hitList, {
      pageAnalyses: props.pageAnalyses
    })
  } catch (previewError) {
    originalPages.value = []
    maskedPages.value = []
    error.value = previewError?.message || '预览加载失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.sourcePath, props.sourceBytes, props.hitList, props.pageAnalyses, props.maskedText, props.fileName, props.extension],
  () => {
    void loadPreview()
  },
  { immediate: true, deep: true }
)
</script>

<style scoped>
.pdf-preview-shell {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.panel-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.zoom-label {
  font-size: 13px;
  color: var(--text-secondary);
}

.pdf-compare {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.pdf-compare.masked-only {
  grid-template-columns: minmax(0, 1fr);
}

.pdf-compare.masked-only .pdf-panel {
  width: 100%;
}

.pdf-compare.masked-only .pdf-pages {
  align-items: stretch;
}

.pdf-compare.masked-only .pdf-page-card {
  width: 100%;
  box-sizing: border-box;
}

.pdf-compare.masked-only .pdf-page-image {
  width: 100%;
}

.pdf-panel {
  min-width: 0;
}

.pdf-pages {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 540px;
  overflow: auto;
  padding-right: 4px;
  align-items: flex-start;
}

.pdf-preview-shell.fullscreen .pdf-pages {
  max-height: calc(100vh - 210px);
}

.pdf-page-card {
  padding: 12px;
  border-radius: 16px;
  background: #f8fafc;
  border: 1px solid rgba(148, 163, 184, 0.22);
}

.pdf-page-image {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 10px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
}

.pdf-state {
  min-height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  background: #f8fafc;
  border-radius: 16px;
  border: 1px dashed rgba(148, 163, 184, 0.35);
}

.pdf-state.error {
  color: #b42318;
}

@media (max-width: 1080px) {
  .pdf-compare {
    grid-template-columns: 1fr;
  }
}
</style>
