"use client"
import { useState } from 'react'
export function useToast() {
  const [toasts, setToasts] = useState<any[]>([])
  return { toasts, toast: (opts: any) => setToasts((p) => [...p, { id: Date.now(), ...opts }]), dismiss: (id: string) => setToasts((p) => p.filter((t) => t.id !== id)) }
}
