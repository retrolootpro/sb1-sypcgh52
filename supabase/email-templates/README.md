# RetroLootPro Supabase Auth Email Templates

Supabase Auth sends invitation emails from its hosted Auth service. The app can trigger and manage invites, but the live email branding is controlled in the Supabase dashboard.

## Team Invite Template

Use `team-invite.html` for the hosted Supabase **Invite user** email template.

Recommended subject:

```text
You're invited to RetroLootPro
```

Dashboard setup:

1. Open Supabase.
2. Go to **Authentication**.
3. Open **Email Templates**.
4. Select **Invite user**.
5. Set the subject to `You're invited to RetroLootPro`.
6. Paste the contents of `supabase/email-templates/team-invite.html`.
7. Save the template.

The template uses Supabase's built-in `{{ .ConfirmationURL }}` invite link and `{{ .Email }}` recipient variable.

## Sender Name And Email App Icon

To make the email appear as coming from RetroLootPro, configure Supabase Auth SMTP settings:

- Sender name: `RetroLootPro`
- Sender email: use a verified address on your domain, such as `support@retrolootpro.com`

The email body includes the hosted RetroLootPro logo from:

```text
https://retrolootpro.com/icons/retroloot-icon-192.png
```

Inbox icons in Apple Mail, Gmail, and similar clients are controlled by the sending domain and mail provider, not the HTML email itself. For best results, use a custom SMTP provider with a verified `retrolootpro.com` sender, SPF, DKIM, DMARC, and BIMI if your mail provider supports brand indicators.
