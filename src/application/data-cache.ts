// ─────────────────────────────────────────────────────────────────────────────
// v96 — طبقة التطبيق (Application Layer) — إدارة حالة القراءة المركزية
// ─────────────────────────────────────────────────────────────────────────────
// قوانين هذه الطبقة: خدمات يستعملها العرض (use cases) — تنسّق بين النطاق
// والبنية التحتية ولا تحوي أي واجهة (UI). هذه الوحدة نُقلت هنا في v96 من
// src/lib/data-cache.ts (أُنشئت في v95) — الكود نفسه بايت ببايت، لا تغيير
// سلوكياً؛ يُحذف المسار القديم src/lib/data-cache.ts ضمن هذه النسخة.
// ذاكرة مركزية خفيفة لطلبات القراءة (GET) فوق authedFetch — لا تمس
// الصلاحيات ولا الجلسة (الكوكي httpOnly هو مصدر الحقيقة كما هو منذ v14).
//
// ماذا تضيف:
//   1) cachedGet(url)        → طلب GET عبر ذاكرة بمدة صلاحية (TTL):
//                              النداءات المتكررة خلال المدة تُقرأ من الذاكرة
//                              فوراً بدل طلب شبكي جديد.
//   2) منع تكرار الطلبات      → النداءات المتوازية لنفس المسار تتشارك طلباً
//                              واحداً (dedup) فلا تتراكم الطلبات على الخادم.
//   3) useCachedGet(url)      → خطّاف React بنمط stale-while-revalidate:
//                              يعرض النسخة المخزنة لحظياً ثم يحدّثها بصمت.
//   4) invalidateCache(prefix)→ إبطال الذاكرة بعد عمليات التعديل (POST/PATCH/DELETE)
//                              حتى تُجلب بيانات حية في القراءة التالية، مع بث
//                              حدث axis:cache-invalidated للتنسيق بين الأقسام.
//
// قواعد أمان ثابتة:
//   - ذاكرة القراءة فقط: أي طلب له method غير GET لا يمر من هنا إطلاقاً.
//   - لا تُخزّن كلمات مرور ولا توكنات — الكوكي httpOnly يُرسل تلقائياً
//     عبر authedFetch (credentials: 'include') كما في كل النظام.
//   - فشل الشبكة لا يُخزّن أبداً — الخطأ يعود للمستدعي كما كان.
//   - الذاكرة داخل صفحة المتصفح فقط (in-memory) وتُمسح مع تحديث الصفحة،
//     فلا تخزيناً دائماً ولا بقايا بعد الخروج — نفس فلسفة no-store القائمة.
// ─────────────────────────────────────────────────────────────────────────────

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { authedFetch } from '@/lib/api-client'

// ─── المخزن الداخلي ──────────────────────────────────────────────────────────
interface CacheEntry {
  data: unknown
  ts: number // وقت التخزين (epoch ms)
}

const cacheStore = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()

// المدة الافتراضية لصلاحية النسخة المخزنة (20 ثانية) — قصيرة عمداً:
// تكفي لتنقل سريع بين الأقسام دون أن تجعل البيانات قديمة إحساساً.
const DEFAULT_TTL_MS = 20000

export interface CachedGetOptions {
  /** مدة صلاحية النسخة المخزنة بالمللي ثانية (افتراضي 20 ثانية) */
  ttl?: number
  /** تجاهل الذاكرة وإجبار جلب شبكي (يحدّث النسخة المخزنة أيضاً) */
  force?: boolean
}

// ─── cachedGet: القراءة عبر الذاكرة ──────────────────────────────────────────
/**
 * GET عبر ذاكرة إدارة الحالة. الاستدعاء المتكرر خلال ttl يُرجع النسخة المخزنة
 * لحظياً، والنداءات المتوازية لنفس المسار تتشارك طلباً واحداً.
 * يعيد جسم الاستجابة كما هو (JSON) — نفس نمط استهلاك authedFetch القائم،
 * والمستدعي يقرأ حقوله بنفس الطريقة السابقة تماماً.
 */
export async function cachedGet<T = unknown>(
  url: string,
  opts: CachedGetOptions = {}
): Promise<T> {
  const ttl = typeof opts.ttl === 'number' ? opts.ttl : DEFAULT_TTL_MS
  const hit = cacheStore.get(url)
  const isFresh = !!hit && Date.now() - hit.ts < ttl
  if (!opts.force && isFresh) return hit!.data as T

  // منع تكرار الطلبات: إن كان نفس المسار قيد الجلب فعلاً نتشارك وعهده
  const running = inflight.get(url)
  if (running) return running as Promise<T>

  const req = (async () => {
    try {
      const res = await authedFetch(url)
      // نفس أسلوب الاستهلاك القائم: نقرأ الجسم ونمرره للمستدعي
      // (الاستدعاءات القائمة تتعامل مع الحقول بنفسها مثل data.notifications || [])
      const data = await res.json().catch(() => null)
      if (data !== null) cacheStore.set(url, { data, ts: Date.now() })
      return data as T
    } finally {
      inflight.delete(url)
    }
  })()

  inflight.set(url, req)
  return req
}

// ─── invalidateCache: إبطال الذاكرة بعد التعديلات ────────────────────────────
/**
 * يمسح نسخ الذاكرة المتأثرة بعملية تعديل:
 *   invalidateCache()            → مسح كامل (بعد تسجيل خروج مثلاً)
 *   invalidateCache('/api/notifications') → مسح ما يبدأ بهذا المسار فقط
 * ويبث حدث axis:cache-invalidated ليعرف أي مكوّن مهتم أن يحدّث نفسه.
 */
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    cacheStore.clear()
  } else {
    for (const key of Array.from(cacheStore.keys())) {
      if (key === prefix || key.startsWith(prefix)) cacheStore.delete(key)
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('axis:cache-invalidated', { detail: prefix || '*' }))
    } catch {
      // تجاهل — البث تحسيني فقط
    }
  }
}

// ─── useCachedGet: خطّاف القراءة بنمط stale-while-revalidate ─────────────────
/**
 * خطّاف جلب جاهز للأقسام المستقبلية:
 *   const { data, loading, refreshing, error, refresh } = useCachedGet('/api/xxx')
 * - يعرض النسخة المخزنة فوراً إن وُجدت (loading=false) ثم يعيد التحقق بصمت.
 * - refresh() يجلب نسخة حية قسراً (زر «تحديث» مثلاً).
 * - url=null يعطّل الجلب (قبل توفر معرّف مثلاً).
 * خاصية إضافية — لا تستخدمها الأقسام القائمة بعد، وتُعتمد تدريجياً دون
 * المساس بمنطقها الحالي.
 */
export function useCachedGet<T = unknown>(url: string | null, opts: CachedGetOptions = {}) {
  const ttl = typeof opts.ttl === 'number' ? opts.ttl : DEFAULT_TTL_MS

  const [data, setData] = useState<T | null>(() => {
    if (!url) return null
    const hit = cacheStore.get(url)
    return hit ? (hit.data as T) : null
  })
  const [loading, setLoading] = useState<boolean>(() => {
    if (!url) return false
    return !cacheStore.get(url)
  })
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (!url) return
    const hit = cacheStore.get(url)
    const isFresh = !!hit && Date.now() - hit.ts < ttl
    if (mode === 'initial' && isFresh) {
      setData(hit!.data as T)
      setLoading(false)
      setError(null)
      return
    }
    if (mode === 'refresh') setRefreshing(true)
    try {
      const d = await cachedGet<T>(url, { ttl })
      if (!mountedRef.current) return
      setData(d)
      setError(null)
    } catch {
      // فشل شبكة: نعلن الخطأ فقط إن لم توجد نسخة مخزنة نعرضها
      if (mountedRef.current && !cacheStore.get(url)) setError('network_error')
    } finally {
      if (mountedRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [url, ttl])

  useEffect(() => {
    setLoading(url ? !cacheStore.get(url) : false)
    load('initial')
  }, [load, url])

  const refresh = useCallback(() => load('refresh'), [load])
  const invalidate = useCallback(() => { if (url) invalidateCache(url) }, [url])

  return { data, loading, refreshing, error, refresh, invalidate }
}
