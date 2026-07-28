import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const encoder = new TextEncoder()

function toBase64(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt'])
}

async function encrypt(apiKey: string, secret?: string) {
  if (!secret) {
    console.warn('ENCRYPTION_SECRET is missing; storing OpenRouter key base64 encoded, not encrypted.')
    return `base64:${toBase64(encoder.encode(apiKey))}`
  }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), encoder.encode(apiKey)))
  const combined = new Uint8Array(iv.length + ciphertext.length)
  combined.set(iv)
  combined.set(ciphertext, iv.length)
  return `aes-gcm:${toBase64(combined)}`
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) throw new Error('Missing authorization token')
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) throw new Error('Unauthorized')

    const { apiKey } = await request.json() as { apiKey?: string }
    if (!apiKey?.trim()) throw new Error('An API key is required')
    const encrypted = await encrypt(apiKey.trim(), Deno.env.get('ENCRYPTION_SECRET'))
    const { error } = await supabase
      .from('user_settings')
      .update({ openrouter_api_key_encrypted: encrypted, has_openrouter_key: true })
      .eq('user_id', user.id)
    if (error) throw error

    return Response.json({ ok: true }, { headers: corsHeaders })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unable to save API key' },
      { status: 400, headers: corsHeaders },
    )
  }
})
