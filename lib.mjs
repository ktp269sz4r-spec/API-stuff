// Small, dependency-free helpers shared by the updater.
import { createHash } from 'node:crypto';

export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export const sha = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

/** Lower-case, accent-free, punctuation-free key used to compare team names. */
export const nrm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…' };
export function decode(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
/** Text that is safe to drop into the page: no angle brackets, no control characters. */
export const clean = (s) => String(s ?? '').replace(/[<>]/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
export const safeUrl = (u) => (/^https?:\/\//i.test(u) ? String(u).replace(/["'<>\s]/g, (c) => encodeURIComponent(c)) : '');
export const stripTags = (h) => decode(String(h ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Turn a web page into compact plain text (tables become "a | b | c" rows). */
export function htmlToText(html, max = 60000) {
  let h = String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/(p|div|tr|li|h[1-6]|section|article|table|ul|ol)>/gi, '\n');
  h = decode(h.replace(/<[^>]+>/g, ' '));
  const t = h.split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').replace(/(\| )+$/, '').trim()).filter(Boolean).join('\n');
  return t.length > max ? t.slice(0, max) : t;
}

export async function fetchText(url, { fetchImpl = fetch, timeout = 20000, headers = {} } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetchImpl(url, {
      signal: ac.signal, redirect: 'follow',
      headers: { 'user-agent': 'AllHockeyBot/1.0 (+personal hockey results site)', accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml,*/*;q=0.8', ...headers },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}

/* ---------- feeds ---------- */
const tag = (blk, name) => {
  const m = blk.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};
export function parseFeed(xml) {
  const items = [];
  const blocks = [...String(xml).matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  for (const b of blocks) {
    const title = stripTags(tag(b, 'title'));
    let link = stripTags(tag(b, 'link'));
    if (!link) { const m = b.match(/<link[^>]*\shref=["']([^"']+)["'][^>]*>/i); link = m ? decode(m[1]) : ''; }
    if (!link) link = stripTags(tag(b, 'guid'));
    const rawDate = stripTags(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const t = Date.parse(rawDate);
    const desc = stripTags(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content'));
    if (title && /^https?:/i.test(link)) items.push({ title, link, iso: isNaN(t) ? null : new Date(t).toISOString().slice(0, 10), desc });
  }
  return items;
}
export function discoverFeeds(html, base) {
  const out = [];
  for (const m of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const t = m[0];
    if (!/type=["']application\/(rss|atom)\+xml["']/i.test(t) || !/rel=["']alternate["']/i.test(t)) continue;
    const href = t.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try { out.push(new URL(decode(href), base).href); } catch { /* ignore */ }
  }
  return [...new Set(out)];
}
export function snippet(text, max = 160) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (stop > 60 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '…');
}
export const isoToD = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

const INTL = /\b(FIH|Olympic|Olympics|World Cup|Pro League|Nations Cup|EuroHockey|EuroChamps|Great Britain|national team|Para Hockey|Commonwealth|Hockey5s|Indoor World)\b/i;
const YOUTH = /\b(under[- ]?\d{2}|U-?(14|16|18|21)s?|junior|juniors|youth)\b/i;
export function classify(item, feed) {
  const s = `${item.title} ${item.desc}`;
  if (INTL.test(s)) return 'International';
  if (YOUTH.test(s)) return 'Youth';
  return feed.category || 'Club';
}

/** Merge new news items into the old list: dedupe by link/title, newest first, capped. */
export function mergeNews(oldItems, newItems, { cap = 40, today = new Date() } = {}) {
  const key = (n) => (n.u || '').replace(/[?#].*$/, '').replace(/\/$/, '') || nrm(n.t);
  const map = new Map();
  for (const n of [...oldItems, ...newItems]) map.set(key(n), { ...map.get(key(n)), ...n });
  return [...map.values()]
    .filter((n) => n.iso && n.iso <= new Date(+today + 2 * 864e5).toISOString().slice(0, 10)) // drop items dated in the future
    .sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0))
    .slice(0, cap);
}

export async function pool(items, n, fn) {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k], k); }
  }));
  return res;
}
