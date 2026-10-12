#!/usr/bin/env node
// All Hockey updater. Refreshes ../data.json (news, fixtures, results, tables) and records what it did.
//   node updater/update.mjs                run everything that is due
//   node updater/update.mjs --force        ignore the "not due yet" and "page unchanged" shortcuts
//   node updater/update.mjs --only=england run a single unit from sources.mjs
//   node updater/update.mjs --news-only    just refresh news
//   node updater/update.mjs --dry          do the work but write nothing
//   node updater/update.mjs --check        test every source (no AI calls, no writes) and report problems
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MONTHS, fetchText, htmlToText, parseFeed, discoverFeeds, snippet, isoToD, classify, mergeNews, pool, sha, nrm, clean, safeUrl } from './lib.mjs';
import { cleanResults, cleanFixtures, cleanTable, canonNames, groundedShare } from './validate.mjs';
import { extractFromText, extractFromSearch } from './llm.mjs';
import { NEWS_FEEDS, UNITS } from './sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hoursSince = (iso, now) => (iso ? (now - Date.parse(iso)) / 36e5 : Infinity);
const dLabel = (now) => `${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`;

/* ------------------------------------------------------------------ news */
async function newsStep(o, data, state) {
  const added = [], errors = []; let ok = 0;
  await pool(o.feeds, 3, async (f) => {
    try {
      let urls = f.feed ? [f.feed] : state.feeds[f.id]?.urls;
      const cached = state.feeds[f.id];
      if (!f.feed && (!urls || (!urls.length && hoursSince(cached?.at, o.now) > 24))) {
        const html = await fetchText(f.site, { fetchImpl: o.fetchImpl });
        urls = discoverFeeds(html, f.site).slice(0, 2);
        state.feeds[f.id] = { urls, at: o.now.toISOString() };
      }
      if (!urls?.length) throw new Error(`no RSS feed found on ${f.site} (set "feed" in sources.mjs)`);
      let items = [];
      for (const u of urls) items.push(...parseFeed(await fetchText(u, { fetchImpl: o.fetchImpl })));
      if (f.only) items = items.filter((i) => f.only.test(`${i.title} ${i.desc}`));
      else if (!items.length) throw new Error('feed had no items');
      items = items.filter((i) => i.iso).sort((a, b) => (a.iso < b.iso ? 1 : -1)).slice(0, 12);
      for (const i of items) {
        const u = safeUrl(i.link); if (!u) continue;
        added.push({ t: clean(i.title).slice(0, 200), c: classify(i, f), d: isoToD(i.iso), iso: i.iso, s: clean(snippet(i.desc)), u });
      }
      ok++;
    } catch (e) { errors.push(`${f.id}: ${e.message}`); }
  });
  data.news = mergeNews(data.news || [], added, { today: o.now });
  return { ok, failed: errors.length, errors, added: added.length };
}

/* --------------------------------------------------------------- leagues */
const teamsOf = (data, comp) => new Set([...(data.tables[comp] || []).map((r) => r.n), ...data.fixtures.filter((x) => x.comp === comp).flatMap((x) => [x.a, x.b]), ...data.results.filter((x) => x.comp === comp).flatMap((x) => [x.a, x.b])]);

function applyUnit(o, data, unit, raw, text, mode) {
  const rejected = [], accepted = []; const today = dLabel(o.now);
  const note = (extra) => `${extra ? extra + ' ' : ''}${mode === 'search' ? 'Found by automatic web search, so check the league site if anything looks wrong. ' : ''}Updated automatically on ${today}. Source: ${unit.source}.`;
  for (const comp of unit.comps) {
    const parts = (raw.competitions || []).filter((c) => c.competition === comp);
    const cat = (k) => parts.flatMap((p) => p[k] || []);
    const known = teamsOf(data, comp);
    let results = cleanResults(cat('results'), comp), fixtures = cleanFixtures(cat('fixtures'), comp, o.now);
    let table = cat('table').length ? cleanTable(cat('table')) : { rows: [] };
    if (table.error) { rejected.push(`${comp} table: ${table.error}`); table = { rows: [] }; }
    canonNames(results, known, ['a', 'b']); canonNames(fixtures, known, ['a', 'b']); canonNames(table.rows, known, ['n']);
    if (text) { // pages mode: every team must literally appear on the page
      const g = (rows, f) => groundedShare(text, rows.flatMap((r) => f.map((k) => r[k])));
      if (results.length && g(results, ['a', 'b']) < 0.9) { rejected.push(`${comp} results: team names not found on page`); results = []; }
      if (fixtures.length && g(fixtures, ['a', 'b']) < 0.9) { rejected.push(`${comp} fixtures: team names not found on page`); fixtures = []; }
      if (table.rows.length && g(table.rows, ['n']) < 0.9) { rejected.push(`${comp} table: team names not found on page`); table = { rows: [] }; }
    }
    const old = data.tables[comp] || [];
    if (table.rows.length && old.length) {
      const sum = (r) => r.reduce((s, x) => s + x.p, 0);
      const oldNames = new Set(old.map((x) => nrm(x.n))), same = table.rows.filter((x) => oldNames.has(nrm(x.n))).length / table.rows.length;
      if (same >= 0.8 && table.rows.length !== old.length) { rejected.push(`${comp} table: team count changed (${old.length} to ${table.rows.length})`); table = { rows: [] }; }
      else if (same >= 0.8 && sum(table.rows) < sum(old)) { rejected.push(`${comp} table: fewer games than the table already held`); table = { rows: [] }; }
    }
    if (results.length) { data.results = data.results.filter((x) => x.comp !== comp).concat(results); data.src[comp] = note(); }
    if (fixtures.length) { data.fixtures = data.fixtures.filter((x) => x.comp !== comp).concat(fixtures); data.fsrc[comp] = note(); }
    if (table.rows.length) { data.tables[comp] = table.rows; data.tsrc[comp] = note(parts.map((p) => clean(p.table_note)).find(Boolean)); }
    accepted.push(`${comp}: ${results.length} results, ${fixtures.length} fixtures, ${table.rows.length} table rows`);
  }
  return { accepted, rejected };
}

async function unitStep(o, data, state, unit) {
  const key = unit.id, last = state.lastRun[key];
  // Hockey is mostly played Fri-Mon, so on other days only check once a day to save cost.
  const matchDays = [5, 6, 0, 1].includes(o.now.getUTCDay());
  const gap = matchDays ? unit.refreshHours : Math.max(unit.refreshHours, 24);
  const due = o.force || hoursSince(last, o.now) >= gap;
  if (!due) return { skipped: 'not due yet' };
  if (!o.apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const today = dLabel(o.now); let raw, text = null, mode, pageHash = null;
  if (unit.pages?.length) {
    mode = 'pages';
    const pages = [];
    for (const url of unit.pages) pages.push({ url, text: htmlToText(await fetchText(url, { fetchImpl: o.fetchImpl })) });
    if (pages.every((p) => p.text.length < 400)) throw new Error('the page has almost no readable text (it is probably built by JavaScript in the browser, so it needs a different URL)');
    pageHash = sha(pages.map((p) => p.text).join('\n'));
    if (!o.force && state.pages[key] === pageHash && hoursSince(last, o.now) < 24) { state.lastRun[key] = o.now.toISOString(); return { skipped: 'page unchanged' }; }
    text = pages.map((p) => p.text).join('\n');
    raw = await o.extractText({ apiKey: o.apiKey, model: o.model, fetchImpl: o.fetchImpl, comps: unit.comps, pages, today });
  } else {
    mode = 'search';
    raw = await o.extractSearch({ apiKey: o.apiKey, model: o.model, fetchImpl: o.fetchImpl, comps: unit.comps, hint: unit.hint, today });
  }
  const res = applyUnit(o, data, unit, raw, text, mode);
  state.lastRun[key] = o.now.toISOString();
  if (pageHash && !res.rejected.length) state.pages[key] = pageHash;
  return { mode, ...res };
}

/* ------------------------------------------------------------------ main */
export async function run(opt = {}) {
  const o = {
    dataPath: path.join(ROOT, 'data.json'), statePath: path.join(ROOT, 'updater', 'state.json'),
    now: new Date(), fetchImpl: globalThis.fetch, extractText: extractFromText, extractSearch: extractFromSearch,
    units: UNITS, feeds: NEWS_FEEDS, force: false, only: null, dry: false, newsOnly: false,
    apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.CLAUDE_MODEL || 'claude-haiku-5-5', log: console.log, ...opt,
  };
  const before = await fs.readFile(o.dataPath, 'utf8');
  const data = JSON.parse(before);
  const state = { pages: {}, lastRun: {}, feeds: {}, failStreak: {}, ...(await fs.readFile(o.statePath, 'utf8').then(JSON.parse, () => ({}))) };
  data.meta = data.meta || {}; data.meta.sources = data.meta.sources || {};
  const alerts = []; const nowIso = o.now.toISOString();

  const news = await newsStep(o, data, state);
  data.meta.news = { at: nowIso, feedsOk: news.ok, feedsFailed: news.failed, errors: news.errors.slice(0, 5) };
  news.errors.forEach((e) => o.log('  news warning:', e));
  if (news.ok === 0 && o.feeds.length) alerts.push('every news feed failed');

  const summary = {};
  if (!o.newsOnly) for (const unit of o.units) {
    if (o.only && unit.id !== o.only) continue;
    try {
      const r = await unitStep(o, data, state, unit);
      summary[unit.id] = r;
      if (r.skipped) continue;
      const good = r.accepted.some((a) => !/: 0 results, 0 fixtures, 0 table rows$/.test(a));
      const failed = r.rejected.length > 0 && !good;
      data.meta.sources[unit.id] = { at: nowIso, mode: r.mode, ok: !failed, detail: failed ? r.rejected.join('; ') : (good ? r.accepted.join('; ') : 'nothing found (off season?)'), ...(r.rejected.length && good ? { warnings: r.rejected } : {}) };
      state.failStreak[unit.id] = failed ? (state.failStreak[unit.id] || 0) + 1 : 0;
      if (failed) o.log(`  ${unit.id}: rejected: ${r.rejected.join('; ')}`);
    } catch (e) {
      summary[unit.id] = { error: e.message };
      data.meta.sources[unit.id] = { at: nowIso, ok: false, detail: e.message };
      state.failStreak[unit.id] = (state.failStreak[unit.id] || 0) + 1;
      o.log(`  ${unit.id}: FAILED: ${e.message}`);
    }
    if ((state.failStreak[unit.id] || 0) >= 3) alerts.push(`${unit.id} has failed ${state.failStreak[unit.id]} runs in a row: ${data.meta.sources[unit.id]?.detail}`);
  }

  // Bump the visible timestamp only when something changed, or every 12 hours so the page can tell the updater is alive.
  const body = (d) => JSON.stringify({ ...d, generated: 0, updated: 0, asof: 0, meta: { ...d.meta, news: 0, sources: Object.fromEntries(Object.entries(d.meta.sources || {}).map(([k, v]) => [k, v?.ok])) } });
  const prev = JSON.parse(before);
  if (body(prev) !== body(data) || hoursSince(prev.generated, o.now) >= 12) {
    data.generated = nowIso; data.asof = nowIso.slice(0, 10); data.updated = dLabel(o.now);
  }
  const out = JSON.stringify(data, null, 1) + '\n', stateOut = JSON.stringify(state, null, 1) + '\n';
  const changed = out !== before;
  if (!o.dry) { if (changed) await fs.writeFile(o.dataPath, out); await fs.writeFile(o.statePath, stateOut); }
  return { changed, news, units: summary, alerts };
}

/* ----------------------------------------------------------------- check */
export async function check(o) {
  console.log('NEWS FEEDS');
  for (const f of o.feeds) {
    try {
      let urls = f.feed ? [f.feed] : discoverFeeds(await fetchText(f.site, { fetchImpl: o.fetchImpl }), f.site);
      if (!urls.length) { console.log(`  FAIL ${f.id}: no feed advertised on ${f.site}. Find the feed URL and set "feed" in sources.mjs.`); continue; }
      const items = parseFeed(await fetchText(urls[0], { fetchImpl: o.fetchImpl }));
      console.log(`  ${items.length ? 'ok  ' : 'WARN'} ${f.id}: ${urls[0]} (${items.length} items${items[0] ? ', newest: ' + items[0].title.slice(0, 60) : ''})`);
    } catch (e) { console.log(`  FAIL ${f.id}: ${e.message}`); }
  }
  console.log('\nLEAGUE PAGES');
  for (const u of o.units) {
    if (!u.pages?.length) { console.log(`  ${u.id}: no pages set, will use web search (needs ANTHROPIC_API_KEY)`); continue; }
    for (const url of u.pages) {
      try { const t = htmlToText(await fetchText(url, { fetchImpl: o.fetchImpl })); console.log(`  ${t.length < 400 ? 'WARN' : 'ok  '} ${u.id}: ${url} (${t.length} characters of text${t.length < 400 ? ', looks JavaScript-built, so pick another URL' : ''})`); }
      catch (e) { console.log(`  FAIL ${u.id}: ${e.message}`); }
    }
  }
  console.log('\nAPI key:', o.apiKey ? 'set' : 'NOT SET (needed for fixtures, results and tables)');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), has = (f) => a.includes(f), val = (f) => a.find((x) => x.startsWith(f + '='))?.split('=')[1];
  const opts = { force: has('--force'), dry: has('--dry'), newsOnly: has('--news-only'), only: val('--only') || null };
  if (has('--check')) { await check({ feeds: NEWS_FEEDS, units: UNITS, fetchImpl: globalThis.fetch, apiKey: process.env.ANTHROPIC_API_KEY }); }
  else {
    const r = await run(opts);
    console.log(`news: ${r.news.ok} feeds ok, ${r.news.failed} failed, ${r.news.added} items seen`);
    for (const [k, v] of Object.entries(r.units)) console.log(`${k}: ${v.skipped ? 'skipped (' + v.skipped + ')' : v.error ? 'FAILED ' + v.error : v.accepted.join(' | ') + (v.rejected.length ? '  REJECTED: ' + v.rejected.join('; ') : '')}`);
    console.log(r.changed ? 'data.json updated' : 'no changes');
    if (r.alerts.length) { console.error('ALERTS:\n - ' + r.alerts.join('\n - ')); process.exitCode = 1; }
  }
}
