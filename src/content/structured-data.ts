/**
 * schema.org JSON-LD for public pages, shared by the React pages and the build-time prerender.
 * Only verified facts: no pricing, ratings, reviews or customer numbers.
 */
import {
  HOME_CONTENT,
  PAGE_META,
  PRODUCT_PAGES,
  PUBLIC_UI,
  SITE,
  publicUrl,
  type FaqItem,
  type PublicLocale,
  type PublicPageId,
} from './site.ts'

const ORG_ID = `${SITE.origin}/#organization`
const WEBSITE_ID = `${SITE.origin}/#website`
const SOFTWARE_ID = `${SITE.origin}/#software`

const SOFTWARE_TEXT: Record<PublicLocale, { description: string; features: string[] }> = {
  en: {
    description:
      'Hilm is a Personal and Workspace Operating System: a web app where individuals organize projects, tasks, meetings and notes (Personal OS) and teams run shared projects (Workspace OS), with an AI assistant that acts on that data after confirmation.',
    features: [
      'Personal OS for individual projects, tasks, notes and daily logs',
      'Workspace OS with shared projects, departments, teams and member roles',
      'Mission Control scheduling and task reminders',
      'Meeting recording, Arabic and English transcription, summaries, decisions and action items',
      'AI assistant that creates and updates projects and tasks after confirmation',
      'Arabic and English interface with right-to-left layout',
      'Installable Progressive Web App',
    ],
  },
  ar: {
    description:
      'حلم نظام تشغيل شخصي ونظام تشغيل لمساحات العمل: تطبيق ويب ينظّم فيه الأفراد المشاريع والمهام والاجتماعات والملاحظات (Personal OS) وتدير فيه الفرق مشاريعها المشتركة (Workspace OS)، مع مساعد ذكي ينفّذ على هذه البيانات بعد التأكيد.',
    features: [
      'Personal OS للمشاريع والمهام والملاحظات والسجلات اليومية الفردية',
      'Workspace OS بمشاريع مشتركة وأقسام وفرق وأدوار للأعضاء',
      'جدولة Mission Control وتذكيرات المهام',
      'تسجيل الاجتماعات وتفريغها بالعربية والإنجليزية مع الملخص والقرارات وبنود العمل',
      'مساعد ذكي ينشئ المشاريع والمهام ويحدّثها بعد التأكيد',
      'واجهة عربية وإنجليزية بتخطيط من اليمين إلى اليسار',
      'تطبيق ويب تقدّمي قابل للتثبيت',
    ],
  },
}

type JsonLd = Record<string, unknown>

/** Keeps search engines and AI answers from merging Hilm with similarly named products. */
export const DISAMBIGUATION: Record<PublicLocale, string> = {
  en: 'Hilm (hilm.tech) is an independent Personal and Workspace Operating System for projects, tasks and meetings. It is not affiliated with hilm.ai, an AI website builder, or with HUMAIN OS.',
  ar: 'حلم (hilm.tech) نظام تشغيل شخصي ونظام تشغيل لمساحات العمل مستقل لإدارة المشاريع والمهام والاجتماعات، ولا يرتبط بموقع hilm.ai لبناء المواقع بالذكاء الاصطناعي ولا بنظام HUMAIN OS.',
}

function organization(): JsonLd {
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: SITE.name,
    alternateName: [...SITE.alternateNames],
    url: `${SITE.origin}/`,
    logo: { '@type': 'ImageObject', url: `${SITE.origin}${SITE.logoPath}`, width: 512, height: 512 },
    disambiguatingDescription: DISAMBIGUATION.en,
    email: SITE.contactEmail,
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: SITE.contactEmail,
      availableLanguage: ['English', 'Arabic'],
    },
    sameAs: [SITE.instagram.url],
  }
}

function website(): JsonLd {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: SITE.name,
    alternateName: [...SITE.alternateNames],
    url: `${SITE.origin}/`,
    inLanguage: ['en', 'ar'],
    publisher: { '@id': ORG_ID },
  }
}

function software(locale: PublicLocale): JsonLd {
  const text = SOFTWARE_TEXT[locale]
  return {
    '@type': 'SoftwareApplication',
    '@id': SOFTWARE_ID,
    name: SITE.name,
    alternateName: [...SITE.alternateNames],
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Productivity',
    operatingSystem: 'Web browser; installable Progressive Web App',
    url: `${SITE.origin}/`,
    installUrl: `${SITE.appOrigin}/`,
    image: `${SITE.origin}${SITE.ogImage[locale]}`,
    description: text.description,
    disambiguatingDescription: DISAMBIGUATION[locale],
    featureList: text.features,
    inLanguage: ['en', 'ar'],
    publisher: { '@id': ORG_ID },
  }
}

function faqPage(items: FaqItem[], url: string, locale: PublicLocale): JsonLd {
  return {
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    inLanguage: locale,
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
}

function breadcrumb(id: PublicPageId, locale: PublicLocale, url: string): JsonLd {
  const name = id === 'privacy' ? PUBLIC_UI[locale].privacy : PRODUCT_PAGES[id as keyof typeof PRODUCT_PAGES][locale].eyebrow
  return {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: PUBLIC_UI[locale].home, item: publicUrl('home', locale) },
      { '@type': 'ListItem', position: 2, name, item: url },
    ],
  }
}

/** Visible FAQ items for a page (the same items rendered on the page). */
export function pageFaq(id: PublicPageId, locale: PublicLocale): FaqItem[] {
  if (id === 'home') return HOME_CONTENT[locale].faq
  if (id === 'privacy') return []
  return PRODUCT_PAGES[id][locale].faq ?? []
}

/** One @graph per page; shared entities use stable @ids so they never conflict. */
export function pageJsonLd(id: PublicPageId, locale: PublicLocale): JsonLd {
  const url = publicUrl(id, locale)
  const meta = PAGE_META[id][locale]
  const webPage: JsonLd = {
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: meta.title,
    description: meta.description,
    inLanguage: locale,
    isPartOf: { '@id': WEBSITE_ID },
    about: { '@id': SOFTWARE_ID },
    primaryImageOfPage: { '@type': 'ImageObject', url: `${SITE.origin}${SITE.ogImage[locale]}` },
  }
  const graph: JsonLd[] = [organization(), website(), software(locale), webPage]
  if (id !== 'home') {
    webPage.breadcrumb = { '@id': `${url}#breadcrumb` }
    graph.push(breadcrumb(id, locale, url))
  }
  const faq = pageFaq(id, locale)
  if (faq.length) graph.push(faqPage(faq, url, locale))
  return { '@context': 'https://schema.org', '@graph': graph }
}
