import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AdminApiError, adminApi, adminSupabase } from '@/admin/client'

export type ConsoleSession = { email: string | null; network: string; networkAllowed: boolean; emailEnabled: boolean }

type Stage =
  | { kind: 'loading' }
  | { kind: 'signin' }
  | { kind: 'enroll'; factorId: string; qr: string; secret: string }
  | { kind: 'challenge'; factorId: string }
  | { kind: 'network'; session: ConsoleSession }
  | { kind: 'denied' }
  | { kind: 'ready'; session: ConsoleSession }

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-7">
        <p className="text-xs uppercase tracking-[0.12em] text-muted">Console</p>
        <h1 className="mt-1 text-xl font-medium">{title}</h1>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}

function CodeInput({ onSubmit, busy, label = 'Authenticator code' }: { onSubmit: (code: string) => void; busy: boolean; label?: string }) {
  const [code, setCode] = useState('')
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (/^\d{6}$/.test(code)) onSubmit(code)
      }}
    >
      <Label htmlFor="totp">{label}</Label>
      <Input
        id="totp"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        className="font-mono text-lg tracking-[0.3em]"
      />
      <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
        {busy ? 'Verifying…' : 'Verify'}
      </Button>
    </form>
  )
}

/** Gate for the whole console: password → TOTP (enroll once) → server check (admin + network). */
export function AdminAuth({ children }: { children: (session: ConsoleSession, signOut: () => Promise<void>) => ReactNode }) {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)

  const signOut = useCallback(async () => {
    await adminSupabase.auth.signOut()
    setStage({ kind: 'signin' })
  }, [])

  const checkServer = useCallback(async () => {
    try {
      const session = await adminApi<ConsoleSession>('session')
      setStage(session.networkAllowed ? { kind: 'ready', session } : { kind: 'network', session })
    } catch (error) {
      if (error instanceof AdminApiError && error.code === 'forbidden') {
        await adminSupabase.auth.signOut()
        setStage({ kind: 'denied' })
        return
      }
      setStage({ kind: 'signin' })
      toast.error('Console is unavailable')
    }
  }, [])

  const advance = useCallback(async () => {
    const { data: session } = await adminSupabase.auth.getSession()
    if (!session.session) return setStage({ kind: 'signin' })
    const { data: aal } = await adminSupabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal?.currentLevel === 'aal2') return checkServer()
    const { data: factors } = await adminSupabase.auth.mfa.listFactors()
    const verified = factors?.totp?.find((f) => f.status === 'verified')
    if (verified) return setStage({ kind: 'challenge', factorId: verified.id })
    // First sign-in: clear half-finished enrollments, then enroll a new authenticator.
    for (const factor of factors?.all ?? []) {
      if (factor.status !== 'verified') await adminSupabase.auth.mfa.unenroll({ factorId: factor.id })
    }
    const { data, error } = await adminSupabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Hilm console' })
    if (error || !data) {
      toast.error('Could not start authenticator setup')
      return setStage({ kind: 'signin' })
    }
    setStage({ kind: 'enroll', factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
  }, [checkServer])

  useEffect(() => {
    void advance()
  }, [advance])

  async function signIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    const { error } = await adminSupabase.auth.signInWithPassword({
      email: String(form.get('email') ?? '').trim().toLowerCase(),
      password: String(form.get('password') ?? ''),
    })
    setBusy(false)
    if (error) return toast.error('Sign-in failed')
    await advance()
  }

  async function verify(factorId: string, code: string) {
    setBusy(true)
    const { error } = await adminSupabase.auth.mfa.challengeAndVerify({ factorId, code })
    setBusy(false)
    if (error) return toast.error('Invalid code')
    await checkServer()
  }

  async function requestApproval() {
    setBusy(true)
    try {
      await adminApi('network/request', { method: 'POST', body: {} })
      toast.success('Approval link sent to your email. Open it on this device.')
    } catch (error) {
      toast.error(error instanceof AdminApiError ? error.code.replaceAll('_', ' ') : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  // Approval links land on /approve-network?token=… and are confirmed once signed in with MFA.
  useEffect(() => {
    if (stage.kind !== 'network') return
    const token = new URLSearchParams(window.location.search).get('token')
    if (window.location.pathname !== '/approve-network' || !token) return
    void (async () => {
      try {
        await adminApi('network/confirm', { method: 'POST', body: { token } })
        window.history.replaceState(null, '', '/')
        toast.success('Network approved')
        await checkServer()
      } catch {
        toast.error('Approval link is invalid, expired, or from another network')
      }
    })()
  }, [stage.kind, checkServer])

  if (stage.kind === 'loading') return <Frame title="Loading…">{null}</Frame>
  if (stage.kind === 'denied') {
    return (
      <Frame title="Not authorized">
        <p className="text-sm text-muted">This account cannot use the console.</p>
        <Button className="mt-5 w-full" variant="secondary" onClick={() => setStage({ kind: 'signin' })}>
          Back
        </Button>
      </Frame>
    )
  }
  if (stage.kind === 'signin') {
    return (
      <Frame title="Sign in">
        <form className="space-y-4" onSubmit={signIn}>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Continue'}
          </Button>
        </form>
      </Frame>
    )
  }
  if (stage.kind === 'enroll') {
    return (
      <Frame title="Set up your authenticator">
        <p className="text-sm text-muted">
          Scan with an authenticator app (1Password, Google Authenticator, Authy), then enter the 6-digit code. It is required on every sign-in.
        </p>
        <img src={stage.qr} alt="Authenticator QR code" className="mx-auto my-5 size-44 rounded-xl bg-white p-2" />
        <p className="mb-4 break-all text-center font-mono text-xs text-muted">{stage.secret}</p>
        <CodeInput busy={busy} onSubmit={(code) => void verify(stage.factorId, code)} />
      </Frame>
    )
  }
  if (stage.kind === 'challenge') {
    return (
      <Frame title="Two-factor verification">
        <CodeInput busy={busy} onSubmit={(code) => void verify(stage.factorId, code)} />
      </Frame>
    )
  }
  if (stage.kind === 'network') {
    return (
      <Frame title="New network">
        <p className="text-sm text-muted">
          The console only accepts approved networks. This one ({stage.session.network}) is not approved yet.
        </p>
        <Button className="mt-5 w-full" disabled={busy || !stage.session.emailEnabled} onClick={() => void requestApproval()}>
          Email me an approval link
        </Button>
        {!stage.session.emailEnabled ? (
          <p className="mt-3 text-xs text-muted">Email delivery is not configured; approve this network from the database instead.</p>
        ) : null}
        <Button className="mt-3 w-full" variant="ghost" onClick={() => void signOut()}>
          Sign out
        </Button>
      </Frame>
    )
  }
  return <>{children(stage.session, signOut)}</>
}

/** Fresh TOTP for sensitive actions (server asks with reauth_required). */
export function ReauthDialog({ open, onDone }: { open: boolean; onDone: (ok: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  if (!open) return null
  async function verify(code: string) {
    setBusy(true)
    const { data: factors } = await adminSupabase.auth.mfa.listFactors()
    const factor = factors?.totp?.find((f) => f.status === 'verified')
    const result = factor ? await adminSupabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code }) : null
    setBusy(false)
    if (!result || result.error) return toast.error('Invalid code')
    onDone(true)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-lg font-medium">Confirm with your authenticator</h2>
        <p className="mt-1 mb-4 text-sm text-muted">Sensitive actions need a code from the last 10 minutes.</p>
        <CodeInput busy={busy} onSubmit={(code) => void verify(code)} />
        <Button className="mt-2 w-full" variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
