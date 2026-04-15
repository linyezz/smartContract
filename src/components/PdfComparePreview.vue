<template>
  <div class="pdf-preview-shell" :class="{ fullscreen: isFullscreen }">
    <div v-if="showToolbar" class="pdf-toolbar">
      <div class="pdf-toolbar-group">
        <span class="zoom-label">缩放 {{ Math.round(zoom * 100) }}%</span>
      </div>
      <div class="pdf-toolbar-group">
        <el-button size="small" @click="zoomOut" :disabled="zoom <= minZoom">缩小</el-button>
        <el-button size="small" @click="resetZoom">重置</el-button>
        <el-button size="small" type="primary" plain @click="zoomIn" :disabled="zoom >= maxZoom">放大</el-button>
      </div>
    </div>

    <div class="pdf-compare">
    <div class="pdf-panel">
      <p class="preview-title">原文页面</p>
      <div v-if="loading" class="pdf-state">页面加载中...</div>
      <div v-else-if="error" class="pdf-state error">{{ error }}</div>
      <div v-else class="pdf-pages">
        <div v-for="page in originalPages" :key="`origin-${page.pageNumber}`" class="pdf-page-card">
          <img
            :src="page.originalDataUrl"
            :alt="`原文第 ${page.pageNumber} 页`"
            class="pdf-page-image"
            :style="imageStyle"
          />
        </div>
      </div>
    </div>

    <div class="pdf-panel">
      <p class="preview-title">脱敏后页面</p>
      <div v-if="loading" class="pdf-state">页面加载中...</div>
      <div v-else-if="error" class="pdf-state error">{{ error }}</div>
      <div v-else class="pdf-pages">
        <div v-for="page in maskedPages" :key="`masked-${page.pageNumber}`" class="pdf-page-card">
          <img
            :src="page.maskedDataUrl"
            :alt="`脱敏后第 ${page.pageNumber} 页`"
            class="pdf-page-image"
            :style="imageStyle"
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
const zoom = ref(1)
const minZoom = 0.6
const maxZoom = 2.4
const zoomStep = 0.2

const imageStyle = computed(() => ({
  width: `${zoom.value * 100}%`,
  maxWidth: 'none'
}))

function zoomIn() {
  zoom.value = Math.min(maxZoom, Number((zoom.value + zoomStep).toFixed(2)))
}

function zoomOut() {
  zoom.value = Math.max(minZoom, Number((zoom.value - zoomStep).toFixed(2)))
}

function resetZoom() {
  zoom.value = 1
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

.pdf-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(241, 245, 249, 0.92));
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.pdf-toolbar-group {
  display: flex;
  align-items: center;
  gap: 8px;
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
