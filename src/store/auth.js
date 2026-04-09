import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  getCurrentUserId,
  getMembers,
  saveCurrentUserId,
  saveMembers
} from '../utils/storage'
import { normalizeWecomProfile, requestWecomLogin } from '../utils/wecom'

export const useAuthStore = defineStore('auth', () => {
  const members = ref([])
  const currentUser = ref(null)
  const bootstrapped = ref(false)

  function bootstrap() {
    if (bootstrapped.value) {
      return
    }
    members.value = getMembers()
    const currentUserId = getCurrentUserId()
    currentUser.value = members.value.find((item) => item.id === currentUserId) || null
    bootstrapped.value = true
  }

  function refreshMembers() {
    members.value = getMembers()
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
    const nextMembers =
      index === -1
        ? [nextMember, ...members.value]
        : members.value.map((item) => (item.id === nextMember.id ? nextMember : item))

    members.value = nextMembers
    await saveMembers(nextMembers)
    return nextMember
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
    const nextMembers = members.value.map((item) =>
      item.id === payload.id ? { ...item, ...payload } : item
    )
    members.value = nextMembers
    void saveMembers(nextMembers)
    if (currentUser.value?.id === payload.id) {
      currentUser.value = nextMembers.find((item) => item.id === payload.id) || null
    }
  }

  function setCustomWords(userId, customWords) {
    updateProfile({ id: userId, customWords })
  }

  function addMember(member) {
    const nextMembers = [member, ...members.value]
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

  return {
    members,
    currentUser,
    isAdmin,
    bootstrap,
    refreshMembers,
    loginByPassword,
    loginByWecomUuid,
    updateProfile,
    setCustomWords,
    addMember,
    deleteMembers,
    logout
  }
})
