import { del } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import {
  ApiError,
  bearerToken,
  cloudflareRequest,
  errorResponse,
  json,
  readJson,
  validateVercelBlobUrl
} from '../lib/cloudflare-api.js';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MODEL_TYPES = ['model/gltf-binary', 'model/gltf+json'];
const IMAGE_LIMIT = 8 * 1024 * 1024;
const MODEL_LIMIT = 100 * 1024 * 1024;

function parseUploadPayload(value) {
  let payload;
  try {
    payload = JSON.parse(value);
  } catch {
    throw new ApiError(400, 'Upload details are invalid.');
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.firebaseIdToken !== 'string' ||
    (payload.kind !== 'image' && payload.kind !== 'model') ||
    typeof payload.contentType !== 'string'
  ) {
    throw new ApiError(400, 'Upload details are incomplete.');
  }
  if (payload.projectId !== undefined && payload.projectId !== null) {
    if (typeof payload.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.projectId)) {
      throw new ApiError(400, 'The project ID is invalid.');
    }
  }
  return payload;
}

function validatePathname(pathname) {
  if (
    typeof pathname !== 'string' ||
    !pathname ||
    pathname.length > 512 ||
    pathname.startsWith('/') ||
    pathname.includes('\\') ||
    pathname.split('/').some(part => !part || part === '.' || part === '..') ||
    /[\u0000-\u001f]/.test(pathname)
  ) {
    throw new ApiError(400, 'The upload path is invalid.');
  }
}

async function authorizeUpload(pathname, clientPayload) {
  validatePathname(pathname);
  const payload = parseUploadPayload(clientPayload);
  const allowedContentTypes = payload.kind === 'model' ? MODEL_TYPES : IMAGE_TYPES;
  const maximumSizeInBytes = payload.kind === 'model' ? MODEL_LIMIT : IMAGE_LIMIT;
  if (!allowedContentTypes.includes(payload.contentType)) {
    throw new ApiError(415, 'This file type is not supported.');
  }
  if (payload.kind === 'model' && !payload.projectId) {
    throw new ApiError(400, 'A project ID is required for a model upload.');
  }

  await cloudflareRequest('/api/admin/me', payload.firebaseIdToken);
  if (payload.projectId) {
    const projects = await cloudflareRequest('/api/admin/projects', payload.firebaseIdToken);
    if (!projects.some(project => project.id === payload.projectId)) {
      throw new ApiError(404, 'Project not found.');
    }
  }

  // UUID-based frontend paths keep original and preview names paired.
  return {
    allowedContentTypes,
    maximumSizeInBytes,
    addRandomSuffix: false,
    tokenPayload: JSON.stringify(payload)
  };
}

async function registerCompletedUpload(blob, tokenPayload) {
  const payload = parseUploadPayload(tokenPayload);
  await cloudflareRequest('/api/admin/media', payload.firebaseIdToken, {
    method: 'POST',
    body: {
      url: validateVercelBlobUrl(blob.url),
      kind: payload.kind,
      projectId: payload.projectId || null,
      contentType: blob.contentType || payload.contentType
    }
  });
}

async function handleClientUpload(request) {
  const body = await readJson(request);
  const response = await handleUpload({
    body,
    request,
    onBeforeGenerateToken: authorizeUpload,
    onUploadCompleted: async ({ blob, tokenPayload }) => {
      await registerCompletedUpload(blob, tokenPayload);
    }
  });
  return json(response);
}

async function handleMediaDelete(request) {
  const token = bearerToken(request);
  const body = await readJson(request);
  const blobUrl = validateVercelBlobUrl(body.url);
  await cloudflareRequest('/api/admin/me', token);
  await del(blobUrl);
  try {
    await cloudflareRequest(`/api/admin/media?url=${encodeURIComponent(blobUrl)}`, token, {
      method: 'DELETE'
    });
  } catch (error) {
    console.error('Blob was deleted but D1 metadata cleanup failed:', error);
    throw new ApiError(502, 'The Blob file was deleted, but its D1 metadata could not be removed.');
  }
  return json({ deleted: true });
}

export default {
  async fetch(request) {
    try {
      if (request.method === 'POST') return await handleClientUpload(request);
      if (request.method === 'DELETE') return await handleMediaDelete(request);
      return json({ error: 'Method not allowed.' }, 405);
    } catch (error) {
      return errorResponse(error);
    }
  }
};
