# All Hockey: autonomous version

The site now reads everything from `data.json`. A scheduled job (`updater/`) refreshes that file by itself,
so news, fixtures, results and tables stay current without you touching anything.

```
index.html                  the site (unchanged look; now loads data.json)
data.json                   all content. Seeded from your hand-built data, then maintained by the updater
updater/sources.mjs         WHAT to keep fresh. The one file you will edit
updater/update.mjs          the job. Also: --check, --force, --only=england, --news-only, --dry
updater/{lib,validate,llm}.mjs, updater/test/run.mjs
.github/workflows/update.yml  runs the job every 2 hours, free on GitHub
```

## Set it up (about 15 minutes)

1. **Put this folder in a GitHub repository** and turn on **Settings, Pages, Deploy from branch (main, root)**.
   (On Netlify or Cloudflare Pages instead? Connect the same repo. Every commit the job makes redeploys the site.)
2. **Get an Anthropic API key** at console.anthropic.com, set a monthly spend limit there, then add it to the repo as
   **Settings, Secrets and variables, Actions, New secret** called `ANTHROPIC_API_KEY`.
   Without a key, news still updates but fixtures, results and tables will not.
3. **Test your sources on your own computer** (needs Node 20+): `node updater/update.mjs --check`.
   It tries every news feed and league page and tells you exactly which ones fail and why. No AI calls, nothing written.
4. **Run it once by hand:** repo, Actions tab, "Update hockey data", Run workflow (tick *force*). Watch the log, then
   open your site. From then on it runs every 2 hours by itself.

## How it works

- **News** comes from RSS feeds. The feed address is auto-discovered from each site's home page. Each story keeps
  the headline, date, a short snippet and a link to the original, nothing more.
- **Fixtures, results and tables**: for each league, Claude reads either the official pages you list, or (if you
  list none) searches the web itself, and returns structured data.
- **Nothing unchecked reaches the site.** Every table must add up (P = W+D+L, goal difference), dates must be real
  (the weekday has to match), team counts cannot change mid-season, and when reading a page every team name must
  actually appear on that page. Anything that fails is thrown away and the previous data stays. The old data is
  never wiped.
- Quiet by design: league pages that have not changed cost nothing, and off match days (Tue to Thu) each league is
  checked at most once a day.
- If a league fails 3 runs in a row, the job fails and GitHub emails you. The site banner also warns visitors if the
  data is more than 2 days old.
- Each league's note under its table says where the data came from and when, and flags web-searched data.

## Make it better and cheaper: add official page URLs

Leagues with `pages: []` in `sources.mjs` use web search, which works with no setup but costs more (rough guide:
a few cents per league per run, so tens of dollars a month if every league uses it; check current pricing) and cannot
be fact-checked against a page. For each league, find the official results or table page, paste it into `pages`, and
re-run `--check`. Reading a known page costs a fraction of a cent and gets the strong team-name check. Guernsey
already has one.

If `--check` says a page "looks JavaScript-built", the page loads its data in the browser, so the updater only
sees an empty shell. Look for a different URL for the same data (a print view, a "full results" page, or the
league's own results site), or leave that league on web search.

## Still manual

The updater never touches these, so they stay as you wrote them: the European group stages
("Euro Hockey League ... (Round 1)"), the US college poll, the competition descriptions on the Competitions page, and
the highlights links.

## Please check

- **Terms of use.** Some sites forbid automated reading. Check each source's terms before relying on it, prefer
  official feeds, and keep the polite request rate (the job makes a handful of requests per run).
- **Accuracy.** Web-searched data in particular can be wrong. Treat the site as a convenient summary and keep the
  link to each league's own site.
- The live sources could not be tested while this was built (no internet access). Step 3 is how you find out which
  need adjusting. The logic around them is covered by `node updater/test/run.mjs` (19 checks).
