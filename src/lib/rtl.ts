import { useTranslation } from 'react-i18next'

export type AppDir = 'ltr' | 'rtl'

export function languageToDir(lng: string | undefined): AppDir {
  return lng?.startsWith('ar') ? 'rtl' : 'ltr'
}

export function isArabicLanguage(lng: string | undefined) {
  return languageToDir(lng) === 'rtl'
}

/** Flip directional icons in RTL (chevrons/arrows that imply forward/back). */
export function rtlMirrorClass(dir?: AppDir | string) {
  const isRtl = dir === 'rtl' || (typeof dir === 'string' && dir.startsWith('ar'))
  return isRtl ? 'rtl:-scale-x-100' : undefined
}

export function useAppDir(): AppDir {
  const { i18n } = useTranslation()
  return languageToDir(i18n.language)
}
