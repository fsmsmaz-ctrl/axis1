// Global app store using Zustand
'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Language } from './i18n'
import type { SessionUser } from './auth'

interface AppState {
  // Auth
  user: SessionUser | null
  setUser: (user: SessionUser | null) => void

  // JWT token (stored separately for Authorization header)
  token: string | null
  setToken: (token: string | null) => void

  // Language
  language: Language
  setLanguage: (lang: Language) => void

  // UI
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }),

      token: null,
      setToken: (token) => set({ token }),

      language: 'ar',
      setLanguage: (language) => set({ language }),

      sidebarOpen: false,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

      theme: 'light',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'axis-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        language: state.language,
        theme: state.theme,
      }),
    }
  )
)
