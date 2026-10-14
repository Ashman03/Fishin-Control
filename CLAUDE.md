# Fishin' Control

Static PWA that gives GO / NO GO fishing-launch calls for a small boat on the Wide Bay coast
(Baffle Creek to Walkers Point, Queensland) from Open-Meteo forecasts. GitHub Pages serves `main`
from the root. No build step, no runtime dependencies. How the code fits together, and the detail
behind each rule below, is in README.md ("How it works" and "Rules worth knowing").

The owner, Ashley, is not a developer and uses an Android phone and Windows PCs only. Explain in
plain English, give finished files rather than code to paste, and never give Apple steps.

## Commands

```
node tests/run.js                        # all tests; clock pinned to Australia/Brisbane
npx --yes prettier@3.8.1 --write .       # format (CI runs --check with this version)
node tools/bundle.js                     # dist/fishin-control.html, one-file preview
```

CI (`.github/workflows/tests.yml`) runs the tests and the Prettier check on every PR and on main.

## Safety rules (never break these)

- **Boat limits** (swell 0.7 m, wind 10 kn, gusts 12 kn, 20 km offshore) are compared only in
  `passes()` in `model.js`, and are never loosened.
- **Ask Ashley before changing scores, limits or fishing logic.** A change that isn't meant to alter
  behaviour must prove it: build the same forecasts on `main` and on the branch and diff the output.
- **Soft factors** (northerlies, wind against current, storm risk) only lower the ranking score.
  Only `passes()` decides GO / NO GO.
- **No real fishing marks in the code.** The site is public.

## Code rules

- **Every fix gets a test that fails without the fix.** Remove the fix and check the test goes red.
- **All site files sit at the top level**, because Ashley uploads with GitHub's web uploader, which
  can't send folders. `tests/`, `tools/` and dot-folders are for development only.
- Every `.js` file the app loads is listed in `sw.js` (offline) and preloaded in `index.html`.
  The tests check both.
- Everything put into HTML goes through `esc()`. No inline scripts or `onclick`: add a handler to
  `ACTIONS` in `ui.js` and a `data-act` attribute.
- Upstream model IDs live only in `MODELS` in `config.js`. Every Open-Meteo request sets
  `cell_selection=sea`. Mind the free tier's request budget.
- Match the surrounding code: Prettier settings in `.prettierrc.json`, short comments that say why.
- Changes to `.github/` must go through a PR (the web uploader can't send it).
- Look and feel: follow README "Look and feel". No outlined text anywhere, and no native pop-up
  menus or dialogs (use in-app dropdowns that open in place).
- The design skills (Impeccable, UI UX Pro Max) give way to Ashley's choices: see
  `.claude/skills/README.md`.

## Branches and releases

- `main` is the live site. Nothing merges to `main` without Ashley's explicit go.
- Normal work: branch from `next`, merge `next` in before opening the PR, PR into `next`. Don't bump
  the version; note changes in CHANGELOG under "Unreleased".
- Releases, minor tweaks straight to `main`, and the senior dev review: use the `release` skill
  (`.claude/skills/release/SKILL.md`).
