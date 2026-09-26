// v46: اسم يوم التقرير (الأحد..السبت) بجانب تاريخ كل تقرير — التقارير اليومية وتقارير السلامة
// يفكّ أجزاء التاريخ (YYYY-MM-DD) يدوياً بدل new Date() المباشر لتجنّب انزياح المنطقة الزمنية،
// ليعمل بشكل صحيح مع التقارير القديمة والمستقبلية على حدٍّ سواء
export function reportDayName(dateStr: any, isRtl: boolean): string {
  if (!dateStr) return ''
  var parts = String(dateStr).split('T')[0].split('-')
  if (parts.length < 3) return ''
  var y = parseInt(parts[0], 10)
  var m = parseInt(parts[1], 10)
  var d = parseInt(parts[2], 10)
  if (!y || !m || !d) return ''
  var day = new Date(y, m - 1, d).getDay()
  var names = isRtl
    ? ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return names[day] || ''
}
