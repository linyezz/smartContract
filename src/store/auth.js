import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  getCurrentUserId,
  getMembers,
  saveCurrentUserId,
  saveMembers
} from '../utils/storage'

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
    updateProfile,
    setCustomWords,
    addMember,
    deleteMembers,
    logout
  }
})
