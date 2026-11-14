// Occasions the content calendar may use. ONLY solar-calendar (Jalali) cultural days and secular/international days:
// no lunar (Hijri) or religious occasions. `kind`: celebration (a greeting; an offer only with a real campaign) | culture (a short respectful post, never an offer)
// | profession (a craft's day: programmer, designer, architect, engineer — a greeting and one useful tip, never an offer) | tech (secular tech/security days, good for useful content). Jalali days are fixed; `rule` ones are computed in build.mjs.
// Dates are the standard Iranian-calendar ones — check them against the official calendar before the year starts (the build prints the Gregorian date of each).
export default [
  { id: 'nowruz', j: [1, 1], kind: 'celebration', title: 'نوروز', note: 'بزرگ‌ترین فرصت سال؛ تبریک + (اگر کمپین واقعی هست) پیشنهاد نوروزی', spec: { theme: 'green', tag: 'nowruz', icon: 'sprout', extra: ['fish', 'egg', 'sparkles'] } },
  { id: 'sizdah', j: [1, 13], kind: 'celebration', title: 'سیزده‌به‌در', note: 'پست سبک و شاد؛ بدون پیشنهاد', spec: { theme: 'green', tag: 'sizdah_bedar', icon: 'sprout', extra: ['sun', 'sparkles'] } },
  { id: 'saadi', j: [2, 1], kind: 'culture', title: 'روز بزرگداشت سعدی', note: 'یک بیت کوتاه + تبریک فرهنگی', spec: { theme: 'violet', tag: 'saadi', icon: 'book-open', extra: ['star'] } },
  { id: 'teacher', j: [2, 12], kind: 'culture', title: 'روز معلم', note: 'قدردانی؛ برای مخاطب دانش‌آموز/دانشجو', spec: { theme: 'amber', tag: 'teachers_day', icon: 'lightbulb', extra: ['book-open', 'star'] } },
  { id: 'doctor', j: [6, 1], kind: 'culture', title: 'روز پزشک (بوعلی)', note: 'قدردانی کوتاه', spec: { theme: 'green', tag: 'doctors_day', icon: 'badge-check', extra: ['heart'] } },
  { id: 'school', j: [7, 1], kind: 'tech', title: 'آغاز سال تحصیلی', note: 'برای مخاطب دانش‌آموز/دانشجو؛ راهنمای اتصال پایدار برای کلاس آنلاین', spec: { theme: 'cyan', tag: 'back_to_school', icon: 'book-open', extra: ['laptop', 'wifi'] } },
  { id: 'mehregan', j: [7, 16], kind: 'celebration', title: 'مهرگان', note: 'جشن پاییز؛ پست شاد + پیشنهاد فقط با کمپین', spec: { theme: 'amber', tag: 'mehregan', icon: 'sun', extra: ['sparkles', 'star'] } },
  { id: 'yalda', j: [9, 30], kind: 'celebration', title: 'شب یلدا', note: 'مهم‌ترین مناسبت پاییز؛ تبریک + کمپین یلدا', spec: { theme: 'amber', tag: 'yalda', icon: 'watermelon', extra: ['pomegranate', 'moon', 'flame'] } },
  { id: 'charshanbe', rule: 'lastTuesdayEsfand', kind: 'celebration', title: 'چهارشنبه‌سوری', note: 'سه‌شنبه‌شب؛ پست شاد + ایمنی', spec: { theme: 'red', tag: 'charshanbe_suri', icon: 'flame', extra: ['sparkles', 'party-popper'] } },
  // professions and craft days (the audience works with computers, design, building): a short respectful greeting + one useful tip, never an offer
  { id: 'programmer', rule: 'programmersDay', kind: 'profession', title: 'روز برنامه‌نویس', note: 'روز ۲۵۶ سال (۱۳ سپتامبر، در سال کبیسه ۱۲)؛ تبریک + نکتهٔ مفید برای کار با VPN و ابزارهای توسعه', spec: { theme: 'green', tag: 'programmers_day', icon: 'terminal', extra: ['laptop', 'zap'] } },
  { id: 'design', g: [4, 27], kind: 'profession', title: 'روز جهانی طراحی گرافیک', note: '۲۷ آوریل؛ تبریک به طراحان؛ نکتهٔ اتصال برای ابزارهای طراحی و منابع جهانی', spec: { theme: 'pink', tag: 'design_day', icon: 'lightbulb', extra: ['sparkles', 'star'] } },
  { id: 'architect', j: [2, 3], kind: 'profession', title: 'روز معمار', note: '۳ اردیبهشت (بزرگداشت شیخ بهایی)؛ در تقویم رسمی با عنوان دیگری آمده، پس «نیمه‌رسمی» بنویسیم؛ تبریک به معماران', spec: { theme: 'violet', tag: 'architects_day', icon: 'list-checks', extra: ['wrench', 'star'] } },
  { id: 'engineer', j: [12, 5], kind: 'profession', title: 'روز مهندس', note: '۵ اسفند (بزرگداشت خواجه‌نصیرالدین طوسی)؛ تبریک به مهندسان', spec: { theme: 'amber', tag: 'engineers_day', icon: 'wrench', extra: ['gauge', 'star'] } },
  { id: 'cyrus', j: [8, 7], kind: 'culture', title: 'روز کوروش بزرگ', note: '۷ آبان (۲۹ اکتبر): روز بزرگداشت، نه زادروز؛ تاریخ تولد کوروش ثبت نشده. تعطیل رسمی نیست؛ پست فرهنگی کوتاه و بدون سیاست، بدون پیشنهاد', spec: { theme: 'amber', tag: 'cyrus_day', icon: 'crown', extra: ['star', 'sun'] } },
  // secular / international (Gregorian dates, converted)
  { id: 'ny', g: [1, 1], kind: 'celebration', title: 'سال نو میلادی', note: 'برای مخاطب جوان؛ پست کوتاه', spec: { theme: 'cyan', tag: 'new_year', icon: 'party-popper', extra: ['sparkles', 'star'] } },
  { id: 'privacy', g: [1, 28], kind: 'tech', title: 'روز جهانی حریم خصوصی داده', note: 'آموزش و آگاهی؛ بدون ادعای فنی خارج از واقعیت', spec: { theme: 'red', tag: 'data_privacy_day', icon: 'lock', extra: ['fingerprint'] } },
  { id: 'saferinternet', rule: 'secondTuesdayFeb', kind: 'tech', title: 'روز جهانی اینترنت امن', note: 'نکات امنیتی ساده', spec: { theme: 'red', tag: 'safer_internet', icon: 'shield-check', extra: ['lock', 'wifi'] } },
  { id: 'valentine', g: [2, 14], kind: 'celebration', title: 'ولنتاین (اختیاری)', note: 'فقط اگر مخاطب را می‌پسندد؛ جایگزین: سپندارمذگان', spec: { theme: 'pink', tag: 'valentine', icon: 'heart', extra: ['gift'] } },
  { id: 'password', rule: 'firstThursdayMay', kind: 'tech', title: 'روز جهانی رمز عبور', note: 'نکات رمز امن؛ ضد کلاهبرداری', spec: { theme: 'red', tag: 'password_day', icon: 'key-round', extra: ['lock', 'fingerprint'] } },
  { id: 'security', g: [11, 30], kind: 'tech', title: 'روز جهانی امنیت رایانه', note: 'پنج عادت امن؛ تقویت اعتماد', spec: { theme: 'red', tag: 'computer_security', icon: 'lock', extra: ['shield-check', 'fingerprint'] } },
  { id: 'blackfriday', rule: 'fourthFridayNov', kind: 'celebration', title: 'جمعه‌ی سیاه', note: 'فقط با کمپین واقعی؛ وگرنه پست «تخفیف ساختگی نداریم»', spec: { theme: 'amber', tag: 'black_friday', icon: 'zap', extra: ['sparkles', 'gift'] } },
]
