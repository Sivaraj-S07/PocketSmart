// Thin fetch wrapper around the Express API.
const BASE = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');

/** Absolute-or-relative URL for an API path (used for plain links such as "view JSON"). */
export const apiUrl = (path) => `${BASE}${path}`;

async function request(method, path, json) {
  const res = await fetch(apiUrl(path), {
    method,
    credentials: BASE ? 'include' : 'same-origin',
    headers: json === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body (e.g. 204) */
  }
  return { ok: res.ok, status: res.status, data };
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, json = {}) => request('POST', path, json),
  del: (path) => request('DELETE', path),
};

/** Turns FastAPI/Express-style `detail` (string, list of {loc,msg}, object) into one readable string. */
export function formatError(detail, fallback = 'Something went wrong.') {
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const loc = Array.isArray(item.loc) ? item.loc.join('.') : '';
          const msg = item.msg || 'Validation error';
          return loc ? `${loc}: ${msg}` : msg;
        }
        return String(item);
      })
      .join(' ');
  }
  if (typeof detail === 'object') {
    if (detail.msg) return detail.msg;
    if (detail.error) return detail.error;
    return JSON.stringify(detail);
  }
  return String(detail);
}
