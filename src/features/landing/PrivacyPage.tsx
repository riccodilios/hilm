import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/ui/page'
import { Button } from '@/components/ui/button'

export function PrivacyPage() {
  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-5 py-12">
      <Button asChild variant="ghost" size="sm" className="mb-8 px-0">
        <Link to="/">← Hilm</Link>
      </Button>
      <PageHeader
        title="Privacy"
        description="Hilm is designed so your operating system stays yours."
      />
      <div className="space-y-6 text-sm leading-relaxed text-muted">
        <p>
          Account data, projects, and AI conversation history are stored in your Supabase project
          under row-level security. OpenRouter API keys are encrypted at rest and never shipped in
          the client bundle.
        </p>
        <p>
          Offline caches live on your device via IndexedDB and the service worker. You can request
          export of your data from Settings as that surface ships.
        </p>
        <p>
          Contact{' '}
          <a className="text-foreground underline-offset-4 hover:underline" href="mailto:hello@hilm.app">
            hello@hilm.app
          </a>{' '}
          for privacy questions.
        </p>
      </div>
    </div>
  )
}
