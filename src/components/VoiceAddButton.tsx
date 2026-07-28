import { Mic, MicOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type VoiceAddButtonProps = {
  listening: boolean
  supported: boolean
  onToggle: () => void
  className?: string
  /** Icon-only control for tight composers (e.g. AI chat). */
  iconOnly?: boolean
  labelKey?: string
  listeningKey?: string
  stopKey?: string
  unsupportedKey?: string
}

export function VoiceAddButton({
  listening,
  supported,
  onToggle,
  className,
  iconOnly = false,
  labelKey = 'tasks.voiceAdd',
  listeningKey = 'tasks.voiceListening',
  stopKey = 'tasks.voiceStop',
  unsupportedKey = 'tasks.voiceUnsupported',
}: VoiceAddButtonProps) {
  const { t } = useTranslation()
  const label = listening ? t(listeningKey) : t(labelKey)
  const title = listening ? t(stopKey) : t(labelKey)

  if (!supported) {
    return (
      <Button
        type="button"
        size={iconOnly ? 'icon' : 'sm'}
        variant="ghost"
        disabled
        className={cn(!iconOnly && 'gap-1.5 text-muted', className)}
        title={t(unsupportedKey)}
        aria-label={t(unsupportedKey)}
      >
        <MicOff className="size-3.5" />
        {iconOnly ? null : t(labelKey)}
      </Button>
    )
  }

  return (
    <Button
      type="button"
      size={iconOnly ? 'icon' : 'sm'}
      variant={listening ? 'default' : 'secondary'}
      onClick={onToggle}
      className={cn(!iconOnly && 'gap-1.5', listening && 'animate-pulse', className)}
      aria-pressed={listening}
      aria-label={title}
      title={title}
    >
      {listening ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
      {iconOnly ? null : label}
    </Button>
  )
}
