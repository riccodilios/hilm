/**
 * SEO config for Hilm — used by index.html mirrors, document head, and structured data.
 * Keep descriptions aligned with landing copy so web + AI search share one entity story.
 */
export const SITE_URL = 'https://hillm.netlify.app'

export const SEO = {
  siteName: 'Hilm',
  alternateNames: ['HILM', 'Hilm AI', 'حلم', 'Hilm Personal OS', 'Hilm Workspace OS'],
  title: 'Hilm — AI Personal Operating System',
  titleTemplate: '%s · Hilm',
  description:
    'Hilm is an AI Personal Operating System and Workspace OS. Your AI Chief of Staff manages projects, tasks, Mission Control, documentation, daily logs, and automation — so you ship faster with one system of record.',
  shortDescription: 'AI Personal Operating System — projects, tasks, and an AI Chief of Staff in one place.',
  keywords: [
    'Hilm',
    'HILM',
    'حلم',
    'Hilm AI',
    'AI personal operating system',
    'personal OS',
    'workspace OS',
    'AI chief of staff',
    'AI project management',
    'AI task manager',
    'Mission Control',
    'productivity AI',
    'personal AI assistant for work',
  ],
  locale: 'en_US',
  localeAlternate: 'ar_SA',
  twitterHandle: '',
  email: 'hello@hilm.app',
  github: 'https://github.com/riccodilios/hilm',
  ogImagePath: '/og-image.png',
  ogImageAlt: 'Hilm — AI Personal Operating System',
} as const

export function absoluteUrl(path = '/') {
  const base = SITE_URL.replace(/\/$/, '')
  if (!path || path === '/') return `${base}/`
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

export function buildWebSiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: SEO.siteName,
    alternateName: [...SEO.alternateNames],
    url: `${SITE_URL}/`,
    description: SEO.description,
    inLanguage: ['en', 'ar'],
    publisher: { '@id': `${SITE_URL}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/personal/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }
}

export function buildOrganizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SEO.siteName,
    alternateName: [...SEO.alternateNames],
    url: `${SITE_URL}/`,
    logo: absoluteUrl('/pwa-512.png'),
    email: SEO.email,
    sameAs: [SEO.github],
    description: SEO.description,
  }
}

export function buildSoftwareApplicationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#app`,
    name: SEO.siteName,
    alternateName: [...SEO.alternateNames],
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Personal productivity and project management',
    operatingSystem: 'Web, Progressive Web App',
    url: `${SITE_URL}/`,
    image: absoluteUrl(SEO.ogImagePath),
    description: SEO.description,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: [
      'AI Chief of Staff',
      'Personal OS and Workspace OS',
      'Projects and tasks with Mission Control',
      'Voice commands and AI automation',
      'Daily logs, documentation, and roadmaps',
      'Offline-capable Progressive Web App',
    ],
    creator: { '@id': `${SITE_URL}/#organization` },
    publisher: { '@id': `${SITE_URL}/#organization` },
  }
}

export type FaqItem = { question: string; answer: string }

export function buildFaqJsonLd(items: FaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
}
