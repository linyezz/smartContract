<template>
  <div class="home-grid">
    <section class="content-card panel">
      <SectionHeader title="文件与规则" subtitle="选择合同文件和脱敏方案后即可开始处理。">
        <template #extra>
          <span class="tag-pill">最大 50MB</span>
        </template>
      </SectionHeader>

      <div
        class="upload-box"
        :class="{ dragging: dragState.isOver }"
        @click="handlePickFile"
        @dragenter.prevent="handleDragEnter"
        @dragover.prevent="handleDragOver"
        @dragleave.prevent="handleDragLeave"
        @drop.prevent="handleDrop"
      >
        <strong>{{ currentFile?.fileName || '点击选择合同文件' }}</strong>
        <p>
          支持 PDF、DOC、DOCX、MD 格式
          <span v-if="currentFile">，当前大小 {{ currentFile.sizeLabel }}</span>
        </p>
        <small>也可以直接把文件拖到这里</small>
      </div>

      <el-alert
        v-if="pdfAnalysisAlert"
        class="pdf-analysis-alert"
        :title="pdfAnalysisAlert.title"
        :description="pdfAnalysisAlert.description"
        :type="pdfAnalysisAlert.type"
        show-icon
        :closable="false"
      />

      <el-space wrap class="mode-row">
        <el-switch v-model="form.enableSmart" active-text="启用智能脱敏" />
        <el-switch v-model="form.includeCustomWords" active-text="叠加自定义词库" />
      </el-space>

      <el-form label-position="top">
        <el-form-item label="智能脱敏类别">
          <div class="type-shortcut-row">
            <el-button link type="primary" @click="toggleAllSmartTypes">
              {{ allSmartTypesSelected ? '取消全选' : '全选' }}
            </el-button>
          </div>
          <el-checkbox-group v-model="form.enabledTypes">
            <el-checkbox
              v-for="item in presetTypeOptions"
              :key="item.value"
              :label="item.value"
            >
              {{ item.label }}
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>

        <el-form-item label="自定义脱敏词">
          <div class="word-list">
            <span v-for="word in visibleWords" :key="word" class="word-tag">{{ word }}</span>
            <span v-if="visibleWords.length === 0" class="empty-tip">当前用户暂无自定义脱敏词</span>
          </div>
        </el-form-item>
      </el-form>

      <div class="action-row">
        <el-button type="primary" :loading="processing" @click="handleMask">
          开始脱敏
        </el-button>
        <el-button :disabled="!hasExportableResult" @click="handleDownload">
          另存为
        </el-button>
        <el-button :disabled="processing || !hasTaskState" @click="resetTaskState">
          清空任务
        </el-button>
      </div>

      <div v-if="result.exportPath" class="path-card">
        <span class="path-label">本地归档路径</span>
        <code>{{ result.exportPath }}</code>
      </div>

      <div v-if="isDev && debugError" class="debug-card">
        <span class="debug-label">详细信息</span>
        <pre>{{ debugError }}</pre>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <span>命中项</span>
          <strong>{{ result.hitList.length }}</strong>
        </div>
        <div class="stat-card">
          <span>处理模式</span>
          <strong>{{ modeLabel }}</strong>
        </div>
      </div>
    </section>

    <section class="content-card panel">
      <SectionHeader title="对比预览" subtitle="左侧原文，右侧脱敏结果。">
        <template #extra>
          <el-space wrap>
            <el-button plain :disabled="!currentFile || processing" @click="openManualMaskDialog">
              手动脱敏
            </el-button>
            <el-button plain :disabled="processing || (!currentFile && !result.originalText)" @click="previewFullscreen = true">
              全屏预览
            </el-button>
          </el-space>
        </template>
      </SectionHeader>
      <div class="preview-shell">
        <div v-if="showProcessingPreviewState" class="preview-state-card">
          <span class="preview-state-badge">{{ previewStageLabel }}</span>
          <strong>{{ previewStageTitle }}</strong>
          <p>{{ previewStageDescription }}</p>
        </div>
        <PdfComparePreview
          v-else-if="showPdfVisualPreview"
          :source-path="currentFile.path"
          :source-bytes="currentFile.bytes"
          :hit-list="result.hitList"
          :page-analyses="currentFile.analysis?.pages || []"
          :masked-text="result.maskedText"
          :file-name="currentFile.fileName"
          :extension="currentFile.extension"
        />
        <div v-else class="preview-grid">
          <div class="preview-panel">
            <p class="preview-title">原文</p>
            <pre>{{ result.originalText || '请先上传合同文件并执行脱敏。' }}</pre>
          </div>
          <div class="preview-panel">
            <p class="preview-title">脱敏后</p>
            <pre>{{ result.maskedText || '脱敏结果会显示在这里。' }}</pre>
          </div>
        </div>
      </div>
      <el-table :data="result.hitList.slice(0, 20)" height="280" empty-text="暂无命中记录">
        <el-table-column prop="source" label="来源" width="110">
          <template #default="{ row }">
            {{ sourceLabelMap[row.source] || row.source || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="type" label="类别" width="120" />
        <el-table-column prop="original" label="原文" />
        <el-table-column prop="masked" label="脱敏后" />
      </el-table>
    </section>
  </div>

  <el-dialog v-model="previewFullscreen" title="对比预览" fullscreen class="preview-dialog">
    <div class="preview-dialog-body">
      <div v-if="showProcessingPreviewState" class="preview-state-card fullscreen-state-card">
        <span class="preview-state-badge">{{ previewStageLabel }}</span>
        <strong>{{ previewStageTitle }}</strong>
        <p>{{ previewStageDescription }}</p>
      </div>
      <PdfComparePreview
        v-else-if="showPdfVisualPreview"
        :source-path="currentFile?.path"
        :source-bytes="currentFile?.bytes"
        :hit-list="result.hitList"
        :page-analyses="currentFile?.analysis?.pages || []"
        :masked-text="result.maskedText"
        :file-name="currentFile?.fileName"
        :extension="currentFile?.extension"
        is-fullscreen
      />
      <div v-else class="preview-grid fullscreen-grid">
        <div class="preview-panel fullscreen-panel">
          <p class="preview-title">原文</p>
          <pre>{{ result.originalText || '请先上传合同文件并执行脱敏。' }}</pre>
        </div>
        <div class="preview-panel fullscreen-panel">
          <p class="preview-title">脱敏后</p>
          <pre>{{ result.maskedText || '脱敏结果会显示在这里。' }}</pre>
        </div>
      </div>
    </div>
  </el-dialog>

  <el-dialog
    v-model="manualMaskVisible"
    :title="manualDialogTitle"
    width="88%"
    top="4vh"
    class="manual-mask-dialog"
    destroy-on-close
  >
    <TextManualMaskEditor
      v-if="currentFile && currentFile.extension !== 'pdf'"
      v-model="manualDraftTextSelections"
      :source-text="manualSourceText"
    />
    <PdfManualMaskEditor
      v-else-if="currentFile"
      v-model="manualDraftPdfRegions"
      :source-path="currentFile.path"
      :source-bytes="currentFile.bytes"
      :hit-list="autoResult.hitList"
      :page-analyses="currentFile.analysis?.pages || []"
    />

    <template #footer>
      <div class="manual-dialog-footer">
        <span class="manual-dialog-tip">{{ manualDialogTip }}</span>
        <div class="manual-dialog-actions">
          <el-button @click="manualMaskVisible = false">取消</el-button>
          <el-button type="primary" :loading="processing" @click="handleManualMaskConfirm">
            完成手动脱敏并输出
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useAuthStore } from '../store/auth'
import { useHistoryStore } from '../store/history'
import SectionHeader from '../components/SectionHeader.vue'
import PdfComparePreview from '../components/PdfComparePreview.vue'
import TextManualMaskEditor from '../components/TextManualMaskEditor.vue'
import PdfManualMaskEditor from '../components/PdfManualMaskEditor.vue'
import { presetTypeOptions, desensitizeText } from '../utils/desensitize'
import { detectPreciseChineseEntities } from '../utils/ner'
import {
  applyPdfOcrResult,
  applyPdfWorkerOcrResult,
  pickFile,
  readContractFile,
  saveMaskedResult
} from '../utils/file'
import { runPdfOcr, runPdfOcrWithWorker } from '../utils/ocr'
import { exportMaskedResultToArchive } from '../utils/exports'
import {
  buildManualPdfRegionHitList,
  cloneManualSelections,
  dedupeManualHitList
} from '../utils/manualMask'

const authStore = useAuthStore()
const historyStore = useHistoryStore()
const isDev = import.meta.env.DEV

authStore.bootstrap()
historyStore.bootstrap()

const form = reactive({
  enableSmart: true,
  includeCustomWords: true,
  enabledTypes: presetTypeOptions.map((item) => item.value)
})

const currentFile = ref(null)
const processing = ref(false)
const dragState = reactive({
  isOver: false,
  depth: 0
})
const result = reactive({
  originalText: '',
  maskedText: '',
  hitList: [],
  exportPath: '',
  sourcePath: ''
})
const autoResult = reactive({
  maskedText: '',
  hitList: []
})
const debugError = ref('')
const previewFullscreen = ref(false)
const manualMaskVisible = ref(false)
const processingStage = ref('')
const manualTextSelections = ref([])
const manualPdfRegions = ref([])
const manualDraftTextSelections = ref([])
const manualDraftPdfRegions = ref([])
let unlistenNativeDragDrop = null

const visibleWords = computed(() => authStore.currentUser?.customWords || [])
const allSmartTypesSelected = computed(() => form.enabledTypes.length === presetTypeOptions.length)
const sourceLabelMap = {
  external: '外部识别',
  regex: '规则',
  custom: '自定义词',
  manual: '手动兜底'
}
const modeLabel = computed(() => {
  const modes = []

  if (form.enableSmart) {
    modes.push('智能脱敏')
  }
  if (form.includeCustomWords) {
    modes.push('自定义词库')
  }
  if (manualTextSelections.value.length || manualPdfRegions.value.length) {
    modes.push('手动脱敏')
  }

  return modes.length ? modes.join(' + ') : '未选择'
})
const showProcessingPreviewState = computed(() => processing.value && Boolean(currentFile.value))
const showPdfVisualPreview = computed(() => currentFile.value?.extension === 'pdf')
const hasExportableResult = computed(() => Boolean(result.maskedText || result.hitList.length))
const hasTaskState = computed(() => Boolean(currentFile.value || result.maskedText || result.hitList.length || result.exportPath))
const manualSourceText = computed(() => autoResult.maskedText || currentFile.value?.text || '')
const manualDialogTitle = computed(() => currentFile.value?.extension === 'pdf' ? '手动区域脱敏' : '手动选词脱敏')
const manualDialogTip = computed(() => {
  if (currentFile.value?.extension === 'pdf') {
    return `当前已选 ${manualDraftPdfRegions.value.length} 个区域，完成后将输出最终文件。`
  }
  return `当前已选 ${manualDraftTextSelections.value.length} 段文字，完成后将输出最终文件。`
})
const previewStageLabel = computed(() => processingStage.value === 'masking' ? '脱敏中' : '识别中')
const previewStageTitle = computed(() => processingStage.value === 'masking'
  ? '正在生成脱敏结果'
  : '正在识别文档内容')
const previewStageDescription = computed(() => processingStage.value === 'masking'
  ? '正在处理敏感信息，请稍候。'
  : '扫描件识别通常会稍慢一些，请耐心等待。')
const pdfAnalysisAlert = computed(() => {
  const analysis = currentFile.value?.analysis
  if (!analysis || analysis.type !== 'pdf') {
    return null
  }
  const ocrInfo = currentFile.value?.ocr

  if (ocrInfo?.applied && analysis.kind === 'text') {
    return {
      type: 'success',
      title: '扫描页已完成识别',
      description: ocrInfo.pdfEnhanced
        ? '当前文件已完成扫描内容识别，后续预览和导出会基于识别结果继续处理。'
        : '当前文件已完成扫描内容识别，后续会继续进行脱敏处理。'
    }
  }

  if (ocrInfo?.applied && analysis.kind !== 'text') {
    return {
      type: 'warning',
      title: '部分页面识别仍不完整',
      description: `仍有 ${analysis.pagesWithoutText} 页内容较难识别，建议在结果页再做人工检查。`
    }
  }

  if (analysis.kind === 'image-only') {
    return {
      type: 'warning',
      title: '当前文件为扫描件',
      description: '扫描件处理时间会比普通文档更久一些，请耐心等待。'
    }
  }

  if (analysis.kind === 'mixed') {
    return {
      type: 'info',
      title: '当前文件部分页面为扫描件',
      description: `共 ${analysis.totalPages} 页，其中 ${analysis.pagesWithoutText} 页识别时间可能会更久。`
    }
  }

  return null
})

function resetManualMaskState() {
  manualTextSelections.value = []
  manualPdfRegions.value = []
  manualDraftTextSelections.value = []
  manualDraftPdfRegions.value = []
  manualMaskVisible.value = false
}

function resetAutoResultState() {
  autoResult.maskedText = ''
  autoResult.hitList = []
}

function resetResultState() {
  result.originalText = ''
  result.maskedText = ''
  result.hitList = []
  result.exportPath = ''
  result.sourcePath = ''
}

function applyPreviewResult(maskedText, hitList, options = {}) {
  result.originalText = currentFile.value?.text || ''
  result.maskedText = maskedText
  result.hitList = hitList
  result.sourcePath = currentFile.value?.path || ''

  if (!options.keepExportPath) {
    result.exportPath = ''
  }
}

function resetTaskState() {
  resetDragState()
  resetManualMaskState()
  resetAutoResultState()
  resetResultState()
  form.enableSmart = true
  form.includeCustomWords = true
  form.enabledTypes = presetTypeOptions.map((item) => item.value)
  currentFile.value = null
  processing.value = false
  debugError.value = ''
  previewFullscreen.value = false
  processingStage.value = ''
}

function toggleAllSmartTypes() {
  form.enabledTypes = allSmartTypesSelected.value
    ? []
    : presetTypeOptions.map((item) => item.value)
}

function buildManualTextEntities(selections = []) {
  return selections.map((item) => ({
    start: item.start,
    end: item.end,
    masked: item.masked,
    type: item.type || '手动选词',
    source: item.source || 'manual'
  }))
}

function buildCombinedHitList(responseHitList = [], manualPdfRegionsToUse = []) {
  return dedupeManualHitList([
    ...responseHitList,
    ...buildManualPdfRegionHitList(manualPdfRegionsToUse)
  ])
}

function buildFinalManualResult(manualTextSelectionsToUse = [], manualPdfRegionsToUse = []) {
  const baseText = autoResult.maskedText || currentFile.value?.text || ''
  const manualResponse = desensitizeText({
    text: baseText,
    enableSmart: false,
    enabledTypes: [],
    customWords: [],
    externalEntities: buildManualTextEntities(manualTextSelectionsToUse)
  })

  return {
    maskedText: manualResponse.maskedText,
    hitList: buildCombinedHitList([
      ...autoResult.hitList,
      ...manualResponse.hitList
    ], manualPdfRegionsToUse)
  }
}

function recordTaskResult(maskedText, hitList, exportMeta = {}) {
  if (!currentFile.value) {
    return
  }

  historyStore.createRecord({
    fileName: currentFile.value.fileName,
    extension: currentFile.value.extension,
    fileSize: currentFile.value.sizeLabel,
    mode: modeLabel.value,
    sourcePath: currentFile.value.path,
    resultText: maskedText,
    originalText: currentFile.value.text,
    hitList,
    exportExtension: exportMeta.exportExtension || '',
    exportPath: exportMeta.absolutePath || exportMeta.path || '',
    exportRelativePath: exportMeta.relativePath || '',
    exportFolder: exportMeta.folder || ''
  })
}

async function ensureAutoPreviewReady(showMessage = false) {
  if (!currentFile.value) {
    ElMessage.warning('请先选择需要处理的合同文件')
    return false
  }

  const hasAutomaticStrategy = form.enableSmart || form.includeCustomWords

  processing.value = true
  processingStage.value = hasAutomaticStrategy ? 'recognizing' : 'masking'
  debugError.value = ''

  try {
    if (currentFile.value.extension === 'pdf' && hasAutomaticStrategy) {
      await ensurePdfOcrReady()
    }

    let externalEntities = []
    if (form.enableSmart) {
      externalEntities = await detectPreciseChineseEntities(currentFile.value.text, form.enabledTypes)
    }

    processingStage.value = 'masking'
    const response = desensitizeText({
      text: currentFile.value.text,
      enableSmart: form.enableSmart,
      enabledTypes: form.enabledTypes,
      customWords: form.includeCustomWords ? visibleWords.value : [],
      externalEntities
    })

    autoResult.maskedText = response.maskedText
    autoResult.hitList = response.hitList
    applyPreviewResult(response.maskedText, response.hitList)
    manualTextSelections.value = []
    manualPdfRegions.value = []

    if (showMessage) {
      ElMessage.success(
        hasAutomaticStrategy
          ? `自动脱敏完成，共处理 ${response.hitList.length} 项，可继续手动补充。`
          : '已准备好手动脱敏内容，可继续补充。'
      )
    }

    return true
  } catch (error) {
    debugError.value = String(error?.stack || error?.message || error)
    ElMessage.error(error.message || '脱敏失败')
    return false
  } finally {
    processing.value = false
    processingStage.value = ''
  }
}

async function openManualMaskDialog() {
  if (!currentFile.value) {
    ElMessage.warning('请先选择需要处理的合同文件')
    return
  }

  if (!autoResult.maskedText && !autoResult.hitList.length) {
    const prepared = await ensureAutoPreviewReady(false)
    if (!prepared) {
      return
    }
  }

  manualDraftTextSelections.value = cloneManualSelections(manualTextSelections.value)
  manualDraftPdfRegions.value = cloneManualSelections(manualPdfRegions.value)
  manualMaskVisible.value = true
}

async function handlePickFile() {
  try {
    const path = await pickFile()
    if (!path) {
      return
    }
    await applySelectedFile(path)
  } catch (error) {
    debugError.value = String(error?.stack || error?.message || error)
    ElMessage.error(error.message || '文件读取失败')
  }
}

async function applySelectedFile(path) {
  resetManualMaskState()
  resetAutoResultState()
  currentFile.value = await readContractFile(path)
  applyPreviewResult('', [], { keepExportPath: false })
  result.originalText = currentFile.value.text
  debugError.value = ''
  ElMessage.success(`已加载 ${currentFile.value.fileName}`)
}

async function ensurePdfOcrReady() {
  if (!currentFile.value || currentFile.value.extension !== 'pdf') {
    return
  }

  const analysis = currentFile.value.analysis
  if (!analysis || analysis.kind === 'text' || currentFile.value.ocr?.applied) {
    return
  }

  const originalKind = analysis.kind
  const missingPageNumbers = (analysis.pages || [])
    .filter((page) => !page.hasUsableText)
    .map((page) => page.pageNumber)
  let workerError = null

  try {
    const workerResult = await runPdfOcrWithWorker(currentFile.value.bytes || currentFile.value.path, {
      fileName: currentFile.value.fileName,
      pageNumbers: missingPageNumbers
    })

    currentFile.value = applyPdfWorkerOcrResult(currentFile.value, workerResult)
    result.originalText = currentFile.value.text
    result.sourcePath = currentFile.value.path

    if (!currentFile.value.text.trim()) {
      throw new Error('当前文件已完成识别，但仍未提取到可用内容，请检查扫描件是否清晰。')
    }

    try {
      const pdfOcrResult = await runPdfOcr({
        inputPath: currentFile.value.path,
        sourceBytes: currentFile.value.bytes,
        fileName: currentFile.value.fileName
      })
      const enhancedFile = await applyPdfOcrResult(currentFile.value, pdfOcrResult)
      currentFile.value = {
        ...enhancedFile,
        ocr: {
          ...currentFile.value.ocr,
          applied: true,
          pdfEnhanced: true,
          pdfOcrTool: pdfOcrResult.tool || 'ocrmypdf',
          pdfOcrCommandLabel: pdfOcrResult.commandLabel || '',
          pdfOcrOutputPath: pdfOcrResult.outputPath || ''
        }
      }
      result.originalText = currentFile.value.text
      result.sourcePath = currentFile.value.path
    } catch (enhanceError) {
      console.warn('pdf text-layer enhancement skipped after local OCR', enhanceError)
    }

    if (originalKind === 'image-only') {
      ElMessage.success('扫描件识别完成，继续执行脱敏。')
    } else {
      ElMessage.success('扫描页识别完成，继续执行脱敏。')
    }
    return
  } catch (error) {
    workerError = error
    console.warn('local OCR worker failed, fallback to ocrmypdf', error)
  }

  const ocrResult = await runPdfOcr({
    inputPath: currentFile.value.path,
    sourceBytes: currentFile.value.bytes,
    fileName: currentFile.value.fileName
  }).catch((error) => {
    if (workerError?.message) {
      throw new Error(`当前文件识别失败，请稍后重试。\n${error.message || String(error)}`)
    }
    throw error
  })

  currentFile.value = await applyPdfOcrResult(currentFile.value, ocrResult)
  currentFile.value = {
    ...currentFile.value,
    ocr: {
      ...(currentFile.value.ocr || {}),
      applied: true,
      fallback: 'ocrmypdf',
      fallbackReason: workerError?.message || '',
      pdfEnhanced: true,
      pdfOcrTool: ocrResult.tool || 'ocrmypdf',
      pdfOcrCommandLabel: ocrResult.commandLabel || '',
      pdfOcrOutputPath: ocrResult.outputPath || ''
    }
  }
  result.originalText = currentFile.value.text
  result.sourcePath = currentFile.value.path

  if (!currentFile.value.text.trim()) {
    throw new Error('当前文件已完成识别，但仍未提取到可用内容，请检查扫描件是否清晰。')
  }

  if (workerError?.message) {
    ElMessage.warning('扫描件识别时间较长，系统已切换到备用识别方式，请稍候。')
  } else if (originalKind === 'image-only') {
    ElMessage.success('扫描件识别完成，继续执行脱敏。')
  } else {
    ElMessage.success('扫描页识别完成，继续执行脱敏。')
  }
}

function resetDragState() {
  dragState.isOver = false
  dragState.depth = 0
}

function handleDragEnter() {
  dragState.depth += 1
  dragState.isOver = true
}

function handleDragOver() {
  dragState.isOver = true
}

function handleDragLeave() {
  dragState.depth = Math.max(dragState.depth - 1, 0)
  if (dragState.depth === 0) {
    dragState.isOver = false
  }
}

async function handleDrop(event) {
  resetDragState()
  const droppedFiles = Array.from(event.dataTransfer?.files || [])
  if (!droppedFiles.length) {
    return
  }

  try {
    await applySelectedFile(droppedFiles[0])
  } catch (error) {
    debugError.value = String(error?.stack || error?.message || error)
    ElMessage.error(error.message || '拖拽文件读取失败')
  }
}

async function applyNativeDroppedPath(path) {
  if (!path) {
    return
  }
  try {
    await applySelectedFile(path)
  } catch (error) {
    debugError.value = String(error?.stack || error?.message || error)
    ElMessage.error(error.message || '拖拽文件读取失败')
  }
}

async function handleMask() {
  if (!form.enableSmart && !form.includeCustomWords) {
    ElMessage.warning('请至少启用一种自动脱敏方案')
    return
  }

  resetManualMaskState()
  await ensureAutoPreviewReady(true)
}

async function handleManualMaskConfirm() {
  if (!currentFile.value) {
    return
  }

  if (!autoResult.maskedText && !autoResult.hitList.length) {
    const prepared = await ensureAutoPreviewReady(false)
    if (!prepared) {
      return
    }
  }

  const nextTextSelections = cloneManualSelections(manualDraftTextSelections.value)
  const nextPdfRegions = cloneManualSelections(manualDraftPdfRegions.value)
  const finalResult = buildFinalManualResult(nextTextSelections, nextPdfRegions)

  manualTextSelections.value = nextTextSelections
  manualPdfRegions.value = nextPdfRegions
  applyPreviewResult(finalResult.maskedText, finalResult.hitList)

  processing.value = true
  processingStage.value = 'masking'
  debugError.value = ''

  try {
    const exported = await exportMaskedResultToArchive(
      currentFile.value.fileName,
      currentFile.value.extension,
      finalResult.maskedText,
      {
        user: authStore.currentUser,
        sourcePath: currentFile.value.path,
        sourceBytes: currentFile.value.bytes,
        hitList: finalResult.hitList,
        pageAnalyses: currentFile.value.analysis?.pages || []
      }
    )
    result.exportPath = exported.absolutePath
    recordTaskResult(finalResult.maskedText, finalResult.hitList, exported)
    manualMaskVisible.value = false
    ElMessage.success(`手动脱敏已完成，共处理 ${finalResult.hitList.length} 项，最终文件已输出。`)
  } catch (error) {
    result.exportPath = ''
    debugError.value = String(error?.stack || error?.message || error)
    ElMessage.error(`输出失败：${error.message || '请稍后重试'}`)
  } finally {
    processing.value = false
    processingStage.value = ''
  }
}

async function handleDownload() {
  if (!hasExportableResult.value || !currentFile.value) {
    return
  }
  try {
    const output = await saveMaskedResult(currentFile.value.fileName, result.maskedText, {
      sourcePath: currentFile.value.path,
      sourceBytes: currentFile.value.bytes,
      hitList: result.hitList,
      pageAnalyses: currentFile.value.analysis?.pages || []
    })
    if (output.saved) {
      debugError.value = ''
      result.exportPath = output.path
      recordTaskResult(result.maskedText, result.hitList, output)
      ElMessage.success(`脱敏结果已另存为 ${output.exportExtension?.toUpperCase() || '文件'}`)
    }
  } catch (error) {
    debugError.value = String(error?.stack || error?.message || error)
    ElMessage.error(`另存失败：${error.message || '请稍后重试'}`)
  }
}

getCurrentWebview().onDragDropEvent((event) => {
  const payload = event.payload

  if (payload.type === 'enter' || payload.type === 'over') {
    dragState.isOver = true
    return
  }

  if (payload.type === 'leave') {
    resetDragState()
    return
  }

  if (payload.type === 'drop') {
    resetDragState()
    const [firstPath] = payload.paths || []
    void applyNativeDroppedPath(firstPath)
  }
}).then((unlisten) => {
  unlistenNativeDragDrop = unlisten
}).catch((error) => {
  debugError.value = String(error?.stack || error?.message || error)
})

onBeforeUnmount(() => {
  if (unlistenNativeDragDrop) {
    void unlistenNativeDragDrop()
  }
})
</script>

<style scoped>
.home-grid {
  display: grid;
  grid-template-columns: minmax(320px, 0.9fr) minmax(0, 1.4fr);
  gap: 20px;
  width: 100%;
}

.panel {
  padding: 24px;
}

.preview-shell {
  margin-bottom: 18px;
}

.preview-state-card {
  min-height: 420px;
  border-radius: 20px;
  border: 1px dashed rgba(47, 111, 237, 0.28);
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.98), rgba(239, 246, 255, 0.96));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px 24px;
  text-align: center;
}

.preview-state-badge {
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(47, 111, 237, 0.1);
  color: var(--brand-dark);
  font-size: 13px;
  font-weight: 600;
}

.preview-state-card strong {
  font-size: 20px;
  color: var(--text-primary);
}

.preview-state-card p {
  margin: 0;
  max-width: 420px;
  color: var(--text-secondary);
  line-height: 1.75;
}

.upload-box {
  padding: 24px;
  border: 1.5px dashed rgba(47, 111, 237, 0.32);
  border-radius: 20px;
  background: rgba(47, 111, 237, 0.05);
  cursor: pointer;
  transition: transform 0.2s ease, border-color 0.2s ease;
}

.upload-box:hover {
  transform: translateY(-2px);
  border-color: rgba(47, 111, 237, 0.55);
}

.upload-box.dragging {
  transform: translateY(-2px);
  border-color: rgba(47, 111, 237, 0.7);
  background: rgba(47, 111, 237, 0.1);
  box-shadow: inset 0 0 0 1px rgba(47, 111, 237, 0.18);
}

.upload-box strong,
.upload-box p,
.upload-box small {
  display: block;
}

.upload-box p {
  margin: 10px 0 0;
  color: var(--text-secondary);
}

.upload-box small {
  margin-top: 10px;
  color: var(--brand-dark);
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 18px;
}

.preview-panel {
  min-width: 0;
  padding: 18px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(241, 245, 249, 0.92));
  border: 1px solid rgba(148, 163, 184, 0.22);
}

.preview-panel pre {
  margin: 0;
  max-height: 520px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.8;
  color: var(--text-primary);
}

.preview-dialog-body {
  height: 100%;
  overflow: hidden;
}

.fullscreen-state-card {
  min-height: calc(100vh - 220px);
}

.fullscreen-grid {
  height: 100%;
  margin-bottom: 0;
}

.fullscreen-panel {
  height: 100%;
}

.fullscreen-panel pre {
  max-height: calc(100vh - 220px);
}

:deep(.preview-dialog) {
  height: 100vh;
}

:deep(.preview-dialog .el-dialog) {
  height: 100vh;
  margin: 0;
}

:deep(.preview-dialog .el-dialog__body) {
  height: calc(100vh - 54px);
  padding: 16px 20px 20px;
  overflow: hidden;
}

:deep(.manual-mask-dialog .el-dialog__body) {
  max-height: calc(100vh - 180px);
  overflow: auto;
  padding-top: 12px;
}

.manual-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.manual-dialog-tip {
  color: var(--text-secondary);
  line-height: 1.7;
}

.manual-dialog-actions {
  display: flex;
  gap: 12px;
}

@media (max-width: 1080px) {
  .preview-grid {
    grid-template-columns: 1fr;
  }
}

.mode-row {
  margin: 18px 0;
}

.pdf-analysis-alert {
  margin-top: 14px;
}

.type-shortcut-row {
  display: flex;
  justify-content: flex-end;
  margin: -4px 0 8px;
}

.word-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.word-tag {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(47, 111, 237, 0.09);
  color: var(--brand-dark);
}

.empty-tip {
  color: var(--text-secondary);
}

.action-row {
  display: flex;
  gap: 12px;
  margin-top: 12px;
}

.path-card {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: 18px;
  background: #f8fbff;
  border: 1px solid var(--line-soft);
}

.debug-card {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: 18px;
  background: #fff5f5;
  border: 1px solid rgba(224, 86, 91, 0.22);
}

.debug-label {
  display: block;
  margin-bottom: 6px;
  color: #b42318;
  font-size: 13px;
  font-weight: 700;
}

.debug-card pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
  color: #7a271a;
}

.path-label,
.path-card code {
  display: block;
}

.path-label {
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-size: 13px;
}

.path-card code {
  word-break: break-all;
  line-height: 1.7;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-top: 20px;
}

.stat-card {
  padding: 16px;
  border-radius: 18px;
  background: var(--bg-muted);
}

.stat-card span,
.stat-card strong {
  display: block;
}

.stat-card span {
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.stat-card strong {
  font-size: 22px;
  line-height: 1.4;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}

.preview-panel {
  min-height: 360px;
  padding: 16px;
  border-radius: 18px;
  background: #f8fbff;
  border: 1px solid var(--line-soft);
}

.preview-title {
  margin: 0 0 12px;
  font-weight: 700;
}

.preview-panel pre {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.75;
  font-family: inherit;
}

@media (max-width: 1100px) {
  .home-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .action-row {
    flex-direction: column;
  }

  .manual-dialog-footer {
    flex-direction: column;
    align-items: flex-start;
  }

  .action-row .el-button {
    width: 100%;
  }

  .preview-grid {
    grid-template-columns: 1fr;
  }
}
</style>
