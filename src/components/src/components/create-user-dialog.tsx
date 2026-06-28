'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'
import { UserPlus, ShieldAlert, Trash2, Edit3, Save, ArrowLeft, Users } from 'lucide-react'
import { TOGGLABLE_PERMISSIONS, TOGGLABLE_PERMISSION_LABELS, ROLE_PERMISSIONS } from '@/lib/auth'

const VALID_ROLES = [
  { value: 'top_management', ar: 'الإدارة العليا', en: 'Top Management' },
  { value: 'project_manager', ar: 'مدير المشروع', en: 'Project Manager' },
  { value: 'site_engineer', ar: 'مهندس الموقع', en: 'Site Engineer' },
  { value: 'hse_officer', ar: 'مسؤول السلامة', en: 'HSE Officer' },
  { value: 'foreman', ar: 'المشرف', en: 'Foreman' },
  { value: 'accountant', ar: 'المحاسب', en: 'Accountant' },
]

const roleLabels: Record<string, { ar: string; en: string }> = {
  top_management: { ar: 'الإدارة العليا', en: 'Top Management' },
  project_manager: { ar: 'مدير المشروع', en: 'Project Manager' },
  site_engineer: { ar: 'مهندس الموقع', en: 'Site Engineer' },
  hse_officer: { ar: 'مسؤول السلامة', en: 'HSE Officer' },
  foreman: { ar: 'المشرف', en: 'Foreman' },
  accountant: { ar: 'المحاسب', en: 'Accountant' },
}

interface CreateUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CreateUserDialog({ open, onOpenChange }: CreateUserDialogProps) {
  const language = useAppStore((s) => s.language)
  const isRtl = language === 'ar'
  const token = useAppStore((s) => s.token)

  const [view, setView] = useState<'list' | 'create' | 'edit'>('list')
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState
