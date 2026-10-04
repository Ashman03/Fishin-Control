# Fishin' Control

Go / no-go fishing windows for a small boat between Baffle Creek and Walkers Point,
Queensland. Static site, no build step, no runtime dependencies.

## Deploy (GitHub Pages)

Upload everything in this folder to the repository root, keeping the `js/` and `css/`
folders as folders. The repo root must show `index.html`, `js/` and `css/` side by side.
Settings → Pages → Deploy from a branch → `main` → `/ (root)`.

The site uses ES modules, so it must be served over http(s). Opening `index.html` by
double-clicking will not work — use the single-file preview for that (see below).

## How it works

```
getData()          data.js    fetch from Open-Meteo, validate, report each source's status
   ↓ raw
build(raw, ctx)    model.js   per-point series → per-ramp worst case → scored days
   ↓ { days, past }
render()           ui.js      state → HTML; clicks → ACTIONS → state → render()
```

| File                     | Job                                                                              |
| ------------------------ | -------------------------------------------------------------------------------- |
| `js/config.js`           | Limits, tuning weights, **every upstream model ID**, ramps, sample points, links |
| `js/data.js`             | Network requests (all sea grid cells, all in parallel), parsing, sample data     |
| `js/model.js`            | The go / no-go rule (`passes`), scoring, windows, tides, probability. Pure       |
| `js/advice.js`           | Sessions, techniques, marks, catch-log patterns. Pure                            |
| `js/astro.js`            | Sun and moon. Pure                                                               |
| `js/ui.js`               | Rendering and click handlers                                                     |
| `js/store.js`            | The single `state` object and localStorage                                       |
| `js/app.js`              | Entry point: startup, refresh, install, service worker                           |
| `js/map.js`, `js/art.js` | The chart and the fish                                                           |
| `sw.js`                  | Offline support; flags saved forecasts so they are never shown as live           |

### Rules worth knowing before changing anything

- **The limits are compared in exactly one place:** `passes()` in `model.js`. Charts,
  scores, windows and the ensemble probability all call it.
- **Sampling is offshore.** Each ramp is sampled at 2, 10, 15 and 20 km along its run-out
  bearing; go / no-go uses the worst of the outer three. See `POINTS` in `config.js`.
- **Every Open-Meteo request sets `cell_selection=sea`.** The default is `land`, which
  under-reads offshore wind.
- **Model IDs live only in `MODELS` in `config.js`.** When Open-Meteo renames a model,
  fix it there. Variables are read with `pickVar()`, which tolerates model-suffixed keys.
- **Everything interpolated into HTML goes through `esc()`.** A Content-Security-Policy
  in `index.html` blocks inline script as a second line of defence.
- **Add a control** by writing a handler in `ACTIONS` (`ui.js`) and a `data-act`
  attribute in the markup. No inline `onclick`.
- **`rebuild()`** recomputes the model and repaints; **`render()`** only repaints.

## Develop

Needs Node 18+ for the tests and tools only; the site itself needs nothing.

```
npm test             # 57 tests, no dependencies, clock pinned to Queensland time
npm run bundle       # dist/fishin-control.html — whole app in one file, for local preview
npx prettier --check .
```

The tests pin `TZ=Australia/Brisbane`. The app shows Queensland local time against the
device clock, so a test machine on UTC sees "midnight" ten hours late.

## Data

Open-Meteo (CC BY 4.0): best-match forecast and wave models, with ECMWF IFS 9 km, NOAA GFS
and DWD ICON as wind cross-checks; ECMWF WAM, NOAA GFS-Wave and Météo-France as swell
cross-checks; ECMWF and NOAA ensembles for the probability. Coastline from
OpenStreetMap-derived land polygons. Marks and catch log stay on the device.

Scores are a filter, not a forecast. Check BOM before launching.
