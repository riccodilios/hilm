try {
  var lng = localStorage.getItem('hilm-lang') || ''
  if (lng.indexOf('ar') === 0) {
    document.documentElement.lang = 'ar'
    document.documentElement.dir = 'rtl'
    document.title = 'حلم — نظام تشغيل شخصي بالذكاء الاصطناعي'
  }
  var theme = localStorage.getItem('hilm-theme') || 'dark'
  theme = theme === 'light' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  var metas = document.querySelectorAll('meta[name="theme-color"]')
  for (var i = 0; i < metas.length; i++) {
    metas[i].setAttribute('content', theme === 'light' ? '#f7f7f8' : '#0a0a0b')
  }
  var scheme = document.querySelector('meta[name="color-scheme"]')
  if (scheme) scheme.setAttribute('content', theme)
} catch (e) {}
