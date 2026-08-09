try {
  var lng = localStorage.getItem('hilm-lang') || ''
  if (lng.indexOf('ar') === 0) {
    document.documentElement.lang = 'ar'
    document.documentElement.dir = 'rtl'
    document.title = 'حلم — نظام تشغيل شخصي بالذكاء الاصطناعي'
  }
  var theme = localStorage.getItem('hilm-theme') || 'dark'
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark'
} catch (e) {}
