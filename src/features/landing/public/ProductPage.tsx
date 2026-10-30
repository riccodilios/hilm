import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePublicPageSeo } from '@/hooks/useDocumentSeo'
import { rtlMirrorClass } from '@/lib/rtl'
import { cn } from '@/lib/utils'
import { PAGE_META, PRODUCT_PAGES, PUBLIC_UI, publicPath, type ProductPageId } from '@/content/site.ts'
import { PublicFooter, PublicHeader } from './PublicChrome'
import { usePublicPage } from './PublicPage'

export function ProductPage({ id }: { id: ProductPageId }) {
  const { locale } = usePublicPage()
  usePublicPageSeo(id, locale)
  const page = PRODUCT_PAGES[id][locale]
  const ui = PUBLIC_UI[locale]
  const arrow = cn('size-4', rtlMirrorClass(locale))

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <PublicHeader />
      <main>
        <section className="px-5 pb-16 pt-8 sm:pb-20 sm:pt-14">
          <div className="mx-auto max-w-4xl">
            <nav aria-label={ui.breadcrumbLabel} className="mb-10 text-xs text-muted">
              <ol className="flex flex-wrap items-center gap-2">
                <li>
                  <Link to={publicPath('home', locale)} className="hover:text-foreground">
                    {ui.home}
                  </Link>
                </li>
                <li aria-hidden>/</li>
                <li aria-current="page" className="text-foreground/80">
                  {page.eyebrow}
                </li>
              </ol>
            </nav>
            <p className="mb-4 text-xs font-medium uppercase tracking-[0.22em] text-muted">{page.eyebrow}</p>
            <h1 className="text-balance text-4xl font-medium leading-tight tracking-tight sm:text-5xl">{page.h1}</h1>
            {page.intro.map((paragraph) => (
              <p key={paragraph} className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
                {paragraph}
              </p>
            ))}
            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="lg" className="min-w-[148px]">
                <Link to="/signup">
                  {ui.getStarted} <ArrowRight className={arrow} />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary" className="min-w-[148px]">
                <Link to="/login">{ui.signIn}</Link>
              </Button>
            </div>
          </div>
        </section>

        {page.sections.map((section, index) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-title`}
            className={cn('border-t border-border-subtle px-5 py-14 sm:py-20', index % 2 === 0 && 'bg-surface/35')}
          >
            <div className="mx-auto max-w-4xl">
              <h2 id={`${section.id}-title`} className="text-2xl font-medium tracking-tight sm:text-3xl">
                {section.h2}
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">{section.body}</p>
              {section.items?.length ? (
                <ul className="mt-8 grid gap-4 sm:grid-cols-2">
                  {section.items.map((item) => (
                    <li key={item.title} className="rounded-2xl border border-border-subtle bg-surface/60 p-5">
                      <h3 className="text-base font-medium tracking-tight">{item.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              {section.link ? (
                <Link
                  to={publicPath(section.link, locale)}
                  className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {ui.learnMore}: {ui.nav[section.link]} <ArrowRight className={arrow} />
                </Link>
              ) : null}
            </div>
          </section>
        ))}

        {page.faq?.length ? (
          <section aria-labelledby="faq-title" className="border-t border-border-subtle px-5 py-14 sm:py-20">
            <div className="mx-auto max-w-4xl">
              <h2 id="faq-title" className="text-2xl font-medium tracking-tight sm:text-3xl">
                {ui.faqTitle}
              </h2>
              <div className="mt-8 space-y-6">
                {page.faq.map((item) => (
                  <article key={item.q} className="border-b border-border-subtle pb-6 last:border-0">
                    <h3 className="text-base font-medium tracking-tight sm:text-lg">{item.q}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">{item.a}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section aria-labelledby="related-title" className="border-t border-border-subtle bg-surface/35 px-5 py-14 sm:py-20">
          <div className="mx-auto max-w-4xl">
            <h2 id="related-title" className="text-2xl font-medium tracking-tight sm:text-3xl">
              {ui.relatedTitle}
            </h2>
            <ul className="mt-8 grid gap-4 sm:grid-cols-3">
              {page.related.map((related) => (
                <li key={related}>
                  <Link
                    to={publicPath(related, locale)}
                    className="block h-full rounded-2xl border border-border-subtle bg-surface/60 p-5 transition-colors hover:border-border"
                  >
                    <span className="flex items-center justify-between gap-2 text-base font-medium tracking-tight">
                      {ui.nav[related]} <ArrowRight className={cn(arrow, 'text-muted')} />
                    </span>
                    <span className="mt-2 block text-sm leading-relaxed text-muted">{PAGE_META[related][locale].description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="px-5 py-20 text-center sm:py-28">
          <div className="mx-auto max-w-2xl">
            <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">{page.cta.title}</h2>
            <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">{page.cta.body}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" className="min-w-[148px]">
                <Link to="/signup">
                  {ui.getStarted} <ArrowRight className={arrow} />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
