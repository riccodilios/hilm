import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, KeyRound, Save } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { getProfile, getSettings, saveOpenRouterKey, settingsKeys, updateProfile, updateSettings } from '@/features/settings/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader, Skeleton } from '@/components/ui/page'

export function SettingsPage() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: settingsKeys.me(), queryFn: getSettings })
  const profile = useQuery({ queryKey: settingsKeys.profile(), queryFn: getProfile })
  const [displayName, setDisplayName] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [apiKey, setApiKey] = useState('')

  useEffect(() => {
    if (settings.data) setDefaultModel(settings.data.default_model)
  }, [settings.data])
  useEffect(() => {
    if (profile.data) setDisplayName(profile.data.display_name ?? '')
  }, [profile.data])

  const save = useMutation({
    mutationFn: async () => {
      await Promise.all([
        updateSettings({ default_model: defaultModel }),
        updateProfile({ display_name: displayName.trim() || undefined }),
        apiKey.trim() ? saveOpenRouterKey(apiKey.trim()) : Promise.resolve(),
      ])
    },
    onSuccess: async () => {
      setApiKey('')
      await queryClient.invalidateQueries({ queryKey: settingsKeys.all })
      toast.success('Settings saved')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (settings.isLoading || profile.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-12 w-64" /><Skeleton className="h-80" /></div>
  }

  return (
    <div>
      <PageHeader title="Settings" description="Personalize Hilm and configure your AI provider." />
      <form className="max-w-2xl space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate() }}>
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Hilm currently uses its focused dark theme.</CardDescription>
          </CardHeader>
          <CardContent><p className="text-sm text-muted">Dark mode is enabled by design and will be configurable in a future release.</p></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your display name appears throughout your personal workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="display-name">Display name</Label>
            <Input id="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>AI provider</CardTitle>
            <CardDescription>Your API key is stored through the encrypted edge function and never returned to the app.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="default-model">Default OpenRouter model</Label>
              <Input id="default-model" value={defaultModel} onChange={(event) => setDefaultModel(event.target.value)} placeholder="anthropic/claude-sonnet-4" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="openrouter-key">OpenRouter API key</Label>
              <div className="flex gap-2">
                <Input id="openrouter-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.data?.has_openrouter_key ? 'Key saved — enter a new key to replace it' : 'sk-or-v1-…'} />
                <KeyRound className="mt-2.5 size-4 shrink-0 text-muted" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Data</CardTitle>
            <CardDescription>Export tooling is being prepared.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild type="button" variant="secondary">
              <Link to="/export"><Download className="size-4" /> Open export scaffold</Link>
            </Button>
          </CardContent>
        </Card>
        <Button type="submit" disabled={save.isPending}><Save className="size-4" /> Save settings</Button>
      </form>
    </div>
  )
}
