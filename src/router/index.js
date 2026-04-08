import { createRouter, createWebHashHistory } from 'vue-router'

import AppLayout from '../layouts/AppLayout.vue'
import LoginPage from '../pages/LoginPage.vue'
import HomePage from '../pages/HomePage.vue'
import HistoryPage from '../pages/HistoryPage.vue'
import ProfilePage from '../pages/ProfilePage.vue'
import { useAuthStore } from '../store/auth'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginPage,
      meta: { public: true }
    },
    {
      path: '/',
      component: AppLayout,
      children: [
        {
          path: '',
          name: 'home',
          component: HomePage
        },
        {
          path: 'history',
          name: 'history',
          component: HistoryPage
        },
        {
          path: 'profile',
          name: 'profile',
          component: ProfilePage
        }
      ]
    }
  ]
})

router.beforeEach((to) => {
  const authStore = useAuthStore()
  authStore.bootstrap()

  if (!to.meta.public && !authStore.currentUser) {
    return { name: 'login' }
  }

  if (to.name === 'login' && authStore.currentUser) {
    return { name: 'home' }
  }

  return true
})

export default router
