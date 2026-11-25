# Supabase backend setup

The portfolio uses Supabase Auth for Studio sign-in, Postgres for project records, and Supabase Storage for cover images. The browser uses only the public publishable key; Row Level Security policies restrict mutations to an allowlisted admin.

## 1. Create a Supabase project

Create a Supabase project. In Project Settings > API, copy the Project URL and the publishable key. Never use a secret/service-role key in the website.

## 2. Create database, policies, bucket, and sample projects

Open SQL Editor in the Supabase Dashboard and run supabase/setup.sql. If the portfolio database was already set up, also run supabase/site-images.sql, supabase/disciplines.sql, supabase/sub-disciplines.sql, and supabase/visual-editor.sql once to add editable site images, persistent project disciplines and sub-disciplines, and saved visual editor text.

## 3. Create your Studio user

In Authentication > Users, add your own user and confirm its email. Then in SQL Editor run the final INSERT statement at the bottom of supabase/setup.sql, replacing you@example.com with your account email. Only users listed in portfolio_admins can manage projects or images. Public sign-up is not enabled.

## 4. Configure the site

Put your Project URL and publishable key in backend-config.js:

window.PORTFOLIO_BACKEND = {
  url: 'https://YOUR_PROJECT_REF.supabase.co',
  publishableKey: 'sb_publishable_...'
};

Never place a service-role or secret key in this file. The publishable key is browser-visible; the SQL policies protect the data.

## 5. Set the production URL

In Supabase Authentication > URL Configuration, set the Site URL to your Vercel site and add the Vercel URL to allowed redirect URLs.

Push the code and config to GitHub to deploy through Vercel. Then sign in with the account created above. Existing sample projects are seeded in the database; project additions, edits, removals, and images are shared by the live site.

## Notes

- Cover images are limited to 8 MB and JPEG, PNG, WebP, or GIF.
- Published project records and cover images are public; only the allowlisted admin can mutate them.
- Removing a project also deletes its stored cover image.
- The frontend does not use a service-role key.
