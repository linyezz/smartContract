<template>
  <div class="manual-pdf-editor">
    <div class="manual-pdf-tip">
      在原文页面上按住鼠标拖出一个区域，即可把该区域作为人工兜底脱敏范围导出。
    </div>

    <div class="pdf-toolbar">
      <div class="pdf-toolbar-group">
        <span class="zoom-label">缩放 {{ Math.round(zoom * 100) }}%</span>
        <span class="selection-count">已选 {{ innerRegions.length }} 个区域</span>
      </div>
      <div class="pdf-toolbar-group">
        <el-button size="small" @click="zoomOut" :disabled="zoom <= minZoom">缩小</el-button>
        <el-button size="small" @click="resetZoom">重置</el-button>
        <el-button size="small" type="primary" plain @click="zoomIn" :disabled="zoom >= maxZoom">放大</el-button>
        <el-button size="small" :disabled="!innerRegions.length" @click="handleClearRegions">清空区域</el-button>
      </div>
    </div>

    <div v-if="loading" class="pdf-state">PDF 页面渲染中...</div>
    <div v-else-if="error" class="pdf-state error">{{ error }}</div>
    <div v-else class="pdf-pages">
      <div v-for="page in pages" :key="page.pageNumber" class="pdf-page-card">
        <p class="preview-title">第 {{ page.pageNumber }} 页</p>
        <div
          class="pdf-stage"
          :style="buildStageStyle(page)"
          @mousedown.left="startSelection(page.pageNumber, $event)"
        >
          <img
            :src="page.originalDataUrl"
            :alt="`PDF 第 ${page.pageNumber} 页`"
            class="pdf-page-image"
            draggable="false"
          />

          <div
            v-for="region in pageRegions(page.pageNumber)"
            :key="region.id"
            class="region-box"
            :style="buildRegionStyle(region)"
          >
            <span class="region-mask">{{ region.masked }}</span>
            <button class="region-remove" type="button" @click.stop="handleRemoveRegion(region.id)">
              删除
            </button>
          </div>

          <div
            v-if="draftRegion && draftRegion.pageNumber === page.pageNumber"
            class="region-box draft"
            :style="buildRegionStyle(draftRegion)"
          >
            <span class="region-mask">{{ draftRegion.masked }}</span>
          </div>
        </div>
      </div>
    </div>

    <el-table :data="innerRegions" max-height="220" empty-text="尚未添加手动区域">
      <el-table-column prop="pageNumber" label="页码" width="90" />
      <el-table-column label="区域" min-width="220">
        <template #default="{ row }">
          左 {{ Math.round(row.rect.left * 100) }}%，上 {{ Math.round(row.rect.top * 100) }}%，宽 {{ Math.round(row.rect.width * 100) }}%，高 {{ Math.round(row.rect.height * 100) }}%
        </template>
      </el-table-column>
      <el-table-column prop="masked" label="脱敏后" width="140" />
      <el-table-column label="操作" width="110" fixed="right">
        <template #default="{ row }">
          <el-button link type="danger" @click="handleRemoveRegion(row.id)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { renderPdfPreviewPages } from '../utils/pdf'
import { buildManualItemId, cloneManualSelections } from '../utils/manualMask'

const props = defineProps({
  sourcePath: {
    type: String,
    default: ''
  },
  sourceBytes: {
    type: [Uint8Array, Array],
    default: null
  },
  pageAnalyses: {
    type: Array,
    default: () => []
  },
  modelValue: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update:modelValue'])

const loading = ref(false)
const error = ref('')
const pages = ref([])
const innerRegions = ref(cloneManualSelections(props.modelValue))
const draftRegion = ref(null)
const zoom = ref(1)
const minZoom = 0.6
const maxZoom = 2.4
const zoomStep = 0.2
const dragState = ref(null)

const sourceRef = computed(() => props.sourceBytes || props.sourcePath)

watch(
  () => props.modelValue,
  (value) => {
    innerRegions.value = cloneManualSelections(value)
  },
  { deep: true }
)

watch(
  () => [props.sourcePath, props.sourceBytes, props.pageAnalyses],
  () => {
    draftRegion.value = null
    void loadPages()
  },
  { immediate: true, deep: true }
)

function syncRegions(nextRegions) {
  innerRegions.value = cloneManualSelections(nextRegions)
  emit('update:modelValue', cloneManualSelections(nextRegions))
}

function buildStageStyle(page) {
  return {
    width: `${page.width * zoom.value}px`
  }
}

function pageRegions(pageNumber) {
  return innerRegions.value.filter((item) => item.pageNumber === pageNumber)
}

function buildRegionStyle(region) {
  return {
    left: `${Number(region.rect.left || 0) * 100}%`,
    top: `${Number(region.rect.top || 0) * 100}%`,
    width: `${Number(region.rect.width || 0) * 100}%`,
    height: `${Number(region.rect.height || 0) * 100}%`
  }
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

async function loadPages() {
  if (!sourceRef.value) {
    pages.value = []
    error.value = ''
    return
  }

  loading.value = true
  error.value = ''

  try {
    pages.value = await renderPdfPreviewPages(sourceRef.value, [], {
      pageAnalyses: props.pageAnalyses
    })
  } catch (loadError) {
    pages.value = []
    error.value = loadError?.message || 'PDF 页面加载失败'
  } finally {
    loading.value = false
  }
}

function normalizePointer(event, bounds) {
  const x = Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width)
  const y = Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height)

  return {
    left: bounds.width ? x / bounds.width : 0,
    top: bounds.height ? y / bounds.height : 0
  }
}

function updateDraftRegion(event) {
  if (!dragState.value) {
    return
  }

  const current = normalizePointer(event, dragState.value.bounds)
  const left = Math.min(dragState.value.start.left, current.left)
  const top = Math.min(dragState.value.start.top, current.top)
  const width = Math.abs(current.left - dragState.value.start.left)
  const height = Math.abs(current.top - dragState.value.start.top)
  const starCount = Math.max(Math.round(width * 18), 3)

  draftRegion.value = {
    id: dragState.value.id,
    pageNumber: dragState.value.pageNumber,
    type: '手动区域',
    source: 'manual',
    target: 'pdf-region',
    original: `第 ${dragState.value.pageNumber} 页手动区域`,
    masked: '*'.repeat(starCount),
    rect: {
      left,
      top,
      width,
      height
    }
  }
}

function stopSelection() {
  window.removeEventListener('mousemove', updateDraftRegion)
  window.removeEventListener('mouseup', finishSelection)
}

function finishSelection() {
  stopSelection()

  if (draftRegion.value?.rect?.width >= 0.01 && draftRegion.value?.rect?.height >= 0.01) {
    syncRegions([...innerRegions.value, draftRegion.value])
  }

  draftRegion.value = null
  dragState.value = null
}

function startSelection(pageNumber, event) {
  if (event.target.closest('.region-remove')) {
    return
  }

  const bounds = event.currentTarget.getBoundingClientRect()
  const start = normalizePointer(event, bounds)

  dragState.value = {
    id: buildManualItemId('manual-region'),
    pageNumber,
    start,
    bounds
  }

  draftRegion.value = null
  window.addEventListener('mousemove', updateDraftRegion)
  window.addEventListener('mouseup', finishSelection)
}

function handleRemoveRegion(regionId) {
  syncRegions(innerRegions.value.filter((item) => item.id !== regionId))
}

function handleClearRegions() {
  syncRegions([])
}

onBeforeUnmount(() => {
  stopSelection()
})
</script>

<style scoped>
.manual-pdf-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.manual-pdf-tip {
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(47, 111, 237, 0.08);
  color: var(--brand-dark);
  line-height: 1.7;
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
  flex-wrap: wrap;
}

.zoom-label,
.selection-count {
  font-size: 13px;
  color: var(--text-secondary);
}

.pdf-pages {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 72vh;
  overflow: auto;
  padding-right: 4px;
}

.pdf-page-card {
  padding: 14px;
  border-radius: 18px;
  background: #f8fafc;
  border: 1px solid rgba(148, 163, 184, 0.22);
}

.preview-title {
  margin: 0 0 12px;
  font-weight: 700;
}

.pdf-stage {
  position: relative;
  user-select: none;
  cursor: crosshair;
}

.pdf-page-image {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 12px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
}

.region-box {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid rgba(224, 86, 91, 0.78);
  background: rgba(255, 255, 255, 0.9);
  color: #111827;
  border-radius: 10px;
  overflow: hidden;
}

.region-box.draft {
  border-style: dashed;
}

.region-mask {
  padding: 0 10px;
  font-weight: 700;
  letter-spacing: 1px;
  pointer-events: none;
}

.region-remove {
  position: absolute;
  right: 4px;
  top: 4px;
  border: none;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.82);
  color: #ffffff;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}

.pdf-state {
  min-height: 220px;
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

@media (max-width: 960px) {
  .pdf-toolbar {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
