/**
 * Supabase Auth → Hooks → Send Email (HTTPS): https://app.hilm.tech/api/auth-email-hook
 * Set SUPABASE_AUTH_HOOK_SECRET to the hook's generated secret (v1,whsec_…).
 */
import type { Config } from '@netlify/functions'
import { Resend } from 'resend'
import { handleAuthEmailHook } from './_shared/email/auth-hook.ts'
import { loadEmailConfig } from './_shared/email/config.ts'
import { logEmail } from './_shared/email/log.ts'
import { createEmailService } from './_shared/email/service.ts'
import { supabaseUrlFromEnv } from './_shared/request-user.ts'

export default async (request: Request) => {
  const config = loadEmailConfig()
  const secret = config.authHookSecret
  const verify =
    secret && config.apiKey
      ? (input: { payload: string; headers: { id: string; timestamp: string; signature: string } }) =>
          new Resend(config.apiKey!).webhooks.verify({ ...input, webhookSecret: secret })
      : null
  try {
    return await handleAuthEmailHook(request, {
      verify,
      service: createEmailService(config),
      config,
      supabaseUrl: supabaseUrlFromEnv(),
      log: logEmail,
    })
  } catch {
    logEmail('email.auth_hook', { outcome: 'failed', code: 'internal_error' })
    return new Response(JSON.stringify({ error: { http_code: 500, message: 'Email could not be sent' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export const config: Config = {
  path: '/api/auth-email-hook',
}
