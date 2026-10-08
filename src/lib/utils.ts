import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// v80: تاريخ اليوم بالتوقيت المحلي وليس UTC — عُمان UTC+4، فبين 00:00 و04:00 فجراً
// كان new Date().toISOString() يعيد تاريخ أمس فيُسجَّل الإدخال بيوم خاطئ.
// نفس معادلة daily-reports المعتمدة (Date.now() - timezoneOffset) لتوحيد السلوك.
export function localTodayISO(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0]
}
