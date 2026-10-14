---
name: release
description: Release Fishin' Control (next -> main, or a minor tweak straight to main) and run the senior dev review. Use when Ashley says release, deploy, ship, go live, "run the senior dev review", or asks for the next build to test.
---

# Releasing Fishin' Control

`main` is the live site (GitHub Pages, root). Nothing reaches `main` without Ashley's explicit go
for that release. Asking for a build to test is not a go.

## Which kind of release

- **Batch release** (the usual case): work from several threads has gathered on `next`. One release
  PR into `next` sets the version, then one PR `next` -> `main`, merged as a merge commit so the two
  branches keep sharing history.
- **Minor tweak** Ashley asks to deploy: branch from the latest `main`, make the change with a patch
  bump, test, and PR straight into `main`. No `next` round trip.

## Steps

1. **Bring everything in.** Merge `main` into `next` if `main` has anything `next` lacks. Check the
   project's open PRs into `next` and ask whether they should be in this release.
2. **Version.** Pick the number (patch for fixes and display tweaks, minor for features). Set it in
   all three places together, which the tests check:
   - `APP_VERSION` in `config.js`
   - `VERSION` in `sw.js` (`'v' + version`): this is what makes phones refetch cached files
   - `version` in `package.json`
3. **Notes.** Rename the CHANGELOG `## Unreleased` heading to the version, in plain English, most
   important first. Update the test count and anything else out of date in README.md. Name any
   site file the release removes, because the web uploader only adds and overwrites.
4. **Checks.** All must pass before the PR:
   - `npx --yes prettier@3.8.1 --write .` then `--check .`
   - `node tests/run.js`
   - `node tools/bundle.js` builds without error
   - The app in Chromium at 390 px and 1280 px, online and offline (see "Checking in a browser"),
     with no sideways scroll, no console errors, and no large empty gaps between cards, including
     on days with extra cards such as closed-season notices
   - If scores, limits or fishing logic were not meant to change: the score proof below
5. **Senior dev review** on any substantial release (below). Fix what it finds, each fix with a
   test, before going on.
6. **Files for Ashley**, in the project's shared folder:
   - `releases/fishin-control-vX.Y.Z.zip`: `git archive --format=zip HEAD` (leaves out `dist/`).
     Unzip it into an empty folder and run the tests there.
   - `releases/fishin-control-vX.Y.Z-preview.html`: copy of `dist/fishin-control.html`.
   - `releases/fishin-control-X.Y.Z-review.md`: the review, if one was run.
7. **Ship, only on Ashley's go.** Open the PR (`next` -> `main`, or the tweak branch -> `main`), wait
   for CI to go green, then merge with a merge commit. Afterwards, check the Pages deploy run went
   green and the live footer shows the new version.
8. **Record it.** Update the live version line in project memory.

## Score proof

To show a change didn't move any call: `git archive origin/main` into a clean folder, then with
`TZ=Australia/Brisbane` and a fixed `Date`, import `model.js` and `advice.js` from both copies.
Run `build()` on the sample data at the standard limits and at relaxed ones, and `sessions()` for
every day and ramp. Dump both to JSON and diff them: they must be byte-for-byte identical.

## Checking in a browser

The cloud container can't reach Open-Meteo or github.io. Serve the repo with
`python3 -m http.server`, and drive Chromium with Playwright using
`timezoneId: 'Australia/Brisbane'`, with routes that abort `open-meteo.com` so the app falls back
to its sample data. For offline, let the service worker install, then call
`context.setOffline(true)` and reload. For accessibility, `npm pack axe-core` and inject it with
`bypassCSP`.

## Senior dev review

When Ashley asks for "the senior dev review", or for a substantial release:

1. Read every file first (source, styles, config, workflows, tests, tools, docs).
2. Look for, in this order:
   - bugs and edge cases (dates and time zones, caching and offline, parsing, races, silent failures)
   - safety logic: confirm limits live only in `passes()` and behave exactly as intended
   - security and privacy (escaping, CSP, stored data, third-party requests)
   - performance (load time, wasted work, Open-Meteo request budget, asset sizes)
   - web and accessibility best practice
   - code quality (dead code, duplication, naming, formatting)
   - tests: every fix has one that fails without it
   - docs: README, CHANGELOG, deploy steps
3. Simplify where it's safe. Never change behaviour, scores or fishing logic without asking. Where
   behaviour shouldn't change, prove it with the score proof.
4. Keep the constraints: top-level site files, no new build step, Android and Windows only, the
   Flight Deck look.
5. Write it up as `releases/<name>-review.md`: a table of findings (most important first) with
   severity and what was done, anything left as is and why, and the checks run.
