# PaServe security email templates

## Password changed

Subject: **Your PaServe password was changed**

Open Supabase Authentication > Emails > Security > Password changed.
Paste the complete contents of password-changed.html into the template source, preview it, then save.

The template uses the PaServe cream (#f5f3ec), espresso (#243329), lime (#c9ef83), surface, border and muted colors from apps/web/src/theme.css. Typography uses Georgia for the display heading and Arial/system fallbacks for email body copy. It uses inline presentation tables, a hidden preheader, responsive gutters and a 48px sign-in action with an Outlook fallback. No remote images, downloaded fonts or JavaScript are required.

Supported template placeholders:
- {{ .Email }}: the account email.
- {{ .SiteURL }}: the configured application URL. Set Supabase Authentication URL Configuration / Site URL to the frontend origin without a trailing slash or path, so the sign-in action resolves to /login. Use the deployed HTTPS origin for production.

This is a design artifact. It does not change the sending configuration, publish the template to Supabase, or connect NestJS password updates to Supabase's password-change notification trigger.

Basic HTML/placeholder checks were run locally. Interactive browser and actual Gmail/Outlook/mobile inbox rendering were not verified in this session.


## Email verification / email-address change codes

Subject: **Your PaServe verification code**

Template: email-verification.html

For PaServe's current implementation, paste this design into **Authentication > Magic link or OTP**. Also use the same neutral design in **Confirm sign up**, which covers first-time verification requests for an address that is new to Supabase. Both templates expose {{ .Token }}.

PaServe currently requests these emails with IdentityService.sendCode / signInWithOtp. The current-inbox approval and new-inbox verification use that same method. The Supabase **Change email address** template is for native Supabase Auth email updates; editing it alone does not change the messages sent by this PaServe flow.

The design deliberately works for registration and email changes: it displays a code rather than a sign-in link, uses neutral account-request wording, and explains the two-inbox approval requirement for email changes. It uses {{ .Email }} and {{ .Token }}, with no hard-coded account address, code, expiry duration, or remote image.

Paste the complete HTML into the template Source field, set the subject above, preview and save. Existing SMTP settings remain unchanged. This repository change does not publish dashboard templates automatically.

Basic nesting, variable and branding checks passed. Actual inbox rendering remains unverified.

## Icon rendering

Decorative symbol badges and text arrows have been removed from these templates so their appearance does not depend on iOS emoji fonts. The app keeps its existing SVG icons for functional controls.

## Forgot password / recovery

Subject: **Reset your PaServe password**

Paste `reset-password.html` into **Authentication > Emails > Reset password**, preview and save. This template must expose `{{ .Token }}`: PaServe accepts the recovery code in its form, rather than a Supabase session link. It uses the existing Supabase custom SMTP (Brevo); no Brevo API key is needed. The API calls `resetPasswordForEmail` and verifies `type: recovery`, then changes the PaServe Argon2 password and revokes PaServe sessions. Supabase is the recovery-email verifier; PaServe remains the sign-in credential store. Native Supabase password-changed emails are not automatically triggered by the local credential update. Dashboard templates are not published by this repository edit.

The recovery design matches `email-verification.html`: identical cream outer canvas, espresso/lime header, Georgia display heading, recipient panel, dark code panel, security divider and branded footer. Only the subject, preheader and operation-specific wording differ. The password stays unchanged until the reset is completed. Publish only `reset-password.html`, keeping the literal `{{ .Token }}` and `{{ .Email }}` placeholders. The recommended subject is **Reset your PaServe password**.
