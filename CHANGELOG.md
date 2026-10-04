# Changelog

## 4.3

### New

- **Launch poll.** The hero now runs a go / no-go poll like a real launch: Swell, Wind,
  Gusts, Window, Models, Bite and Rules, each reading GO, HOLD or NO GO, so the reason
  behind a day's score is visible at a glance.
- **T-minus countdown** to the next launch window anywhere in the week, or "Window open —
  closes 11:00" when you are in one. Updates while the app is open.
- **Window tracks** on the day strip: a 24-hour line on each day with the green hours lit.
- **Closed-season reminders**, from DPI Queensland's published dates (checked 25 Sep 2026):
  coral reef fin fish (north of 24°50′S only — Baffle, Kolan, Burnett Heads), snapper and
  pearl perch, Spanish mackerel (southern dates), barramundi, black jewfish, spanner crab.
  Shown in force and up to two weeks ahead; closed species are marked in the biting list.
- **Go-day alerts.** Notifies when a day newly turns green. Installed on Android, the
  worker checks in the background (Android decides how often, usually every several
  hours); otherwise new go days are flagged when the app opens. Never alerts from a saved
  copy, and never twice for the same day.

### Changed

- Walkers Point now runs out east-north-east, off the front of Woodgate (was east-south-
  east). All four sample points are in open water; at the old bearing the 2 km point was
  on land.
- The service worker is a module, so background checks run the same model as the page.

## 4.2

- **Much lighter on the forecast service.** Open-Meteo's free tier counts every location
  as a call and limits calls per minute. The six cross-check models were requesting all
  20 sample points while only ever reading one, so each refresh cost about 160 calls and
  a few quick refreshes could get the app refused — at which point it fell back to sample
  data. Cross-checks now request the one point they use: about 50 calls per refresh.
- When the service refuses (busy, rate-limited, down) the app now shows the last good
  forecast, clearly marked "Saved forecast — not live" with the reason, instead of
  sample data. Previously that only happened with no signal at all.
- The sample-data banner now states exactly why the live forecast failed.
- Each ensemble model is requested separately, so one rejected model no longer loses both.
- A rejected forecast request is retried once without the optional parameters. A
  rate limit is deliberately not retried, since that would only prolong it.

## 4.1

- **Site files moved to the top level.** GitHub's web uploader cannot upload folders, so
  v4.0 deployed `index.html` without its `js/` and `css/` folders and showed only a giant
  logo. Every file the site needs now sits at the root.
- If app files are missing, the page now says so instead of failing silently, and the
  logo keeps its size without the stylesheet.
- Tests added for both, so a folder can never creep back into the site's file paths.

## 4.0

### Forecast accuracy

- **Wind was read from land grid cells.** Open-Meteo defaults to `cell_selection=land`,
  which snapped offshore sample points to coastal land, under-reading wind. All requests
  now ask for sea cells.
- **The go / no-go gate discounted offshore wind by 28 %** (a 13 kn westerly passed a
  10 kn limit as 9.4 kn). Limits now apply to the forecast as given. Shelter affects
  ramp ranking only.
- **Ensemble probability could silently vanish.** Open-Meteo renamed its ensemble models
  and returns data under the new names; the parser only knew the old key pattern. Now
  requests `ecmwf_ifs025_ensemble` and `ncep_gefs_seamless` and parses any key style.
- **Swell cross-check model `ewam` covers Europe only** and never returned data here.
  Replaced with ECMWF WAM and Météo-France wave.
- ECMWF wind cross-check moved from the 0.25° grid to the native 9 km model.
- The swell limit now applies to swell height (as stated and as BOM reports it); wind
  chop is shown separately. Previously combined sea height was used.
- Open-coast swell is no longer discounted by the bay shelter factor; it applies only
  where wave data has to be borrowed.
- Bay points without wave data borrowed from the first point in the list (Baffle Creek);
  they now borrow from the nearest point.
- Tide curve taken 10 km out rather than 2 km, where the ~8 km tide model is unreliable.

### Bugs

- Daily wind direction was an arithmetic mean of bearings (350° and 10° gave 180°).
- Ensemble and forecast hours were paired by position rather than timestamp.
- Tide chart plotted the curve by index and its markers by time; they could drift apart.
- **Map range rings were never drawn** — negative radius, which browsers reject.
- Logging a past session stamped it with today's conditions.
- Offline, a saved forecast was labelled "Live". Now flagged "Saved forecast — not live".
- The timezone warning was defined but never displayed.
- Pressing Refresh twice could let the older response overwrite the newer one.
- Open panels snapped shut on every re-render.
- Ramp name and ramp subtitle ran together on one line; single values shown as "1.2–1.2".

### Links

- BOM link pointed at K'gari Coastal Waters (ocean side of Fraser). Each ramp now links
  its own zone: Capricornia Coast (Baffle, Miara, Burnett) or Hervey Bay Waters (Elliott,
  Walkers Point).
- Fishing rules link updated after the move from DAF to DPI.

### Code

- Split the 1,700-line inline script into eleven ES modules, each with one job.
- Single `state` object; model and advice modules are pure functions.
- Every tunable value and model ID in `config.js`.
- Per-source status shown in the app, so a dead feed is visible rather than silent.
- Content-Security-Policy; no inline scripts or handlers.
- 57-test suite, each fixed bug covered and verified to fail when the bug is reintroduced.
- Prettier and EditorConfig settings committed.
- `tools/bundle.js` builds a single-file preview.
