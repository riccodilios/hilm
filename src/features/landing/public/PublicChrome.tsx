import { Link } from 'react-router-dom'
import appI18n from '@/i18n'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PRODUCT_PAGE_IDS, PUBLIC_LOCALES, PUBLIC_UI, SITE, publicPath } from '@/content/site.ts'
import { usePublicPage } from './PublicPage'

const BRAND = { en: 'Hilm', ar: 'حلم' } as const

const LANGUAGE_LABEL = { en: 'Language', ar: 'اللغة' } as const
const LANGUAGE_SHORT = { en: 'EN', ar: 'ع' } as const

/**
 * Same EN / ع toggle as the app's LanguageSwitcher, but each option links to this page's URL in
 * that language and remembers the choice for the app.
 */
export function PublicLanguageSwitch({ className }: { className?: string }) {
  const { id, locale } = usePublicPage()
  return (
    <div
      className={cn('inline-flex items-center rounded-xl border border-border bg-surface-2/60 p-1', className)}
      role="group"
      aria-label={LANGUAGE_LABEL[locale]}
    >
      {PUBLIC_LOCALES.map((lng) => (
        <Link
          key={lng}
          to={publicPath(id, lng)}
          hrefLang={lng}
          lang={lng}
          aria-label={PUBLIC_UI[lng].language}
          aria-current={lng === locale ? 'true' : undefined}
          onClick={() => void appI18n.changeLanguage(lng)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            lng === locale ? 'bg-surface text-foreground shadow-sm' : 'text-muted hover:text-foreground',
          )}
        >
          {LANGUAGE_SHORT[lng]}
        </Link>
      ))}
    </div>
  )
}

export function PublicHeader({ className }: { className?: string }) {
  const { id, locale } = usePublicPage()
  const ui = PUBLIC_UI[locale]
  return (
    <header
      className={cn(
        'relative z-10 mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-5',
        className,
      )}
    >
      <Link to={publicPath('home', locale)} className="text-sm font-medium tracking-tight text-foreground">
        {BRAND[locale]}
      </Link>
      <nav
        aria-label={ui.primaryNav}
        className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto text-sm [scrollbar-width:none] sm:order-none sm:mx-0 sm:w-auto [&::-webkit-scrollbar]:hidden"
      >
        {PRODUCT_PAGE_IDS.map((page) => (
          <Link
            key={page}
            to={publicPath(page, locale)}
            aria-current={page === id ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-full px-3 py-1.5 transition-colors hover:text-foreground',
              page === id ? 'bg-surface-2 text-foreground' : 'text-muted',
            )}
          >
            {ui.nav[page]}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        <PublicLanguageSwitch />
        <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
          <Link to="/login">{ui.signIn}</Link>
        </Button>
        <Button asChild size="sm">
          <Link to="/signup">{ui.getStarted}</Link>
        </Button>
      </div>
    </header>
  )
}

export function PublicFooter() {
  const { locale } = usePublicPage()
  const ui = PUBLIC_UI[locale]
  return (
    <footer className="border-t border-border-subtle px-5 py-12">
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Link to={publicPath('home', locale)} className="text-sm font-medium tracking-tight">
            {BRAND[locale]}
          </Link>
          <p className="mt-2 max-w-xs text-sm text-muted">{ui.footerTagline}</p>
          <PublicLanguageSwitch className="mt-5" />
        </div>
        <nav aria-label={ui.nav.features} className="flex flex-col gap-2 text-sm text-muted">
          {PRODUCT_PAGE_IDS.map((page) => (
            <Link key={page} to={publicPath(page, locale)} className="w-fit transition-colors hover:text-foreground">
              {ui.nav[page]}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-2 text-sm text-muted">
          <Link to={publicPath('privacy', locale)} className="w-fit transition-colors hover:text-foreground">
            {ui.privacy}
          </Link>
          <a href={`mailto:${SITE.contactEmail}`} className="w-fit transition-colors hover:text-foreground">
            {ui.contact}
          </a>
          <Link to="/login" className="w-fit transition-colors hover:text-foreground">
            {ui.signIn}
          </Link>
        </div>
      </div>
    </footer>
  )
}
