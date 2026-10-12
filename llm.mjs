// Asks Claude to turn messy page text (or web search results) into strict, structured data.
// Uses a forced tool call, so the answer arrives as JSON rather than prose that needs parsing.

export const RECORD_TOOL = (comps) => ({
  name: 'record_competitions',
  description: 'Record the hockey data you found. Only include what you actually saw. Omit or leave empty anything you could not find.',
  input_schema: {
    type: 'object',
    properties: {
      competitions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            competition: { type: 'string', enum: comps },
            results: { type: 'array', description: 'Most recent completed round(s), at most 20 matches.', items: { type: 'object', properties: { home: { type: 'string' }, away: { type: 'string' }, score: { type: 'string', description: 'Home goals first, e.g. "3-1"' } }, required: ['home', 'away', 'score'] } },
            fixtures: { type: 'array', description: 'Next scheduled matches, at most 20.', items: { type: 'object', properties: { home: { type: 'string' }, away: { type: 'string' }, when: { type: 'string', description: 'Exactly like "Sat 10 Oct 16:30" (local time) or "Sat 10 Oct" if no time is shown, or "TBC".' }, venue: { type: 'string' } }, required: ['home', 'away', 'when'] } },
            table: { type: 'array', description: 'Current league table, one row per team.', items: { type: 'object', properties: { team: { type: 'string' }, played: { type: 'integer' }, won: { type: 'integer' }, drawn: { type: 'integer' }, lost: { type: 'integer' }, goals_for: { type: 'integer' }, goals_against: { type: 'integer' }, points: { type: 'integer', description: 'Points exactly as published' } }, required: ['team', 'played', 'won', 'drawn', 'lost', 'goals_for', 'goals_against'] } },
            table_note: { type: 'string', description: 'One short sentence on anything unusual about how this table scores points (e.g. shoot-out points). Optional.' },
          },
          required: ['competition'],
        },
      },
    },
    required: ['competitions'],
  },
});

const SYSTEM = `You extract field hockey results, fixtures and league tables into structured data.
Rules:
- Only record facts that are present in the material you are given. Never guess, never fill gaps from memory.
- Copy team names exactly as written in the material.
- Scores are home-first. Skip any match that is unfinished, abandoned or has no clear score.
- Put each match in the correct competition; men's and women's competitions are separate.
- If the material does not contain a section (for example no table), leave that section empty.
- Dates: write "Sat 10 Oct 16:30" style, with no year. Use the local time shown on the page.`;

async function post({ apiKey, fetchImpl, body }) {
  const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Anthropic API ${r.status}: ${j?.error?.message || 'unknown error'}`);
  return j;
}
const find = (j) => j.content?.find((b) => b.type === 'tool_use' && b.name === 'record_competitions')?.input;

/** Mode 1: you give it the page text. Cheap and checkable. */
export async function extractFromText({ apiKey, model, fetchImpl = fetch, comps, pages, today }) {
  const material = pages.map((p) => `=== PAGE: ${p.url} ===\n${p.text}`).join('\n\n');
  const j = await post({ apiKey, fetchImpl, body: {
    model, max_tokens: 6000, system: SYSTEM, tools: [RECORD_TOOL(comps)], tool_choice: { type: 'tool', name: 'record_competitions' },
    messages: [{ role: 'user', content: `Today is ${today}. Competitions you may record: ${comps.join('; ')}.\n\n${material}` }],
  } });
  const out = find(j);
  if (!out) throw new Error('Claude returned no structured data');
  return out;
}

/** Mode 2: no URLs needed. Claude searches the web itself. Convenient, but cannot be fact-checked against page text. */
export async function extractFromSearch({ apiKey, model, fetchImpl = fetch, comps, hint, today, maxTurns = 4 }) {
  const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }, RECORD_TOOL(comps)];
  const messages = [{ role: 'user', content: `Today is ${today}. Use web search to find the CURRENT season's latest results, upcoming fixtures and league table for: ${comps.join('; ')}.\n${hint || ''}\nPrefer the official league or governing body website. Ignore old seasons and unofficial or fan-made data. When done, call record_competitions.` }];
  for (let turn = 0; turn < maxTurns; turn++) {
    const j = await post({ apiKey, fetchImpl, body: { model, max_tokens: 6000, system: SYSTEM, tools, messages } });
    const out = find(j);
    if (out) return out;
    messages.push({ role: 'assistant', content: j.content });
    if (j.stop_reason !== 'pause_turn') messages.push({ role: 'user', content: 'Now call record_competitions with what you found. Use empty arrays for anything you could not find reliably.' });
  }
  throw new Error('Claude did not finish with structured data');
}
