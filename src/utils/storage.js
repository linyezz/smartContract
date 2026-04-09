import { load } from '@tauri-apps/plugin-store'

const KEYS = {
  currentUserId: 'ecmax.currentUserId',
  members: 'ecmax.members',
  history: 'ecmax.desensitizeHistory'
}

const adminMember = {
  id: 'user-admin',
  username: 'admin',
  password: '123456',
  name: '系统管理员',
  role: 'admin',
  title: '法务平台主管',
  email: 'admin@ecmax.local',
  phone: '13800138000',
  avatar: '',
  loginType: 'password',
  customWords: ['极易科技', '商业秘密', '内部报价']
}

const state = {
  currentUserId: null,
  members: [adminMember],
  history: []
}

let storePromise = null
let initialized = false

async function getStore() {
  if (!storePromise) {
    storePromise = load('ecmax-store.json', {
      autoSave: 100,
      defaults: {
        [KEYS.currentUserId]: null,
        [KEYS.members]: [adminMember],
        [KEYS.history]: []
      }
    })
  }
  return storePromise
}

export async function initializePersistence() {
  if (initialized) {
    return state
  }

  const store = await getStore()
  const members = await store.get(KEYS.members)
  const currentUserId = await store.get(KEYS.currentUserId)
  const history = await store.get(KEYS.history)

  state.members = Array.isArray(members) && members.length > 0 ? members : [adminMember]
  state.currentUserId = typeof currentUserId === 'string' ? currentUserId : null
  state.history = Array.isArray(history) ? history : []

  if (!Array.isArray(members) || members.length === 0) {
    await store.set(KEYS.members, state.members)
    await store.save()
  }

  initialized = true
  return state
}

export function getMembers() {
  return [...state.members]
}

export async function saveMembers(members) {
  state.members = [...members]
  const store = await getStore()
  await store.set(KEYS.members, state.members)
}

export function getCurrentUserId() {
  return state.currentUserId
}

export async function saveCurrentUserId(userId) {
  state.currentUserId = userId || null
  const store = await getStore()
  await store.set(KEYS.currentUserId, state.currentUserId)
}

export function getHistory() {
  return [...state.history]
}

export async function saveHistory(history) {
  state.history = [...history]
  const store = await getStore()
  await store.set(KEYS.history, state.history)
}

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export { KEYS }
