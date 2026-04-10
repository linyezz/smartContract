<template>
  <div class="pdf-compare">
    <div class="pdf-panel">
      <p class="preview-title">原文页面</p>
      <div v-if="loading" class="pdf-state">PDF 页面渲染中...</div>
      <div v-else-if="error" class="pdf-state error">{{ error }}</div>
      <div v-else class="pdf-pages">
        <div v-for="page in pages" :key="`origin-${page.pageNumber}`" class="pdf-page-card">
          <img :src="page.originalDataUrl" :alt="`原文第 ${page.pageNumber} 页`" class="pdf-page-image" />
        </div>
      </div>
    </div>

    <div class="pdf-panel">
      <p class="preview-title">脱敏后页面</p>
      <div v-if="loading" class="pdf-state">PDF 页面渲染中...</div>
      <div v-else-if="error" class="pdf-state error">{{ error }}</div>
      <div v-else class="pdf-pages">
        <div v-for="page in pages" :key="`masked-${page.pageNumber}`" class="pdf-page-card">
          <img :src="page.maskedDataUrl" :alt="`脱敏后第 ${page.pageNumber} 页`" class="pdf-page-image" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
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
  }
})

const loading = ref(false)
const error = ref('')
const pages = ref([])

async function loadPreview() {
  if (!props.sourcePath && !props.sourceBytes) {
    pages.value = []
    error.value = ''
    return
  }

  loading.value = true
  error.value = ''

  try {
    pages.value = await renderPdfPreviewPages(props.sourceBytes || props.sourcePath, props.hitList)
  } catch (previewError) {
    pages.value = []
    error.value = previewError?.message || 'PDF 预览渲染失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.sourcePath, props.sourceBytes, props.hitList],
  () => {
    void loadPreview()
  },
  { immediate: true, deep: true }
)
</script>

<style scoped>
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
