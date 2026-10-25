export const fmt = (n) => '\u20b9' + Number(n).toLocaleString('en-IN');

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Pull a JSON object out of a model reply: plain, fenced, or surrounded by prose. */
export function extractJSON(text) {
  if (!text) return null;
  try {
    return JSON.parse(text.trim());
  } catch {
    /* keep trying */
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* keep trying */
    }
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      /* give up */
    }
  }
  return null;
}

/** Tiny markdown subset used to show a non-JSON model reply.  Input is HTML-escaped FIRST. */
export function mdToHtml(t, { h3 = '12px 0 6px', h2 = '14px 0 7px', h1 = false } = {}) {
  let html = escapeHTML(t)
    .replace(/^### (.+)$/gm, `<h3 style="color:var(--ink);font-weight:900;margin:${h3}">$1</h3>`)
    .replace(/^## (.+)$/gm, `<h2 style="color:var(--ink);font-weight:900;margin:${h2}">$1</h2>`);
  if (h1) html = html.replace(/^# (.+)$/gm, `<h1 style="color:var(--ink);font-weight:900;margin:${h2}">$1</h1>`);
  return html
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--ink)">$1</strong>')
    .replace(/^- (.+)$/gm, '<li style="margin-bottom:4px">$1</li>')
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, (s) => `<ul style="padding-left:20px;margin:8px 0">${s}</ul>`)
    .replace(/\n\n/g, '<br/><br/>');
}

/** Read the plan text from a /generate-* response the way every planner page did. */
export function planText(raw) {
  return (raw && (raw.recommendations || raw.result || raw.response)) || '';
}

export function errorText(raw) {
  return typeof raw?.detail === 'string' ? raw.detail : JSON.stringify(raw);
}

/** Server-built, https-only shopping links: [[name, url], ...]. */
export function serverLinks(item) {
  const links = item && item.shopping_links;
  if (!links || typeof links !== 'object') return [];
  return Object.entries(links).filter(([, url]) => /^https:\/\//.test(url));
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
