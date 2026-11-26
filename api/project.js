import { del } from '@vercel/blob';
import {
  bearerToken,
  cloudflareRequest,
  errorResponse,
  json,
  readJson,
  isVercelBlobUrl
} from '../lib/cloudflare-api.js';

function projectMediaUrls(url) {
  const urls = [url];
  const previewUrl = new URL(url);
  if (/-original\.[^.]+$/i.test(previewUrl.pathname)) {
    previewUrl.pathname = previewUrl.pathname.replace(/-original\.[^.]+$/i, '-preview.webp');
    urls.push(previewUrl.toString());
  }
  return urls;
}

export default async function handler(request) {
  try {
    if (request.method !== 'DELETE') return json({ error: 'Method not allowed.' }, 405);
    const token = bearerToken(request);
    const { projectId } = await readJson(request);
    if (typeof projectId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) {
      return json({ error: 'The project ID is invalid.' }, 400);
    }

    const result = await cloudflareRequest(
      `/api/admin/projects/${encodeURIComponent(projectId)}`,
      token,
      { method: 'DELETE' }
    );
    const blobUrls = [...new Set(result.mediaUrls.filter(isVercelBlobUrl).flatMap(projectMediaUrls))];
    if (blobUrls.length) {
      try {
        await del(blobUrls);
      } catch (error) {
        console.error('Project was deleted but Blob cleanup failed:', error);
        return json({
          deleted: true,
          mediaCleanupFailed: true,
          error: 'The project was deleted, but some Blob files could not be removed.'
        }, 502);
      }
    }
    return json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
