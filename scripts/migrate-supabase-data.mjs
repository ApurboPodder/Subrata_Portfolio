import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { upload } from '@vercel/blob/client';

const STORAGE_BUCKET = 'portfolio-projects';
const STORYBOOK_PREFIX = '__STORYBOOK_GALLERY_V1__:';
const MIGRATION_STATE_PATH = process.env.MIGRATION_STATE_PATH || join(tmpdir(), 'subrata-portfolio-migration.json');
const MIGRATION_TOKEN = process.env.PORTFOLIO_MIGRATION_TOKEN;
const UPLOAD_ORIGIN = process.env.MIGRATION_UPLOAD_ORIGIN;

function requiredEnvironment(name, value) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Public Supabase configuration is missing.');
  return { url: new URL(url).origin, key };
}

async function supabaseRequest(config, path, init = {}) {
  const response = await fetch(new URL(path, `${config.url}/`), {
    ...init,
    headers: {
      apikey: config.key,
      authorization: `Bearer ${config.key}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers
    }
  });
  if (!response.ok) throw new Error(`Supabase request failed (${response.status}): ${path}`);
  return response.json();
}

async function getSourceData(config) {
  const [projects, disciplines, settings] = await Promise.all([
    supabaseRequest(config, '/rest/v1/projects?select=*&order=sort_order.asc,created_at.asc'),
    supabaseRequest(config, '/rest/v1/portfolio_disciplines?select=*&order=sort_order.asc,name.asc'),
    supabaseRequest(config, '/rest/v1/portfolio_settings?select=*')
  ]);
  if (settings.length !== 1) throw new Error(`Expected one settings row; received ${settings.length}.`);

  const objects = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await supabaseRequest(config, `/storage/v1/object/list/${STORAGE_BUCKET}`, {
      method: 'POST',
      body: JSON.stringify({ prefix: '', limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    });
    objects.push(...page);
    if (page.length < 1000) break;
  }
  return { projects, disciplines, settings: settings[0], objects };
}

function getTargetPath(sourcePath) {
  const pairKey = sourcePath
    .replace(/-original\.[^.]+$/i, '')
    .replace(/-preview\.webp$/i, '');
  const digest = createHash('sha256').update(pairKey).digest('hex').slice(0, 24);
  const filename = basename(sourcePath).replace(/[^A-Za-z0-9._-]/g, '_').slice(-100);
  return `supabase-migration/${digest}/${filename || 'image'}`;
}

function getPublicStorageUrl(config, sourcePath) {
  const path = sourcePath.split('/').map(encodeURIComponent).join('/');
  return new URL(`/storage/v1/object/public/${STORAGE_BUCKET}/${path}`, config.url);
}

async function loadState() {
  try {
    return JSON.parse(await readFile(MIGRATION_STATE_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { uploads: {} };
    throw error;
  }
}

let writeQueue = Promise.resolve();
function saveState(state) {
  writeQueue = writeQueue.then(() => writeFile(MIGRATION_STATE_PATH, JSON.stringify(state), 'utf8'));
  return writeQueue;
}

async function uploadMedia(config, objects, state) {
  const apiUrl = new URL('/api/media', requiredEnvironment('MIGRATION_UPLOAD_ORIGIN', UPLOAD_ORIGIN));
  if (!['https:', 'http:'].includes(apiUrl.protocol)) throw new Error('Migration upload URL must be HTTP or HTTPS.');
  const pending = objects.filter(item => !state.uploads[item.name]);
  let next = 0;
  let completed = 0;
  const workers = Array.from({ length: 3 }, async () => {
    while (true) {
      const index = next++;
      if (index >= pending.length) return;
      const object = pending[index];
      const contentType = String(object.metadata?.mimetype || '').split(';')[0].trim().toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)) {
        throw new Error(`Unsupported media type for storage object ${object.name}.`);
      }

      const response = await fetch(getPublicStorageUrl(config, object.name));
      if (!response.ok) throw new Error(`Could not download a storage object (${response.status}).`);
      const bytes = await response.arrayBuffer();
      if (object.metadata?.size && bytes.byteLength !== Number(object.metadata.size)) {
        throw new Error(`Downloaded media size does not match storage metadata for ${object.name}.`);
      }

      const filename = basename(object.name).replace(/[^A-Za-z0-9._-]/g, '_').slice(-100) || 'image';
      const file = new File([bytes], filename, { type: contentType });
      const blob = await upload(getTargetPath(object.name), file, {
        access: 'public',
        contentType,
        handleUploadUrl: apiUrl.toString(),
        clientPayload: JSON.stringify({
          migrationToken: requiredEnvironment('PORTFOLIO_MIGRATION_TOKEN', MIGRATION_TOKEN),
          kind: 'image',
          contentType
        })
      });
      state.uploads[object.name] = blob.url;
      completed += 1;
      await saveState(state);
      if (completed % 10 === 0 || completed === pending.length) {
        console.log(`Uploaded ${completed}/${pending.length} remaining media objects.`);
      }
    }
  });
  await Promise.all(workers);
}

function mapPath(path, state) {
  if (path === null || path === undefined) return null;
  const url = state.uploads[path];
  if (!url) throw new Error(`A referenced storage object was not uploaded: ${path}`);
  return url;
}

function makeImportPayload(data, state) {
  const projects = data.projects.map(project => {
    let description = project.description || '';
    if (description.startsWith(STORYBOOK_PREFIX)) {
      const gallery = JSON.parse(description.slice(STORYBOOK_PREFIX.length));
      if (!Array.isArray(gallery.paths)) throw new Error(`Invalid storybook gallery data for project ${project.id}.`);
      description = STORYBOOK_PREFIX + JSON.stringify({
        ...gallery,
        paths: gallery.paths.map(path => mapPath(path, state))
      });
    }
    return {
      ...project,
      description,
      cover_path: mapPath(project.cover_path, state),
      is_featured: project.is_featured ?? false
    };
  });
  const settings = {
    ...data.settings,
    id: 1,
    portrait_path: mapPath(data.settings.portrait_path, state),
    hero_cover_path: mapPath(data.settings.hero_cover_path, state),
    site_content: data.settings.site_content || {}
  };
  const disciplineRows = data.disciplines.map(discipline => ({
    ...discipline,
    parent_id: discipline.parent_id || null
  }));
  return { projects, disciplines: disciplineRows, settings };
}

async function importD1(data, state) {
  const workerUrl = new URL(requiredEnvironment('CLOUDFLARE_API_URL', process.env.CLOUDFLARE_API_URL));
  const response = await fetch(new URL('/api/migration/import', workerUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${requiredEnvironment('PORTFOLIO_MIGRATION_TOKEN', MIGRATION_TOKEN)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(makeImportPayload(data, state))
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `D1 migration failed (${response.status}).`);
  return result.imported;
}

async function main() {
  const config = parseSupabaseConfig();
  const data = await getSourceData(config);
  const state = await loadState();
  const referenced = new Set();
  for (const project of data.projects) {
    if (project.cover_path) referenced.add(project.cover_path);
    if (project.description?.startsWith(STORYBOOK_PREFIX)) {
      const gallery = JSON.parse(project.description.slice(STORYBOOK_PREFIX.length));
      for (const path of gallery.paths || []) referenced.add(path);
    }
  }
  for (const path of [data.settings.portrait_path, data.settings.hero_cover_path]) {
    if (path) referenced.add(path);
  }
  for (const path of referenced) {
    if (!data.objects.some(object => object.name === path)) {
      throw new Error(`Referenced source media is missing from Supabase Storage: ${path}`);
    }
  }

  console.log(`Source: ${data.projects.length} projects, ${data.disciplines.length} disciplines, ${data.objects.length} media objects (${referenced.size} referenced).`);
  if (process.env.MIGRATION_DRY_RUN === '1') {
    console.log('Dry run complete; no media was uploaded and D1 was not changed.');
    return;
  }
  requiredEnvironment('CLOUDFLARE_API_URL', process.env.CLOUDFLARE_API_URL);
  requiredEnvironment('PORTFOLIO_MIGRATION_TOKEN', MIGRATION_TOKEN);
  requiredEnvironment('MIGRATION_UPLOAD_ORIGIN', UPLOAD_ORIGIN);
  await uploadMedia(config, data.objects, state);
  const imported = await importD1(data, state);
  console.log(`D1 import complete: ${imported.projects} projects, ${imported.disciplines} disciplines, ${imported.settings} settings row.`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
