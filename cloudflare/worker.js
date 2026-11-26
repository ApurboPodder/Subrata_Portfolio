const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MODEL_TYPES = new Set(['model/gltf-binary', 'model/gltf+json']);
const PROJECT_COLUMNS = new Set([
  'title', 'slug', 'category', 'year', 'description', 'art_key',
  'cover_path', 'is_published', 'sort_order', 'is_featured'
]);
const DISCIPLINE_COLUMNS = new Set(['name', 'parent_id', 'sort_order', 'is_visible']);

let firebaseKeys;
let firebaseKeysExpireAt = 0;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

function fail(status, message) {
  throw new HttpError(status, message);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function getFirebaseKeys(forceRefresh = false) {
  if (!forceRefresh && firebaseKeys && Date.now() < firebaseKeysExpireAt) {
    return firebaseKeys;
  }

  const response = await fetch(FIREBASE_JWKS_URL);
  if (!response.ok) {
    throw new HttpError(503, 'Could not verify the sign-in token.');
  }

  const body = await response.json();
  if (!Array.isArray(body.keys)) {
    throw new HttpError(503, 'The sign-in key service returned an invalid response.');
  }

  const maxAge = Number((response.headers.get('cache-control') || '').match(/max-age=(\d+)/i)?.[1]) || 3600;
  firebaseKeys = body.keys;
  firebaseKeysExpireAt = Date.now() + maxAge * 1000;
  return firebaseKeys;
}

async function verifyFirebaseToken(token, projectId) {
  const parts = token.split('.');
  if (parts.length !== 3 || !projectId || projectId === 'SET_FIREBASE_PROJECT_ID') {
    fail(401, 'A valid sign-in token is required.');
  }

  let header;
  let claims;
  try {
    header = decodeJwtPart(parts[0]);
    claims = decodeJwtPart(parts[1]);
  } catch {
    fail(401, 'The sign-in token is invalid.');
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    fail(401, 'The sign-in token uses an unsupported signature.');
  }

  let key = (await getFirebaseKeys()).find(candidate => candidate.kid === header.kid);
  if (!key) {
    key = (await getFirebaseKeys(true)).find(candidate => candidate.kid === header.kid);
  }
  if (!key) {
    fail(401, 'The sign-in token key is not recognized.');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    key,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const validSignature = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(parts.slice(0, 2).join('.'))
  );

  const now = Math.floor(Date.now() / 1000);
  if (
    !validSignature ||
    claims.aud !== projectId ||
    claims.iss !== `https://securetoken.google.com/${projectId}` ||
    typeof claims.sub !== 'string' ||
    !claims.sub ||
    typeof claims.exp !== 'number' ||
    claims.exp <= now ||
    typeof claims.iat !== 'number' ||
    claims.iat > now + 60 ||
    claims.iat < now - 60 * 60 ||
    typeof claims.auth_time !== 'number' ||
    claims.auth_time > now + 60 ||
    claims.auth_time < now - 8 * 60 * 60 ||
    typeof claims.email !== 'string' ||
    claims.email_verified !== true
  ) {
    fail(401, 'The sign-in token is invalid or expired.');
  }

  return claims;
}

async function identityFor(request, env) {
  const authorization = request.headers.get('authorization');
  if (!authorization) return null;

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) fail(401, 'A valid bearer token is required.');

  const claims = await verifyFirebaseToken(match[1], env.FIREBASE_PROJECT_ID);
  const admin = await env.DB.prepare(
    'SELECT email, firebase_uid FROM portfolio_admins WHERE email = ? COLLATE NOCASE OR firebase_uid = ? LIMIT 1'
  ).bind(claims.email, claims.sub).first();
  if (admin && !admin.firebase_uid) {
    await env.DB.prepare(
      'UPDATE portfolio_admins SET firebase_uid = ? WHERE email = ? COLLATE NOCASE AND firebase_uid IS NULL'
    ).bind(claims.sub, admin.email).run();
  }

  return { uid: claims.sub, email: claims.email, isAdmin: Boolean(admin) };
}

function requireAdmin(identity) {
  if (!identity) fail(401, 'Sign in to manage the portfolio.');
  if (!identity.isAdmin) fail(403, 'This account is not approved for Studio access.');
  return identity;
}

function normalizeProject(row) {
  if (!row) return row;
  return {
    ...row,
    is_published: Boolean(row.is_published),
    is_featured: Boolean(row.is_featured)
  };
}

function normalizeDiscipline(row) {
  if (!row) return row;
  return { ...row, is_visible: Boolean(row.is_visible) };
}

function normalizeSettings(row) {
  if (!row) return row;
  let siteContent;
  try {
    siteContent = JSON.parse(row.site_content);
  } catch {
    fail(500, 'Saved visual editor content is not valid JSON.');
  }
  if (!siteContent || typeof siteContent !== 'object' || Array.isArray(siteContent)) {
    fail(500, 'Saved visual editor content has an invalid format.');
  }
  return {
    ...row,
    show_all_work: Boolean(row.show_all_work),
    site_content: siteContent
  };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    fail(400, 'Request body must be valid JSON.');
  }
}

function validateId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    fail(400, 'Invalid record ID.');
  }
  return value;
}

function validateSlug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 120) {
    fail(400, 'Slug must contain lowercase letters, numbers, and single hyphens.');
  }
  return value;
}

function validateProject(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Project data is required.');
  const data = {};
  for (const [key, value] of Object.entries(input)) {
    if (!PROJECT_COLUMNS.has(key)) fail(400, `Unsupported project field: ${key}.`);
    if (['is_published', 'is_featured'].includes(key)) {
      if (typeof value !== 'boolean') fail(400, `${key} must be a boolean.`);
      data[key] = Number(value);
    } else if (key === 'sort_order' || key === 'year') {
      if (!Number.isInteger(value)) fail(400, `${key} must be an integer.`);
      data[key] = value;
    } else if (['art_key', 'cover_path'].includes(key)) {
      if (value !== null && typeof value !== 'string') fail(400, `${key} must be text or null.`);
      data[key] = key === 'cover_path' && value !== null ? validateBlobUrl(value) : value;
    } else if (typeof value !== 'string') {
      fail(400, `${key} must be text.`);
    } else {
      data[key] = value;
    }
  }

  if (!partial || 'title' in data) {
    if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 120) {
      fail(400, 'Project title must be between 1 and 120 characters.');
    }
    data.title = data.title.trim();
  }
  if (!partial || 'slug' in data) data.slug = validateSlug(data.slug);
  if (!partial || 'category' in data) {
    if (typeof data.category !== 'string' || !data.category.trim() || data.category.length > 80) {
      fail(400, 'Project category is required.');
    }
    data.category = data.category.trim();
  }
  if (!partial || 'year' in data) {
    if (!Number.isInteger(data.year) || data.year < 1900 || data.year > 2200) {
      fail(400, 'Project year must be between 1900 and 2200.');
    }
  }
  if (!partial && !('description' in data)) data.description = '';
  if (!partial && !('sort_order' in data)) data.sort_order = 0;
  if (!partial && !('is_published' in data)) data.is_published = 1;
  if (!partial && !('is_featured' in data)) data.is_featured = 0;
  return data;
}

function migrationTokenMatches(request, env) {
  const expected = env.PORTFOLIO_MIGRATION_TOKEN;
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  if (!expected || !match || match[1].length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= match[1].charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

function requireMigrationToken(request, env) {
  if (!migrationTokenMatches(request, env)) fail(401, 'A valid migration token is required.');
}

function validateMigrationTimestamp(value, field) {
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) {
    fail(400, `${field} must be a valid timestamp.`);
  }
  return value;
}

async function importPortfolio(request, env) {
  const input = await readJson(request);
  if (
    !input ||
    !Array.isArray(input.projects) ||
    !Array.isArray(input.disciplines) ||
    !input.settings ||
    typeof input.settings !== 'object' ||
    input.projects.length > 1000 ||
    input.disciplines.length > 200
  ) {
    fail(400, 'The migration payload is incomplete or too large.');
  }

  const current = await env.DB.prepare(
    'SELECT (SELECT COUNT(*) FROM projects) AS projects, (SELECT COUNT(*) FROM portfolio_disciplines) AS disciplines'
  ).first();
  if (current.projects || current.disciplines) {
    fail(409, 'Portfolio data can only be imported into an empty D1 database.');
  }

  const projectIds = new Set();
  const slugs = new Set();
  const projects = input.projects.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail(400, 'Invalid project in migration payload.');
    const allowed = new Set([...PROJECT_COLUMNS, 'id', 'created_at', 'updated_at']);
    if (Object.keys(row).some(key => !allowed.has(key))) fail(400, 'Unsupported project field in migration payload.');
    const id = validateId(row.id);
    if (projectIds.has(id)) fail(400, 'Duplicate project ID in migration payload.');
    projectIds.add(id);
    const project = validateProject({
      slug: row.slug,
      title: row.title,
      category: row.category,
      year: row.year,
      description: row.description,
      art_key: row.art_key ?? null,
      cover_path: row.cover_path ?? null,
      is_published: row.is_published,
      sort_order: row.sort_order,
      is_featured: row.is_featured ?? false
    });
    if (slugs.has(project.slug)) fail(400, 'Duplicate project slug in migration payload.');
    slugs.add(project.slug);
    return {
      ...project,
      id,
      created_at: validateMigrationTimestamp(row.created_at, 'Project created_at'),
      updated_at: validateMigrationTimestamp(row.updated_at, 'Project updated_at')
    };
  });

  const disciplineIds = new Set();
  const disciplineNames = new Set();
  const disciplines = input.disciplines.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail(400, 'Invalid discipline in migration payload.');
    const allowed = new Set([...DISCIPLINE_COLUMNS, 'id', 'created_at']);
    if (Object.keys(row).some(key => !allowed.has(key))) fail(400, 'Unsupported discipline field in migration payload.');
    const id = validateId(row.id);
    if (disciplineIds.has(id)) fail(400, 'Duplicate discipline ID in migration payload.');
    disciplineIds.add(id);
    const discipline = validateDiscipline({
      name: row.name,
      parent_id: row.parent_id ?? null,
      sort_order: row.sort_order,
      is_visible: row.is_visible
    });
    const normalizedName = discipline.name.toLowerCase();
    if (disciplineNames.has(normalizedName)) fail(400, 'Duplicate discipline name in migration payload.');
    disciplineNames.add(normalizedName);
    return {
      ...discipline,
      id,
      created_at: validateMigrationTimestamp(row.created_at, 'Discipline created_at')
    };
  });
  for (const discipline of disciplines) {
    if (discipline.parent_id && !disciplineIds.has(discipline.parent_id)) {
      fail(400, 'A discipline parent is missing from the migration payload.');
    }
    if (discipline.parent_id === discipline.id) fail(400, 'A discipline cannot be its own parent.');
  }

  const settings = input.settings;
  const portraitPath = settings.portrait_path === null ? null : validateBlobUrl(settings.portrait_path);
  const heroCoverPath = settings.hero_cover_path === null ? null : validateBlobUrl(settings.hero_cover_path);
  if (typeof settings.show_all_work !== 'boolean') fail(400, 'show_all_work must be a boolean.');
  if (!settings.site_content || typeof settings.site_content !== 'object' || Array.isArray(settings.site_content)) {
    fail(400, 'site_content must be an object.');
  }
  const settingsUpdatedAt = validateMigrationTimestamp(settings.updated_at, 'Settings updated_at');

  const statements = [];
  for (const discipline of disciplines.sort((left, right) => Number(Boolean(left.parent_id)) - Number(Boolean(right.parent_id)))) {
    statements.push(env.DB.prepare(
      'INSERT INTO portfolio_disciplines (id, name, parent_id, sort_order, is_visible, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id, sort_order = excluded.sort_order, is_visible = excluded.is_visible, created_at = excluded.created_at'
    ).bind(
      discipline.id,
      discipline.name,
      discipline.parent_id,
      discipline.sort_order,
      discipline.is_visible,
      discipline.created_at
    ));
  }
  for (const project of projects) {
    statements.push(env.DB.prepare(
      'INSERT INTO projects (id, slug, title, category, year, description, art_key, cover_path, is_published, sort_order, is_featured, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, title = excluded.title, category = excluded.category, year = excluded.year, description = excluded.description, art_key = excluded.art_key, cover_path = excluded.cover_path, is_published = excluded.is_published, sort_order = excluded.sort_order, is_featured = excluded.is_featured, created_at = excluded.created_at, updated_at = excluded.updated_at'
    ).bind(
      project.id,
      project.slug,
      project.title,
      project.category,
      project.year,
      project.description,
      project.art_key,
      project.cover_path,
      project.is_published,
      project.sort_order,
      project.is_featured,
      project.created_at,
      project.updated_at
    ));
  }
  statements.push(env.DB.prepare(
    'UPDATE portfolio_settings SET portrait_path = ?, hero_cover_path = ?, show_all_work = ?, site_content = ?, updated_at = ? WHERE id = 1'
  ).bind(
    portraitPath,
    heroCoverPath,
    Number(settings.show_all_work),
    JSON.stringify(settings.site_content),
    settingsUpdatedAt
  ));
  await env.DB.batch(statements);

  return json({ imported: { projects: projects.length, disciplines: disciplines.length, settings: 1 } });
}

function validateDiscipline(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Discipline data is required.');
  const data = {};
  for (const [key, value] of Object.entries(input)) {
    if (!DISCIPLINE_COLUMNS.has(key)) fail(400, `Unsupported discipline field: ${key}.`);
    if (key === 'is_visible') {
      if (typeof value !== 'boolean') fail(400, 'is_visible must be a boolean.');
      data[key] = Number(value);
    } else if (key === 'sort_order') {
      if (!Number.isInteger(value)) fail(400, 'sort_order must be an integer.');
      data[key] = value;
    } else if (key === 'parent_id') {
      if (value !== null && typeof value !== 'string') fail(400, 'parent_id must be text or null.');
      data[key] = value;
    } else if (typeof value === 'string') {
      data[key] = value.trim();
    } else {
      fail(400, `${key} must be text.`);
    }
  }
  if (!partial || 'name' in data) {
    if (typeof data.name !== 'string' || !data.name || data.name.length > 40) {
      fail(400, 'Discipline name must be between 1 and 40 characters.');
    }
  }
  if (!partial && !('sort_order' in data)) data.sort_order = 0;
  if (!partial && !('is_visible' in data)) data.is_visible = 1;
  return data;
}

async function updateRecord(db, table, id, data) {
  const fields = Object.keys(data);
  if (!fields.length) fail(400, 'No supported fields were provided.');
  const assignments = fields.map(field => `${field} = ?`).join(', ');
  await db.prepare(
    `UPDATE ${table} SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(...fields.map(field => data[field]), id).run();
}

function isConstraintError(error) {
  return /unique constraint|foreign key constraint|check constraint/i.test(String(error?.message || ''));
}

function validateBlobUrl(value) {
  let blobUrl;
  try {
    if (typeof value !== 'string') fail(400, 'Invalid Vercel Blob URL.');
    blobUrl = new URL(value);
  } catch {
    fail(400, 'Invalid Vercel Blob URL.');
  }
  if (
    blobUrl.protocol !== 'https:' ||
    !blobUrl.hostname.endsWith('.public.blob.vercel-storage.com') ||
    blobUrl.port ||
    blobUrl.username ||
    blobUrl.password ||
    blobUrl.pathname === '/' ||
    blobUrl.search ||
    blobUrl.hash
  ) {
    fail(400, 'Invalid Vercel Blob URL.');
  }
  return blobUrl.toString();
}

async function registerMedia(request, env) {
  const data = await readJson(request);
  const blobUrl = validateBlobUrl(data?.url);
  const kind = data?.kind;
  const contentType = typeof data?.contentType === 'string'
    ? data.contentType.split(';')[0].trim().toLowerCase()
    : '';
  if (kind !== 'model' && kind !== 'image') fail(400, 'Unsupported media kind.');
  if (kind === 'model' ? !MODEL_TYPES.has(contentType) : !IMAGE_TYPES.has(contentType)) {
    fail(415, 'This file type is not supported.');
  }

  const projectId = data.projectId || null;
  if (kind === 'model' && !projectId) fail(400, 'A project ID is required for a model upload.');
  if (projectId) validateId(projectId);
  if (projectId && !(await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first())) {
    fail(404, 'Project not found.');
  }

  if (projectId) {
    await env.DB.prepare(
      'INSERT INTO project_media (id, project_id, kind, blob_url, mime_type) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), projectId, kind === 'model' ? 'model' : 'gallery', blobUrl, contentType).run();
  }

  return json({ url: blobUrl, contentType }, 201);
}

async function deleteMedia(env, url) {
  const blobUrl = validateBlobUrl(url.searchParams.get('url'));
  await env.DB.prepare('DELETE FROM project_media WHERE blob_url = ?').bind(blobUrl).run();
  return json({ deleted: true });
}

async function listProjects(env, isAdmin) {
  const query = isAdmin
    ? 'SELECT * FROM projects ORDER BY sort_order ASC, created_at ASC'
    : 'SELECT * FROM projects WHERE is_published = 1 ORDER BY sort_order ASC, created_at ASC';
  const { results } = await env.DB.prepare(query).all();
  return results.map(normalizeProject);
}

async function listDisciplines(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, parent_id, sort_order, is_visible, created_at FROM portfolio_disciplines ORDER BY sort_order ASC, name COLLATE NOCASE ASC'
  ).all();
  return results.map(normalizeDiscipline);
}

async function getProjectMedia(env, projectId) {
  const { results } = await env.DB.prepare(
    'SELECT id, project_id, kind, blob_url, mime_type, sort_order, created_at FROM project_media WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).bind(projectId).all();
  return results;
}

async function deleteProject(env, projectId) {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first();
  if (!project) fail(404, 'Project not found.');

  const media = await getProjectMedia(env, projectId);
  const blobUrls = new Set(media.map(item => item.blob_url));
  if (project.cover_path) blobUrls.add(project.cover_path);
  const prefix = '__STORYBOOK_GALLERY_V1__:';
  if (typeof project.description === 'string' && project.description.startsWith(prefix)) {
    const gallery = parseJson(project.description.slice(prefix.length), {});
    if (Array.isArray(gallery.paths)) gallery.paths.forEach(path => typeof path === 'string' && blobUrls.add(path));
  }
  await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(projectId).run();
  return json({ deleted: true, mediaUrls: [...blobUrls] });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return new Response(null, { status: 204 });
  if (path === '/api/migration/verify' && method === 'POST') {
    requireMigrationToken(request, env);
    return json({ authorized: true });
  }
  if (path === '/api/migration/import' && method === 'POST') {
    requireMigrationToken(request, env);
    return importPortfolio(request, env);
  }

  const identity = await identityFor(request, env);
  const isAdmin = Boolean(identity?.isAdmin);

  if (path === '/api/projects' && method === 'GET') {
    return json(await listProjects(env, isAdmin));
  }
  if (path === '/api/disciplines' && method === 'GET') {
    return json(await listDisciplines(env));
  }
  if (path === '/api/settings' && method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM portfolio_settings WHERE id = 1').first();
    return json(normalizeSettings(row));
  }
  const mediaMatch = path.match(/^\/api\/projects\/([A-Za-z0-9_-]{1,128})\/media$/);
  if (mediaMatch && method === 'GET') {
    const projectId = validateId(mediaMatch[1]);
    const project = await env.DB.prepare('SELECT is_published FROM projects WHERE id = ?').bind(projectId).first();
    if (!project) fail(404, 'Project not found.');
    if (!project.is_published && !isAdmin) fail(404, 'Project not found.');
    return json(await getProjectMedia(env, projectId));
  }

  if (!path.startsWith('/api/admin/')) fail(404, 'Route not found.');
  requireAdmin(identity);

  if (path === '/api/admin/me' && method === 'GET') {
    return json({ id: identity.uid, email: identity.email });
  }
  if (path === '/api/admin/projects' && method === 'GET') {
    return json(await listProjects(env, true));
  }
  if (path === '/api/admin/projects' && method === 'POST') {
    const data = validateProject(await readJson(request));
    const id = crypto.randomUUID();
    const result = await env.DB.prepare(
      'INSERT INTO projects (id, slug, title, category, year, description, art_key, cover_path, is_published, sort_order, is_featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id, data.slug, data.title, data.category, data.year, data.description,
      data.art_key || null, data.cover_path || null, data.is_published, data.sort_order, data.is_featured
    ).run();
    if (!result.success) fail(500, 'Could not save the project.');
    const created = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
    return json(normalizeProject(created), 201);
  }
  const projectMatch = path.match(/^\/api\/admin\/projects\/([A-Za-z0-9_-]{1,128})$/);
  if (projectMatch) {
    const projectId = validateId(projectMatch[1]);
    if (method === 'PATCH') {
      const data = validateProject(await readJson(request), true);
      await updateRecord(env.DB, 'projects', projectId, data);
      const updated = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first();
      if (!updated) fail(404, 'Project not found.');
      return json(normalizeProject(updated));
    }
    if (method === 'DELETE') return deleteProject(env, projectId);
  }

  if (path === '/api/admin/disciplines' && method === 'POST') {
    const data = validateDiscipline(await readJson(request));
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO portfolio_disciplines (id, name, parent_id, sort_order, is_visible) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, data.name, data.parent_id || null, data.sort_order, data.is_visible).run();
    const created = await env.DB.prepare('SELECT * FROM portfolio_disciplines WHERE id = ?').bind(id).first();
    return json(normalizeDiscipline(created), 201);
  }
  const disciplineMatch = path.match(/^\/api\/admin\/disciplines\/([A-Za-z0-9_-]{1,128})$/);
  if (disciplineMatch) {
    const id = validateId(disciplineMatch[1]);
    if (method === 'PATCH') {
      const data = validateDiscipline(await readJson(request), true);
      const fields = Object.keys(data);
      if (!fields.length) fail(400, 'No supported fields were provided.');
      if (data.parent_id) {
        const cycle = data.parent_id === id
          ? true
          : Boolean(await env.DB.prepare(
            'WITH RECURSIVE descendants(id) AS (SELECT id FROM portfolio_disciplines WHERE parent_id = ? UNION ALL SELECT d.id FROM portfolio_disciplines d JOIN descendants x ON d.parent_id = x.id) SELECT id FROM descendants WHERE id = ? LIMIT 1'
          ).bind(id, data.parent_id).first());
        if (cycle) fail(409, 'A discipline cannot be nested beneath itself or one of its sub-disciplines.');
      }
      const assignments = fields.map(field => `${field} = ?`).join(', ');
      await env.DB.prepare(
        `UPDATE portfolio_disciplines SET ${assignments} WHERE id = ?`
      ).bind(...fields.map(field => data[field]), id).run();
      const updated = await env.DB.prepare('SELECT * FROM portfolio_disciplines WHERE id = ?').bind(id).first();
      if (!updated) fail(404, 'Discipline not found.');
      return json(normalizeDiscipline(updated));
    }
    if (method === 'DELETE') {
      const discipline = await env.DB.prepare('SELECT id, name, parent_id FROM portfolio_disciplines WHERE id = ?').bind(id).first();
      if (!discipline) fail(404, 'Discipline not found.');
      const child = await env.DB.prepare('SELECT id FROM portfolio_disciplines WHERE parent_id = ? LIMIT 1').bind(id).first();
      if (child) fail(409, 'Delete sub-disciplines before deleting this discipline.');
      const project = await env.DB.prepare('SELECT id FROM projects WHERE category = ? LIMIT 1').bind(discipline.name).first();
      if (project) fail(409, 'Move projects to another category before deleting this discipline.');
      await env.DB.prepare('DELETE FROM portfolio_disciplines WHERE id = ?').bind(id).run();
      return json({ deleted: true });
    }
  }

  if (path === '/api/admin/settings' && method === 'PATCH') {
    const input = await readJson(request);
    const allowed = new Set(['portrait_path', 'hero_cover_path', 'show_all_work', 'site_content']);
    const data = {};
    for (const [key, value] of Object.entries(input || {})) {
      if (!allowed.has(key)) fail(400, `Unsupported settings field: ${key}.`);
      if (key === 'show_all_work') {
        if (typeof value !== 'boolean') fail(400, 'show_all_work must be a boolean.');
        data[key] = Number(value);
      } else if (key === 'site_content') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'site_content must be an object.');
        data[key] = JSON.stringify(value);
      } else {
        if (value !== null && typeof value !== 'string') fail(400, `${key} must be text or null.`);
        data[key] = value;
      }
    }
    if (!Object.keys(data).length) fail(400, 'No supported settings were provided.');
    const fields = Object.keys(data);
    const assignments = fields.map(field => `${field} = ?`).join(', ');
    await env.DB.prepare(
      `UPDATE portfolio_settings SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = 1`
    ).bind(...fields.map(field => data[field])).run();
    const settings = await env.DB.prepare('SELECT * FROM portfolio_settings WHERE id = 1').first();
    return json(normalizeSettings(settings));
  }

  if (path === '/api/admin/media' && method === 'POST') {
    return registerMedia(request, env);
  }
  if (path === '/api/admin/media' && method === 'DELETE') {
    return deleteMedia(env, url);
  }

  fail(404, 'Route not found.');
}

function withCors(response, request, env) {
  const origin = request.headers.get('origin');
  const allowedOrigins = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (!origin || !allowedOrigins.includes(origin)) return response;

  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  headers.set('access-control-allow-headers', 'Authorization, Content-Type');
  headers.set('access-control-max-age', '86400');
  headers.append('vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    try {
      const response = await handleRequest(request, env);
      return withCors(response, request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return withCors(json({ error: error.message }, error.status), request, env);
      }
      if (isConstraintError(error)) {
        return withCors(json({ error: 'The record conflicts with existing data or a related record.' }, 409), request, env);
      }
      console.error('Portfolio API request failed:', error);
      return withCors(json({ error: 'The portfolio API could not complete the request.' }, 500), request, env);
    }
  }
};
