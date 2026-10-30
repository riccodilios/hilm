try {
  var root = document.documentElement
  // With JavaScript the app renders the page itself; the prerendered copy is for crawlers and no-JS.
  root.classList.add('js')
  var lng = localStorage.getItem('hilm-lang') || ''
  // Prerendered public pages carry their own language (data-public-locale); app pages follow the saved choice.
  if (!root.hasAttribute('data-public-locale') && lng.indexOf('ar') === 0) {
    root.lang = 'ar'
    root.dir = 'rtl'
    document.title = 'حلم'
  }
  var theme = localStorage.getItem('hilm-theme') || 'dark'
  theme = theme === 'light' ? 'light' : 'dark'
  root.dataset.theme = theme
  root.style.colorScheme = theme
  var metas = document.querySelectorAll('meta[name="theme-color"]')
  for (var i = 0; i < metas.length; i++) {
    metas[i].setAttribute('content', theme === 'light' ? '#f7f7f8' : '#0a0a0b')
  }
  var scheme = document.querySelector('meta[name="color-scheme"]')
  if (scheme) scheme.setAttribute('content', theme)
} catch (e) {}
