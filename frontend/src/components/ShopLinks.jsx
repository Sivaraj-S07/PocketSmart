import { serverLinks } from '../util.js';

/**
 * Shopping buttons for one item: the server's whitelisted https links when present, otherwise client-built
 * search links for `fallbackPlatforms` using the page's own platform table `cfg`.
 */
export default function ShopLinks({ item, name, fallbackPlatforms, cfg }) {
  const links = serverLinks(item);
  if (links.length) {
    return links.map(([label, url]) => (
      <a key={label} href={url} target="_blank" rel="noopener noreferrer" className={`sbtn s-${label.toLowerCase()}`}>{label}</a>
    ));
  }
  const q = encodeURIComponent(name ?? '');
  return fallbackPlatforms.map((p) => {
    const c = cfg[p] || { lbl: p, cls: 's-other', u: '#' };
    return <a key={p} href={`${c.u}${q}`} target="_blank" rel="noopener noreferrer" className={`sbtn ${c.cls}`}>{c.lbl}</a>;
  });
}
