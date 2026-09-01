# Supabase Auth email templates (configure in Dashboard)

Hilm does **not** store auth email templates in this repository. Configure them in:

**Supabase Dashboard → Authentication → Email Templates**

## Confirm signup

Use the default link flow (recommended):

```html
<h2>Confirm your Hilm account</h2>
<p>Follow this link to verify your email:</p>
<p><a href="{{ .ConfirmationURL }}">Confirm my email</a></p>
```

`{{ .ConfirmationURL }}` redirects to your app’s `emailRedirectTo` (`/auth/callback?next=/onboarding`) when redirect URLs are allow-listed.

**Do not** hardcode `localhost:3000` or any fixed URL in the template.

## Optional OTP / token in email

If you customize the template to include a numeric code:

```html
<p>Your verification code: {{ .Token }}</p>
```

Hilm’s callback route also accepts Supabase `token_hash` / `token` query parameters and calls `verifyOtp`. Users can click the link **or** open a link that includes the token — there is no separate OTP entry screen today.

## Reset password

```html
<p><a href="{{ .ConfirmationURL }}">Reset password</a></p>
```

Redirect target is configured in code as `/auth/callback?next=/auth/reset-password`.

## Magic link

Same as confirm — use `{{ .ConfirmationURL }}`.

## Production checklist

1. **Site URL** = `https://hillm.netlify.app` (not localhost)
2. **Redirect URLs** include `/auth/callback**` and `/auth/confirm**`
3. **Custom SMTP** configured (default Supabase mailer is not production-grade)
4. **Confirm email** enabled if you require verification before login

Run locally:

```bash
npm run configure-auth
npm run audit-auth   # requires SUPABASE_ACCESS_TOKEN
```
