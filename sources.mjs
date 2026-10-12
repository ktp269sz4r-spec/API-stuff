// ---------------------------------------------------------------------------
// WHAT THE UPDATER KEEPS FRESH. Edit this file to add, remove or sharpen sources.
// ---------------------------------------------------------------------------

/** News. Give a `feed` URL if you know it; otherwise the feed is auto-discovered from the site's home page. */
export const NEWS_FEEDS = [
  { id: 'englandhockey', site: 'https://www.englandhockey.co.uk', category: 'Club' },
  { id: 'fih',           site: 'https://fih.hockey',               category: 'International' },
  { id: 'eurohockey',    site: 'https://www.eurohockey.org',       category: 'International' },
  { id: 'hoofdklasse',   site: 'https://staatsloterijhoofdklasse.com', category: 'Club' },
  { id: 'eshockey',      site: 'https://eshockey.es',              category: 'Club' },
  { id: 'scottish',      site: 'https://www.scottish-hockey.org.uk', category: 'Club' },
  { id: 'bundesliga',    site: 'https://www.hockeybundesliga.de',  category: 'Club' },
  // Local papers cover many sports, so only keep hockey stories:
  { id: 'bailiwick',     site: 'https://www.bailiwickexpress.com', category: 'Club', only: /hockey/i },
  { id: 'gsypress',      site: 'https://guernseypress.com',        category: 'Club', only: /hockey/i },
];

/**
 * Leagues. Each "unit" fills in the fixtures, results and table for the listed competitions
 * (names must match the site's data.json exactly).
 *
 *  - Put official page URLs in `pages` and the updater reads those pages (cheap, and every team name is
 *    checked against the page text, so invented data is rejected).
 *  - Leave `pages` empty and Claude searches the web for it instead (works with no setup, costs a bit more,
 *    and cannot be checked against page text, so the site labels it as web-searched).
 *
 *  `refreshHours` = the minimum gap between runs for that unit on match days (Fri to Mon). On other days it is
 *  at most once a day. This keeps API costs down.
 */
export const UNITS = [
  { id: 'guernsey', source: 'Guernsey Hockey', refreshHours: 3,
    pages: ['https://www.pitchero.com/clubs/guernseyhockey/matches'],
    comps: ["Guernsey Men's Division 1", 'Guernsey Ladies League'] },
  { id: 'jersey', source: 'Jersey Hockey', refreshHours: 12, pages: [],
    hint: 'These are the Jersey (Channel Islands) club leagues run by Jersey Hockey Association.',
    comps: ["Jersey Men's 1st Division", 'Jersey Ladies 1st Division'] },
  { id: 'england', source: 'England Hockey', refreshHours: 6, pages: [],
    hint: 'England Hockey Premier Division (the Premier Division of the national league, season 2026-27).',
    comps: ["EHL Men's Premier Division", "EHL Women's Premier Division"] },
  { id: 'netherlands', source: 'Hoofdklasse', refreshHours: 12, pages: [],
    hint: 'Dutch Hoofdklasse (Staatsloterij Hoofdklasse), season 2026-27.',
    comps: ['Dutch Hoofdklasse Men', 'Dutch Hoofdklasse Women'] },
  { id: 'germany', source: 'Hockey-Bundesliga', refreshHours: 12, pages: [],
    hint: 'German Hockey Bundesliga, season 2026-27. Keep the points exactly as published (shoot-outs count).',
    comps: ['German Bundesliga Men', 'German Bundesliga Women'] },
  { id: 'belgium', source: 'Hockey League (Belgium)', refreshHours: 12, pages: [],
    hint: 'Belgian Hockey League (Carlsberg 0.0 Hockey League), season 2026-27.',
    comps: ['Belgian Hockey League Men', 'Belgian Hockey League Women'] },
  { id: 'spain', source: 'RFEH', refreshHours: 12, pages: [],
    hint: 'Spanish Liga IATI (men) and Liga Iberdrola (women), season 2026-27.',
    comps: ['Spanish Liga IATI Men', 'Spanish Liga Iberdrola Women'] },
  { id: 'france', source: 'FFH', refreshHours: 24, pages: [],
    hint: 'French Élite league, season 2026-27.',
    comps: ['French Élite Men', 'French Élite Women'] },
  { id: 'scotland', source: 'Scottish Hockey', refreshHours: 12, pages: [],
    hint: 'Scottish Hockey Premiership, season 2026-27.',
    comps: ['Scottish Premiership Men', 'Scottish Premiership Women'] },
  { id: 'australia', source: 'Hockey Australia', refreshHours: 24, pages: [],
    hint: 'Hockey One (Australia), season 2026. Dates and times are Australian local time.',
    comps: ['Australian Hockey One Men', 'Australian Hockey One Women'] },
  { id: 'india', source: 'Hockey India', refreshHours: 48, pages: [],
    hint: 'Hockey India League. If the new season has not started, record nothing.',
    comps: ['Hockey India League Men', 'Hockey India League Women'] },
];
// Not touched by the updater (kept by hand): group stages such as "Euro Hockey League ... (Round 1)" and the US college poll.
