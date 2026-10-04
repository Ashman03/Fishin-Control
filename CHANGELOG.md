# Changelog

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
