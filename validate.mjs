// Checks that guard the site from bad data. Anything that fails is dropped and the previous data is kept.
import { MONTHS, DAYS, nrm, clean } from './lib.mjs';

const WHEN = new RegExp(`^(${DAYS.join('|')}) (\\d{1,2}) (${MONTHS.join('|')})( \\d{2}:\\d{2})?$`);
const int = (v) => (Number.isInteger(+v) && v !== '' && v !== null ? +v : NaN);

/** Year that puts "10 Oct" closest to `now`. */
export function yearFor(mon, day, now) {
  const y = now.getUTCFullYear(), m = MONTHS.indexOf(mon);
  return [y - 1, y, y + 1].sort((p, q) => Math.abs(Date.UTC(p, m, day) - now) - Math.abs(Date.UTC(q, m, day) - now))[0];
}

export function cleanScore(s) {
  const m = String(s ?? '').trim().match(/^(\d{1,2})\s*[-–—:]\s*(\d{1,2})(?:\s*\(?\s*([A-Za-z.]{2,10})\s*\)?)?$/);
  return m ? `${m[1]}–${m[2]}${m[3] ? ' ' + m[3] : ''}` : null;
}
export function cleanWhen(w, now) {
  const s = String(w ?? '').trim().replace(/\s+/g, ' ');
  if (/^(TBC|Date TBC)$/i.test(s)) return 'TBC';
  if (/^Postponed/i.test(s)) return s.slice(0, 40);
  const m = s.match(WHEN);
  if (!m) return null;
  const day = +m[2];
  const dt = new Date(Date.UTC(yearFor(m[3], day, now), MONTHS.indexOf(m[3]), day));
  if (DAYS[dt.getUTCDay()] !== m[1]) return null;               // weekday must match the date
  if (m[4] && !/^ ([01]\d|2[0-3]):[0-5]\d$/.test(m[4])) return null;
  return s;
}

export function cleanResults(rows, comp) {
  const out = [];
  for (const r of rows || []) {
    const sc = cleanScore(r.score ?? r.sc);
    const a = clean(r.home ?? r.a), b = clean(r.away ?? r.b);
    if (!sc || !a || !b || nrm(a) === nrm(b)) continue;
    out.push({ comp, a, b, sc });
  }
  return out.slice(0, 30);
}
export function cleanFixtures(rows, comp, now) {
  const out = [];
  for (const r of rows || []) {
    const w = cleanWhen(r.when ?? r.w, now);
    const a = clean(r.home ?? r.a), b = clean(r.away ?? r.b);
    if (!w || !a || !b || nrm(a) === nrm(b)) continue;
    out.push({ comp, a, b, w, v: clean(r.venue ?? r.v).slice(0, 80) });
  }
  return out.slice(0, 30);
}
/** Returns {rows} or {error}. Strict on purpose: a table that does not add up is not published. */
export function cleanTable(rows) {
  const out = [], seen = new Set();
  for (const r of rows || []) {
    const row = { n: clean(r.team ?? r.n), p: int(r.played ?? r.p), w: int(r.won ?? r.w), d: int(r.drawn ?? r.d), l: int(r.lost ?? r.l), f: int(r.goals_for ?? r.f), a: int(r.goals_against ?? r.a) };
    if (!row.n || [row.p, row.w, row.d, row.l, row.f, row.a].some((x) => isNaN(x) || x < 0 || x > 400)) return { error: `bad row for "${row.n}"` };
    if (row.p !== row.w + row.d + row.l) return { error: `P != W+D+L for ${row.n}` };
    row.gd = row.f - row.a;
    const given = r.gd ?? r.goal_difference;
    if (given !== undefined && given !== null && given !== '' && int(String(given).replace('+', '')) !== row.gd) return { error: `GD mismatch for ${row.n}` };
    const pts = int(r.points ?? r.pts);
    if (!isNaN(pts) && pts !== row.w * 3 + row.d) row.pts = pts;  // only keep when the league scores differently (e.g. shoot-outs)
    if (seen.has(nrm(row.n))) return { error: `duplicate team ${row.n}` };
    seen.add(nrm(row.n)); out.push(row);
  }
  return out.length >= 4 ? { rows: out } : { error: 'fewer than 4 teams' };
}

/** Rewrite team names to the spelling the site already uses (e.g. "and" vs "&"). */
export function canonNames(rows, known, fields) {
  const map = new Map([...known].map((k) => [nrm(k), k]));
  for (const r of rows) for (const f of fields) if (map.has(nrm(r[f]))) r[f] = map.get(nrm(r[f]));
}
/** Share of team names that literally appear in the page text. Guards against invented data. */
export function groundedShare(text, names) {
  const t = ' ' + nrm(text) + ' ';
  const list = [...new Set(names)].filter(Boolean);
  if (!list.length) return 1;
  return list.filter((n) => t.includes(' ' + nrm(n) + ' ')).length / list.length;
}
