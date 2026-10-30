# Admin console

A private console for the Hilm owner: app activity, app-wide AI cost and AI switches, account
lock/unlock/termination, product emails (sent from `Hilm <noreply@hilm.tech>`), approved
networks and an audit log.

The hostname is not written anywhere in the repository. It lives only in the Netlify environment
variable `ADMIN_HOST` (Builds + Functions scope). It is covered by the existing `*.hilm.tech`
wildcard certificate, so it never appears in public certificate-transparency logs, and nothing
links to it.

## Access policy (enforced server-side in `netlify/functions/_shared/admin/guard.ts`)

1. Requests on any other host get a plain 404 (API) and the console page itself returns 404.
2. State-changing requests must carry `Origin: https://<ADMIN_HOST>` (no cross-site requests).
3. Supabase session with assurance level **aal2**: password + authenticator (TOTP) code. The
   authenticator is enrolled on first sign-in.
4. The user must be the single row in `private.admin_users` (a unique index allows only one row).
5. **Network lock:** the first password + TOTP sign-in registers its network (IPv4 /24, IPv6 /64).
   Any other network is refused, even with the right password and code. To add one, sign in from
   it and press "Email me an approval link"; the link (15 minutes, single use) must be opened from
   that same network.
6. Locking or deleting accounts, AI switches, removing networks and sending product emails also
   need an authenticator code from the last 10 minutes.
7. Every action and every refusal is written to `private.admin_audit_log` (append-only; updates
   and deletes are rejected by a trigger).

The session is kept in `sessionStorage` under its own key (closing the tab signs out), and the
console signs out after 15 minutes without interaction. All traffic is HTTPS with HSTS.

## Setup (done)

- Migration `supabase/migrations/0039_admin_portal.sql` applied.
- Admin row inserted for the owner account.
- `ADMIN_HOST` set in Netlify and added as a domain alias (Netlify DNS record created).

## Recovery

Run these with the service connection (they cannot be done through the console):

```sql
-- Locked out by the network lock (e.g. ISP change and no email access):
delete from private.admin_allowed_networks;      -- next MFA sign-in re-registers its network

-- Change the admin account:
delete from private.admin_users;
insert into private.admin_users (user_id) select id from auth.users where lower(email) = 'new@owner.tld';
```

Lost authenticator: remove the factor in Supabase Dashboard → Authentication → Users → the admin
user → MFA factors, then sign in again to enroll a new one.
