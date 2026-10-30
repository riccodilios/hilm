/**
 * Public website content and metadata — the single source for the React marketing pages, the
 * build-time prerender (scripts/prerender-public.mjs), sitemap.xml and llms.txt.
 *
 * Keep this file free of imports and non-erasable TypeScript: the prerender script loads it with
 * Node's type stripping. Every claim here must describe a shipped capability.
 */

export type PublicLocale = 'en' | 'ar'
export const PUBLIC_LOCALES: readonly PublicLocale[] = ['en', 'ar']

export const SITE = {
  name: 'Hilm',
  alternateNames: ['HILM', 'حلم', 'Hilm AI', 'Hilm Personal OS', 'Hilm Workspace OS'],
  origin: 'https://hilm.tech',
  appOrigin: 'https://app.hilm.tech',
  logoPath: '/pwa-512.png',
  ogImage: { en: '/og-image.png', ar: '/og-image-ar.png', width: 1200, height: 630 },
  /** Shown on the site today; confirm before adding to structured data or llms.txt. */
  contactEmail: 'hello@hilm.app',
} as const

export type PublicPageId = 'home' | 'personal-os' | 'workspace-os' | 'meetings' | 'features' | 'privacy'
export type ProductPageId = 'personal-os' | 'workspace-os' | 'meetings' | 'features'

export const PUBLIC_PAGE_IDS: readonly PublicPageId[] = ['home', 'personal-os', 'workspace-os', 'meetings', 'features', 'privacy']
export const PRODUCT_PAGE_IDS: readonly ProductPageId[] = ['personal-os', 'workspace-os', 'meetings', 'features']

const SLUGS: Record<PublicPageId, string> = {
  home: '',
  'personal-os': 'personal-os',
  'workspace-os': 'workspace-os',
  meetings: 'meetings',
  features: 'features',
  privacy: 'privacy',
}

/** Last meaningful content change per page (sitemap lastmod). */
export const PAGE_UPDATED: Record<PublicPageId, string> = {
  home: '2026-10-30',
  'personal-os': '2026-10-30',
  'workspace-os': '2026-10-30',
  meetings: '2026-10-30',
  features: '2026-10-30',
  privacy: '2026-10-30',
}

/** Canonical path: no trailing slash; Arabic pages live under /ar. */
export function publicPath(id: PublicPageId, locale: PublicLocale): string {
  const slug = SLUGS[id]
  if (locale === 'ar') return slug ? `/ar/${slug}` : '/ar'
  return slug ? `/${slug}` : '/'
}

export function publicUrl(id: PublicPageId, locale: PublicLocale): string {
  const path = publicPath(id, locale)
  return path === '/' ? `${SITE.origin}/` : `${SITE.origin}${path}`
}

export function matchPublicPath(pathname: string): { id: PublicPageId; locale: PublicLocale } | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  for (const locale of PUBLIC_LOCALES) {
    for (const id of PUBLIC_PAGE_IDS) {
      if (publicPath(id, locale) === path) return { id, locale }
    }
  }
  return null
}

export function appUrl(path: string): string {
  return `${SITE.appOrigin}${path}`
}

export type PageMeta = { title: string; description: string }

export const PAGE_META: Record<PublicPageId, Record<PublicLocale, PageMeta>> = {
  home: {
    en: {
      title: 'Hilm — Your Personal & Workspace OS',
      description:
        'One platform for managing your life and work. Hilm brings personal projects, tasks, meetings and team collaboration together, with AI that works on your real data.',
    },
    ar: {
      title: 'حلم — نظام تشغيل لحياتك الشخصية ولعمل فريقك',
      description:
        'منصة واحدة لإدارة حياتك وعملك. يجمع حلم مشاريعك الشخصية ومهامك واجتماعاتك وتعاون فريقك في مكان واحد، مع ذكاء اصطناعي يعمل على بياناتك الفعلية.',
    },
  },
  'personal-os': {
    en: {
      title: 'Personal OS — Run Your Projects, Tasks and Meetings | Hilm',
      description:
        'Hilm Personal OS is a private system for one person: projects, tasks, schedule, notes, daily logs and meeting notes in one place, with an AI assistant that acts after you confirm.',
    },
    ar: {
      title: 'Personal OS — أدِر مشاريعك ومهامك واجتماعاتك | حلم',
      description:
        'Personal OS في حلم نظام خاص بك وحدك: المشاريع والمهام والجدول والملاحظات والسجلات اليومية ومحاضر الاجتماعات في مكان واحد، مع مساعد ذكي ينفّذ بعد تأكيدك.',
    },
  },
  'workspace-os': {
    en: {
      title: 'Workspace OS — Team Projects, Roles and Meetings | Hilm',
      description:
        'Hilm Workspace OS gives teams shared projects and tasks, departments and roles, team-lead visibility, activity, reports and meeting notes, with an AI assistant scoped to the workspace.',
    },
    ar: {
      title: 'Workspace OS — مشاريع الفريق والأدوار والاجتماعات | حلم',
      description:
        'Workspace OS في حلم يمنح الفرق مشاريع ومهام مشتركة، وأقساماً وأدواراً، ورؤية لقادة الفرق، وسجل نشاط وتقارير ومحاضر اجتماعات، مع مساعد ذكي يعمل داخل مساحة العمل.',
    },
  },
  meetings: {
    en: {
      title: 'AI Meeting Notes: Transcripts, Summaries and Action Items | Hilm',
      description:
        'Record meetings in the browser, get Arabic and English transcripts with speakers, and leave with a summary, decisions and action items you can turn into tasks in Hilm.',
    },
    ar: {
      title: 'محاضر اجتماعات بالذكاء الاصطناعي: تفريغ وملخص ومهام | حلم',
      description:
        'سجّل اجتماعاتك من المتصفح، واحصل على تفريغ نصي بالعربية والإنجليزية مع المتحدثين، ثم ملخص وقرارات وبنود عمل يمكنك تحويلها إلى مهام في حلم.',
    },
  },
  features: {
    en: {
      title: 'Features — Projects, Tasks, Meetings and AI | Hilm',
      description:
        'Every Hilm feature in one place: projects and roadmaps, tasks and reminders, Mission Control, meeting transcription, an AI assistant that takes action, and shared workspaces for teams.',
    },
    ar: {
      title: 'المزايا — المشاريع والمهام والاجتماعات والذكاء الاصطناعي | حلم',
      description:
        'كل مزايا حلم في مكان واحد: المشاريع وخرائط الطريق، والمهام والتذكيرات، وMission Control، وتفريغ الاجتماعات، ومساعد ذكي ينفّذ، ومساحات عمل مشتركة للفرق.',
    },
  },
  privacy: {
    en: {
      title: 'Privacy at Hilm — How Your Data Is Stored',
      description:
        'How Hilm stores your projects, meetings and AI conversations: row-level security, server-held AI keys, private audio storage and on-device offline caches.',
    },
    ar: {
      title: 'الخصوصية في حلم — كيف نحفظ بياناتك',
      description:
        'كيف يحفظ حلم مشاريعك واجتماعاتك ومحادثات الذكاء الاصطناعي: أمان على مستوى الصفوف، ومفاتيح ذكاء اصطناعي على الخادم، وتخزين صوت خاص، وذاكرة مؤقتة على جهازك.',
    },
  },
}

export type PublicUi = {
  nav: Record<ProductPageId, string>
  home: string
  signIn: string
  getStarted: string
  openApp: string
  language: string
  otherLanguage: string
  privacy: string
  contact: string
  footerTagline: string
  faqTitle: string
  relatedTitle: string
  learnMore: string
  breadcrumbLabel: string
  primaryNav: string
}

export const PUBLIC_UI: Record<PublicLocale, PublicUi> = {
  en: {
    nav: { 'personal-os': 'Personal OS', 'workspace-os': 'Workspace OS', meetings: 'Meetings', features: 'Features' },
    home: 'Home',
    signIn: 'Sign in',
    getStarted: 'Get started',
    openApp: 'Open Hilm',
    language: 'English',
    otherLanguage: 'العربية',
    privacy: 'Privacy',
    contact: 'Contact',
    footerTagline: 'Your Personal and Workspace Operating System.',
    faqTitle: 'Frequently asked questions',
    relatedTitle: 'Keep exploring',
    learnMore: 'Learn more',
    breadcrumbLabel: 'Breadcrumb',
    primaryNav: 'Main',
  },
  ar: {
    nav: { 'personal-os': 'Personal OS', 'workspace-os': 'Workspace OS', meetings: 'الاجتماعات', features: 'المزايا' },
    home: 'الرئيسية',
    signIn: 'تسجيل الدخول',
    getStarted: 'ابدأ الآن',
    openApp: 'افتح حلم',
    language: 'العربية',
    otherLanguage: 'English',
    privacy: 'الخصوصية',
    contact: 'تواصل معنا',
    footerTagline: 'نظام تشغيلك الشخصي ونظام تشغيل فريقك.',
    faqTitle: 'أسئلة شائعة',
    relatedTitle: 'تابع الاستكشاف',
    learnMore: 'اعرف المزيد',
    breadcrumbLabel: 'مسار التنقل',
    primaryNav: 'القائمة الرئيسية',
  },
}

export type FaqItem = { q: string; a: string }
export type FeatureItem = { title: string; body: string }
export type ContentSection = {
  id: string
  h2: string
  body: string
  items?: FeatureItem[]
  link?: ProductPageId
}

export type ProductPageContent = {
  eyebrow: string
  h1: string
  intro: string[]
  sections: ContentSection[]
  faq?: FaqItem[]
  related: ProductPageId[]
  cta: { title: string; body: string }
}

/** Homepage additions (the rest of the homepage copy lives in the app locale files). */
export const HOME_CONTENT: Record<
  PublicLocale,
  { h1Suffix: string; meetings: { eyebrow: string; title: string; body: string; points: string[]; link: string }; faq: FaqItem[] }
> = {
  en: {
    h1Suffix: 'Your Personal and Workspace Operating System',
    meetings: {
      eyebrow: 'Meetings',
      title: 'Meetings that end with a plan.',
      body: 'Record in the browser, get a transcript in Arabic, English or both, and leave with a summary, decisions and action items you can turn into tasks.',
      points: [
        'Microphone or meeting-tab recording',
        'Speakers, timestamps and transcript search',
        'Summary, decisions and action items linked to the transcript',
        'Arabic ↔ English translation, PDF and Markdown export',
      ],
      link: 'How Hilm handles meetings',
    },
    faq: [
      {
        q: 'What is Hilm?',
        a: 'Hilm is a Personal and Workspace Operating System: one web app where individuals organize their projects, tasks, meetings and notes (Personal OS) and teams run shared projects together (Workspace OS), with an AI assistant that works on that data.',
      },
      {
        q: 'What is a Personal OS?',
        a: 'A Personal OS is one private system for everything you are working on. In Hilm it holds your projects, tasks, Mission Control schedule, notes, ideas, daily logs and meeting notes, so you are not stitching together five separate apps.',
      },
      {
        q: 'What is a Workspace OS?',
        a: 'Workspace OS is the team side of Hilm: shared projects and tasks, departments and teams, member roles, a team-lead view, activity, reports and team meetings, with an AI assistant scoped to the workspace.',
      },
      {
        q: 'Can I use Hilm for personal projects?',
        a: 'Yes. Personal OS works on its own and is private to your account. You do not need a team to use Hilm.',
      },
      {
        q: 'Can teams use Hilm together?',
        a: 'Yes. Create a workspace, invite members with roles (owner, admin, member or viewer), and share projects, tasks and meetings. Each member keeps their own Personal OS alongside the workspace.',
      },
      {
        q: 'Can Hilm transcribe meetings and turn them into tasks?',
        a: 'Yes. Record a meeting in the browser and Hilm transcribes it with speaker labels, then writes a summary and lists decisions and action items. Any action item can become a task in one step.',
      },
      {
        q: 'What does the AI assistant do?',
        a: 'It reads your Hilm projects and tasks, proposes concrete changes such as creating or updating tasks, adding roadmap items or writing a daily log, and applies them inside Hilm after you confirm.',
      },
      {
        q: 'Does Hilm support Arabic?',
        a: 'Yes. The interface is available in Arabic and English with a right-to-left layout for Arabic, and meeting transcription handles Arabic, English and mixed speech.',
      },
      {
        q: 'Is Hilm available on mobile?',
        a: 'Hilm is a Progressive Web App. Open app.hilm.tech in your phone’s browser and add it to your home screen to use it like an installed app, with push notifications for reminders.',
      },
      {
        q: 'How do I get started?',
        a: 'Create an account at app.hilm.tech, set up your first project, then add tasks or record a meeting. You can create or join a workspace whenever you need one.',
      },
    ],
  },
  ar: {
    h1Suffix: 'نظام تشغيلك الشخصي ونظام تشغيل فريقك',
    meetings: {
      eyebrow: 'الاجتماعات',
      title: 'اجتماعات تنتهي بخطة واضحة.',
      body: 'سجّل من المتصفح، واحصل على تفريغ نصي بالعربية أو الإنجليزية أو بكلتيهما، واخرج بملخص وقرارات وبنود عمل يمكنك تحويلها إلى مهام.',
      points: [
        'تسجيل من الميكروفون أو من تبويب الاجتماع',
        'المتحدثون والتوقيتات والبحث داخل النص',
        'ملخص وقرارات وبنود عمل مرتبطة بالنص',
        'ترجمة بين العربية والإنجليزية وتصدير PDF وMarkdown',
      ],
      link: 'كيف يتعامل حلم مع الاجتماعات',
    },
    faq: [
      {
        q: 'ما هو حلم؟',
        a: 'حلم نظام تشغيل شخصي ونظام تشغيل لمساحات العمل: تطبيق ويب واحد ينظّم فيه الأفراد مشاريعهم ومهامهم واجتماعاتهم وملاحظاتهم (Personal OS)، وتدير فيه الفرق مشاريعها المشتركة (Workspace OS)، مع مساعد ذكي يعمل على هذه البيانات.',
      },
      {
        q: 'ما المقصود بنظام التشغيل الشخصي (Personal OS)؟',
        a: 'هو نظام خاص واحد لكل ما تعمل عليه. في حلم يضم مشاريعك ومهامك وجدولك في Mission Control وملاحظاتك وأفكارك وسجلاتك اليومية ومحاضر اجتماعاتك، بدلاً من التنقل بين خمسة تطبيقات منفصلة.',
      },
      {
        q: 'ما المقصود بنظام تشغيل مساحة العمل (Workspace OS)؟',
        a: 'هو الجانب الجماعي من حلم: مشاريع ومهام مشتركة، وأقسام وفرق، وأدوار للأعضاء، وعرض لقادة الفرق، وسجل نشاط وتقارير واجتماعات للفريق، مع مساعد ذكي يعمل داخل مساحة العمل.',
      },
      {
        q: 'هل يمكنني استخدام حلم لمشاريعي الشخصية؟',
        a: 'نعم. يعمل Personal OS بشكل مستقل وهو خاص بحسابك وحدك، ولا تحتاج إلى فريق لاستخدام حلم.',
      },
      {
        q: 'هل يمكن للفرق استخدام حلم معاً؟',
        a: 'نعم. أنشئ مساحة عمل، وادعُ الأعضاء بأدوار (مالك أو مسؤول أو عضو أو مشاهد)، وشارك المشاريع والمهام والاجتماعات. ويحتفظ كل عضو بنظامه الشخصي إلى جانب مساحة العمل.',
      },
      {
        q: 'هل يفرّغ حلم الاجتماعات ويحوّلها إلى مهام؟',
        a: 'نعم. سجّل الاجتماع من المتصفح وسيفرّغه حلم نصياً مع تمييز المتحدثين، ثم يكتب ملخصاً ويستخرج القرارات وبنود العمل. ويمكن تحويل أي بند عمل إلى مهمة بخطوة واحدة.',
      },
      {
        q: 'ماذا يفعل المساعد الذكي؟',
        a: 'يقرأ مشاريعك ومهامك في حلم، ويقترح تغييرات محددة مثل إنشاء المهام أو تحديثها أو إضافة عناصر إلى خريطة الطريق أو كتابة السجل اليومي، ثم ينفّذها داخل حلم بعد تأكيدك.',
      },
      {
        q: 'هل يدعم حلم اللغة العربية؟',
        a: 'نعم. الواجهة متاحة بالعربية والإنجليزية مع تخطيط من اليمين إلى اليسار للعربية، ويتعامل تفريغ الاجتماعات مع العربية والإنجليزية والحديث الذي يمزج بينهما.',
      },
      {
        q: 'هل حلم متاح على الجوال؟',
        a: 'حلم تطبيق ويب تقدّمي (PWA). افتح app.hilm.tech من متصفح جوالك وأضفه إلى الشاشة الرئيسية لاستخدامه كتطبيق مثبّت، مع إشعارات للتذكيرات.',
      },
      {
        q: 'كيف أبدأ؟',
        a: 'أنشئ حساباً على app.hilm.tech، وأعدّ مشروعك الأول، ثم أضف المهام أو سجّل اجتماعاً. ويمكنك إنشاء مساحة عمل أو الانضمام إلى واحدة متى احتجت.',
      },
    ],
  },
}

export const PRODUCT_PAGES: Record<ProductPageId, Record<PublicLocale, ProductPageContent>> = {
  'personal-os': {
    en: {
      eyebrow: 'Personal OS',
      h1: 'Personal OS: one place to run your own projects and days',
      intro: [
        'Hilm’s Personal OS is a private workspace for one person. Your projects, tasks, schedule, notes, daily logs and meetings live in one connected system that only your account can see.',
        'An AI assistant reads that same context and can make changes for you, such as creating tasks or updating a project, once you confirm.',
      ],
      sections: [
        {
          id: 'who',
          h2: 'Who Personal OS is for',
          body: 'Freelancers, founders, students and anyone running several projects at once. If your work is scattered across a to-do app, a notes app, a calendar and a chat window, Personal OS brings it back into one record that you own.',
        },
        {
          id: 'projects',
          h2: 'Projects that keep their context',
          body: 'Every project has its own overview, tasks, board, roadmap, notes, ideas, documentation and meetings, so the decisions behind the work stay next to the work.',
          items: [
            { title: 'Overview and health', body: 'Status, progress and a health signal for each project, with labels and archiving to keep a long list manageable.' },
            { title: 'Roadmap', body: 'Plan what comes now, next and later inside the project instead of a separate planning tool.' },
            { title: 'Notes, ideas and documentation', body: 'Capture thinking where it belongs and keep project documentation beside the tasks it explains.' },
          ],
        },
        {
          id: 'tasks',
          h2: 'Tasks, priorities and your schedule',
          body: 'Tasks carry status, priority, due dates and reminders. Work through them as a list or on a board, and plan your days in Mission Control, Hilm’s scheduling view.',
          items: [
            { title: 'List and board views', body: 'Move tasks across statuses on a board or sort them in a list.' },
            { title: 'Mission Control', body: 'See scheduled work on a calendar and decide what happens when.' },
            { title: 'Reminders', body: 'Get push notifications on your devices before tasks are due.' },
          ],
        },
        {
          id: 'daily',
          h2: 'Daily logs and reports',
          body: 'Write down what you shipped, what blocked you and what comes next. Reports summarize progress across your projects and can be exported as PDF.',
        },
        {
          id: 'meetings',
          h2: 'Meetings that turn into work',
          body: 'Record a meeting inside a project. Hilm transcribes it, writes a summary, lists decisions and action items, and lets you turn any action item into a task.',
          link: 'meetings',
        },
        {
          id: 'ai',
          h2: 'An AI assistant that works on your data',
          body: 'Type in chat or use voice dictation. The assistant reads your projects and tasks, proposes concrete changes such as creating tasks, updating statuses, adding roadmap items or writing a daily log, and applies them after you confirm.',
        },
        {
          id: 'vs',
          h2: 'Personal OS and Workspace OS',
          body: 'Personal OS is private to you. When work needs a team, Workspace OS adds shared projects, roles and team views. Both live under the same Hilm account, so moving between personal and team work is one switch away.',
          link: 'workspace-os',
        },
      ],
      faq: [
        {
          q: 'Is my Personal OS private?',
          a: 'Yes. Personal projects, tasks, notes and meetings are visible only to your account. Workspace data is stored separately and shared only with that workspace’s members.',
        },
        {
          q: 'Do I need a team to use Hilm?',
          a: 'No. Personal OS works on its own. You can create or join a workspace later if you start working with others.',
        },
        {
          q: 'Can I use Personal OS on my phone?',
          a: 'Yes. Hilm is a Progressive Web App: open app.hilm.tech in your mobile browser and add it to your home screen.',
        },
      ],
      related: ['meetings', 'workspace-os', 'features'],
      cta: { title: 'Start your Personal OS', body: 'Create an account and set up your first project in a few minutes.' },
    },
    ar: {
      eyebrow: 'Personal OS',
      h1: 'Personal OS: مكان واحد لإدارة مشاريعك وأيامك',
      intro: [
        'Personal OS في حلم مساحة خاصة لشخص واحد. مشاريعك ومهامك وجدولك وملاحظاتك وسجلاتك اليومية واجتماعاتك تعيش في نظام واحد مترابط لا يراه إلا حسابك.',
        'ويقرأ المساعد الذكي السياق نفسه، ويمكنه إجراء تغييرات نيابة عنك، مثل إنشاء المهام أو تحديث مشروع، بعد أن تؤكد.',
      ],
      sections: [
        {
          id: 'who',
          h2: 'لمن صُمّم Personal OS',
          body: 'للمستقلين ورواد الأعمال والطلاب وكل من يدير عدة مشاريع في الوقت نفسه. إذا كان عملك موزعاً بين تطبيق مهام وتطبيق ملاحظات وتقويم ونافذة محادثة، فإن Personal OS يعيده إلى سجل واحد تملكه.',
        },
        {
          id: 'projects',
          h2: 'مشاريع تحتفظ بسياقها',
          body: 'لكل مشروع نظرة عامة ومهام ولوحة وخريطة طريق وملاحظات وأفكار وتوثيق واجتماعات، فتبقى القرارات التي وراء العمل بجانب العمل نفسه.',
          items: [
            { title: 'النظرة العامة والحالة', body: 'الحالة والتقدم ومؤشر صحة لكل مشروع، مع تسميات وأرشفة لإبقاء قائمة المشاريع الطويلة منظمة.' },
            { title: 'خريطة الطريق', body: 'خطط لما يأتي الآن وما بعده ولاحقاً داخل المشروع، بدلاً من أداة تخطيط منفصلة.' },
            { title: 'الملاحظات والأفكار والتوثيق', body: 'دوّن أفكارك في مكانها الصحيح، واحتفظ بتوثيق المشروع بجانب المهام التي يشرحها.' },
          ],
        },
        {
          id: 'tasks',
          h2: 'المهام والأولويات وجدولك',
          body: 'لكل مهمة حالة وأولوية وموعد استحقاق وتذكير. اعمل عليها كقائمة أو على لوحة، وخطط لأيامك في Mission Control، عرض الجدولة في حلم.',
          items: [
            { title: 'عرض القائمة واللوحة', body: 'انقل المهام بين الحالات على اللوحة أو رتّبها في قائمة.' },
            { title: 'Mission Control', body: 'شاهد العمل المجدول على تقويم وقرر ما يحدث ومتى.' },
            { title: 'التذكيرات', body: 'تصلك إشعارات على أجهزتك قبل موعد استحقاق المهام.' },
          ],
        },
        {
          id: 'daily',
          h2: 'السجلات اليومية والتقارير',
          body: 'دوّن ما أنجزته وما أعاقك وما الخطوة التالية. وتلخّص التقارير التقدم عبر مشاريعك ويمكن تصديرها بصيغة PDF.',
        },
        {
          id: 'meetings',
          h2: 'اجتماعات تتحول إلى عمل',
          body: 'سجّل اجتماعاً داخل مشروع، وسيفرّغه حلم نصياً، ويكتب ملخصاً، ويستخرج القرارات وبنود العمل، ويتيح لك تحويل أي بند إلى مهمة.',
          link: 'meetings',
        },
        {
          id: 'ai',
          h2: 'مساعد ذكي يعمل على بياناتك',
          body: 'اكتب في المحادثة أو استخدم الإملاء الصوتي. يقرأ المساعد مشاريعك ومهامك، ويقترح تغييرات محددة مثل إنشاء المهام وتحديث حالاتها وإضافة عناصر إلى خريطة الطريق أو كتابة السجل اليومي، ثم ينفّذها بعد تأكيدك.',
        },
        {
          id: 'vs',
          h2: 'Personal OS وWorkspace OS',
          body: 'Personal OS خاص بك وحدك. وعندما يحتاج العمل إلى فريق، يضيف Workspace OS مشاريع مشتركة وأدواراً وعروضاً للفريق. ويعمل الاثنان تحت حساب حلم نفسه، فالانتقال بين عملك الشخصي وعمل الفريق خطوة واحدة.',
          link: 'workspace-os',
        },
      ],
      faq: [
        {
          q: 'هل نظامي الشخصي خاص؟',
          a: 'نعم. المشاريع والمهام والملاحظات والاجتماعات الشخصية لا يراها إلا حسابك. أما بيانات مساحة العمل فتُحفظ بشكل منفصل ولا يطّلع عليها إلا أعضاء تلك المساحة.',
        },
        {
          q: 'هل أحتاج إلى فريق لاستخدام حلم؟',
          a: 'لا. يعمل Personal OS بشكل مستقل، ويمكنك إنشاء مساحة عمل أو الانضمام إلى واحدة لاحقاً عندما تبدأ العمل مع آخرين.',
        },
        {
          q: 'هل يمكنني استخدام Personal OS على جوالي؟',
          a: 'نعم. حلم تطبيق ويب تقدّمي: افتح app.hilm.tech من متصفح الجوال وأضفه إلى الشاشة الرئيسية.',
        },
      ],
      related: ['meetings', 'workspace-os', 'features'],
      cta: { title: 'ابدأ نظامك الشخصي', body: 'أنشئ حساباً وأعدّ مشروعك الأول في دقائق.' },
    },
  },
  'workspace-os': {
    en: {
      eyebrow: 'Workspace OS',
      h1: 'Workspace OS: shared projects, clear ownership, one view of the team',
      intro: [
        'Workspace OS is Hilm for teams and organizations. Members share projects and tasks, the organization is mapped into departments and teams, and leads can see who is working on what.',
        'Team meetings and an AI assistant work inside the workspace, so decisions and follow-ups stay with the shared work instead of in private chats.',
      ],
      sections: [
        {
          id: 'who',
          h2: 'Who Workspace OS is for',
          body: 'Small companies, agencies, product teams and project crews that want shared delivery without stitching together a project tool, a team directory and a meeting-notes app.',
        },
        {
          id: 'projects',
          h2: 'Shared projects and tasks',
          body: 'Workspace projects hold tasks with assignees, statuses, priorities and due dates. The team works from shared lists and boards and plans in a shared Mission Control.',
        },
        {
          id: 'org',
          h2: 'Organization structure and roles',
          body: 'Map the organization into departments and teams so ownership is clear before work starts. Every member has a role that sets what they can do.',
          items: [
            { title: 'Owner and admin', body: 'Manage the workspace, its members and its structure.' },
            { title: 'Member', body: 'Create and update projects, tasks and meetings.' },
            { title: 'Viewer', body: 'Follow the work without changing it.' },
          ],
        },
        {
          id: 'visibility',
          h2: 'Team visibility',
          body: 'A team-lead view shows the workload across a lead’s people, the activity feed records what changed and who changed it, and reports summarize projects and members.',
        },
        {
          id: 'meetings',
          h2: 'Team meetings and decisions',
          body: 'Record workspace meetings, link speakers to workspace members, and turn agreed action items into workspace tasks assigned to the right person.',
          link: 'meetings',
        },
        {
          id: 'ai',
          h2: 'An assistant scoped to the workspace',
          body: 'The workspace assistant works with workspace projects and tasks and stays separate from each member’s personal assistant and personal data.',
        },
        {
          id: 'personal',
          h2: 'How Workspace OS relates to Personal OS',
          body: 'Each person keeps a private Personal OS. Workspace OS sits alongside it under the same account, so private work and team work stay separate but are one switch apart.',
          link: 'personal-os',
        },
      ],
      faq: [
        {
          q: 'How do permissions work in a workspace?',
          a: 'Each member has a role. Owners and admins manage the workspace and its members, members create and edit work, and viewers can see the work without changing it.',
        },
        {
          q: 'Does workspace data mix with my personal data?',
          a: 'No. Personal OS and Workspace OS are stored separately. Workspace members see workspace projects, tasks and meetings, never anyone’s Personal OS.',
        },
        {
          q: 'Can we assign meeting action items to teammates?',
          a: 'Yes. In a workspace meeting, an action item can become a workspace task assigned to a member.',
        },
      ],
      related: ['meetings', 'personal-os', 'features'],
      cta: { title: 'Bring your team into Hilm', body: 'Create an account, start a workspace and invite your team.' },
    },
    ar: {
      eyebrow: 'Workspace OS',
      h1: 'Workspace OS: مشاريع مشتركة، ومسؤوليات واضحة، ورؤية واحدة للفريق',
      intro: [
        'Workspace OS هو حلم للفرق والمؤسسات. يتشارك الأعضاء المشاريع والمهام، ويُرسم الهيكل التنظيمي في أقسام وفرق، ويرى قادة الفرق من يعمل على ماذا.',
        'وتعمل اجتماعات الفريق والمساعد الذكي داخل مساحة العمل، فتبقى القرارات والمتابعات مع العمل المشترك بدلاً من المحادثات الخاصة.',
      ],
      sections: [
        {
          id: 'who',
          h2: 'لمن صُمّم Workspace OS',
          body: 'للشركات الصغيرة والوكالات وفرق المنتجات وفرق المشاريع التي تريد تسليماً مشتركاً دون الجمع بين أداة مشاريع ودليل للفريق وتطبيق لمحاضر الاجتماعات.',
        },
        {
          id: 'projects',
          h2: 'مشاريع ومهام مشتركة',
          body: 'تضم مشاريع مساحة العمل مهام لها مسؤولون وحالات وأولويات ومواعيد استحقاق. ويعمل الفريق من قوائم ولوحات مشتركة ويخطط في Mission Control مشترك.',
        },
        {
          id: 'org',
          h2: 'الهيكل التنظيمي والأدوار',
          body: 'ارسم المؤسسة في أقسام وفرق لتتضح المسؤولية قبل بدء العمل. ولكل عضو دور يحدد ما يمكنه فعله.',
          items: [
            { title: 'المالك والمسؤول', body: 'إدارة مساحة العمل وأعضائها وهيكلها.' },
            { title: 'العضو', body: 'إنشاء المشاريع والمهام والاجتماعات وتحديثها.' },
            { title: 'المشاهد', body: 'متابعة العمل دون تغييره.' },
          ],
        },
        {
          id: 'visibility',
          h2: 'رؤية واضحة للفريق',
          body: 'يعرض عرض قائد الفريق حجم العمل لدى أفراد فريقه، ويسجّل سجل النشاط ما تغيّر ومن غيّره، وتلخّص التقارير المشاريع والأعضاء.',
        },
        {
          id: 'meetings',
          h2: 'اجتماعات الفريق وقراراته',
          body: 'سجّل اجتماعات مساحة العمل، واربط المتحدثين بأعضاء المساحة، وحوّل بنود العمل المتفق عليها إلى مهام مسندة إلى الشخص المناسب.',
          link: 'meetings',
        },
        {
          id: 'ai',
          h2: 'مساعد يعمل داخل مساحة العمل',
          body: 'يعمل مساعد مساحة العمل مع مشاريعها ومهامها، ويبقى منفصلاً عن المساعد الشخصي لكل عضو وعن بياناته الشخصية.',
        },
        {
          id: 'personal',
          h2: 'علاقة Workspace OS بـ Personal OS',
          body: 'يحتفظ كل شخص بنظامه الشخصي الخاص. ويعمل Workspace OS إلى جانبه تحت الحساب نفسه، فيبقى العمل الخاص وعمل الفريق منفصلين لكن بينهما خطوة واحدة.',
          link: 'personal-os',
        },
      ],
      faq: [
        {
          q: 'كيف تعمل الصلاحيات في مساحة العمل؟',
          a: 'لكل عضو دور. يدير المالكون والمسؤولون المساحة وأعضاءها، وينشئ الأعضاء العمل ويعدّلونه، ويطّلع المشاهدون على العمل دون تغييره.',
        },
        {
          q: 'هل تختلط بيانات مساحة العمل ببياناتي الشخصية؟',
          a: 'لا. يُحفظ Personal OS وWorkspace OS بشكل منفصل. يرى أعضاء المساحة مشاريعها ومهامها واجتماعاتها، ولا يرون النظام الشخصي لأي أحد.',
        },
        {
          q: 'هل يمكننا إسناد بنود العمل من الاجتماعات إلى الزملاء؟',
          a: 'نعم. في اجتماع مساحة العمل يمكن تحويل بند العمل إلى مهمة في المساحة مسندة إلى أحد الأعضاء.',
        },
      ],
      related: ['meetings', 'personal-os', 'features'],
      cta: { title: 'اجمع فريقك في حلم', body: 'أنشئ حساباً، وابدأ مساحة عمل، وادعُ فريقك.' },
    },
  },
  meetings: {
    en: {
      eyebrow: 'Meetings',
      h1: 'AI meeting notes: transcripts, summaries, decisions and action items',
      intro: [
        'Hilm records your meeting in the browser, transcribes it in Arabic, English or a mix of both, and turns the conversation into a summary, decisions and action items.',
        'Meetings belong to a project in your Personal OS or a shared workspace, so what was agreed ends up next to the work it affects.',
      ],
      sections: [
        {
          id: 'record',
          h2: 'Record in the browser',
          body: 'Start a recording from any project. Hilm records your microphone, or an online meeting running in a browser tab together with your microphone. Hilm does not join calls as a bot; it records the audio on your device.',
          items: [
            { title: 'Microphone', body: 'For in-person meetings and calls on speaker.' },
            { title: 'Meeting tab and microphone', body: 'For online meetings in a browser tab, in desktop browsers that support sharing tab audio, such as Chrome and Edge.' },
            { title: 'Long meetings', body: 'Recording continues for hours, within your plan’s meeting minutes, and audio is saved in parts as you go.' },
          ],
        },
        {
          id: 'transcript',
          h2: 'Transcripts with speakers',
          body: 'The transcript separates speakers, keeps Arabic in Arabic script and English in English, and handles switching between the two mid-sentence. Rename speakers to real names, search the transcript, and play back the audio from any line.',
        },
        {
          id: 'analysis',
          h2: 'Summaries, decisions and action items',
          body: 'When the meeting ends, Hilm writes a summary and key points, lists the decisions, and extracts action items with suggested owners and due dates. Each decision and action item links back to the moment in the transcript where it was said.',
        },
        {
          id: 'tasks',
          h2: 'From discussion to tasks',
          body: 'Turn any action item into a task in one step. In a workspace, assign it to the teammate who owns it, and the meeting keeps a link to every task it created.',
        },
        {
          id: 'share',
          h2: 'Translate, export and share',
          body: 'Switch the summary and transcript between Arabic and English, export the meeting as PDF or Markdown, or create a read-only link for people outside Hilm.',
          items: [
            { title: 'Translation', body: 'Saved Arabic and English versions of the summary, action items and transcript.' },
            { title: 'Export', body: 'PDF or Markdown copies of the meeting notes.' },
            { title: 'Share links', body: 'A read-only view of the summary and transcript. The owner can revoke or replace the link at any time; audio is never shared.' },
          ],
        },
        {
          id: 'privacy',
          h2: 'Private by default',
          body: 'Meeting audio is stored privately and is available only to people with access to the meeting. Share links exist only when the owner creates one, and shared pages are excluded from search engines.',
        },
      ],
      faq: [
        {
          q: 'Which languages can Hilm transcribe?',
          a: 'Arabic and English, including conversations that switch between them. Arabic stays in Arabic script and English terms stay in English.',
        },
        {
          q: 'Does Hilm work with Zoom, Google Meet or Microsoft Teams?',
          a: 'Hilm does not connect to these services or join calls. If the meeting runs in a browser tab, record the tab’s audio together with your microphone; otherwise record with your microphone.',
        },
        {
          q: 'Can I share meeting notes with someone who does not use Hilm?',
          a: 'Yes. Create a read-only share link from the meeting. Recipients can read the summary and transcript without an account, and you can turn the link off at any time.',
        },
      ],
      related: ['personal-os', 'workspace-os', 'features'],
      cta: { title: 'Record your next meeting with Hilm', body: 'Create an account, open a project and press record.' },
    },
    ar: {
      eyebrow: 'الاجتماعات',
      h1: 'محاضر اجتماعات بالذكاء الاصطناعي: تفريغ نصي وملخص وقرارات وبنود عمل',
      intro: [
        'يسجّل حلم اجتماعك من المتصفح، ويفرّغه نصياً بالعربية أو الإنجليزية أو بمزيج منهما، ويحوّل الحديث إلى ملخص وقرارات وبنود عمل.',
        'ينتمي كل اجتماع إلى مشروع في نظامك الشخصي أو في مساحة عمل مشتركة، فينتهي ما اتُّفق عليه بجانب العمل الذي يخصه.',
      ],
      sections: [
        {
          id: 'record',
          h2: 'سجّل من المتصفح',
          body: 'ابدأ التسجيل من أي مشروع. يسجّل حلم صوت الميكروفون، أو اجتماعاً عبر الإنترنت يعمل في تبويب المتصفح مع صوت الميكروفون. لا ينضم حلم إلى المكالمات كروبوت، بل يسجّل الصوت من جهازك.',
          items: [
            { title: 'الميكروفون', body: 'للاجتماعات الحضورية والمكالمات على مكبر الصوت.' },
            { title: 'تبويب الاجتماع مع الميكروفون', body: 'للاجتماعات عبر الإنترنت في تبويب المتصفح، في متصفحات سطح المكتب التي تدعم مشاركة صوت التبويب مثل Chrome وEdge.' },
            { title: 'الاجتماعات الطويلة', body: 'يستمر التسجيل لساعات ضمن دقائق الاجتماعات في خطتك، ويُحفظ الصوت على أجزاء أثناء التسجيل.' },
          ],
        },
        {
          id: 'transcript',
          h2: 'تفريغ نصي مع المتحدثين',
          body: 'يميّز التفريغ بين المتحدثين، ويُبقي العربية بالحروف العربية والإنجليزية بالإنجليزية، ويتعامل مع الانتقال بينهما في الجملة نفسها. أعد تسمية المتحدثين بأسمائهم، وابحث داخل النص، واستمع إلى الصوت من أي سطر.',
        },
        {
          id: 'analysis',
          h2: 'ملخص وقرارات وبنود عمل',
          body: 'عند انتهاء الاجتماع يكتب حلم ملخصاً ونقاطاً رئيسية، ويسرد القرارات، ويستخرج بنود العمل مع اقتراح المسؤول وموعد الاستحقاق. ويرتبط كل قرار وبند بالموضع الذي قيل فيه داخل النص.',
        },
        {
          id: 'tasks',
          h2: 'من النقاش إلى المهام',
          body: 'حوّل أي بند عمل إلى مهمة بخطوة واحدة. وفي مساحة العمل أسنده إلى الزميل المسؤول عنه، ويحتفظ الاجتماع برابط لكل مهمة نتجت عنه.',
        },
        {
          id: 'share',
          h2: 'الترجمة والتصدير والمشاركة',
          body: 'بدّل الملخص والنص بين العربية والإنجليزية، أو صدّر الاجتماع بصيغة PDF أو Markdown، أو أنشئ رابط قراءة فقط لأشخاص من خارج حلم.',
          items: [
            { title: 'الترجمة', body: 'نسخ محفوظة بالعربية والإنجليزية للملخص وبنود العمل والنص.' },
            { title: 'التصدير', body: 'نسخ PDF أو Markdown من محضر الاجتماع.' },
            { title: 'روابط المشاركة', body: 'عرض للقراءة فقط للملخص والنص. يمكن للمالك إلغاء الرابط أو استبداله في أي وقت، ولا تتم مشاركة الصوت أبداً.' },
          ],
        },
        {
          id: 'privacy',
          h2: 'خاص افتراضياً',
          body: 'يُحفظ صوت الاجتماع بشكل خاص ولا يصل إليه إلا من لديه صلاحية على الاجتماع. ولا توجد روابط مشاركة إلا إذا أنشأها المالك، وتُستبعد الصفحات المشتركة من محركات البحث.',
        },
      ],
      faq: [
        {
          q: 'ما اللغات التي يفرّغها حلم؟',
          a: 'العربية والإنجليزية، بما في ذلك الأحاديث التي تنتقل بينهما. تبقى العربية بالحروف العربية والمصطلحات الإنجليزية بالإنجليزية.',
        },
        {
          q: 'هل يعمل حلم مع Zoom أو Google Meet أو Microsoft Teams؟',
          a: 'لا يتصل حلم بهذه الخدمات ولا ينضم إلى المكالمات. إذا كان الاجتماع يعمل في تبويب المتصفح فسجّل صوت التبويب مع الميكروفون، وإلا فسجّل بالميكروفون.',
        },
        {
          q: 'هل يمكنني مشاركة محضر الاجتماع مع شخص لا يستخدم حلم؟',
          a: 'نعم. أنشئ رابط مشاركة للقراءة فقط من صفحة الاجتماع. يقرأ المستلمون الملخص والنص دون حساب، ويمكنك إيقاف الرابط في أي وقت.',
        },
      ],
      related: ['personal-os', 'workspace-os', 'features'],
      cta: { title: 'سجّل اجتماعك القادم مع حلم', body: 'أنشئ حساباً، وافتح مشروعاً، واضغط تسجيل.' },
    },
  },
  features: {
    en: {
      eyebrow: 'Features',
      h1: 'Hilm features',
      intro: [
        'Everything Hilm does today, grouped by what it helps you get done. Each feature works in Personal OS, and the team features come with a shared workspace.',
      ],
      sections: [
        {
          id: 'planning',
          h2: 'Projects and planning',
          body: 'Give every project one home for its plan and its context.',
          items: [
            { title: 'Projects', body: 'Overview, progress, health, labels and archive.' },
            { title: 'Roadmaps', body: 'Now, next and later horizons inside each project.' },
            { title: 'Mission Control', body: 'A scheduling view of what is planned and when.' },
            { title: 'Notes, ideas and documentation', body: 'Kept inside the project they belong to.' },
          ],
          link: 'personal-os',
        },
        {
          id: 'tasks',
          h2: 'Tasks and follow-through',
          body: 'Keep work moving from idea to done.',
          items: [
            { title: 'Tasks', body: 'Statuses, priorities and due dates, with assignees in shared workspaces.' },
            { title: 'Boards', body: 'Drag tasks across statuses.' },
            { title: 'Reminders', body: 'Push notifications before tasks are due.' },
            { title: 'Daily logs and reports', body: 'Record each day’s progress and export reports as PDF.' },
          ],
        },
        {
          id: 'meetings',
          h2: 'Meetings',
          body: 'Turn conversations into decisions and tasks.',
          items: [
            { title: 'Recording', body: 'Microphone, or a meeting tab together with your microphone.' },
            { title: 'Transcription', body: 'Arabic, English and mixed speech, with speakers and timestamps.' },
            { title: 'Summaries and action items', body: 'Decisions and action items linked to the transcript.' },
            { title: 'Translate, export and share', body: 'Arabic ↔ English, PDF and Markdown, read-only links.' },
          ],
          link: 'meetings',
        },
        {
          id: 'ai',
          h2: 'AI assistant',
          body: 'An assistant that works on your Hilm data rather than a separate chat history.',
          items: [
            { title: 'Actions you confirm', body: 'Create and update projects, tasks, roadmap items, notes and daily logs.' },
            { title: 'Voice dictation', body: 'Speak instead of typing in the assistant.' },
            { title: 'Workspace assistant', body: 'A separate assistant scoped to each shared workspace.' },
          ],
        },
        {
          id: 'teams',
          h2: 'Teams',
          body: 'Shared delivery with clear ownership.',
          items: [
            { title: 'Shared workspaces', body: 'Projects, tasks and meetings shared with members.' },
            { title: 'Departments and teams', body: 'Map the organization before assigning work.' },
            { title: 'Roles', body: 'Owner, admin, member and viewer.' },
            { title: 'Team-lead view, activity and reports', body: 'See workload, changes and progress across the team.' },
          ],
          link: 'workspace-os',
        },
        {
          id: 'everyday',
          h2: 'Everyday use',
          body: 'Small things that make Hilm easy to live in.',
          items: [
            { title: 'Search and command palette', body: 'Jump anywhere with the keyboard.' },
            { title: 'Installable web app', body: 'Install from the browser on desktop and mobile; recent data stays readable offline.' },
            { title: 'Arabic and English', body: 'Full right-to-left layout for Arabic.' },
            { title: 'Light and dark themes', body: 'Switch between a light and a dark theme.' },
          ],
        },
      ],
      related: ['personal-os', 'workspace-os', 'meetings'],
      cta: { title: 'See it in your own work', body: 'Create an account and bring in your first project.' },
    },
    ar: {
      eyebrow: 'المزايا',
      h1: 'مزايا حلم',
      intro: [
        'كل ما يقدّمه حلم اليوم، مجمّعاً حسب ما يساعدك على إنجازه. تعمل كل ميزة في Personal OS، وتأتي مزايا الفرق مع مساحة العمل المشتركة.',
      ],
      sections: [
        {
          id: 'planning',
          h2: 'المشاريع والتخطيط',
          body: 'امنح كل مشروع مكاناً واحداً لخطته وسياقه.',
          items: [
            { title: 'المشاريع', body: 'نظرة عامة وتقدم وحالة وتسميات وأرشفة.' },
            { title: 'خرائط الطريق', body: 'الآن وما بعده ولاحقاً داخل كل مشروع.' },
            { title: 'Mission Control', body: 'عرض جدولة لما هو مخطط له ومتى.' },
            { title: 'الملاحظات والأفكار والتوثيق', body: 'محفوظة داخل المشروع الذي تنتمي إليه.' },
          ],
          link: 'personal-os',
        },
        {
          id: 'tasks',
          h2: 'المهام والمتابعة',
          body: 'حافظ على تقدّم العمل من الفكرة حتى الإنجاز.',
          items: [
            { title: 'المهام', body: 'حالات وأولويات ومواعيد استحقاق، مع إسناد المسؤولين في مساحات العمل المشتركة.' },
            { title: 'اللوحات', body: 'اسحب المهام بين الحالات.' },
            { title: 'التذكيرات', body: 'إشعارات قبل موعد استحقاق المهام.' },
            { title: 'السجلات اليومية والتقارير', body: 'سجّل تقدم كل يوم وصدّر التقارير بصيغة PDF.' },
          ],
        },
        {
          id: 'meetings',
          h2: 'الاجتماعات',
          body: 'حوّل الأحاديث إلى قرارات ومهام.',
          items: [
            { title: 'التسجيل', body: 'من الميكروفون، أو من تبويب الاجتماع مع الميكروفون.' },
            { title: 'التفريغ النصي', body: 'العربية والإنجليزية والحديث المختلط، مع المتحدثين والتوقيتات.' },
            { title: 'الملخص وبنود العمل', body: 'قرارات وبنود عمل مرتبطة بالنص.' },
            { title: 'الترجمة والتصدير والمشاركة', body: 'بين العربية والإنجليزية، وPDF وMarkdown، وروابط للقراءة فقط.' },
          ],
          link: 'meetings',
        },
        {
          id: 'ai',
          h2: 'المساعد الذكي',
          body: 'مساعد يعمل على بياناتك في حلم بدلاً من سجل محادثة منفصل.',
          items: [
            { title: 'إجراءات تؤكدها', body: 'إنشاء المشاريع والمهام وعناصر خريطة الطريق والملاحظات والسجلات اليومية وتحديثها.' },
            { title: 'الإملاء الصوتي', body: 'تحدّث بدلاً من الكتابة في المساعد.' },
            { title: 'مساعد مساحة العمل', body: 'مساعد منفصل يعمل داخل كل مساحة عمل مشتركة.' },
          ],
        },
        {
          id: 'teams',
          h2: 'الفرق',
          body: 'تسليم مشترك بمسؤوليات واضحة.',
          items: [
            { title: 'مساحات عمل مشتركة', body: 'مشاريع ومهام واجتماعات مشتركة مع الأعضاء.' },
            { title: 'الأقسام والفرق', body: 'ارسم المؤسسة قبل توزيع العمل.' },
            { title: 'الأدوار', body: 'مالك ومسؤول وعضو ومشاهد.' },
            { title: 'عرض قائد الفريق والنشاط والتقارير', body: 'شاهد حجم العمل والتغييرات والتقدم عبر الفريق.' },
          ],
          link: 'workspace-os',
        },
        {
          id: 'everyday',
          h2: 'الاستخدام اليومي',
          body: 'تفاصيل صغيرة تجعل حلم سهل الاستخدام كل يوم.',
          items: [
            { title: 'البحث ولوحة الأوامر', body: 'انتقل إلى أي مكان بلوحة المفاتيح.' },
            { title: 'تطبيق ويب قابل للتثبيت', body: 'ثبّته من المتصفح على سطح المكتب والجوال، وتبقى بياناتك الحديثة متاحة للقراءة دون اتصال.' },
            { title: 'العربية والإنجليزية', body: 'تخطيط كامل من اليمين إلى اليسار للعربية.' },
            { title: 'المظهر الفاتح والداكن', body: 'بدّل بين مظهر فاتح ومظهر داكن.' },
          ],
        },
      ],
      related: ['personal-os', 'workspace-os', 'meetings'],
      cta: { title: 'جرّبه على عملك الفعلي', body: 'أنشئ حساباً وأضف مشروعك الأول.' },
    },
  },
}
