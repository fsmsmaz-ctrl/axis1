// ─── v100: قواعد رؤية المكتبات — وحدة نقية مشتركة (خادم + واجهة) ────────────
// بلا أي استيراد حتى تكون آمنة للمتصفح والخادم معاً.
//
// القاعدة الذهبية من صاحب الموقع:
//   «أي شيء يكون خاص يجب أن يبقى خاصاً ولا يظهر للآخرين مهما كان السبب،
//    ولا يمكن لأي شخص أن ينشأ قسماً ويجعله عاماً أو لمن يمتلك الرابط
//    داخل مكتبة خاصة — هذه ثغرة».
//
// الترجمة التقنية: رؤية أي عنصر داخل المكتبة لا تتجاوز رؤية مكتبتها أبداً
// (ترتيب الاتساع: عام > برابط > خاص — الأضيق يفوز دائماً).

export type LibVisibility = 'public' | 'private' | 'link'

/** ترتيب الاتساع — الرقم الأصغر أضيق وأشد خصوصية */
export var LIB_VIS_ORDER: Record<LibVisibility, number> = { private: 1, link: 2, public: 3 }

/** تطبيع قيمة الرؤية — أي قيمة غريبة أو قديمة تُعامَل كعامة (سلوك ما قبل v100) */
export function libraryVisibility(v?: string | null): LibVisibility {
  return v === 'private' || v === 'link' ? v : 'public'
}

/** رؤية قسم كما هي مخزّنة (قبل قيد المكتبة) */
export function sectionModeOf(s: { isPrivate: boolean; linkToken?: string | null }): LibVisibility {
  if (s.linkToken) return 'link'
  return s.isPrivate ? 'private' : 'public'
}

/**
 * v100: الرؤية الفعلية للقسم = الأضيق بين رؤية القسم ورؤية مكتبته.
 * قسم عام أو «برابط» داخل مكتبة خاصة يصير خاصاً فعلياً — سدّ الثغرة حوسبياً
 * حتى لو تسرّبت بيانات قديمة، فالقراءة نفسها محكومة بالقاعدة.
 */
export function effectiveSectionMode(
  lib: { visibility?: string | null },
  section: { isPrivate: boolean; linkToken?: string | null }
): LibVisibility {
  var libV = libraryVisibility(lib.visibility)
  var secV = sectionModeOf(section)
  return LIB_VIS_ORDER[secV] <= LIB_VIS_ORDER[libV] ? secV : libV
}

/** الأوضاع المسموح بها لقسم جديد/معدَّل داخل مكتبة برؤية معينة (قيد الكتابة) */
export function allowedSectionModes(lib: { visibility?: string | null }): LibVisibility[] {
  var lv = libraryVisibility(lib.visibility)
  if (lv === 'private') return ['private']
  if (lv === 'link') return ['private', 'link']
  return ['private', 'public', 'link']
}
