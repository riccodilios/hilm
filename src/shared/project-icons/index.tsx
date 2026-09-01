import { useMemo, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  Airplay,
  AlarmClock,
  Archive,
  Atom,
  Banknote,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Boxes,
  Brain,
  Briefcase,
  Building2,
  Calculator,
  Calendar,
  Camera,
  ChartPie,
  Cloud,
  Code2,
  Cog,
  Compass,
  Cpu,
  CreditCard,
  Database,
  Factory,
  FileCode2,
  Film,
  Flag,
  Flame,
  Folder,
  Gamepad2,
  Gauge,
  Gift,
  GitBranch,
  Globe2,
  GraduationCap,
  Hammer,
  Heart,
  HeartPulse,
  Home,
  Hospital,
  Inbox,
  KeyRound,
  Landmark,
  Layers,
  LayoutDashboard,
  Lightbulb,
  LineChart,
  Link2,
  Lock,
  Mail,
  Map,
  Megaphone,
  MessageSquare,
  Mic,
  Milestone,
  MonitorSmartphone,
  Mountain,
  Network,
  Newspaper,
  Package,
  Palette,
  PenTool,
  Plane,
  Plug,
  Radio,
  Rocket,
  Route,
  Search,
  Server,
  Settings2,
  Share2,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Stethoscope,
  Store,
  Target,
  Terminal,
  TrendingUp,
  Truck,
  Users,
  Video,
  Wallet,
  Wand2,
  Wifi,
  Wrench,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

export type IconCategory =
  | 'recent'
  | 'favorites'
  | 'technology'
  | 'ai'
  | 'business'
  | 'finance'
  | 'education'
  | 'marketing'
  | 'design'
  | 'development'
  | 'communication'
  | 'infrastructure'
  | 'security'
  | 'analytics'
  | 'cloud'
  | 'database'
  | 'api'
  | 'shopping'
  | 'healthcare'
  | 'travel'
  | 'gaming'
  | 'general'

type IconDef = { id: string; Icon: LucideIcon; label: string; categories: IconCategory[] }

const FAVORITES_KEY = 'hilm.projectIcon.favorites'
const RECENT_KEY = 'hilm.projectIcon.recent'

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeList(key: string, values: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(values.slice(0, 24)))
  } catch {
    /* ignore */
  }
}

export const PROJECT_ICON_CATALOG: IconDef[] = [
  { id: 'folder', Icon: Folder, label: 'Folder', categories: ['general'] },
  { id: 'inbox', Icon: Inbox, label: 'Inbox', categories: ['general', 'communication'] },
  { id: 'home', Icon: Home, label: 'Home', categories: ['general'] },
  { id: 'star', Icon: Star, label: 'Star', categories: ['general', 'favorites'] },
  { id: 'flag', Icon: Flag, label: 'Flag', categories: ['general', 'marketing'] },
  { id: 'archive', Icon: Archive, label: 'Archive', categories: ['general'] },
  { id: 'gift', Icon: Gift, label: 'Gift', categories: ['general', 'shopping'] },
  { id: 'flame', Icon: Flame, label: 'Flame', categories: ['general', 'gaming'] },
  { id: 'compass', Icon: Compass, label: 'Compass', categories: ['general', 'travel'] },

  { id: 'cpu', Icon: Cpu, label: 'CPU', categories: ['technology', 'development'] },
  { id: 'monitor', Icon: MonitorSmartphone, label: 'Devices', categories: ['technology'] },
  { id: 'wifi', Icon: Wifi, label: 'Wifi', categories: ['technology', 'infrastructure'] },
  { id: 'radio', Icon: Radio, label: 'Radio', categories: ['technology', 'communication'] },
  { id: 'airplay', Icon: Airplay, label: 'Airplay', categories: ['technology'] },
  { id: 'network', Icon: Network, label: 'Network', categories: ['technology', 'infrastructure'] },
  { id: 'cog', Icon: Cog, label: 'Settings', categories: ['technology', 'infrastructure'] },
  { id: 'settings', Icon: Settings2, label: 'Tune', categories: ['technology'] },
  { id: 'wrench', Icon: Wrench, label: 'Wrench', categories: ['technology', 'infrastructure'] },
  { id: 'hammer', Icon: Hammer, label: 'Build', categories: ['technology', 'development'] },

  { id: 'sparkles', Icon: Sparkles, label: 'Sparkles', categories: ['ai', 'design'] },
  { id: 'brain', Icon: Brain, label: 'Brain', categories: ['ai'] },
  { id: 'bot', Icon: Bot, label: 'Bot', categories: ['ai', 'development'] },
  { id: 'atom', Icon: Atom, label: 'Atom', categories: ['ai', 'education'] },
  { id: 'wand', Icon: Wand2, label: 'Magic', categories: ['ai', 'design'] },
  { id: 'mic', Icon: Mic, label: 'Voice', categories: ['ai', 'communication'] },

  { id: 'briefcase', Icon: Briefcase, label: 'Briefcase', categories: ['business'] },
  { id: 'building', Icon: Building2, label: 'Building', categories: ['business'] },
  { id: 'landmark', Icon: Landmark, label: 'Landmark', categories: ['business', 'finance'] },
  { id: 'users', Icon: Users, label: 'Team', categories: ['business', 'communication'] },
  { id: 'factory', Icon: Factory, label: 'Factory', categories: ['business', 'infrastructure'] },
  { id: 'target', Icon: Target, label: 'Target', categories: ['business', 'marketing'] },
  { id: 'milestone', Icon: Milestone, label: 'Milestone', categories: ['business', 'development'] },
  { id: 'calendar', Icon: Calendar, label: 'Calendar', categories: ['business', 'general'] },
  { id: 'alarm', Icon: AlarmClock, label: 'Deadline', categories: ['business'] },

  { id: 'wallet', Icon: Wallet, label: 'Wallet', categories: ['finance'] },
  { id: 'banknote', Icon: Banknote, label: 'Cash', categories: ['finance'] },
  { id: 'credit-card', Icon: CreditCard, label: 'Card', categories: ['finance', 'shopping'] },
  { id: 'calculator', Icon: Calculator, label: 'Calculator', categories: ['finance', 'analytics'] },
  { id: 'trending', Icon: TrendingUp, label: 'Growth', categories: ['finance', 'analytics'] },

  { id: 'book', Icon: BookOpen, label: 'Book', categories: ['education'] },
  { id: 'graduation', Icon: GraduationCap, label: 'Education', categories: ['education'] },
  { id: 'lightbulb', Icon: Lightbulb, label: 'Idea', categories: ['education', 'ai'] },
  { id: 'newspaper', Icon: Newspaper, label: 'News', categories: ['education', 'marketing'] },

  { id: 'megaphone', Icon: Megaphone, label: 'Campaign', categories: ['marketing'] },
  { id: 'share', Icon: Share2, label: 'Share', categories: ['marketing', 'communication'] },
  { id: 'mail', Icon: Mail, label: 'Email', categories: ['marketing', 'communication'] },
  { id: 'bell', Icon: Bell, label: 'Alerts', categories: ['marketing', 'communication'] },

  { id: 'palette', Icon: Palette, label: 'Palette', categories: ['design'] },
  { id: 'pen', Icon: PenTool, label: 'Pen', categories: ['design'] },
  { id: 'camera', Icon: Camera, label: 'Camera', categories: ['design'] },
  { id: 'film', Icon: Film, label: 'Film', categories: ['design', 'gaming'] },
  { id: 'layers', Icon: Layers, label: 'Layers', categories: ['design', 'development'] },
  { id: 'layout', Icon: LayoutDashboard, label: 'Layout', categories: ['design', 'analytics'] },

  { id: 'code', Icon: Code2, label: 'Code', categories: ['development'] },
  { id: 'terminal', Icon: Terminal, label: 'Terminal', categories: ['development'] },
  { id: 'git', Icon: GitBranch, label: 'Git', categories: ['development'] },
  { id: 'file-code', Icon: FileCode2, label: 'Source', categories: ['development'] },
  { id: 'boxes', Icon: Boxes, label: 'Packages', categories: ['development', 'infrastructure'] },
  { id: 'package', Icon: Package, label: 'Package', categories: ['development', 'shopping'] },
  { id: 'rocket', Icon: Rocket, label: 'Launch', categories: ['development', 'technology'] },
  { id: 'zap', Icon: Zap, label: 'Zap', categories: ['development', 'technology'] },

  { id: 'message', Icon: MessageSquare, label: 'Chat', categories: ['communication'] },
  { id: 'video', Icon: Video, label: 'Video', categories: ['communication'] },
  { id: 'link', Icon: Link2, label: 'Link', categories: ['communication', 'api'] },

  { id: 'server', Icon: Server, label: 'Server', categories: ['infrastructure', 'cloud'] },
  { id: 'gauge', Icon: Gauge, label: 'Perf', categories: ['infrastructure', 'analytics'] },
  { id: 'activity', Icon: Activity, label: 'Activity', categories: ['infrastructure', 'analytics'] },
  { id: 'route', Icon: Route, label: 'Route', categories: ['infrastructure', 'travel'] },

  { id: 'shield', Icon: Shield, label: 'Shield', categories: ['security'] },
  { id: 'lock', Icon: Lock, label: 'Lock', categories: ['security'] },
  { id: 'key', Icon: KeyRound, label: 'Key', categories: ['security', 'api'] },

  { id: 'chart', Icon: BarChart3, label: 'Bars', categories: ['analytics'] },
  { id: 'line-chart', Icon: LineChart, label: 'Lines', categories: ['analytics'] },
  { id: 'pie', Icon: ChartPie, label: 'Pie', categories: ['analytics'] },

  { id: 'cloud', Icon: Cloud, label: 'Cloud', categories: ['cloud', 'infrastructure'] },
  { id: 'database', Icon: Database, label: 'Database', categories: ['database', 'cloud'] },
  { id: 'plug', Icon: Plug, label: 'API', categories: ['api', 'development'] },

  { id: 'cart', Icon: ShoppingCart, label: 'Cart', categories: ['shopping'] },
  { id: 'bag', Icon: ShoppingBag, label: 'Bag', categories: ['shopping'] },
  { id: 'store', Icon: Store, label: 'Store', categories: ['shopping', 'business'] },
  { id: 'truck', Icon: Truck, label: 'Shipping', categories: ['shopping', 'travel'] },

  { id: 'heart', Icon: Heart, label: 'Heart', categories: ['healthcare', 'general'] },
  { id: 'pulse', Icon: HeartPulse, label: 'Pulse', categories: ['healthcare'] },
  { id: 'stethoscope', Icon: Stethoscope, label: 'Clinic', categories: ['healthcare'] },
  { id: 'hospital', Icon: Hospital, label: 'Hospital', categories: ['healthcare'] },

  { id: 'plane', Icon: Plane, label: 'Flight', categories: ['travel'] },
  { id: 'globe', Icon: Globe2, label: 'Globe', categories: ['travel', 'business'] },
  { id: 'map', Icon: Map, label: 'Map', categories: ['travel'] },
  { id: 'mountain', Icon: Mountain, label: 'Outdoor', categories: ['travel', 'gaming'] },

  { id: 'gamepad', Icon: Gamepad2, label: 'Games', categories: ['gaming'] },
  { id: 'search', Icon: Search, label: 'Search', categories: ['general', 'analytics'] },
]

/** Backward-compatible flat list used by older call sites. */
export const PROJECT_ICONS = PROJECT_ICON_CATALOG.map(({ id, Icon }) => ({ id, Icon }))

export type ProjectIconId = (typeof PROJECT_ICON_CATALOG)[number]['id']

const iconMap = Object.fromEntries(PROJECT_ICON_CATALOG.map((item) => [item.id, item.Icon])) as Record<
  string,
  LucideIcon
>

export function getProjectIcon(icon?: string | null): LucideIcon {
  if (icon && iconMap[icon]) return iconMap[icon]
  return Folder
}

type ProjectIconProps = {
  icon?: string | null
  className?: string
  size?: number
}

export function ProjectIcon({ icon, className, size = 16 }: ProjectIconProps) {
  const Icon = getProjectIcon(icon)
  return <Icon className={className} size={size} aria-hidden />
}

const CATEGORY_ORDER: IconCategory[] = [
  'recent',
  'favorites',
  'technology',
  'ai',
  'business',
  'finance',
  'education',
  'marketing',
  'design',
  'development',
  'communication',
  'infrastructure',
  'security',
  'analytics',
  'cloud',
  'database',
  'api',
  'shopping',
  'healthcare',
  'travel',
  'gaming',
  'general',
]

type ProjectIconPickerProps = {
  value: string
  onChange: (icon: string) => void
  color?: string
}

export function ProjectIconPicker({ value, onChange, color = '#60a5fa' }: ProjectIconPickerProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<IconCategory | 'all'>('all')
  const [favorites, setFavorites] = useState(() => readList(FAVORITES_KEY))
  const [recent, setRecent] = useState(() => readList(RECENT_KEY))

  const PreviewIcon = getProjectIcon(value)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return PROJECT_ICON_CATALOG.filter((item) => {
      const matchesQuery =
        !q ||
        item.id.includes(q) ||
        item.label.toLowerCase().includes(q) ||
        item.categories.some((c) => c.includes(q))
      if (!matchesQuery) return false
      if (category === 'all') return true
      if (category === 'favorites') return favorites.includes(item.id)
      if (category === 'recent') return recent.includes(item.id)
      return item.categories.includes(category)
    })
  }, [query, category, favorites, recent])

  function select(id: string) {
    onChange(id)
    const nextRecent = [id, ...recent.filter((item) => item !== id)].slice(0, 12)
    setRecent(nextRecent)
    writeList(RECENT_KEY, nextRecent)
  }

  function toggleFavorite(id: string) {
    const next = favorites.includes(id)
      ? favorites.filter((item) => item !== id)
      : [id, ...favorites].slice(0, 24)
    setFavorites(next)
    writeList(FAVORITES_KEY, next)
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border-subtle bg-surface/40 p-3">
      <div className="flex items-center gap-3">
        <span
          className="flex size-12 items-center justify-center rounded-2xl text-background"
          style={{ backgroundColor: color }}
        >
          <PreviewIcon className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium capitalize">{value.replaceAll('-', ' ')}</p>
          <p className="text-xs text-muted">Live preview</p>
        </div>
        <button
          type="button"
          className={cn(
            'rounded-xl border px-2.5 py-1.5 text-xs',
            favorites.includes(value)
              ? 'border-accent/40 bg-accent/10 text-foreground'
              : 'border-border-subtle text-muted',
          )}
          onClick={() => toggleFavorite(value)}
        >
          {favorites.includes(value) ? 'Favorited' : 'Favorite'}
        </button>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search icons…"
        className="h-9"
      />

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        <CategoryChip active={category === 'all'} onClick={() => setCategory('all')}>
          All
        </CategoryChip>
        {CATEGORY_ORDER.map((item) => (
          <CategoryChip key={item} active={category === item} onClick={() => setCategory(item)}>
            {item}
          </CategoryChip>
        ))}
      </div>

      <div className="grid max-h-56 grid-cols-6 gap-2 overflow-y-auto sm:grid-cols-8">
        {filtered.map(({ id, Icon, label }) => {
          const selected = value === id
          return (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={selected}
              onClick={() => select(id)}
              onContextMenu={(event) => {
                event.preventDefault()
                toggleFavorite(id)
              }}
              className={cn(
                'flex size-9 items-center justify-center rounded-xl border transition-colors',
                selected
                  ? 'border-foreground/40 text-background'
                  : 'border-border-subtle bg-surface-2 text-muted hover:text-foreground',
              )}
              style={selected ? { backgroundColor: color } : undefined}
            >
              <Icon className="size-4" />
            </button>
          )
        })}
      </div>
      {!filtered.length ? <p className="text-xs text-muted">No icons match that search.</p> : null}
    </div>
  )
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-2.5 py-1 text-[11px] capitalize whitespace-nowrap',
        active
          ? 'border-accent/40 bg-accent/10 text-foreground'
          : 'border-border-subtle bg-surface/50 text-muted',
      )}
    >
      {children}
    </button>
  )
}
