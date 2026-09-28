import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { SESSION_COOKIE, getCookieOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  // v56: مهلة 4 ثوانٍ لفحص الجلسة — لو علقت قاعدة البيانات (مشروع Supabase متوقف)
  // نرجع {user: null} فوراً ليظهر نموذج الدخول بدل صفحة فارغة معلقة،
  // ونحافظ على الكوكي في حالة المهلة (الجلسة قد تكون سليمة وقاعدة البيانات فقط بطيئة)
  var timedOut = false
  var user: Awaited<ReturnType<typeof getAuthUser>>
  try {
    user = await Promise.race([
      getAuthUser(req),
      new Promise<null>(function (resolve) {
        setTimeout(function () { timedOut = true; resolve(null) }, 4000)
      }),
    ])
  } catch {
    user = null
  }

  if (!user) {
    // Clear any invalid/expired cookie so the client knows to re-authenticate
    const response = NextResponse.json({ user: null }, { status: 200 })
    // Check if there was a token (cookie or header)
    // v56: عند المهلة لا نمسح الكوكي — الانقطاع ليس انتهاء جلسة
    const hadCookie = req.cookies.get(SESSION_COOKIE)?.value
    const hadHeader = req.headers.get('authorization')
    if (!timedOut && (hadCookie || hadHeader)) {
      // Cookie attributes MUST match how it was set, otherwise the browser won't clear it
      response.cookies.set(SESSION_COOKIE, '', {
        ...getCookieOptions(),
        maxAge: 0,
      })
    }
    return response
  }

  return NextResponse.json({ user })
}
