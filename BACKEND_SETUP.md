# Portfolio backend

The production site uses Firebase Authentication for Studio sign-in, Cloudflare Workers and D1 for the API and portfolio records, and Vercel Blob for image and model files. The frontend no longer loads or calls Supabase.

## Current setup

- Frontend provider: `cloudflare` in `backend-config.js`.
- Worker and D1 configuration: `cloudflare/wrangler.jsonc` and `cloudflare/`.
- Vercel Blob upload and delete routes: `api/`.
- Firebase browser adapter: `cloudflare-frontend.js`.
- Cloudflare API details and deployment instructions: `cloudflare/README.md`.
- Studio access: use an allowlisted Firebase email and verify it before signing in. The login form can resend the verification email after you enter your email and password.

The Worker URL and Firebase web-app configuration are public client settings. Keep Blob tokens, migration tokens, and Firebase service-account credentials out of source control.

## Migration and rollback

All 107 published project records, 11 disciplines, and editable text/settings content were imported into D1 and verified. Media transfer was skipped at the user's request, so image and model files must be uploaded manually through Studio; the imported records have no old Supabase media references. Until then, those portfolio visuals will be absent.

Production has been cut over to Cloudflare. The public Preview loaded the imported portfolio content and discipline filters, and the Studio sign-in dialog rendered. Firebase sign-in, Studio editing, media uploads, and deletion cleanup have not yet been end-to-end tested. Complete those checks and the manual uploads before considering the migration fully verified.

The Supabase project and `supabase/` SQL files are intentionally retained unchanged as a rollback source. Do not delete them until the Cloudflare deployment and manual media uploads are verified.
