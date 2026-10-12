import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseFeed, discoverFeeds, htmlToText, snippet, mergeNews, classify, nrm, clean } from '../lib.mjs';
import { cleanScore, cleanWhen, cleanTable, cleanResults } from '../validate.mjs';
import { run } from '../update.mjs';

let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log('  pass', name); } catch (e) { console.error('  FAIL', name, '\n', e.message); process.exitCode = 1; } };
const NOW = new Date('2026-10-12T09:00:00Z');

/* ---------- parsing ---------- */
await t('RSS + Atom parse, entities, CDATA', () => {
  const rss = `<rss><channel><item><title><![CDATA[Wimbledon &amp; Surbiton win]]></title><link>https://ex.com/a?x=1</link><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Big wins for <b>both</b> clubs. More text here.</p>]]></description></item></channel></rss>`;
  const [i] = parseFeed(rss);
  assert.equal(i.title, 'Wimbledon & Surbiton win'); assert.equal(i.iso, '2026-10-05'); assert.equal(i.desc, 'Big wins for both clubs. More text here.');
  const atom = `<feed><entry><title>Atom story</title><link rel="alternate" href="https://ex.com/b"/><updated>2026-10-06T08:00:00Z</updated><summary>Sum</summary></entry></feed>`;
  assert.equal(parseFeed(atom)[0].link, 'https://ex.com/b');
});
await t('feed discovery resolves relative links', () => {
  const h = `<head><link rel="alternate" type="application/rss+xml" href="/feed.xml"><link rel="stylesheet" href="x.css"></head>`;
  assert.deepEqual(discoverFeeds(h, 'https://site.org/news'), ['https://site.org/feed.xml']);
});
await t('markup in feeds cannot reach the page', () => {
  const [i] = parseFeed(`<rss><item><title>&lt;img src=x onerror=alert(1)&gt;Hi</title><link>https://ex.com/z</link><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item></rss>`);
  assert.ok(!/[<>]/.test(clean(i.title)));
});
await t('html to text keeps table rows', () => {
  const x = htmlToText('<script>var a=1</script><table><tr><td>Wimbledon</td><td>6</td></tr><tr><td>Oxted</td><td>1</td></tr></table>');
  assert.equal(x, 'Wimbledon | 6\nOxted | 1');
});
await t('snippet cuts at a sentence', () => assert.ok(snippet('A first sentence that is comfortably long enough to be a sensible place to stop. ' + 'word '.repeat(60)).endsWith('.')));
await t('news merge dedupes, sorts, drops future items', () => {
  const old = [{ t: 'Old', u: 'https://ex.com/a', iso: '2026-10-01', c: 'Club' }];
  const nw = [{ t: 'Old (edited)', u: 'https://ex.com/a/', iso: '2026-10-01', c: 'Club' }, { t: 'New', u: 'https://ex.com/b', iso: '2026-10-09', c: 'Club' }, { t: 'Future', u: 'https://ex.com/c', iso: '2027-01-01', c: 'Club' }];
  const m = mergeNews(old, nw, { today: NOW });
  assert.deepEqual(m.map((x) => x.t), ['New', 'Old (edited)']);
});
await t('classifier', () => {
  assert.equal(classify({ title: 'FIH Pro League squad named', desc: '' }, { category: 'Club' }), 'International');
  assert.equal(classify({ title: 'Cup draw', desc: '' }, { category: 'Club' }), 'Club');
});

/* ---------- validation ---------- */
await t('scores and dates', () => {
  assert.equal(cleanScore('6-1'), '6–1'); assert.equal(cleanScore('3 : 3 (SO)'), '3–3 SO'); assert.equal(cleanScore('abc'), null);
  assert.equal(cleanWhen('Sat 10 Oct 16:30', NOW), 'Sat 10 Oct 16:30');
  assert.equal(cleanWhen('Sun 10 Oct 16:30', NOW), null, 'weekday must match');
  assert.equal(cleanWhen('Sat 10 Oct 25:00', NOW), null);
  assert.equal(cleanWhen('Sat 2 Jan', NOW), 'Sat 2 Jan', 'year rolls over: 2 Jan 2027 is a Saturday');
  assert.equal(cleanWhen('Fri 2 Jan', NOW), null);
});
await t('tables must add up', () => {
  const row = (o) => ({ team: 'T', played: 2, won: 1, drawn: 1, lost: 0, goals_for: 3, goals_against: 1, ...o });
  const mk = (f) => [row({ team: 'A' }), row({ team: 'B' }), row({ team: 'C' }), row({ team: 'D' })].map(f || ((x) => x));
  assert.ok(cleanTable(mk()).rows);
  assert.ok(cleanTable(mk((x) => (x.team == 'A' ? { ...x, won: 2 } : x))).error, 'P != W+D+L');
  assert.ok(cleanTable(mk((x) => (x.team == 'A' ? { ...x, gd: 5 } : x))).error, 'GD mismatch');
  assert.ok(cleanTable(mk((x) => (x.team == 'B' ? { ...x, team: 'A' } : x))).error, 'duplicate');
  assert.equal(cleanTable(mk((x) => ({ ...x, points: 7 }))).rows[0].pts, 7, 'keeps unusual points');
  assert.equal(cleanTable(mk((x) => ({ ...x, points: 4 }))).rows[0].pts, undefined);
});

/* ---------- Claude request shapes ---------- */
import { extractFromText, extractFromSearch } from '../llm.mjs';
await t('text extraction sends a forced tool call and returns its input', async () => {
  let sent;
  const f = async (url, init) => { sent = { url, init, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ content: [{ type: 'tool_use', name: 'record_competitions', input: { competitions: [] } }] }) }; };
  const out = await extractFromText({ apiKey: 'k', model: 'm', fetchImpl: f, comps: ['A'], pages: [{ url: 'u', text: 'x' }], today: '12 Oct 2026' });
  assert.deepEqual(out, { competitions: [] });
  assert.equal(sent.init.headers['x-api-key'], 'k'); assert.deepEqual(sent.body.tool_choice, { type: 'tool', name: 'record_competitions' });
  assert.deepEqual(sent.body.tools[0].input_schema.properties.competitions.items.properties.competition.enum, ['A']);
});
await t('search extraction follows up until Claude records the data', async () => {
  const replies = [{ stop_reason: 'pause_turn', content: [{ type: 'text', text: 'searching' }] }, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'found it' }] }, { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'record_competitions', input: { competitions: [{ competition: 'A' }] } }] }];
  let i = 0, last;
  const f = async (u, init) => { last = JSON.parse(init.body); return { ok: true, json: async () => replies[i++] }; };
  const out = await extractFromSearch({ apiKey: 'k', model: 'm', fetchImpl: f, comps: ['A'], hint: '', today: 'x' });
  assert.equal(out.competitions[0].competition, 'A'); assert.equal(i, 3);
  assert.ok(last.tools.some((x) => x.type === 'web_search_20250305'));
});
await t('API errors surface a readable message', async () => {
  const f = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) });
  await assert.rejects(() => extractFromText({ apiKey: 'bad', model: 'm', fetchImpl: f, comps: ['A'], pages: [], today: 'x' }), /401.*invalid x-api-key/);
});

/* ---------- end to end ---------- */
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ah-'));
const dataPath = path.join(tmp, 'data.json'), statePath = path.join(tmp, 'state.json');
const seed = JSON.parse(await fs.readFile(new URL('../../data.json', import.meta.url), 'utf8'));
await fs.writeFile(dataPath, JSON.stringify(seed));
const COMP = "EHL Men's Premier Division";
const oldTable = seed.tables[COMP];
const newRows = oldTable.map((r) => ({ team: r.n, played: r.p + 1, won: r.w, drawn: r.d + 1, lost: r.l, goals_for: r.f + 1, goals_against: r.a + 1 }));
const pageHtml = `<table>${oldTable.map((r) => `<tr><td>${r.n.replace('&', '&amp;')}</td><td>${r.p + 1}</td></tr>`).join('')}</table><p>${'Round three of the Premier Division. '.repeat(20)}</p>`;
const feedXml = `<rss><channel><item><title>Matchday Three preview</title><link>https://ex.com/preview</link><pubDate>Mon, 12 Oct 2026 07:00:00 GMT</pubDate><description>Teams gear up for matchday three of the season.</description></item></channel></rss>`;
const fetchImpl = async (url) => ({ ok: true, status: 200, text: async () => (String(url).includes('feed') ? feedXml : pageHtml) });
const feeds = [{ id: 'f', site: 'https://ex.com', feed: 'https://ex.com/feed.xml', category: 'Club' }];
const unit = { id: 'england', source: 'England Hockey', refreshHours: 0, pages: ['https://ex.com/ehl'], comps: [COMP] };
const good = { competitions: [{ competition: COMP, table: newRows, table_note: '', results: [{ home: 'Wimbledon', away: 'Surbiton', score: '2-2' }, { home: 'Hampstead and Westminster', away: 'Oxted', score: '1-0' }], fixtures: [{ home: 'Oxted', away: 'Bowdon', when: 'Sat 17 Oct 16:30', venue: 'Caterham School' }] }] };
const base = { dataPath, statePath, now: NOW, fetchImpl, feeds, units: [unit], apiKey: 'test', log: () => {} };

await t('end to end: good data is applied, names canonicalised, notes written', async () => {
  const r = await run({ ...base, extractText: async () => good });
  assert.ok(r.changed); assert.equal(r.alerts.length, 0);
  const d = JSON.parse(await fs.readFile(dataPath, 'utf8'));
  assert.equal(d.tables[COMP].find((x) => x.n === 'Wimbledon').p, 3);
  assert.ok(d.results.some((x) => x.comp === COMP && x.a === 'Hampstead & Westminster' && x.sc === '1–0'), 'canonical spelling kept');
  assert.ok(d.fixtures.some((x) => x.comp === COMP && x.w === 'Sat 17 Oct 16:30'));
  assert.match(d.tsrc[COMP], /Updated automatically on 12 Oct 2026\. Source: England Hockey\./);
  assert.equal(d.news[0].t, 'Matchday Three preview'); assert.equal(d.generated, NOW.toISOString());
  assert.equal(d.tables['Dutch Hoofdklasse Men'].length, seed.tables['Dutch Hoofdklasse Men'].length, 'other leagues untouched');
  assert.deepEqual(d.groups, seed.groups); assert.deepEqual(d.polls, seed.polls);
});
await t('second run with an unchanged page makes no API call', async () => {
  let calls = 0;
  const r = await run({ ...base, force: false, now: new Date(+NOW + 3600e3), units: [{ ...unit, refreshHours: 0 }], extractText: async () => { calls++; return good; } });
  assert.equal(calls, 0); assert.equal(r.units.england.skipped, 'page unchanged');
});
await t('invented teams are rejected and old data survives', async () => {
  const before = await fs.readFile(dataPath, 'utf8');
  const bad = { competitions: [{ competition: COMP, results: [{ home: 'Atlantis HC', away: 'Narnia Hockey Club', score: '9-0' }] }] };
  const r = await run({ ...base, force: true, now: new Date(+NOW + 7200e3), extractText: async () => bad });
  const d = JSON.parse(await fs.readFile(dataPath, 'utf8'));
  assert.ok(r.units.england.rejected[0].includes('results')); assert.ok(!d.results.some((x) => x.a === 'Atlantis HC'));
  assert.deepEqual(d.tables[COMP], JSON.parse(before).tables[COMP]);
});
await t('table that rewinds or changes size is rejected', async () => {
  const rewound = { competitions: [{ competition: COMP, table: oldTable.map((r) => ({ team: r.n, played: r.p, won: r.w, drawn: r.d, lost: r.l, goals_for: r.f, goals_against: r.a })) }] };
  const r = await run({ ...base, force: true, now: new Date(+NOW + 9000e3), extractText: async () => rewound });
  assert.ok(r.units.england.rejected.some((x) => /fewer games/.test(x)));
  const short = { competitions: [{ competition: COMP, table: newRows.slice(0, 8) }] };
  const r2 = await run({ ...base, force: true, now: new Date(+NOW + 9100e3), extractText: async () => short });
  assert.ok(r2.units.england.rejected.some((x) => /team count/.test(x)));
});
await t('API failure keeps data, and three failures in a row raise an alert', async () => {
  let alerts = [];
  for (let i = 0; i < 3; i++) alerts = (await run({ ...base, force: true, now: new Date(+NOW + (10000 + i) * 1e3), extractText: async () => { throw new Error('Anthropic API 529: overloaded'); } })).alerts;
  assert.ok(alerts.some((a) => a.includes('england has failed')), JSON.stringify(alerts));
  const d = JSON.parse(await fs.readFile(dataPath, 'utf8')); assert.equal(d.meta.sources.england.ok, false); assert.equal(d.tables[COMP].find((x) => x.n === 'Wimbledon').p, 3);
});
await t('a JavaScript-only page is reported clearly', async () => {
  const empty = async () => ({ ok: true, status: 200, text: async () => '<html><div id="app"></div><script>boot()</script></html>' });
  const r = await run({ ...base, fetchImpl: async (u) => (String(u).includes('feed') ? fetchImpl(u) : empty()), force: true, extractText: async () => good });
  assert.match(r.units.england.error, /JavaScript/);
});
await t('missing API key fails that unit but still refreshes news', async () => {
  const r = await run({ ...base, apiKey: '', force: true, extractText: async () => good });
  assert.match(r.units.england.error, /ANTHROPIC_API_KEY/); assert.equal(r.news.ok, 1);
});
console.log(`\n${n} checks passed`);
await fs.writeFile('/tmp/e2e-data.json', await fs.readFile(dataPath));
