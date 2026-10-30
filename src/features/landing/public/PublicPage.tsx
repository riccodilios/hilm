import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react'
import { createInstance, type i18n as I18nInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import appI18n, { applyDocumentLanguage } from '@/i18n'
import en from '@/i18n/locales/en.json'
import ar from '@/i18n/locales/ar.json'
import type { PublicLocale, PublicPageId } from '@/content/site.ts'

const instances = new Map<PublicLocale, I18nInstance>()

/**
 * Public pages render in the language of their URL (/ar/... is Arabic), independent of the
 * visitor's saved app language, so crawlers and visitors always see the URL's language.
 */
function fixedLanguageI18n(locale: PublicLocale) {
  let instance = instances.get(locale)
  if (!instance) {
    instance = createInstance()
    void instance.init({
      resources: { en: { translation: en }, ar: { translation: ar } },
      lng: locale,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      initAsync: false,
      react: { useSuspense: false },
    })
    instances.set(locale, instance)
  }
  return instance
}

type PublicPageContextValue = { id: PublicPageId; locale: PublicLocale }

const PublicPageContext = createContext<PublicPageContextValue | null>(null)

export function usePublicPage(): PublicPageContextValue {
  const value = useContext(PublicPageContext)
  if (!value) throw new Error('usePublicPage must be used inside <PublicPage>')
  return value
}

export function PublicPage({ id, locale, children }: PublicPageContextValue & { children: ReactNode }) {
  const instance = useMemo(() => fixedLanguageI18n(locale), [locale])

  useLayoutEffect(() => {
    const root = document.documentElement
    root.lang = locale
    root.dir = locale === 'ar' ? 'rtl' : 'ltr'
    root.dataset.publicLocale = locale
    return () => {
      delete root.dataset.publicLocale
      applyDocumentLanguage(appI18n.resolvedLanguage ?? appI18n.language)
    }
  }, [locale])

  const value = useMemo(() => ({ id, locale }), [id, locale])
  return (
    <PublicPageContext.Provider value={value}>
      <I18nextProvider i18n={instance}>{children}</I18nextProvider>
    </PublicPageContext.Provider>
  )
}
