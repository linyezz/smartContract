<template>
  <div class="profile-grid">
    <aside class="content-card sidebar">
      <div class="avatar-block">
        <div v-if="authStore.currentUser?.avatar" class="avatar-circle avatar-image-wrap">
          <img :src="authStore.currentUser.avatar" :alt="authStore.currentUser.name" class="avatar-image" />
        </div>
        <div v-else class="avatar-circle">{{ initial }}</div>
        <el-button link type="primary" class="avatar-edit-button" @click="changeAvatar">
          修改头像
        </el-button>
      </div>
      <el-menu :default-active="activeTab" @select="activeTab = $event">
        <el-menu-item index="profile">个人信息</el-menu-item>
        <el-menu-item index="words">脱敏词库</el-menu-item>
        <el-menu-item index="about">关于</el-menu-item>
        <el-menu-item v-if="authStore.isAdmin" index="members">成员管理</el-menu-item>
      </el-menu>
      <el-button plain class="logout-button" @click="handleLogout">退出登录</el-button>
    </aside>

    <section class="content-card panel">
      <template v-if="activeTab === 'profile'">
        <SectionHeader title="个人信息" subtitle="修改姓名、职位、邮箱和手机号。" />
        <el-form label-position="top" :model="profileForm" class="form-grid">
          <el-form-item label="姓名"><el-input v-model="profileForm.name" /></el-form-item>
          <el-form-item label="职位"><el-input v-model="profileForm.title" /></el-form-item>
          <el-form-item label="邮箱"><el-input v-model="profileForm.email" /></el-form-item>
          <el-form-item label="手机号"><el-input v-model="profileForm.phone" /></el-form-item>
        </el-form>
        <el-button type="primary" @click="saveProfile">保存信息</el-button>
      </template>

      <template v-else-if="activeTab === 'words'">
        <SectionHeader title="脱敏词库设置" subtitle="首页会自动同步当前用户的自定义脱敏词。">
          <template #extra>
            <div class="inline-add">
              <el-input v-model="wordInput" placeholder="输入一个自定义词" @keyup.enter="addWord" />
              <el-button type="primary" @click="addWord">添加</el-button>
              <el-button @click="importWords">导入词库</el-button>
            </div>
          </template>
        </SectionHeader>

        <div class="word-section">
          <p class="word-title">我的词库</p>
          <p class="word-tip">支持导入 `docx`、`txt`、`md`，系统会自动从文本中提取词条并去重。</p>
          <div class="word-list">
            <el-tag
              v-for="word in myWords"
              :key="word"
              closable
              size="large"
              @close.prevent="removeWord(word)"
            >
              {{ word }}
            </el-tag>
          </div>
        </div>

        <div v-if="authStore.isAdmin" class="word-section">
          <p class="word-title">全员词库</p>
          <div class="all-words">
            <div v-for="member in authStore.members" :key="member.id" class="member-word-card">
              <strong>{{ member.name }}</strong>
              <p>{{ member.title }}</p>
              <div class="word-list compact">
                <span v-for="word in member.customWords || []" :key="word" class="word-tag">
                  {{ word }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="activeTab === 'about'">
        <SectionHeader title="关于" subtitle="产品信息与适用说明。" />
        <div class="about-card">
          <h2>极易合同智能脱敏系统</h2>
          <p><strong>版本：</strong>1.0.0</p>
          <p><strong>用途：</strong>用于合同等文档的敏感信息脱敏处理</p>
          <p>适用于法务场景的文档处理工具</p>
        </div>
      </template>

      <template v-else>
        <SectionHeader title="成员管理" subtitle="管理员可新增成员、删除成员并配置基础角色权限。" />
        <div class="member-tools">
          <el-button type="primary" @click="memberDialogVisible = true">添加成员</el-button>
          <el-button
            type="danger"
            plain
            :disabled="selectedMemberIds.length === 0"
            @click="deleteMembers()"
          >
            批量删除
          </el-button>
        </div>

        <el-table
          :data="authStore.members"
          row-key="id"
          @selection-change="selectedMemberIds = $event.map((item) => item.id)"
        >
          <el-table-column type="selection" width="52" />
          <el-table-column prop="name" label="姓名" />
          <el-table-column prop="username" label="账号" />
          <el-table-column prop="title" label="职位" />
          <el-table-column prop="role" label="角色" />
          <el-table-column prop="email" label="邮箱" />
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button link type="danger" @click="deleteMembers([row.id])">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </section>
  </div>

  <el-dialog v-model="memberDialogVisible" width="560px" title="添加成员">
    <el-form label-position="top" :model="memberForm">
      <el-form-item label="姓名"><el-input v-model="memberForm.name" /></el-form-item>
      <el-form-item label="账号"><el-input v-model="memberForm.username" /></el-form-item>
      <el-form-item label="密码"><el-input v-model="memberForm.password" /></el-form-item>
      <el-form-item label="职位"><el-input v-model="memberForm.title" /></el-form-item>
      <el-form-item label="邮箱"><el-input v-model="memberForm.email" /></el-form-item>
      <el-form-item label="手机号"><el-input v-model="memberForm.phone" /></el-form-item>
      <el-form-item label="角色">
        <el-select v-model="memberForm.role">
          <el-option label="管理员" value="admin" />
          <el-option label="普通用户" value="user" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="memberDialogVisible = false">取消</el-button>
      <el-button type="primary" @click="createMember">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import SectionHeader from '../components/SectionHeader.vue'
import { useAuthStore } from '../store/auth'
import { uid } from '../utils/storage'
import { readWordLibraryFile, WORD_LIBRARY_FILE_TYPES } from '../utils/file'

const router = useRouter()
const authStore = useAuthStore()
authStore.bootstrap()

const activeTab = ref('profile')
const selectedMemberIds = ref([])
const memberDialogVisible = ref(false)
const wordInput = ref('')

const profileForm = reactive({
  id: '',
  avatar: '',
  name: '',
  title: '',
  email: '',
  phone: ''
})

const memberForm = reactive({
  name: '',
  username: '',
  password: '',
  title: '',
  email: '',
  phone: '',
  role: 'user'
})

const initial = computed(() => authStore.currentUser?.name?.slice(0, 1) || '管')
const myWords = computed(() => authStore.currentUser?.customWords || [])

watch(
  () => authStore.currentUser,
  (user) => {
    if (!user) {
      return
    }
    profileForm.id = user.id
    profileForm.avatar = user.avatar || ''
    profileForm.name = user.name
    profileForm.title = user.title
    profileForm.email = user.email
    profileForm.phone = user.phone
  },
  { immediate: true, deep: true }
)

function saveProfile() {
  authStore.updateProfile({ ...profileForm })
  ElMessage.success('个人信息已保存')
}

async function changeAvatar() {
  try {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: '头像图片',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif']
        }
      ]
    })

    const path = typeof selected === 'string' ? selected : null
    if (!path) {
      return
    }

    const bytes = await readFile(path)
    profileForm.avatar = buildAvatarDataUrl(path, bytes)
    saveProfile()
  } catch (error) {
    ElMessage.error(error.message || '修改头像失败')
  }
}

function buildAvatarDataUrl(path, bytes) {
  const mimeType = resolveImageMimeType(path)
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return `data:${mimeType};base64,${btoa(binary)}`
}

function resolveImageMimeType(path) {
  const extension = path.split('.').pop()?.toLowerCase()

  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    default:
      return 'image/png'
  }
}

function addWord() {
  const nextWord = wordInput.value.trim()
  if (!nextWord) {
    return
  }
  const nextWords = Array.from(new Set([nextWord, ...myWords.value]))
  authStore.setCustomWords(authStore.currentUser.id, nextWords)
  wordInput.value = ''
  ElMessage.success('已添加自定义脱敏词')
}

function normalizeImportedWords(text) {
  return Array.from(
    new Set(
      text
        .split(/[\n\r,，;；、\t\s]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2 && item.length <= 40)
    )
  )
}

async function importWords() {
  try {
    const path = await pickFileByExtensions(WORD_LIBRARY_FILE_TYPES)
    if (!path) {
      return
    }
    const file = await readWordLibraryFile(path)
    const importedWords = normalizeImportedWords(file.text)
    if (!importedWords.length) {
      ElMessage.warning('未从文件中识别到可导入的词条')
      return
    }

    const previousCount = myWords.value.length
    const nextWords = Array.from(new Set([...importedWords, ...myWords.value]))
    authStore.setCustomWords(authStore.currentUser.id, nextWords)
    ElMessage.success(`导入完成，新增 ${nextWords.length - previousCount} 个词条`)
  } catch (error) {
    ElMessage.error(error.message || '导入词库失败')
  }
}

async function removeWord(word) {
  try {
    await ElMessageBox.confirm(`确认删除词条“${word}”吗？`, '删除确认', {
      type: 'warning'
    })
    authStore.setCustomWords(
      authStore.currentUser.id,
      myWords.value.filter((item) => item !== word)
    )
    ElMessage.success('已删除脱敏词')
  } catch {
    // noop
  }
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

async function createMember() {
  if (!memberForm.name || !memberForm.username || !memberForm.password) {
    ElMessage.warning('请至少填写姓名、账号和密码')
    return
  }
  authStore.addMember({
    id: uid('user'),
    ...memberForm,
    avatar: '',
    customWords: []
  })
  memberDialogVisible.value = false
  Object.assign(memberForm, {
    name: '',
    username: '',
    password: '',
    title: '',
    email: '',
    phone: '',
    role: 'user'
  })
  ElMessage.success('成员已添加')
}

async function deleteMembers(overrideIds) {
  const ids = overrideIds || selectedMemberIds.value
  if (!ids.length) {
    return
  }
  try {
    await ElMessageBox.confirm('删除成员后不可恢复，确认继续吗？', '提示', {
      type: 'warning'
    })
    authStore.deleteMembers(ids)
    selectedMemberIds.value = []
    ElMessage.success('成员已删除')
  } catch {
    // noop
  }
}

function handleLogout() {
  authStore.logout()
  router.push({ name: 'login' })
}
</script>

<style scoped>
.profile-grid {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 20px;
}

.sidebar,
.panel {
  padding: 24px;
}

.avatar-block {
  text-align: center;
  padding-bottom: 20px;
}

.avatar-edit-button {
  margin-top: -2px;
}

.avatar-circle {
  width: 72px;
  height: 72px;
  margin: 0 auto 14px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, var(--brand) 0%, #6ea1ff 100%);
  color: white;
  font-size: 28px;
  font-weight: 800;
}

.avatar-image-wrap {
  overflow: hidden;
  background: rgba(47, 111, 237, 0.08);
}

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.logout-button {
  width: 100%;
  margin-top: 20px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.inline-add {
  display: flex;
  gap: 12px;
}

.word-section + .word-section {
  margin-top: 24px;
}

.word-title {
  margin: 0 0 12px;
  font-weight: 700;
}

.word-tip {
  margin: 0 0 12px;
  color: var(--text-secondary);
  font-size: 13px;
}

.word-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
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
  border-radius: 18px;
  background: #f8fbff;
  border: 1px solid var(--line-soft);
}

.member-word-card strong,
.member-word-card p {
  display: block;
}

.about-card {
  padding: 24px;
  border-radius: 20px;
  background: #f8fbff;
  border: 1px solid var(--line-soft);
}

.about-card h2 {
  margin: 0 0 20px;
  font-size: 28px;
}

.about-card p {
  margin: 0 0 14px;
  line-height: 1.8;
  color: var(--text-primary);
}

.member-word-card p {
  margin: 8px 0 14px;
  color: var(--text-secondary);
}

.word-tag {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(47, 111, 237, 0.09);
  color: var(--brand-dark);
  font-size: 13px;
}

.member-tools {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

@media (max-width: 1024px) {
  .profile-grid {
    grid-template-columns: 1fr;
  }

  .all-words,
  .form-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .inline-add {
    flex-direction: column;
    width: 100%;
  }
}
</style>
