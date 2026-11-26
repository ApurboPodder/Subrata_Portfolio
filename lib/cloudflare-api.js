export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200) {
  return Response.json(data, { status });
}

export function errorResponse(error) {
  const status = error instanceof ApiError ? error.status : 500;
  if (status >= 500) console.error('Portfolio media API request failed:', error);
  return json(
    { error: error instanceof ApiError ? error.message : 'The media request could not be completed.' },
    status
  );
}

export function bearerToken(request) {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError(401, 'Sign in to manage portfolio media.');
  return match[1];
}

export async function cloudflareRequest(path, token, options = {}) {
  const configuredUrl = process.env.CLOUDFLARE_API_URL;
  if (!configuredUrl) throw new ApiError(503, 'The Cloudflare API URL is not configured.');

  let baseUrl;
  try {
    baseUrl = new URL(configuredUrl);
  } catch {
    throw new ApiError(503, 'The Cloudflare API URL is invalid.');
  }
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password) {
    throw new ApiError(503, 'The Cloudflare API URL must be a secure HTTPS origin.');
  }

  const endpoint = new URL(path, baseUrl.origin);
  const headers = new Headers({ authorization: `Bearer ${token}` });
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(endpoint, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(response.ok ? 502 : response.status, 'The Cloudflare API returned an invalid response.');
  }
  if (!response.ok) {
    throw new ApiError(response.status, data.error || 'The Cloudflare API rejected the request.');
  }
  return data;
}

export function isVercelBlobUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname.endsWith('.public.blob.vercel-storage.com') &&
      !url.port &&
      !url.username &&
      !url.password &&
      url.pathname !== '/' &&
      !url.search &&
      !url.hash;
  } catch {
    return false;
  }
}

export function validateVercelBlobUrl(value) {
  if (!isVercelBlobUrl(value)) throw new ApiError(400, 'Invalid Vercel Blob URL.');
  return new URL(value).toString();
}

export function readJson(request) {
  return request.json().catch(() => {
    throw new ApiError(400, 'Request body must be valid JSON.');
  });
}
