import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { shouldShowAnnouncement } from '@/features/announcements/catalog'
import { WhatsNewModal } from '@/features/announcements/WhatsNewModal'
import { getSettings, settingsKeys, updateSettings } from '@/features/settings/api'

export function WhatsNewGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: settingsKeys.me(), queryFn: getSettings })
  const pending = shouldShowAnnouncement(settings.data?.last_seen_announcement_version)

  const ack = useMutation({
    mutationFn: async () => {
      if (!pending) return
      await updateSettings({ last_seen_announcement_version: pending.version })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: settingsKeys.me() })
    },
  })

  return (
    <>
      {children}
      {settings.data?.onboarding_completed && pending ? (
        <WhatsNewModal
          announcement={pending}
          pending={ack.isPending}
          onContinue={() => ack.mutate()}
        />
      ) : null}
    </>
  )
}
