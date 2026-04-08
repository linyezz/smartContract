<template>
  <div class="profile-grid">
    <aside class="content-card sidebar">
      <div class="avatar-block">
        <div class="avatar-circle">{{ initial }}</div>
        <h3>{{ authStore.currentUser?.name }}</h3>
        <p>{{ authStore.currentUser?.title }}</p>
      </div>
      <el-menu :default-active="activeTab" @select="activeTab = $event">
        <el-menu-item index="profile">个人信息</el-menu-item>
        <el-menu-item index="words">脱敏词库</el-menu-item>
        <el-menu-item v-if="authStore.isAdmin" index="members">成员管理</el-menu-item>
      </el-menu>
      <el-button plain class="logout-button" @click="handleLogout">退出登录</el-button>
    </aside>

    <section class="content-card panel">
      <template v-if="activeTab === 'profile'">
        <SectionHeader title="个人信息" subtitle="修改头像文字、姓名、职位、邮箱和手机号。" />
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
            </div>
          </template>
        </SectionHeader>

        <div class="word-section">
          <p class="word-title">我的词库</p>
          <div class="word-list">
            <el-tag
              v-for="word in myWords"
              :key="word"
              closable
              size="large"
              @close="removeWord(word)"
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
import SectionHeader from '../components/SectionHeader.vue'
import { useAuthStore } from '../store/auth'
import { uid } from '../utils/storage'

const router = useRouter()
const authStore = useAuthStore()
authStore.bootstrap()

const activeTab = ref('profile')
const selectedMemberIds = ref([])
const memberDialogVisible = ref(false)
const wordInput = ref('')

const profileForm = reactive({
  id: '',
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

function removeWord(word) {
  authStore.setCustomWords(
    authStore.currentUser.id,
    myWords.value.filter((item) => item !== word)
  )
  ElMessage.success('已删除脱敏词')
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

.avatar-block h3,
.avatar-block p {
  margin: 0;
}

.avatar-block p {
  margin-top: 8px;
  color: var(--text-secondary);
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
