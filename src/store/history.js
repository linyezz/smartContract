import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import dayjs from 'dayjs'
import { getHistory, saveHistory, uid } from '../utils/storage'
import { useAuthStore } from './auth'

export const useHistoryStore = defineStore('history', () => {
  const items = ref([])
  const loaded = ref(false)

  function bootstrap() {
    if (loaded.value) {
      return
    }
    items.value = getHistory()
    loaded.value = true
  }

  function persist(nextItems) {
    items.value = nextItems
    void saveHistory(nextItems)
  }

  function createRecord(payload) {
    const authStore = useAuthStore()
    const user = authStore.currentUser
    const record = {
      id: uid('history'),
      operatorId: user?.id,
      operatorName: user?.name || '未知用户',
      createdAt: new Date().toISOString(),
      status: '已完成',
      ...payload
    }
    persist([record, ...items.value])
    return record
  }

  function deleteRecords(ids) {
    persist(items.value.filter((item) => !ids.includes(item.id)))
  }

  function updateRecord(recordId, payload) {
    const nextItems = items.value.map((item) =>
      item.id === recordId ? { ...item, ...payload } : item
    )
    persist(nextItems)
    return nextItems.find((item) => item.id === recordId) || null
  }

  const visibleItems = computed(() => {
    const authStore = useAuthStore()
    if (authStore.isAdmin) {
      return items.value
    }
    return items.value.filter((item) => item.operatorId === authStore.currentUser?.id)
  })

  function filterRecords(filters) {
    const base = visibleItems.value
    return base.filter((item) => {
      const nameMatched = !filters.keyword || item.fileName.includes(filters.keyword)
      const modeMatched = !filters.mode || item.mode === filters.mode
      const dateMatched = !filters.range?.length
        || (dayjs(item.createdAt).isAfter(dayjs(filters.range[0]).startOf('day'))
          && dayjs(item.createdAt).isBefore(dayjs(filters.range[1]).endOf('day')))
      return nameMatched && modeMatched && dateMatched
    })
  }

  return {
    items,
    visibleItems,
    bootstrap,
    createRecord,
    deleteRecords,
    updateRecord,
    filterRecords
  }
})
