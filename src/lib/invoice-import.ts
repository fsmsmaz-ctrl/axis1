// ============================================================
// v110 — رفع ملف الفواتير: المحلل التلقائي لملفات الإكسل/CSV
// ============================================================
// المبدأ الأمني: هذه الوحدة قراءة فقط — تحلل الملف وتعيد النتائج،
// ولا تلمس قاعدة البيانات إطلاقاً. الكتابة تحدث فقط في مسار
// /api/costs-import بعد موافقة الموظف الصريحة (زر التأكيد).
//
// كيف يعمل التحليل التلقائي؟
//   1) يقرأ أول ورقة تحتوي بيانات في الملف (xlsx / xls / csv).
//   2) يكتشف صف العناوين تلقائياً (أكثر صف خلال أول 15 صفاً خلايا نصية).
//   3) يطابق أسماء الأعمدة مع قوائم مرادفات عربية/إنجليزية
//      (المبلغ، التاريخ، البيان، النوع، الملاحظات).
//   4) إن فشل تطابق العناوين يلجأ لاكتشاف العمود من محتواه
//      (نسبة الأرقام = مبلغ، نسبة التواريخ المقروءة = تاريخ...).
//   5) يقرأ كل صف ويطبع الأرقام العربية (٠١٢٣) والفواصل العربية (٫ ٬)
//      ويقرأ التواريخ بعدة صيغ (يوم/شهر/سنة، سنة/شهر/يوم، رقم إكسل التسلسلي).
//   6) يهمل صفوف «الإجمالي/المجموع» تلقائياً حتى لا تُسجل كفاتورة وهمية.
//   7) يفرز الصفوف: صالحة للإنشاء / مرفوضة مع سبب واضح لكل صف.
// ============================================================

import * as XLSX from 'xlsx'

// الحد الأقصى لعدد الفواتير في الملف الواحد (أكبر = خطر مهلة الخادم)
export var MAX_IMPORT_ROWS = 500

// الحد الأقصى لحجم الملف 4 ميجابايت (حد منصة النشر نفسه ~4.5MB)
export var MAX_IMPORT_FILE_BYTES = 4 * 1024 * 1024

export interface ImportRow {
  rowNumber: number   // رقم الصف داخل الملف (للتتبع ورسائل الأخطاء)
  dateISO: string     // YYYY-MM-DD
  amount: number
  description: string
  category: string    // من قائمة تصنيفات التكاليف المعتمدة فقط
  notes: string
}

export interface FieldMapping {
  found: boolean
  header: string      // اسم العمود كما ورد (أو «اكتُشف من المحتوى»)
  columnIndex: number
  method: 'header' | 'content'
}

export interface ImportError {
  rowNumber: number
  reason: string
}

export interface ImportAnalysis {
  ok: boolean
  message: string
  fileName: string
  sheetName: string
  mapping: {
    amount: FieldMapping | null
    date: FieldMapping | null
    description: FieldMapping | null
    category: FieldMapping | null
    notes: FieldMapping | null
  }
  rows: ImportRow[]
  errors: ImportError[]
  stats: {
    dataRows: number
    validRows: number
    skippedRows: number
    totalAmount: number
    minDate: string
    maxDate: string
    byCategory: Array<{ category: string; count: number; amount: number }>
  }
}

// ---------- أدوات تطبيع النص العربي ----------

var AR_DIGITS = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669' // ٠١٢٣٤٥٦٧٨٩
var FA_DIGITS = '\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9' // ۰۱۲۳۴۵۶۷۸۹

// تحويل الأرقام العربية/الفارسية إلى أرقام لاتينية
function toWesternDigits(s: string): string {
  var out = ''
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i)
    var ai = AR_DIGITS.indexOf(ch)
    if (ai >= 0) { out += String(ai); continue }
    var fi = FA_DIGITS.indexOf(ch)
    if (fi >= 0) { out += String(fi); continue }
    out += ch
  }
  return out
}

// توحيد النص العربي للمقارنة: إزالة التشكيل والتطويل، توحيد الألف والياء
// والتاء المربوطة، وحذف المسافات والرموز — «الإجمالي» و«الاجمالي» يصيران كلمة واحدة
function normalizeText(s: any): string {
  var t = String(s || '')
  t = t.replace(/[\u064B-\u0652\u0640\u0670]/g, '')          // تشكيل + تطويل
  t = t.replace(/[\u0623\u0625\u0622]/g, '\u0627')            // أ إ آ → ا
  t = t.replace(/\u0649/g, '\u064A')                          // ى → ي
  t = t.replace(/\u0629/g, '\u0647')                          // ة → ه
  t = t.replace(/[^\u0621-\u064Aa-zA-Z0-9]/g, '')             // غير الحروف/الأرقام
  return t.toLowerCase()
}

// قص النص الظاهر من خلية (للبيان والملاحظات)
function cellText(v: any): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

// ---------- قراءة المبلغ ----------

// كلمات العملات والوحدات تُحذف قبل قراءة الرقم
var CURRENCY_RE = /(ر\.?\s?ع)|(ريال[تs]?(\s?عماني)? عماني?)|(ريال[تs]?)|(عماني)|(OMR)|(R\.?\s?O\.?)|(Rial)|(﷼)|(بيس[ةه])|(بيزا)|(Baiza)|(Baisa)|(درهم)|(دينار)|(دولار)/gi

function parseAmountCell(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v instanceof Date) return null
  var s = toWesternDigits(String(v)).trim()
  if (!s) return null
  var neg = /^\(.*\)$/.test(s)   // الأقواس المحاسبية = قيمة سالبة → ستُرفض لاحقاً (المبلغ يجب أن يكون موجباً)
  s = s.replace(CURRENCY_RE, '')
  // مسافات، علامات اتجاه، فواصل آلاف (عربية ٬ ولاتينية ، و, وفاصلة الألف العربية U+066C)
  s = s.replace(/[\u00A0\u200E\u200F\u202A-\u202E\s\u060C\u066C\u066D]/g, '')
  s = s.replace(/\u066C/g, '').replace(/,/g, '')
  s = s.replace(/\u066B/g, '.')  // الفاصلة العشرية العربية ٫
  var m = /-?\d+(?:\.\d+)?/.exec(s)
  if (!m) return null
  var num = parseFloat(m[0])
  if (!Number.isFinite(num)) return null
  if (neg) num = -num
  return num
}

// ---------- قراءة التاريخ ----------

function buildYmd(y: number, mo: number, d: number): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  if (y < 1990 || y > 2075) return null
  var dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() + 1 !== mo || dt.getUTCDate() !== d) return null // تاريخ غير موجود فعلاً (مثل 30/2)
  var mm = (mo < 10 ? '0' : '') + mo
  var dd = (d < 10 ? '0' : '') + d
  return y + '-' + mm + '-' + dd
}

// تعيد YYYY-MM-DD أو null — تدعم: كائن تاريخ، رقم إكسل التسلسلي،
// صيغ يوم/شهر/سنة وسنة/شهر/يوم وyyyyMMdd (بفواصل / - . أو بدون)
function parseDateCell(v: any): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null
    return buildYmd(v.getFullYear(), v.getMonth() + 1, v.getDate())
  }
  if (typeof v === 'number') {
    // رقم تسلسلي إكسل (نظام 1900) — النطاق 20000..80000 ≈ سنة 1954..2119
    if (v < 20000 || v > 80000) return null
    var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
    return buildYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  var s = toWesternDigits(String(v)).trim()
  if (!s) return null
  var m: RegExpExecArray | null = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(s)
  if (m) return buildYmd(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/.exec(s)
  if (m) {
    var p1 = +m[1], p2 = +m[2], y = +m[3]
    if (y < 100) y += 2000
    // يوم/شهر هو العرف العربي؛ إن كان الرقم الثاني > 12 فالصيغة شهر/يوم (أمريكية)
    var day = p1, month = p2
    if (p2 > 12 && p1 <= 12) { day = p2; month = p1 }
    return buildYmd(y, month, day)
  }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (m) return buildYmd(+m[1], +m[2], +m[3])
  return null
}

// ---------- تصنيف نوع التكلفة من النص ----------

// نفس التصنيفات المعتمدة في /api/costs — أي نص آخر يصبح other
// الترتيب مقصود: الأخص أولاً (قطع غيار قبل قطع مثلًا)
var CATEGORY_KEYWORDS: Array<{ key: string; words: string[] }> = [
  { key: 'parts',       words: ['قطعغيار', 'قطعالغيار', 'spareparts', 'spares', 'spare'] },
  { key: 'fuel',        words: ['ديزل', 'وقود', 'محروقات', 'fuel', 'diesel', 'petrol', 'gasoline'] },
  { key: 'oil',         words: ['زيوت', 'زيت', 'شحوم', 'oil', 'lubricant', 'lubricants'] },
  { key: 'maintenance', words: ['صيانه', 'اصلاح', 'اصلاحات', 'maintenance', 'repair', 'repairs', 'servicing'] },
  { key: 'rental',      words: ['ايجار', 'تاجير', 'كراء', 'استئجار', 'rental', 'rent', 'lease', 'leasing', 'hire'] },
  { key: 'safety',      words: ['سلامه', 'امن', 'حمايه', 'safety', 'ppe'] },
  { key: 'housing',     words: ['سكن', 'اقامه', 'housing', 'accommodation', 'camp'] },
  { key: 'transport',   words: ['نقل', 'شحن', 'مواصلات', 'انتقالات', 'transport', 'shipping', 'freight', 'haulage', 'delivery'] },
  { key: 'labor',       words: ['اجور', 'اجره', 'أجره', 'عماله', 'عمال', 'يدعامله', 'labor', 'labour', 'wages', 'manpower', 'salary', 'salaries', 'payroll'] },
]

function detectCategory(text: any): string {
  var t = normalizeText(text)
  if (!t) return 'other'
  for (var i = 0; i < CATEGORY_KEYWORDS.length; i++) {
    var words = CATEGORY_KEYWORDS[i].words
    for (var j = 0; j < words.length; j++) {
      if (t.indexOf(words[j]) !== -1) return CATEGORY_KEYWORDS[i].key
    }
  }
  return 'other'
}

// ---------- مرادفات صف العناوين ----------

// القوائم مطبّعة بنفس قواعد normalizeText (بلا مسافات، أ متوحدة، ة→ه)
var HEADER_SYNONYMS: Record<string, string[]> = {
  date: ['تاريخ', 'التاريخ', 'تاريخالفاتوره', 'تاريخالسداد', 'تاريخالتسجيل', 'تاريخالعمل', 'تاريخالمستند', 'date', 'invoicedate', 'issuedate', 'documentdate', 'entrydate', 'وقت'],
  amount: ['مبلغ', 'المبلغ', 'قيمه', 'القيمه', 'اجمالي', 'الاجمالي', 'مجموع', 'المجموع', 'سعر', 'السعر', 'صافي', 'الصافي', 'مبلغالفاتوره', 'قيمهالفاتوره', 'مبلغالفاتورة', 'total', 'amount', 'value', 'price', 'cost', 'sum', 'net', 'netamount', 'totalamount', 'grandtotal', 'subtotalamount'],
  description: ['بيان', 'البيان', 'وصف', 'الوصف', 'تفاصيل', 'التفاصيل', 'اسم', 'الاسم', 'عنوان', 'موضوع', 'اسمالفاتوره', 'الفاتوره', 'فاتوره', 'بيانالفاتوره', 'اسمالبند', 'البند', 'بند', 'description', 'details', 'name', 'title', 'item', 'itemname', 'invoice', 'invoicename', 'particulars', 'subject'],
  category: ['نوع', 'النوع', 'نوعالتكلفه', 'نوعالفاتوره', 'نوعالمصروف', 'نوعالبيان', 'تصنيف', 'التصنيف', 'فئه', 'الفئه', 'category', 'type', 'costtype', 'expensetype', 'classification', 'قسم', 'القسم'],
  notes: ['ملاحظات', 'ملاحظه', 'ملاحظاتاضافيه', 'note', 'notes', 'remark', 'remarks', 'comment', 'comments', 'تعليق', 'التعليق', 'شرح', 'الشرح'],
}

// ترتيب الإسناد مقصود: «تاريخ الفاتورة» يجب أن يلتقطه التاريخ قبل البيان،
// و«نوع الفاتورة» يلتقطه النوع قبل البيان — ثم البيان فالملاحظات
var FIELD_ORDER = ['date', 'amount', 'category', 'description', 'notes']

function scoreHeader(headerNorm: string, synNorm: string): number {
  if (!headerNorm || !synNorm) return 0
  if (headerNorm === synNorm) return 100
  if (headerNorm.indexOf(synNorm) === 0) return 60
  if (headerNorm.indexOf(synNorm) !== -1) return 30
  return 0
}

// صفوف «الإجمالي/المجموع» تُهمل تلقائياً حتى لا تُسجل كفاتورة وهمية مزدوجة
var TOTAL_ROW_LABELS = ['اجمالي', 'الاجمالي', 'مجموع', 'المجموع', 'المجموعالفرعي', 'الصافي', 'صافي', 'grandtotal', 'nettotal', 'subtotal', 'total', 'sum', 'المجموعالكلي', 'اجماليالفواتير', 'اجماليالمبلغ']

function isTotalRowLabel(desc: string): boolean {
  var t = normalizeText(desc)
  if (!t) return false
  for (var i = 0; i < TOTAL_ROW_LABELS.length; i++) {
    if (t === TOTAL_ROW_LABELS[i]) return true
  }
  return false
}

// ---------- المحلل الرئيسي ----------

export function parseInvoiceWorkbook(buffer: Buffer, fileName: string): ImportAnalysis {
  var base: ImportAnalysis = {
    ok: false,
    message: '',
    fileName: fileName,
    sheetName: '',
    mapping: { amount: null, date: null, description: null, category: null, notes: null },
    rows: [],
    errors: [],
    stats: { dataRows: 0, validRows: 0, skippedRows: 0, totalAmount: 0, minDate: '', maxDate: '', byCategory: [] },
  }

  // 1) قراءة الملف
  var wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  } catch (e: any) {
    base.message = 'تعذر قراءة الملف — تأكد أنه ملف إكسل سليم (xlsx أو xls أو csv)'
    return base
  }
  if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
    base.message = 'الملف فارغ أو لا يحتوي أوراق عمل'
    return base
  }

  // 2) اختيار أول ورقة تحتوي صفوف بيانات كافية (عناوين + صف واحد على الأقل)
  var sheetName = ''
  var matrix: any[][] = []
  for (var si = 0; si < wb.SheetNames.length; si++) {
    var ws = wb.Sheets[wb.SheetNames[si]]
    if (!ws) continue
    var m: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as any[][]
    if (m && m.length >= 2) { sheetName = wb.SheetNames[si]; matrix = m; break }
    if (m && m.length === 1 && !sheetName) { sheetName = wb.SheetNames[si]; matrix = m }
  }
  if (!matrix.length) {
    base.message = 'لا توجد ورقة عمل تحتوي بيانات في الملف'
    return base
  }
  base.sheetName = sheetName

  // 3) اكتشاف صف العناوين: خلال أول 15 صفاً نختار صفّاً خلاياه النصية
  // أكثر من خلاياه الشبيهة بالبيانات (تواريخ/أرقام مقروءة) وبها خليتان نصيتان على الأقل —
  // حتى لا يُلتقط أول صف بيانات كصف عناوين في الملفات الخالية من رؤوس الأعمدة
  var headerIdx = -1
  var bestScore = 0
  var scanLimit = Math.min(15, matrix.length)
  for (var r = 0; r < scanLimit; r++) {
    var rowArr = matrix[r] || []
    var textCells = 0
    var dataLikeCells = 0
    for (var c = 0; c < rowArr.length; c++) {
      var cv = rowArr[c]
      if (cv === null || cv === undefined || String(cv).trim() === '') continue
      if (parseDateCell(cv) !== null || parseAmountCell(cv) !== null) {
        dataLikeCells++
      } else if (typeof cv === 'string') {
        textCells++
      } else {
        dataLikeCells++
      }
    }
    var isCandidate = textCells >= 2 && textCells > dataLikeCells
    if (isCandidate && textCells > bestScore) { bestScore = textCells; headerIdx = r }
  }
  var hasHeader = headerIdx >= 0 && bestScore >= 2

  // عرض الجدول الفعلي (عدد الأعمدة المستخدمة في صفوف البيانات، بحد 40)
  var colCount = 0
  for (var rr = 0; rr < matrix.length; rr++) {
    var len = (matrix[rr] || []).length
    if (len > colCount) colCount = Math.min(len, 40)
  }
  if (colCount === 0) {
    base.message = 'الورقة الأولى فارغة — لا توجد أي بيانات'
    return base
  }

  // عناوين الأعمدة كما وردت في الملف
  var headers: string[] = []
  for (var hc = 0; hc < colCount; hc++) {
    headers.push(hasHeader ? cellText((matrix[headerIdx] || [])[hc]) : '')
  }

  // 4) إسناد الأعمدة بالعناوين (ترتيب الأولوية FIELD_ORDER، كل عمود حقل واحد فقط)
  var claimed: Record<number, string> = {}
  var mapping: Record<string, FieldMapping | null> = { amount: null, date: null, description: null, category: null, notes: null }

  if (hasHeader) {
    for (var f = 0; f < FIELD_ORDER.length; f++) {
      var field = FIELD_ORDER[f]
      var syns = HEADER_SYNONYMS[field]
      var bestCol = -1
      var bestVal = 0
      for (var cc = 0; cc < colCount; cc++) {
        if (claimed[cc]) continue
        var hNorm = normalizeText(headers[cc])
        if (!hNorm) continue
        var sc = 0
        for (var k = 0; k < syns.length; k++) {
          var v = scoreHeader(hNorm, syns[k])
          if (v > sc) sc = v
        }
        if (sc > bestVal || (sc === bestVal && sc > 0 && bestCol < 0)) { bestVal = sc; bestCol = cc }
      }
      if (bestCol >= 0 && bestVal >= 30) {
        claimed[bestCol] = field
        mapping[field] = { found: true, header: headers[bestCol], columnIndex: bestCol, method: 'header' }
      }
    }
  }

  // صفوف البيانات (مع حفظ رقم الصف الأصلي في الملف لرسائل الأخطاء)
  var dataStart = hasHeader ? headerIdx + 1 : 0
  var dataRows: Array<{ excelRow: number; cells: any[] }> = []
  for (var dr = dataStart; dr < matrix.length; dr++) {
    var cells = matrix[dr] || []
    var anyValue = false
    for (var ac = 0; ac < cells.length; ac++) {
      if (cells[ac] !== null && cells[ac] !== undefined && String(cells[ac]).trim() !== '') { anyValue = true; break }
    }
    if (!anyValue) continue
    dataRows.push({ excelRow: dr + 1, cells: cells })
  }

  // 5) الاكتشاف الاحتياطي من المحتوى لما لم يُطابق بالعناوين
  function ratioOf(rows: Array<{ excelRow: number; cells: any[] }>, col: number, test: (v: any) => boolean): number {
    var hit = 0, seen = 0
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i].cells[col]
      if (v === null || v === undefined || v === '') continue
      seen++
      if (test(v)) hit++
    }
    return seen === 0 ? 0 : hit / seen
  }

  if (!mapping.date) {
    var bestDateCol = -1, bestDateRatio = 0
    for (var dc = 0; dc < colCount; dc++) {
      if (claimed[dc]) continue
      var ratio = ratioOf(dataRows, dc, function(v: any) { return parseDateCell(v) !== null })
      if (ratio >= 0.5 && ratio > bestDateRatio) { bestDateRatio = ratio; bestDateCol = dc }
    }
    if (bestDateCol >= 0) {
      mapping.date = { found: true, header: 'اكتُشف من المحتوى (نسب تواريخ مرتفعة)', columnIndex: bestDateCol, method: 'content' }
      claimed[bestDateCol] = 'date'
    }
  }

  if (!mapping.amount) {
    var bestAmtCol = -1, bestAmtRatio = 0
    for (var ac2 = 0; ac2 < colCount; ac2++) {
      if (claimed[ac2]) continue
      var ratio2 = ratioOf(dataRows, ac2, function(v: any) { return parseAmountCell(v) !== null })
      if (ratio2 >= 0.5 && ratio2 > bestAmtRatio) { bestAmtRatio = ratio2; bestAmtCol = ac2 }
    }
    if (bestAmtCol >= 0) {
      mapping.amount = { found: true, header: 'اكتُشف من المحتوى (نسب أرقام مرتفعة)', columnIndex: bestAmtCol, method: 'content' }
      claimed[bestAmtCol] = 'amount'
    }
  }

  if (!mapping.description) {
    // نصي بقلّة تكرار (تفاصيل متمايزة) — ليس عمود النوع المتكرر
    var bestDescCol = -1, bestDescDistinct = 0
    for (var tc = 0; tc < colCount; tc++) {
      if (claimed[tc]) continue
      var vals: Record<string, boolean> = {}
      var nonEmpty = 0
      for (var i2 = 0; i2 < dataRows.length; i2++) {
        var tv = cellText(dataRows[i2].cells[tc])
        if (!tv) continue
        nonEmpty++
        if (tv.length <= 500) vals[tv] = true
      }
      var distinct = Object.keys(vals).length
      if (nonEmpty > 0 && distinct >= dataRows.length / 4 && distinct > bestDescDistinct) {
        bestDescDistinct = distinct
        bestDescCol = tc
      }
    }
    if (bestDescCol >= 0) {
      mapping.description = { found: true, header: 'اكتُشف من المحتوى (نصوص متمايزة)', columnIndex: bestDescCol, method: 'content' }
      claimed[bestDescCol] = 'description'
    }
  }
  // النوع: تطابق العناوين فقط — الاكتشاف بالمحتوى خطر (عمود وصف متكرر قد يُخطأ فيه) فلا يُجرى

  // 6) فحص الحد الأدنى: عمود مبلغ وعمود تاريخ إلزاميان
  var amountCol = mapping.amount ? mapping.amount.columnIndex : -1
  var dateCol = mapping.date ? mapping.date.columnIndex : -1
  var descCol = mapping.description ? mapping.description.columnIndex : -1
  var catCol = mapping.category ? mapping.category.columnIndex : -1
  var notesCol = mapping.notes ? mapping.notes.columnIndex : -1

  if (amountCol < 0 || dateCol < 0) {
    var missing: string[] = []
    if (amountCol < 0) missing.push('«المبلغ»')
    if (dateCol < 0) missing.push('«التاريخ»')
    base.message = 'لم يتمكن النظام من تحديد عمود ' + missing.join(' وعمود ') + ' تلقائياً. تأكد أن صف العناوين الأول يحتوي عمود مبلغ وعمود تاريخ (مثل: المبلغ، التاريخ، البيان، النوع) وأن بياناتها مكتوبة كأرقام وتواريخ فعلية.'
    // إبقاء خريطة الاكتشاف للعرض في الواجهة (ملاحظات تشخيصية)
    base.mapping = { amount: mapping.amount, date: mapping.date, description: mapping.description, category: mapping.category, notes: mapping.notes }
    base.stats.dataRows = dataRows.length
    return base
  }

  // 7) قراءة الصفوف وفرزها
  var rows: ImportRow[] = []
  var errors: ImportError[] = []
  var totalAmount = 0
  var minDate = ''
  var maxDate = ''
  var catAgg: Record<string, { count: number; amount: number }> = {}

  for (var ri = 0; ri < dataRows.length; ri++) {
    var drow = dataRows[ri]
    var cells = drow.cells
    var excelRow = drow.excelRow

    var amount = amountCol >= 0 ? parseAmountCell(cells[amountCol]) : null
    var dateISO = dateCol >= 0 ? parseDateCell(cells[dateCol]) : null
    var desc = descCol >= 0 ? cellText(cells[descCol]) : ''
    var catText = catCol >= 0 ? cells[catCol] : null
    var note = notesCol >= 0 ? cellText(cells[notesCol]) : ''

    // صف فارغ تماماً من المبالغ والتواريخ والنصوص — تجاوز صامت
    if ((amount === null || !Number.isFinite(amount)) && !dateISO && !desc && !note) continue

    // صف «الإجمالي/المجموع» — يُهمل عمداً ليلاً يُنشئ فاتورة وهمية
    if (isTotalRowLabel(desc)) {
      errors.push({ rowNumber: excelRow, reason: 'صف «إجمالي/مجموع» — أُهمل تلقائياً وليس فاتورة' })
      continue
    }

    if (amount === null || !Number.isFinite(amount)) {
      errors.push({ rowNumber: excelRow, reason: 'مبلغ غير مقروء أو ناقص' })
      continue
    }
    if (!dateISO) {
      errors.push({ rowNumber: excelRow, reason: 'تاريخ غير مقروء أو ناقص (الصيغ المدعومة: يوم/شهر/سنة أو سنة/شهر/يوم)' })
      continue
    }
    if (amount <= 0) {
      errors.push({ rowNumber: excelRow, reason: 'المبلغ يجب أن يكون أكبر من صفر (المقروء: ' + amount + ')' })
      continue
    }
    if (amount > 10000000) {
      errors.push({ rowNumber: excelRow, reason: 'المبلغ يتجاوز الحد الأقصى المسموح 10,000,000' })
      continue
    }

    var category = catText !== null && catText !== undefined && String(catText).trim() !== '' ? detectCategory(catText) : 'other'
    var finalDesc = desc || ('فاتورة مستوردة من ' + fileName + ' — صف ' + excelRow)
    if (finalDesc.length > 1000) finalDesc = finalDesc.slice(0, 1000)
    var finalNotes = note ? ('مستوردة من ملف: ' + fileName + ' — صف ' + excelRow + ' | ملاحظة الملف: ' + note) : ('مستوردة من ملف: ' + fileName + ' — صف ' + excelRow)
    if (finalNotes.length > 2000) finalNotes = finalNotes.slice(0, 2000)

    rows.push({
      rowNumber: excelRow,
      dateISO: dateISO,
      amount: Math.round(amount * 1000) / 1000,
      description: finalDesc,
      category: category,
      notes: finalNotes,
    })

    totalAmount += amount
    if (!minDate || dateISO < minDate) minDate = dateISO
    if (!maxDate || dateISO > maxDate) maxDate = dateISO
    if (!catAgg[category]) catAgg[category] = { count: 0, amount: 0 }
    catAgg[category].count++
    catAgg[category].amount += amount
  }

  var byCategory: Array<{ category: string; count: number; amount: number }> = []
  var catKeys = Object.keys(catAgg)
  for (var ck = 0; ck < catKeys.length; ck++) {
    byCategory.push({ category: catKeys[ck], count: catAgg[catKeys[ck]].count, amount: Math.round(catAgg[catKeys[ck]].amount * 1000) / 1000 })
  }
  byCategory.sort(function(a, b) { return b.amount - a.amount })

  base.ok = true
  base.rows = rows
  base.errors = errors
  base.mapping = { amount: mapping.amount, date: mapping.date, description: mapping.description, category: mapping.category, notes: mapping.notes }
  base.stats = {
    dataRows: dataRows.length,
    validRows: rows.length,
    skippedRows: errors.length,
    totalAmount: Math.round(totalAmount * 1000) / 1000,
    minDate: minDate,
    maxDate: maxDate,
    byCategory: byCategory,
  }
  if (rows.length === 0) {
    base.ok = false
    base.message = 'لم يُعثر على أي فاتورة صالحة في الملف — راجع قائمة الملاحظات أدناه (مبلغ أو تاريخ غير مقروء في كل الصفوف؟)'
  }
  return base
}
