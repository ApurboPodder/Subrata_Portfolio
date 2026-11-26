# Cloudflare data backend with Vercel Blob

The production frontend uses Cloudflare Workers and D1 with Firebase Authentication and Vercel Blob media storage. Supabase is no longer used by the frontend and remains intact only as a rollback source.

## Components

- D1 schema and migrations: `migrations/`
- Worker REST API: `worker.js`
- Portfolio media: public Vercel Blob store
- Media upload/delete routes: root `api/` Vercel Functions
- Admin identity: Firebase Authentication email/password; the Worker verifies Firebase ID tokens and checks the D1 `portfolio_admins` email allowlist. The first successful login binds the Firebase UID so an approved admin can update their email without losing access.

Firebase is identity-only. Project records, disciplines, settings, and media metadata are stored in D1; image and model files are stored in Vercel Blob. Existing Supabase passwords cannot be exported; each admin must set a new password if Firebase is adopted. Firebase's public web configuration is not a secret; do not put service-account credentials in the frontend or Worker.

## API contract

Public Worker routes:

- `GET /api/projects` — published projects; an approved admin token includes drafts.
- `GET /api/disciplines`
- `GET /api/settings`
- `GET /api/projects/:id/media` — media metadata includes each public `blob_url`.

Admin Worker requests require `Authorization: Bearer <Firebase ID token>`:

- `GET /api/admin/me`
- `GET|POST /api/admin/projects`, `PATCH|DELETE /api/admin/projects/:id`
- `POST /api/admin/disciplines`, `PATCH|DELETE /api/admin/disciplines/:id`
- `PATCH /api/admin/settings`
- `POST /api/admin/media` registers an uploaded Blob URL in D1.
- `DELETE /api/admin/media?url=...` removes its D1 metadata.
- `DELETE /api/admin/projects/:id` returns removed media URLs; use the Vercel project route below for file cleanup.

Vercel media routes:

- `POST /api/media` — Vercel Blob client-upload token exchange and completion callback.
- `DELETE /api/media` with JSON `{ "url": "<public Blob URL>" }` — deletes the Blob and its D1 media metadata.
- `DELETE /api/project` with JSON `{ "projectId": "<id>" }` — deletes the D1 project, then its associated Blob files. A cleanup failure is returned explicitly because the project record will already be deleted.

The browser must upload through `@vercel/blob/client` with `access: "public"` and send a `clientPayload` containing the Firebase ID token, media kind, MIME type, and optional project ID:

```js
const blob = await upload(`${folder}/${file.name}`, file, {
  access: 'public',
  handleUploadUrl: '/api/media',
  clientPayload: JSON.stringify({
    firebaseIdToken,
    kind,
    contentType: file.type,
    projectId
  })
});
```

The Vercel route verifies Studio authorization through the Worker before issuing upload tokens. Images retain the existing 8 MiB limit and supported image types; GLB/glTF model files are limited to 100 MiB. The Vercel Blob SDK sends files directly from the browser, avoiding Vercel Functions' 4.5 MB request limit.

## Provisioning

1. Create a public Blob store from the Vercel project’s **Storage** tab. When connecting it, select **Add a read-write token env var to this connection**; `handleUpload` needs `BLOB_READ_WRITE_TOKEN` to issue client-upload tokens. Keep this value in Vercel environment settings, never in source control.
2. Set `CLOUDFLARE_API_URL` in the Vercel project’s Production and Preview environments to the deployed Worker HTTPS origin (for example, its `workers.dev` URL).
3. Configure `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGINS`, and the D1 database ID in `wrangler.jsonc`. The Worker requires no R2 bucket.
4. Configure the Firebase web app for the existing Vercel hostname and enable email/password sign-in. Add only explicitly approved email addresses to `portfolio_admins` in D1. Studio users must verify their Firebase email; the login form can resend the verification email after they enter their email and password.
5. Apply migrations and deploy the Worker and Vercel project. Keep the production and active Preview origins in `ALLOWED_ORIGINS` so browser API requests pass CORS checks.

Vercel Blob Hobby currently includes 1 GB storage, 10 GB monthly data transfer, 10,000 simple operations, and 2,000 advanced operations. Hobby usage does not incur overage charges, but Blob access can stop until 30 days have passed after a quota is exceeded. Review the current [Blob usage and pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing) before production use.

D1 migration `0001_initial.sql` has been applied and the Worker deployed. Two approved Studio email addresses are allowlisted in D1, and `CLOUDFLARE_API_URL` is configured in Vercel Production and Preview. The 107 published projects, 11 disciplines, and editable text/settings content were imported and verified. Production now uses the Cloudflare provider. Media transfer was skipped at the user's request, so images and models must be uploaded manually through Studio; old Supabase media references were cleared. Preview validation confirmed the public portfolio content, discipline filters, and Studio sign-in dialog render, but Firebase sign-in, Studio edits, uploads, and deletion cleanup are not yet end-to-end verified. Keep the Supabase project and `supabase/` SQL intact until those checks and uploads are complete. The existing `moved.html` and `vercel.json` files are unrelated and remain untouched.
