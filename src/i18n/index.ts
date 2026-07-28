import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from '@/i18n/locales/en.json'
import ar from '@/i18n/locales/ar.json'

export const supportedLngs = ['en', 'ar'] as const
export type AppLanguage = (typeof supportedLngs)[number]

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    fallbackLng: 'en',
    supportedLngs: [...supportedLngs],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'hilm-lang',
    },
  })

export function applyDocumentLanguage(lng: string) {
  const language = (lng.startsWith('ar') ? 'ar' : 'en') as AppLanguage
  const dir = language === 'ar' ? 'rtl' : 'ltr'
  document.documentElement.lang = language
  document.documentElement.dir = dir
  document.documentElement.dataset.locale = language
  document.title = language === 'ar' ? 'حلم' : 'Hilm'
  return { language, dir }
}

applyDocumentLanguage(i18n.resolvedLanguage ?? i18n.language)

i18n.on('languageChanged', (lng) => {
  applyDocumentLanguage(lng)
})

export default i18n
