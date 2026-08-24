// Global app store using Zustand
'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Language } from './i18n'
import type { SessionUser } from './auth'

interface AppState {
  user: SessionUser | null
  setUser: (user: SessionUser | null) => void
  language: Language
  setLanguage: (lang: Language) => void
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
      // C-2 FIX: Only persist user, language, theme — NOT token
      partialize: (state) => ({
        user: state.user,
        language: state.language,
        theme: state.theme,
      }),
    }
  )
)
