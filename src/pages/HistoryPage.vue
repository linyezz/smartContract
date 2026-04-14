<template>
  <section class="content-card panel">
    <SectionHeader title="历史记录" subtitle="查看、筛选并管理所有脱敏操作。">
      <template #extra>
        <div class="toolbar-actions">
          <el-button
            :disabled="selectedIds.length === 0"
            @click="exportSelected"
          >
            批量导出
          </el-button>
          <el-button
            type="danger"
            plain
            :disabled="selectedIds.length === 0"
            @click="deleteSelected"
          >
            批量删除
          </el-button>
        </div>
      </template>
    </SectionHeader>

    <div class="filters">
      <el-date-picker
        v-model="filters.range"
        type="daterange"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
      />
      <el-input v-model="filters.keyword" placeholder="文档名称关键词" clearable />
      <el-select v-model="filters.mode" clearable placeholder="脱敏模式">
        <el-option label="智能脱敏" value="智能脱敏" />
        <el-option label="敏感词库" value="敏感词库" />
        <el-option label="智能脱敏 + 自定义词库" value="智能脱敏 + 自定义词库" />
      </el-select>
      <el-button @click="resetFilters">重置</el-button>
    </div>

    <el-table
      :data="pagedRecords"
      @selection-change="handleSelectionChange"
      row-key="id"
      height="560"
      empty-text="暂无历史记录"
    >
      <el-table-column type="selection" width="52" />
      <el-table-column type="index" label="序号" width="70" />
      <el-table-column prop="id" label="ID" min-width="180" />
      <el-table-column prop="operatorName" label="操作人" width="120" />
      <el-table-column prop="createdAt" label="操作时间" width="180">
        <template #default="{ row }">
          {{ formatDate(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column prop="fileName" label="文档名称" min-width="180" />
      <el-table-column prop="fileSize" label="大小" width="110" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column prop="mode" label="模式" min-width="180" />
      <el-table-column label="归档路径" min-width="220">
        <template #default="{ row }">
          <span class="path-text">{{ row.exportPath || '未导出' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="结果" width="120">
        <template #default="{ row }">
          命中 {{ row.hitList?.length || 0 }} 项
        </template>
      </el-table-column>
      <el-table-column label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">查看</el-button>
          <el-button link @click="openPath(row.exportPath)" :disabled="!row.exportPath">打开结果</el-button>
          <el-button link @click="saveAsRecord(row)">另存脱敏文档</el-button>
          <el-button link @click="reExportRecord(row)">重新导出</el-button>
          <el-button link type="danger" @click="deleteSelected([row.id])">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="footer-row">
      <span>共 {{ filteredRecords.length }} 条记录</span>
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        layout="prev, pager, next"
        :total="filteredRecords.length"
      />
    </div>

    <div v-if="isDev && debugError" class="debug-card">
      <span class="debug-label">调试信息</span>
      <pre>{{ debugError }}</pre>
    </div>
  </section>

  <el-dialog v-model="detailVisible" width="900px" title="脱敏详情">
    <template v-if="activeRecord">
      <p class="detail-meta">
        {{ activeRecord.fileName }} · {{ activeRecord.operatorName }} ·
        {{ formatDate(activeRecord.createdAt) }}
      </p>
      <div class="detail-paths">
        <div class="detail-path-item">
          <span>原文件地址</span>
          <code>{{ activeRecord.sourcePath || '未记录' }}</code>
          <el-button link @click="openPath(activeRecord.sourcePath)" :disabled="!activeRecord.sourcePath">打开原文件</el-button>
        </div>
        <div class="detail-path-item">
          <span>脱敏归档地址</span>
          <code>{{ activeRecord.exportPath || '未导出' }}</code>
          <el-button link @click="openPath(activeRecord.exportPath)" :disabled="!activeRecord.exportPath">打开脱敏文件</el-button>
          <el-button link @click="saveAsRecord(activeRecord)">另存脱敏文档</el-button>
        </div>
      </div>
      <div class="detail-grid">
        <div class="detail-panel">
          <p class="preview-title">原文</p>
          <pre>{{ activeRecord.originalText }}</pre>
        </div>
        <div class="detail-panel">
          <p class="preview-title">脱敏后</p>
          <pre>{{ activeRecord.resultText }}</pre>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import dayjs from 'dayjs'
import { ElMessageBox, ElMessage } from 'element-plus'
import SectionHeader from '../components/SectionHeader.vue'
import { useHistoryStore } from '../store/history'
import { saveMaskedResult } from '../utils/file'
import { exportMaskedResultToArchive, openLocalPath } from '../utils/exports'

const historyStore = useHistoryStore()
historyStore.bootstrap()
const isDev = import.meta.env.DEV

const filters = reactive({
  range: [],
  keyword: '',
  mode: ''
})

const pagination = reactive({
  page: 1,
  pageSize: 10
})

const selectedIds = ref([])
const detailVisible = ref(false)
const activeRecord = ref(null)
const debugError = ref('')

const filteredRecords = computed(() => historyStore.filterRecords(filters))
const pagedRecords = computed(() => {
  const start = (pagination.page - 1) * pagination.pageSize
  return filteredRecords.value.slice(start, start + pagination.pageSize)
})

function formatDate(value) {
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss')
}

function handleSelectionChange(rows) {
  selectedIds.value = rows.map((item) => item.id)
}

function resetFilters() {
  filters.range = []
  filters.keyword = ''
  filters.mode = ''
  pagination.page = 1
}

async function deleteSelected(overrideIds) {
  const ids = Array.isArray(overrideIds) ? overrideIds : selectedIds.value
  if (!ids.length) {
    return
  }
  try {
    await ElMessageBox.confirm('删除后不可恢复，确认继续吗？', '提示', {
      type: 'warning'
    })
    historyStore.deleteRecords(ids)
    selectedIds.value = []
    const totalPages = Math.max(1, Math.ceil(filteredRecords.value.length / pagination.pageSize))
    pagination.page = Math.min(pagination.page, totalPages)
    ElMessage.success('已删除所选记录')
  } catch {
    // noop
  }
}

function openDetail(row) {
  activeRecord.value = row
  detailVisible.value = true
}

async function openPath(path) {
  if (!path) {
    return
  }
  try {
    await openLocalPath(path)
    debugError.value = ''
  } catch (error) {
    debugError.value = String(error?.stack || error?.message || error)
    ElMessage.error(error.message || '打开路径失败')
  }
}

async function reExportRecord(row) {
  try {
    const exported = await exportMaskedResultToArchive(
      row.fileName,
      row.extension || row.fileName.split('.').pop()?.toLowerCase() || 'docx',
      row.resultText,
      {
        user: {
          id: row.operatorId,
          name: row.operatorName
        },
        sourcePath: row.sourcePath,
        hitList: row.hitList
      }
    )
    const updated = historyStore.updateRecord(row.id, {
      exportExtension: exported.exportExtension,
      exportPath: exported.absolutePath,
      exportRelativePath: exported.relativePath,
      exportFolder: exported.folder
    })
    if (activeRecord.value?.id === row.id) {
      activeRecord.value = updated
    }
    debugError.value = ''
    ElMessage.success('已重新导出脱敏文档')
  } catch (error) {
    debugError.value = String(error?.stack || error?.message || error)
    ElMessage.error(error.message || '重新导出失败')
  }
}

async function saveAsRecord(row) {
  if (!row?.resultText) {
    ElMessage.warning('当前记录没有可另存的脱敏结果')
    return
  }

  try {
    const output = await saveMaskedResult(row.fileName, row.resultText, {
      sourcePath: row.sourcePath,
      hitList: row.hitList
    })
    if (!output.saved) {
      return
    }
    debugError.value = ''
    ElMessage.success(`脱敏文档已另存为 ${output.exportExtension?.toUpperCase() || '文件'}`)
  } catch (error) {
    debugError.value = String(error?.stack || error?.message || error)
    ElMessage.error(error.message || '另存脱敏文档失败')
  }
}

async function exportSelected() {
  if (!selectedIds.value.length) {
    return
  }
  const targets = filteredRecords.value.filter((item) => selectedIds.value.includes(item.id))
  for (const item of targets) {
    // Keep batch export simple and deterministic.
    // Each record is re-archived to a new timestamped file.
    // eslint-disable-next-line no-await-in-loop
    await reExportRecord(item)
  }
}
</script>

<style scoped>
.panel {
  padding: 24px;
}

.filters {
  display: grid;
  grid-template-columns: 1.3fr 1fr 1fr auto;
  gap: 12px;
  margin-bottom: 18px;
}

.toolbar-actions {
  display: flex;
  gap: 12px;
}

.path-text {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
  color: var(--text-secondary);
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

.detail-meta {
  margin-top: 0;
  color: var(--text-secondary);
}

.detail-paths {
  display: grid;
  gap: 12px;
  margin-bottom: 16px;
}

.detail-path-item {
  padding: 14px 16px;
  border-radius: 16px;
  background: #f8fbff;
  border: 1px solid var(--line-soft);
}

.detail-path-item span,
.detail-path-item code {
  display: block;
}

.detail-path-item span {
  margin-bottom: 6px;
  color: var(--text-secondary);
}

.detail-path-item code {
  margin-bottom: 6px;
  word-break: break-all;
  line-height: 1.6;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.detail-panel {
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

.detail-panel pre {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.72;
  font-family: inherit;
}

@media (max-width: 960px) {
  .filters {
    grid-template-columns: 1fr;
  }

  .footer-row,
  .detail-grid {
    grid-template-columns: 1fr;
    display: grid;
  }
}
</style>
