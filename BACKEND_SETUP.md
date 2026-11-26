# Portfolio backend

The Cloudflare cutover preview uses Firebase Authentication for Studio sign-in, Cloudflare Workers and D1 for the API and portfolio records, and Vercel Blob for image and model files. The production site remains on the existing backend until data transfer and preview verification are complete.

## Current setup

- Frontend provider: `cloudflare` in `backend-config.js`.
- Worker and D1 configuration: `cloudflare/wrangler.jsonc` and `cloudflare/`.
- Vercel Blob upload and delete routes: `api/`.
- Firebase browser adapter: `cloudflare-frontend.js`.
- Cloudflare API details and deployment instructions: `cloudflare/README.md`.

The Worker URL and Firebase web-app configuration are public client settings. Keep Blob tokens, migration tokens, and Firebase service-account credentials out of source control.

## Migration and rollback

The Supabase project and `supabase/` SQL files are retained as the source and rollback copy while the Cloudflare preview is being tested. Do not delete the Supabase project or its files as part of this migration. The one-time migration runner is `scripts/migrate-supabase-data.mjs`; it requires the existing Supabase public URL/key and temporary migration authorization, and it transfers portfolio records and media into D1 and Vercel Blob.

Do not switch production traffic until the imported record/media counts match the source and the public portfolio, Studio authentication, editing, uploads, and deletion flows pass on the Vercel Preview deployment.
