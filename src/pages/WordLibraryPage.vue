<template>
  <div class="word-library-grid">
    <aside class="content-card group-panel">
      <SectionHeader title="分组" subtitle="启用的分组会参与自定义脱敏。" />
      <div class="group-create">
        <el-input v-model="groupInput" placeholder="新建分组名称" @keyup.enter="createGroup" />
        <el-button type="primary" @click="createGroup">新建</el-button>
      </div>

      <div class="group-list">
        <button
          v-for="group in wordGroups"
          :key="group.id"
          class="group-item"
          :class="{ active: selectedGroupId === group.id }"
          type="button"
          @click="selectedGroupId = group.id"
        >
          <span>
            <strong>{{ group.name }}</strong>
            <small>{{ group.words.length }} 个词</small>
          </span>
          <el-switch
            :model-value="group.enabled"
            @click.stop
            @change="toggleGroup(group.id, $event)"
          />
        </button>
      </div>
    </aside>

    <section class="content-card panel">
      <SectionHeader
        :title="selectedGroup?.name || '默认分组'"
        subtitle="维护分组中的脱敏词，导入时会自动去重。"
      >
        <template #extra>
          <el-select v-model="importGroupId" class="import-group-select" placeholder="导入到默认分组">
            <el-option
              v-for="group in wordGroups"
              :key="group.id"
              :label="group.name"
              :value="group.id"
            />
          </el-select>
          <el-button @click="importWords">批量导入</el-button>
          <el-button
            v-if="canDeleteSelectedGroup"
            type="danger"
            plain
            @click="deleteGroup(selectedGroup.id)"
          >
            删除分组
          </el-button>
        </template>
      </SectionHeader>

      <div class="word-toolbar">
        <el-input v-model="wordInput" placeholder="输入一个脱敏词" @keyup.enter="addWord" />
        <el-button type="primary" @click="addWord">添加</el-button>
      </div>

      <el-alert
        class="word-import-tip"
        title="支持导入 TXT、DOC、DOCX 文件，词条请用逗号、换行或空格分隔。"
        type="info"
        show-icon
        :closable="false"
      />

      <div class="word-section">
        <div class="word-section-head">
          <p class="word-title">分组词条</p>
          <el-tag :type="selectedGroup?.enabled ? 'success' : 'info'">
            {{ selectedGroup?.enabled ? '已启用' : '已禁用' }}
          </el-tag>
        </div>
        <div v-if="selectedGroupWords.length" class="word-list">
          <el-tag
            v-for="word in selectedGroupWords"
            :key="word"
            closable
            size="large"
            @close.prevent="removeWord(word)"
          >
            {{ word }}
          </el-tag>
        </div>
        <el-empty v-else description="当前分组暂无脱敏词" />
      </div>

      <div class="word-section">
        <div class="word-section-head">
          <p class="word-title">白名单</p>
          <el-tag type="info">{{ whitelistWords.length }} 个词</el-tag>
        </div>
        <div class="word-toolbar">
          <el-input v-model="whitelistInput" placeholder="输入不需要脱敏的词" @keyup.enter="addWhitelistWord" />
          <el-button type="primary" @click="addWhitelistWord">添加</el-button>
        </div>
        <div v-if="whitelistWords.length" class="word-list control-word-list">
          <el-tag
            v-for="word in whitelistWords"
            :key="word"
            closable
            size="large"
            type="info"
            @close.prevent="removeWhitelistWord(word)"
          >
            {{ word }}
          </el-tag>
        </div>
        <el-empty v-else description="暂无白名单词" />
      </div>

      <div class="word-section">
        <div class="word-section-head">
          <p class="word-title">我司实体</p>
          <el-tag type="success">{{ ourEntityWords.length }} 个词</el-tag>
        </div>
        <div class="word-toolbar">
          <el-input v-model="ourEntityInput" placeholder="输入我司实体名称" @keyup.enter="addOurEntityWord" />
          <el-button type="primary" @click="addOurEntityWord">添加</el-button>
        </div>
        <div v-if="ourEntityWords.length" class="word-list control-word-list">
          <el-tag
            v-for="word in ourEntityWords"
            :key="word"
            closable
            size="large"
            type="success"
            @close.prevent="removeOurEntityWord(word)"
          >
            {{ word }}
          </el-tag>
        </div>
        <el-empty v-else description="暂无我司实体" />
      </div>

      <div v-if="authStore.isAdmin" class="word-section">
        <p class="word-title">全员词库概览</p>
        <div class="all-words">
          <div v-for="member in authStore.members" :key="member.id" class="member-word-card">
            <strong>{{ member.name }}</strong>
            <p>{{ member.title }}</p>
            <div class="word-list compact">
              <span
                v-for="group in member.customWordGroups || []"
                :key="group.id"
                class="group-chip"
                :class="{ disabled: group.enabled === false }"
              >
                {{ group.name }} · {{ group.words?.length || 0 }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { open } from '@tauri-apps/plugin-dialog'
import SectionHeader from '../components/SectionHeader.vue'
import { useAuthStore } from '../store/auth'
import { uid } from '../utils/storage'
import { readWordLibraryFile, WORD_LIBRARY_FILE_TYPES } from '../utils/file'

const DEFAULT_GROUP_ID = 'group-default'

const authStore = useAuthStore()
authStore.bootstrap()

const selectedGroupId = ref(DEFAULT_GROUP_ID)
const importGroupId = ref(DEFAULT_GROUP_ID)
const groupInput = ref('')
const wordInput = ref('')
const whitelistInput = ref('')
const ourEntityInput = ref('')

const wordGroups = computed(() => authStore.currentWordGroups)
const whitelistWords = computed(() => authStore.activeWhitelistWords)
const ourEntityWords = computed(() => authStore.activeOurEntityWords)
const selectedGroup = computed(() =>
  wordGroups.value.find((group) => group.id === selectedGroupId.value) ||
  wordGroups.value.find((group) => group.id === DEFAULT_GROUP_ID) ||
  wordGroups.value[0]
)
const selectedGroupWords = computed(() => selectedGroup.value?.words || [])
const canDeleteSelectedGroup = computed(
  () => !!selectedGroup.value && selectedGroup.value.id !== DEFAULT_GROUP_ID
)

watch(
  wordGroups,
  (groups) => {
    if (!groups.some((group) => group.id === selectedGroupId.value)) {
      selectedGroupId.value = groups[0]?.id || DEFAULT_GROUP_ID
    }
    if (!groups.some((group) => group.id === importGroupId.value)) {
      importGroupId.value = groups[0]?.id || DEFAULT_GROUP_ID
    }
  },
  { immediate: true }
)

function normalizeWords(words = [], options = {}) {
  const minLength = options.minLength ?? 2
  const maxLength = options.maxLength ?? 40
  return Array.from(
    new Set(
      words
        .map((word) => String(word || '').trim())
        .filter((word) => word.length >= minLength && word.length <= maxLength)
    )
  )
}

function normalizeImportedWords(text) {
  return normalizeWords(String(text || '').split(/[\n\r,，;；、\t\s]+/))
}

function saveGroups(groups) {
  if (!authStore.currentUser?.id) {
    return
  }
  authStore.setCustomWordGroups(authStore.currentUser.id, groups)
}

function saveWhitelistWords(words) {
  if (!authStore.currentUser?.id) {
    return
  }
  authStore.setWhitelistWords(
    authStore.currentUser.id,
    normalizeWords(words, { minLength: 1, maxLength: 80 })
  )
}

function saveOurEntityWords(words) {
  if (!authStore.currentUser?.id) {
    return
  }
  authStore.setOurEntityWords(
    authStore.currentUser.id,
    normalizeWords(words, { minLength: 1, maxLength: 80 })
  )
}

function updateGroup(groupId, patch) {
  saveGroups(
    wordGroups.value.map((group) =>
      group.id === groupId ? { ...group, ...patch } : group
    )
  )
}

function createGroup() {
  const name = groupInput.value.trim()
  if (!name) {
    return
  }
  if (wordGroups.value.some((group) => group.name === name)) {
    ElMessage.warning('分组名称已存在')
    return
  }
  const group = {
    id: uid('word-group'),
    name,
    enabled: true,
    words: []
  }
  saveGroups([...wordGroups.value, group])
  selectedGroupId.value = group.id
  importGroupId.value = group.id
  groupInput.value = ''
  ElMessage.success('分组已创建')
}

function toggleGroup(groupId, enabled) {
  updateGroup(groupId, { enabled })
}

async function deleteGroup(groupId) {
  const target = wordGroups.value.find((group) => group.id === groupId)
  if (!target) {
    return
  }
  if (target.id === DEFAULT_GROUP_ID) {
    ElMessage.warning('默认分组不可删除')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定要删除分组「${target.name}」吗？该分组下的 ${target.words.length} 个脱敏词将一并移除，且不可恢复。`,
      '删除分组',
      {
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
  } catch {
    return
  }

  const remaining = wordGroups.value.filter((group) => group.id !== groupId)
  saveGroups(remaining)

  const fallbackId =
    remaining.find((group) => group.id === DEFAULT_GROUP_ID)?.id ||
    remaining[0]?.id ||
    DEFAULT_GROUP_ID
  if (selectedGroupId.value === groupId) {
    selectedGroupId.value = fallbackId
  }
  if (importGroupId.value === groupId) {
    importGroupId.value = fallbackId
  }
  ElMessage.success('分组已删除')
}

function addWord() {
  const nextWord = wordInput.value.trim()
  if (!nextWord || !selectedGroup.value) {
    return
  }
  const nextWords = normalizeWords([nextWord, ...selectedGroupWords.value])
  updateGroup(selectedGroup.value.id, { words: nextWords })
  wordInput.value = ''
  ElMessage.success('已添加脱敏词')
}

function addWhitelistWord() {
  const nextWord = whitelistInput.value.trim()
  if (!nextWord) {
    return
  }
  saveWhitelistWords([nextWord, ...whitelistWords.value])
  whitelistInput.value = ''
  ElMessage.success('已添加白名单词')
}

function addOurEntityWord() {
  const nextWord = ourEntityInput.value.trim()
  if (!nextWord) {
    return
  }
  saveOurEntityWords([nextWord, ...ourEntityWords.value])
  ourEntityInput.value = ''
  ElMessage.success('已添加我司实体')
}

async function importWords() {
  try {
    const path = await pickFileByExtensions(WORD_LIBRARY_FILE_TYPES)
    if (!path) {
      return
    }
    const targetGroup =
      wordGroups.value.find((group) => group.id === importGroupId.value) ||
      wordGroups.value.find((group) => group.id === DEFAULT_GROUP_ID) ||
      wordGroups.value[0]

    if (!targetGroup) {
      ElMessage.warning('请先创建一个分组')
      return
    }

    const file = await readWordLibraryFile(path)
    const importedWords = normalizeImportedWords(file.text)
    if (!importedWords.length) {
      ElMessage.warning('未从文件中识别到可导入的词条')
      return
    }

    const previousCount = targetGroup.words.length
    const nextWords = normalizeWords([...importedWords, ...targetGroup.words])
    updateGroup(targetGroup.id, { words: nextWords })
    selectedGroupId.value = targetGroup.id
    ElMessage.success(`导入完成，新增 ${nextWords.length - previousCount} 个词条`)
  } catch (error) {
    ElMessage.error(error.message || '导入词库失败')
  }
}

function removeWord(word) {
  if (!selectedGroup.value) {
    return
  }
  updateGroup(selectedGroup.value.id, {
    words: selectedGroupWords.value.filter((item) => item !== word)
  })
  ElMessage.success('已删除脱敏词')
}

function removeWhitelistWord(word) {
  saveWhitelistWords(whitelistWords.value.filter((item) => item !== word))
  ElMessage.success('已删除白名单词')
}

function removeOurEntityWord(word) {
  saveOurEntityWords(ourEntityWords.value.filter((item) => item !== word))
  ElMessage.success('已删除我司实体')
}

async function pickFileByExtensions(extensions) {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: '词库文件',
        extensions
      }
    ]
  })
  return typeof selected === 'string' ? selected : null
}
</script>

<style scoped>
.word-library-grid {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 20px;
}

.group-panel,
.panel {
  padding: 24px;
}

.group-create,
.word-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
}

.group-list {
  display: grid;
  gap: 10px;
  margin-top: 18px;
}

.group-item {
  width: 100%;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: #f8fbff;
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  text-align: left;
  cursor: pointer;
}

.group-item.active {
  border-color: rgba(47, 111, 237, 0.42);
  background: rgba(47, 111, 237, 0.08);
}

.group-item strong,
.group-item small {
  display: block;
}

.group-item small {
  margin-top: 4px;
  color: var(--text-secondary);
}

.import-group-select {
  width: 180px;
}

.word-import-tip {
  margin-top: 14px;
}

.word-section {
  margin-top: 24px;
}

.word-section + .word-section {
  margin-top: 28px;
}

.word-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.word-title {
  margin: 0;
  font-weight: 700;
}

.word-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.control-word-list {
  margin-top: 14px;
}

.word-list.compact {
  gap: 8px;
}

.all-words {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.member-word-card {
  padding: 16px;
  border-radius: 14px;
  background: #f8fbff;
  border: 1px solid var(--line-soft);
}

.member-word-card p {
  margin: 8px 0 14px;
  color: var(--text-secondary);
}

.group-chip {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(47, 111, 237, 0.09);
  color: var(--brand-dark);
  font-size: 13px;
}

.group-chip.disabled {
  background: rgba(148, 163, 184, 0.18);
  color: var(--text-secondary);
}

@media (max-width: 1024px) {
  .word-library-grid,
  .all-words {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .group-create,
  .word-toolbar {
    grid-template-columns: 1fr;
  }
}
</style>
