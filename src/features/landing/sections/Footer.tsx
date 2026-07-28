import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export function LandingFooter() {
  const { t } = useTranslation()
  const links = [
    { label: t('landing.footerPrivacy'), href: '/privacy' },
    { label: t('landing.footerGithub'), href: 'https://github.com/riccodilios/hilm', external: true },
    { label: t('landing.footerDocs'), href: '/app/documents' },
    { label: t('landing.footerContact'), href: 'mailto:hello@hilm.app' },
  ]

  return (
    <footer className="border-t border-border-subtle px-5 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium tracking-tight">{t('brand.name')}</p>
          <p className="mt-1 text-xs text-muted">{t('brand.os')}</p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
          {links.map((link) =>
            link.external || link.href.startsWith('mailto:') ? (
              <a
                key={link.label}
                href={link.href}
                className="transition-colors hover:text-foreground"
                {...(link.external
                  ? { target: '_blank', rel: 'noreferrer' }
                  : {})}
              >
                {link.label}
              </a>
            ) : (
              <Link key={link.label} to={link.href} className="transition-colors hover:text-foreground">
                {link.label}
              </Link>
            ),
          )}
        </nav>
      </div>
    </footer>
  )
}
