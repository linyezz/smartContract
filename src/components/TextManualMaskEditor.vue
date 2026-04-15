<template>
  <div class="manual-text-editor">
    <div class="manual-text-tip">
      在左侧原文里直接框选需要兜底脱敏的文字，然后点击“加入脱敏”。
    </div>

    <div class="manual-text-actions">
      <div class="manual-selection-summary">
        <span class="manual-selection-label">当前选择</span>
        <strong>{{ pendingSelection?.original || '未选择文本' }}</strong>
      </div>
      <div class="manual-selection-buttons">
        <el-button type="primary" :disabled="!pendingSelection" @click="handleAddSelection">
          加入脱敏
        </el-button>
        <el-button :disabled="!innerSelections.length" @click="handleClearSelections">
          清空已选
        </el-button>
      </div>
    </div>

    <div class="manual-text-grid">
      <section class="manual-text-panel">
        <p class="manual-panel-title">原文选择区</p>
        <div
          ref="sourceContainerRef"
          class="manual-text-content selectable"
          @mouseup="captureSelection"
        >{{ sourceText }}</div>
      </section>

      <section class="manual-text-panel">
        <p class="manual-panel-title">手动脱敏预览</p>
        <pre class="manual-text-content preview">{{ maskedPreview }}</pre>
      </section>
    </div>

    <el-table :data="innerSelections" max-height="240" empty-text="尚未添加手动选词">
      <el-table-column prop="type" label="方式" width="120" />
      <el-table-column prop="original" label="原文" />
      <el-table-column prop="masked" label="脱敏后" width="180" />
      <el-table-column label="操作" width="110" fixed="right">
        <template #default="{ row }">
          <el-button link type="danger" @click="handleRemoveSelection(row.id)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  applyManualTextSelections,
  cloneManualSelections,
  normalizeManualTextSelection,
  selectionOverlapsExisting
} from '../utils/manualMask'

const props = defineProps({
  sourceText: {
    type: String,
    default: ''
  },
  modelValue: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update:modelValue'])

const sourceContainerRef = ref(null)
const pendingSelection = ref(null)
const innerSelections = ref(cloneManualSelections(props.modelValue))

const maskedPreview = computed(() => applyManualTextSelections(props.sourceText, innerSelections.value))

watch(
  () => props.modelValue,
  (value) => {
    innerSelections.value = cloneManualSelections(value)
  },
  { deep: true }
)

watch(
  () => props.sourceText,
  () => {
    pendingSelection.value = null
    innerSelections.value = cloneManualSelections([])
    emit('update:modelValue', [])
  }
)

function syncSelections(nextSelections) {
  innerSelections.value = cloneManualSelections(nextSelections)
  emit('update:modelValue', cloneManualSelections(nextSelections))
}

function getTextOffset(root, targetNode, targetOffset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let currentNode = walker.nextNode()
  let total = 0

  while (currentNode) {
    if (currentNode === targetNode) {
      return total + targetOffset
    }
    total += currentNode.textContent?.length || 0
    currentNode = walker.nextNode()
  }

  return total
}

function clearBrowserSelection() {
  const selection = window.getSelection()
  selection?.removeAllRanges()
}

function captureSelection() {
  const root = sourceContainerRef.value
  const selection = window.getSelection()

  if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
    pendingSelection.value = null
    return
  }

  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) {
    pendingSelection.value = null
    return
  }

  const start = getTextOffset(root, range.startContainer, range.startOffset)
  const end = getTextOffset(root, range.endContainer, range.endOffset)
  const normalized = normalizeManualTextSelection({ start, end }, props.sourceText)

  pendingSelection.value = normalized
}

function handleAddSelection() {
  if (!pendingSelection.value) {
    return
  }

  if (selectionOverlapsExisting(innerSelections.value, pendingSelection.value)) {
    ElMessage.warning('选中的内容与已有手动脱敏范围重叠，请调整后再添加。')
    return
  }

  syncSelections([...innerSelections.value, pendingSelection.value].sort((left, right) => left.start - right.start))
  pendingSelection.value = null
  clearBrowserSelection()
}

function handleRemoveSelection(selectionId) {
  syncSelections(innerSelections.value.filter((item) => item.id !== selectionId))
}

function handleClearSelections() {
  syncSelections([])
  pendingSelection.value = null
  clearBrowserSelection()
}
</script>

<style scoped>
.manual-text-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.manual-text-tip {
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(47, 111, 237, 0.08);
  color: var(--brand-dark);
  line-height: 1.7;
}

.manual-text-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.manual-selection-summary {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.manual-selection-label {
  color: var(--text-secondary);
  font-size: 13px;
}

.manual-selection-summary strong {
  max-width: 560px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.manual-selection-buttons {
  display: flex;
  gap: 10px;
}

.manual-text-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.manual-text-panel {
  min-width: 0;
  padding: 18px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(241, 245, 249, 0.92));
  border: 1px solid rgba(148, 163, 184, 0.22);
}

.manual-panel-title {
  margin: 0 0 12px;
  font-weight: 700;
}

.manual-text-content {
  margin: 0;
  min-height: 320px;
  max-height: 420px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.8;
  color: var(--text-primary);
}

.manual-text-content.selectable {
  user-select: text;
  cursor: text;
}

.manual-text-content.preview {
  font-family: inherit;
}

@media (max-width: 960px) {
  .manual-text-actions {
    flex-direction: column;
    align-items: flex-start;
  }

  .manual-text-grid {
    grid-template-columns: 1fr;
  }

  .manual-selection-summary strong {
    max-width: none;
    white-space: normal;
  }
}
</style>
