// Global app store using Zustand
'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Language } from './i18n'
import type { SessionUser } from './auth'

interface AppState {
  user: SessionUser | null
  setUser: (user: SessionUser | null) => void
  token: string | null
  setToken: (token: string | null) => void
  language: Language
  setLanguage: (lang: Language) => void
  setPage: (page: string) => void
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
      setPage: (page) => { /* navigation handled by app-shell */ },
      sidebarOpen: false,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      theme: 'light',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'axis-storage',
      storage: createJSONStorage(() => localStorage),
      // Only persist preferences — NOT user session data
      // Session is managed by httpOnly cookie (ends when browser closes)
      partialize: (state) => ({
        language: state.language,
        theme: state.theme,
      }),
    }
  )
)
