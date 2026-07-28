import { useTranslation } from 'react-i18next'
import { Mic, MicOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type VoiceAddButtonProps = {
  listening: boolean
  supported: boolean
  onToggle: () => void
  className?: string
}

export function VoiceAddButton({ listening, supported, onToggle, className }: VoiceAddButtonProps) {
  const { t } = useTranslation()

  if (!supported) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled
        className={cn('gap-1.5 text-muted', className)}
        title={t('tasks.voiceUnsupported')}
      >
        <MicOff className="size-3.5" />
        {t('tasks.voiceAdd')}
      </Button>
    )
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={listening ? 'default' : 'secondary'}
      onClick={onToggle}
      className={cn('gap-1.5', listening && 'animate-pulse', className)}
      aria-pressed={listening}
      title={listening ? t('tasks.voiceStop') : t('tasks.voiceAdd')}
    >
      {listening ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
      {listening ? t('tasks.voiceListening') : t('tasks.voiceAdd')}
    </Button>
  )
}
