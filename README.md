# Fishin' Control

Go / no-go fishing windows for a small boat between Baffle Creek and Walkers Point,
Queensland. Static site: no build step, no runtime dependencies, no third-party requests
besides the forecast itself.

## Deploy (GitHub Pages)

Add file → Upload files → select **every file** in this folder (Ctrl+A in the file
picker) → Commit. The site files are deliberately all at the top level, because GitHub's
web uploader cannot upload folders. The `tests/` and `tools/` folders are for development
only; the site works without them.

Settings → Pages → Deploy from a branch → `main` → `/ (root)`.

The hidden `.github` folder (the daily data feed check and the test run) cannot go
through the web uploader. Changes to it come through a pull request: open it on GitHub
and press **Merge pull request**. Uploading the site files never touches it.

The site uses ES modules, so it must be served over http(s). Opening `index.html` by
double-clicking will not work — use the single-file preview for that (see below). If the
loading screen sticks on "Mission software · Loading" and a "files are missing" note
appears, a `.js` file did not upload; a page with no styling at all means `styles.css`
did not.

## How it works

```
getData()          data.js    fetch from Open-Meteo, validate, report each source's status
   ↓ raw
build(raw, ctx)    model.js   per-point series → per-ramp worst case → scored days
   ↓ { days, past }
render()           ui.js      state → HTML; clicks → ACTIONS → state → render()
```

| File          | Job                                                                              |
| ------------- | -------------------------------------------------------------------------------- |
| `config.js`   | Limits, tuning weights, **every upstream model ID**, ramps, sample points, links |
| `data.js`     | Network requests (all sea grid cells, all in parallel), parsing, sample data     |
| `model.js`    | The go / no-go rule (`passes`), scoring, windows, tides, probability. Pure       |
| `advice.js`   | Sessions, techniques, marks, catch-log patterns. Pure                            |
| `astro.js`    | Sun and moon. Pure                                                               |
| `ui.js`       | Rendering and click handlers (the "Flight Deck" screens)                         |
| `store.js`    | The single `state` object and localStorage                                       |
| `app.js`      | Entry point: startup, refresh, install, service worker                           |
| `closures.js` | Queensland closed seasons for this coast, from DPI's published dates             |
| `alerts.js`   | Go-day detection and the state shared with the background worker                 |
| `map.js`      | The chart: coastline, your 20 km range, ramps, rings                             |
| `art.js`      | Species pictures: maps each species to its `species-*.webp`                      |
| `importer.js` | Reads Humminbird DATA.HWR and GPX waypoints into marks, on the phone             |
| `sw.js`       | Offline support; flags saved forecasts so they are never shown as live           |

Assets, all at the top level: `species-*.webp` (21 pictures), `logo-128.webp` (header), `logo-448.webp` (loading screen),
`icon-*.png` (favicon, notifications, install), `font-*.woff2` (Outfit and Space Grotesk,
self-hosted under the SIL Open Font License — see `fonts-OFL.txt`). The chart's coastline
is GSHHG full-resolution data (LGPL — see `coastline-LICENSE.txt`), embedded in `map.js`.

### Rules worth knowing before changing anything

- **The limits are compared in exactly one place:** `passes()` in `model.js`. Charts,
  scores, windows and the ensemble probability all call it.
- **Sampling is offshore.** Each ramp is sampled at 2, 10, 15 and 20 km along its run-out
  bearing; go / no-go uses the worst of the outer three. See `POINTS` in `config.js`.
- **Mind the request budget.** Open-Meteo's free tier counts every location as a call
  and limits calls per minute. Only the two primary requests need all 20 points; anything
  that reads one point should request one point. A refresh currently costs ~50 calls.
- **Every Open-Meteo request sets `cell_selection=sea`.** The default is `land`, which
  under-reads offshore wind.
- **Model IDs live only in `MODELS` in `config.js`.** When Open-Meteo renames a model,
  fix it there. Variables are read with `pickVar()`, which tolerates model-suffixed keys.
- **Everything interpolated into HTML goes through `esc()`.** A Content-Security-Policy
  in `index.html` blocks inline script as a second line of defence.
- **Add a control** by writing a handler in `ACTIONS` (`ui.js`) and a `data-act`
  attribute in the markup. No inline `onclick`.
- **Closures carry dates, not rules of thumb.** `closures.js` lists the department's
  published dates and records when they were checked; the app warns when they run out.
- **The service worker is a module** (`register('sw.js', { type: 'module' })`) so it can
  import `data.js` and `model.js` for background go-day checks. Anything it imports must
  not touch the DOM or localStorage.
- **Soft adjustments never move the line.** Northerlies, wind against the tidal current
  and storm risk (`softPenalties()` in `model.js`) lower the ranking score by a few points;
  only `passes()` decides GO / NO GO. Storms show as a HOLD on the caution and advisory panel at
  most.
- **Fishing hours** run from an hour before sunrise to an hour after sunset
  (`fishBeforeSunrise` / `fishAfterSunset` in `TUNING`).
- **Rivers are scored separately** (`riverScore()`): tide, moon and rain first; wind only
  when it is strong close in. The Forecast tab switches between Ocean and Rivers.
- **Marks with a position never leave the phone.** Imported marks live in localStorage
  only; never put real marks in the code, because the site is public.
- **`rebuild()`** recomputes the model and repaints; **`render()`** only repaints, and
  keeps open panels and keyboard focus where they were.
- **Releasing:** bump `APP_VERSION` in `config.js`, `VERSION` in `sw.js` and `version` in
  `package.json` together (the tests check they match). The version bump is what makes
  phones replace cached images and fonts, which are served cache-first.
- **Look and feel ("Flight Deck", 6.0):** square panels on a chart grid, spaced capital
  headings (`sect()` in `ui.js`), corner brackets (`--brackets` in `styles.css`). Green,
  amber and red mean go, marginal and no-go and nothing else; light blue is the
  interface. Each reading turns green and amber at the same lines as its own words
  (`LINES` in `util.js`): ocean scores at the verdict's 75 / 42, river scores at 70 / 40,
  Bite at its lamp's 60 / 45, and the Models % takes its Models lamp's colour. Nothing
  uses outlined text. The page reads from the top: the daily score, then the 7-day
  forecast, then the caution and advisory panel and the detail below it. Phones get a
  bottom sections bar; from 900 px wide the layout spreads into columns (`.deck`,
  `.col-a/b/c`, `.advsec`, `.grid`).
- **Saved data is cleaned on load** (`cleanMark`, `cleanLogEntry` in `store.js`), so a
  damaged entry can't break a render.

## Develop

Needs Node 18+ for the tests and tools only; the site itself needs nothing.

```
npm test             # 209 tests, no dependencies, clock pinned to Queensland time
npm run bundle       # dist/fishin-control.html — whole app in one file, for local preview
npm run lint         # Prettier formatting check (npm run format to fix)
```

### Daily data feed check

`.github/workflows/feed-check.yml` runs `tools/check-feeds.js` every morning just after
6 am Queensland time (and on any pull request that touches the data code). It makes the same
Open-Meteo requests the app makes, reads the DPI closed seasons page and tries every
link in `SOURCES`, and reports:

- **Changed:** a model renamed or retired, a request refused, a field dropped or in new
  units, a forecast that stops short of the week, the DPI page updated since
  `CLOSURES_CHECKED`, closure dates running out, or a linked page gone (404). The
  workflow opens an issue labelled `feed-check` (GitHub emails the owner), comments only
  if the problem changes, and closes it when the check passes again.
- **Not reachable:** a service busy (429), down (5xx) or slow. Retried, then reported on
  the run page only, because these fix themselves and the app says so at the time.

DPI's website turns away GitHub's machines (HTTP 403), so the check notes that and moves
on; a monthly Claude routine in the project reads the page and compares its "Last
updated" date with `CLOSURES_CHECKED` instead.

`.github/workflows/tests.yml` runs `node tests/run.js` and the Prettier check on every
pull request and every change to `main`.

Run the feed check by hand from Actions → Data feed check → Run workflow, or locally with
`node tools/check-feeds.js`. The app itself does the field check on every load too
(`fieldGaps()` in `data.js`): anything missing shows as "Forecast data incomplete" on the
forecast and in Data sources.

### Species illustrations

The 21 `species-*.webp` files are made from the supplied PNG artwork by
`python3 tools/prepare-species.py ORIGINALS_FOLDER [REDRAWN_FOLDER ...]` (needs Pillow,
numpy and scipy). It removes the background haze and stray bits of neighbouring animals,
centres each one on the same 600 × 320 canvas and writes WebP. Later folders override
earlier ones. To replace one picture, run it again, then bump the version so phones fetch
the new image.

What's biting comes from `SEASON` (Ocean page) and `RIVER_SEASON` (Rivers page) in
`config.js`. Species still waiting on a painting are listed in `ART_PENDING` in `art.js` and show a
faint fish silhouette until then. To add one: name the PNG after the species (for example
`estuary_cod.png`), run the tool, add the file to `SPECIES_IMAGES` in `art.js` and to the
offline list in `sw.js`, and take the species off `ART_PENDING`. The tests check each step.

The tests pin `TZ=Australia/Brisbane`. The app shows Queensland local time against the
device clock, so a test machine on UTC sees "midnight" ten hours late.

## Data

Coastline: GSHHG (Wessel and Smith), LGPL. Open-Meteo (CC BY 4.0): best-match forecast and wave models, with ECMWF IFS 9 km, NOAA GFS
and DWD ICON as wind cross-checks; ECMWF WAM, NOAA GFS-Wave and Météo-France as swell
cross-checks; ECMWF and NOAA ensembles for the probability. Marks and catch log stay on the device.

Scores are a filter, not a forecast. Check BOM before launching.
