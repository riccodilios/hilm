import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Building2, Check, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FadeIn, Section, SectionHeading } from '@/features/landing/primitives'
import { getPlanCatalog } from '@/shared/billing/api'
import { cn } from '@/lib/utils'

type PlanKey = 'free' | 'pro' | 'team' | 'team_pro'

/** Shown before the live catalog loads (and in the pre-rendered page); the database is the source. */
const FALLBACK_PRICES: Record<PlanKey, number> = { free: 0, pro: 30, team: 250, team_pro: 400 }

function PlanCard({ id, price, featured }: { id: PlanKey; price: number; featured?: boolean }) {
  const { t, i18n } = useTranslation()
  const points = t(`landing.pricing.plans.${id}.points`, { returnObjects: true }) as string[]
  const amount = new Intl.NumberFormat(i18n.language.startsWith('ar') ? 'ar-SA' : 'en-US').format(price)
  return (
    <article
      className={cn(
        'flex min-w-0 flex-col rounded-3xl border p-6',
        featured ? 'border-foreground/30 bg-surface' : 'border-border-subtle bg-surface/50',
      )}
    >
      <h4 className="text-lg font-medium">{t(`landing.pricing.plans.${id}.name`)}</h4>
      <p className="mt-1 text-sm text-muted">{t(`landing.pricing.plans.${id}.blurb`)}</p>
      <p className="mt-5 flex items-baseline gap-1.5">
        <span className="text-4xl font-medium tracking-tight tabular-nums">{amount}</span>
        <span className="text-sm text-muted">{t('landing.pricing.perMonth')}</span>
      </p>
      <ul className="mt-5 flex-1 space-y-2.5">
        {(Array.isArray(points) ? points : []).map((point) => (
          <li key={point} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-muted" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <Button asChild className="mt-6" variant={featured ? 'default' : 'secondary'}>
        <Link to="/signup">{id === 'free' || id === 'pro' ? t('landing.pricing.cta') : t('landing.pricing.contact')}</Link>
      </Button>
    </article>
  )
}

export function PricingSection() {
  const { t } = useTranslation()
  const [prices, setPrices] = useState(FALLBACK_PRICES)

  useEffect(() => {
    let active = true
    getPlanCatalog()
      .then((plans) => {
        if (!active) return
        const next = { ...FALLBACK_PRICES }
        for (const plan of plans) if (plan.id in next) next[plan.id as PlanKey] = Number(plan.price_sar_monthly)
        setPrices(next)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  return (
    <Section id="pricing">
      <FadeIn>
        <SectionHeading eyebrow={t('landing.pricing.eyebrow')} title={t('landing.pricing.title')} description={t('landing.pricing.description')} />
      </FadeIn>
      <div className="grid gap-10 lg:grid-cols-2">
        <FadeIn>
          <div className="mb-4 flex items-center gap-2 text-sm text-muted">
            <UserRound className="size-4" strokeWidth={1.5} /> {t('landing.pricing.personal')}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <PlanCard id="free" price={prices.free} />
            <PlanCard id="pro" price={prices.pro} featured />
          </div>
        </FadeIn>
        <FadeIn delay={0.08}>
          <div className="mb-4 flex items-center gap-2 text-sm text-muted">
            <Building2 className="size-4" strokeWidth={1.5} /> {t('landing.pricing.workspace')}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <PlanCard id="team" price={prices.team} featured />
            <PlanCard id="team_pro" price={prices.team_pro} />
          </div>
        </FadeIn>
      </div>
      <p className="mt-8 text-center text-xs text-muted">{t('landing.pricing.note')}</p>
    </Section>
  )
}
