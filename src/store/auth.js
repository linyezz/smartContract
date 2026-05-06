import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  getCurrentUserId,
  getMembers,
  saveCurrentUserId,
  saveMembers
} from '../utils/storage'
import { normalizeWecomProfile, requestWecomLogin } from '../utils/wecom'

const DEFAULT_WORD_GROUP_ID = 'group-default'
const DEFAULT_WORD_GROUP_NAME = '默认分组'

function uniqueWords(words = []) {
  return Array.from(
    new Set(
      words
        .map((word) => String(word || '').trim())
        .filter(Boolean)
    )
  )
}

function createDefaultWordGroup(words = []) {
  return {
    id: DEFAULT_WORD_GROUP_ID,
    name: DEFAULT_WORD_GROUP_NAME,
    enabled: true,
    words: uniqueWords(words)
  }
}

function normalizeCustomWordGroups(member = {}) {
  const sourceGroups = Array.isArray(member.customWordGroups) ? member.customWordGroups : []
  const groups = sourceGroups
    .map((group, index) => ({
      id: group.id || (index === 0 ? DEFAULT_WORD_GROUP_ID : `group-${Date.now()}-${index}`),
      name: String(group.name || '').trim() || (index === 0 ? DEFAULT_WORD_GROUP_NAME : `分组 ${index + 1}`),
      enabled: group.enabled !== false,
      words: uniqueWords(group.words || [])
    }))
    .filter((group) => group.name)

  if (!groups.length) {
    groups.push(createDefaultWordGroup(member.customWords || []))
  }

  if (!groups.some((group) => group.id === DEFAULT_WORD_GROUP_ID)) {
    groups.unshift(createDefaultWordGroup(member.customWords || []))
  }

  return groups.map((group) => (
    group.id === DEFAULT_WORD_GROUP_ID
      ? { ...group, name: group.name || DEFAULT_WORD_GROUP_NAME, enabled: group.enabled !== false }
      : group
  ))
}

function flattenCustomWordGroups(groups = []) {
  return uniqueWords(groups.flatMap((group) => group.words || []))
}

function normalizeMember(member = {}) {
  const customWordGroups = normalizeCustomWordGroups(member)
  return {
    ...member,
    customWordGroups,
    customWords: flattenCustomWordGroups(customWordGroups)
  }
}

export const useAuthStore = defineStore('auth', () => {
  const members = ref([])
  const currentUser = ref(null)
  const bootstrapped = ref(false)

  function bootstrap() {
    if (bootstrapped.value) {
      return
    }
    const normalizedMembers = getMembers().map(normalizeMember)
    members.value = normalizedMembers
    void saveMembers(normalizedMembers)
    const currentUserId = getCurrentUserId()
    currentUser.value = members.value.find((item) => item.id === currentUserId) || null
    bootstrapped.value = true
  }

  function refreshMembers() {
    const normalizedMembers = getMembers().map(normalizeMember)
    members.value = normalizedMembers
    void saveMembers(normalizedMembers)
    if (currentUser.value) {
      currentUser.value = members.value.find((item) => item.id === currentUser.value.id) || null
    }
  }

  function loginByPassword(username, password) {
    refreshMembers()
    const user = members.value.find(
      (item) => item.username === username && item.password === password
    )
    if (!user) {
      return { success: false, message: '账号或密码错误' }
    }
    currentUser.value = user
    void saveCurrentUserId(user.id)
    return { success: true, user }
  }

  async function upsertMember(nextMember) {
    const index = members.value.findIndex((item) => item.id === nextMember.id)
    const normalizedMember = normalizeMember(nextMember)
    const nextMembers =
      index === -1
        ? [normalizedMember, ...members.value]
        : members.value.map((item) => (item.id === nextMember.id ? normalizedMember : item))

    members.value = nextMembers
    await saveMembers(nextMembers)
    return normalizedMember
  }

  function buildWecomMember(userInfo) {
    const profile = normalizeWecomProfile(userInfo)
    const existingUser = members.value.find(
      (item) =>
        item.wecomUserId === profile.wecomUserId ||
        (profile.username && item.username === profile.username)
    )

    return {
      id: existingUser?.id || `wecom-${profile.wecomUserId || Date.now()}`,
      username: profile.username || existingUser?.username || `wecom_${Date.now()}`,
      password: existingUser?.password || '',
      name: profile.name,
      role: existingUser?.role || 'user',
      title: profile.title,
      email: profile.email,
      phone: profile.phone,
      avatar: profile.avatar,
      customWords: existingUser?.customWords || [],
      customWordGroups: existingUser?.customWordGroups || normalizeCustomWordGroups(existingUser || {}),
      loginType: 'wecom',
      wecomUserId: profile.wecomUserId,
      wecomProfile: profile.rawProfile
    }
  }

  async function loginByWecomUuid(uuid) {
    refreshMembers()

    try {
      const result = await requestWecomLogin(uuid)
      const userInfo = result?.user_info || result?.userInfo

      if (!result?.access_token || !userInfo) {
        return {
          success: false,
          message: result?.message || '企微登录失败，未获取到用户信息'
        }
      }

      const user = await upsertMember(buildWecomMember(userInfo))
      currentUser.value = user
      await saveCurrentUserId(user.id)

      return {
        success: true,
        user,
        tokenData: result
      }
    } catch (error) {
      console.error(error)
      return {
        success: false,
        message: error?.message || '企微登录失败'
      }
    }
  }

  function updateProfile(payload) {
    const normalizedPayload = payload.customWordGroups
      ? {
          ...payload,
          customWordGroups: normalizeCustomWordGroups(payload),
          customWords: flattenCustomWordGroups(normalizeCustomWordGroups(payload))
        }
      : payload
    const nextMembers = members.value.map((item) =>
      item.id === payload.id ? normalizeMember({ ...item, ...normalizedPayload }) : item
    )
    members.value = nextMembers
    void saveMembers(nextMembers)
    if (currentUser.value?.id === payload.id) {
      currentUser.value = nextMembers.find((item) => item.id === payload.id) || null
    }
  }

  function setCustomWords(userId, customWords) {
    updateProfile({ id: userId, customWordGroups: [createDefaultWordGroup(customWords)] })
  }

  function setCustomWordGroups(userId, customWordGroups) {
    updateProfile({ id: userId, customWordGroups })
  }

  function addMember(member) {
    const nextMembers = [normalizeMember(member), ...members.value]
    members.value = nextMembers
    void saveMembers(nextMembers)
  }

  function deleteMembers(ids) {
    const nextMembers = members.value.filter((item) => !ids.includes(item.id))
    members.value = nextMembers
    void saveMembers(nextMembers)
    if (currentUser.value && ids.includes(currentUser.value.id)) {
      logout()
    }
  }

  function logout() {
    currentUser.value = null
    void saveCurrentUserId('')
  }

  const isAdmin = computed(() => currentUser.value?.role === 'admin')
  const currentWordGroups = computed(() => normalizeCustomWordGroups(currentUser.value || {}))
  const activeCustomWords = computed(() =>
    uniqueWords(
      currentWordGroups.value
        .filter((group) => group.enabled)
        .flatMap((group) => group.words || [])
    )
  )

  return {
    members,
    currentUser,
    isAdmin,
    currentWordGroups,
    activeCustomWords,
    bootstrap,
    refreshMembers,
    loginByPassword,
    loginByWecomUuid,
    updateProfile,
    setCustomWords,
    setCustomWordGroups,
    addMember,
    deleteMembers,
    logout
  }
})
