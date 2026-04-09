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
          支持 PDF、DOC、DOCX 格式
          <span v-if="currentFile">，当前大小 {{ currentFile.sizeLabel }}</span>
        </p>
        <small>也可以直接把文件拖到这里</small>
      </div>

      <el-space wrap class="mode-row">
        <el-switch v-model="form.enableSmart" active-text="启用智能脱敏" />
        <el-switch v-model="form.includeCustomWords" active-text="叠加自定义词库" />
      </el-space>

      <el-form label-position="top">
        <el-form-item label="智能脱敏类别">
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
        <el-button :disabled="!result.maskedText" @click="handleDownload">
          另存为
        </el-button>
        <el-button :disabled="!result.exportPath" @click="handleOpenExportPath">
          打开归档
        </el-button>
      </div>

      <div v-if="result.exportPath" class="path-card">
        <span class="path-label">本地归档路径</span>
        <code>{{ result.exportPath }}</code>
      </div>

      <div v-if="debugError" class="debug-card">
        <span class="debug-label">调试信息</span>
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
      <SectionHeader title="对比预览" subtitle="左侧原文，右侧脱敏结果。" />
      <div class="preview-grid">
        <div class="preview-panel">
          <p class="preview-title">原文</p>
          <pre>{{ result.originalText || '请先上传合同文件并执行脱敏。' }}</pre>
        </div>
        <div class="preview-panel">
          <p class="preview-title">脱敏后</p>
          <pre>{{ result.maskedText || '脱敏结果会显示在这里。' }}</pre>
        </div>
      </div>
      <el-table :data="result.hitList.slice(0, 20)" height="280" empty-text="暂无命中记录">
        <el-table-column prop="type" label="类别" width="120" />
        <el-table-column prop="original" label="原文" />
        <el-table-column prop="masked" label="脱敏后" />
      </el-table>
    </section>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../store/auth'
import { useHistoryStore } from '../store/history'
import SectionHeader from '../components/SectionHeader.vue'
import { presetTypeOptions, desensitizeText } from '../utils/desensitize'
import { pickFile, readContractFile, saveMaskedResult } from '../utils/file'
import { exportMaskedResultToArchive, openLocalPath } from '../utils/exports'

const authStore = useAuthStore()
const historyStore = useHistoryStore()

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
const debugError = ref('')

const visibleWords = computed(() => authStore.currentUser?.customWords || [])
const modeLabel = computed(() => {
  if (form.enableSmart && form.includeCustomWords) {
    return '智能脱敏 + 自定义词库'
  }
  if (form.enableSmart) {
    return '智能脱敏'
  }
  if (form.includeCustomWords) {
    return '敏感词库'
  }
  return '未选择'
})

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
  currentFile.value = await readContractFile(path)
  result.originalText = currentFile.value.text
  result.maskedText = ''
  result.hitList = []
  result.exportPath = ''
  result.sourcePath = currentFile.value.path
  debugError.value = ''
  ElMessage.success(`已加载 ${currentFile.value.fileName}`)
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

  const firstFile = droppedFiles[0]
  const droppedPath = firstFile.path
  if (!droppedPath) {
    ElMessage.warning('当前环境未识别到拖拽文件路径，请改用点击上传。')
    return
  }

  try {
    await applySelectedFile(droppedPath)
  } catch (error) {
    debugError.value = String(error?.stack || error?.message || error)
    ElMessage.error(error.message || '拖拽文件读取失败')
  }
}

async function handleMask() {
  if (!currentFile.value) {
    ElMessage.warning('请先选择需要处理的合同文件')
    return
  }
  if (!form.enableSmart && !form.includeCustomWords) {
    ElMessage.warning('请至少启用一种脱敏方案')
    return
  }

  processing.value = true
  debugError.value = ''
  try {
    const response = desensitizeText({
      text: currentFile.value.text,
      enableSmart: form.enableSmart,
      enabledTypes: form.enabledTypes,
      customWords: form.includeCustomWords ? visibleWords.value : []
    })

    result.originalText = currentFile.value.text
    result.maskedText = response.maskedText
    result.hitList = response.hitList
    result.sourcePath = currentFile.value.path
    const record = historyStore.createRecord({
      fileName: currentFile.value.fileName,
      extension: currentFile.value.extension,
      fileSize: currentFile.value.sizeLabel,
      mode: modeLabel.value,
      sourcePath: currentFile.value.path,
      resultText: response.maskedText,
      originalText: currentFile.value.text,
      hitList: response.hitList
    })

    try {
      const exported = await exportMaskedResultToArchive(
        currentFile.value.fileName,
        currentFile.value.extension,
        response.maskedText,
        {
          user: authStore.currentUser
        }
      )
      result.exportPath = exported.absolutePath
      historyStore.updateRecord(record.id, {
        exportExtension: exported.exportExtension,
        exportPath: exported.absolutePath,
        exportRelativePath: exported.relativePath,
        exportFolder: exported.folder
      })
      ElMessage.success(`脱敏完成，共识别 ${response.hitList.length} 项，结果已按原格式归档`)
    } catch (error) {
      result.exportPath = ''
      debugError.value = String(error?.stack || error?.message || error)
      ElMessage.warning(`脱敏已完成，但导出失败：${error.message || '请稍后重试'}`)
    }
  } catch (error) {
    debugError.value = String(error?.stack || error?.message || error)
    ElMessage.error(error.message || '脱敏失败')
  } finally {
    processing.value = false
  }
}

async function handleDownload() {
  if (!result.maskedText || !currentFile.value) {
    return
  }
  try {
    const output = await saveMaskedResult(currentFile.value.fileName, result.maskedText)
    if (output.saved) {
      debugError.value = ''
      result.exportPath = output.path
      ElMessage.success(`脱敏结果已另存为 ${output.exportExtension?.toUpperCase() || '文件'}`)
    }
  } catch (error) {
    debugError.value = String(error?.stack || error?.message || error)
    ElMessage.error(`另存失败：${error.message || '请稍后重试'}`)
  }
}

async function handleOpenExportPath() {
  if (!result.exportPath) {
    return
  }
  try {
    await openLocalPath(result.exportPath)
  } catch (error) {
    debugError.value = String(error?.stack || error?.message || error)
    ElMessage.error(error.message || '打开路径失败')
  }
}
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

.mode-row {
  margin: 18px 0;
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
  font-size: 24px;
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

  .action-row .el-button {
    width: 100%;
  }

  .preview-grid {
    grid-template-columns: 1fr;
  }
}
</style>
