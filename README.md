# Fishin' Control — v3

Go / no-go fishing window planner for the coast between Baffle Creek and
Walkers Point, Queensland. Single HTML file, no build step, no dependencies.

## Publish on GitHub Pages

1. Upload **the files in this folder** (not the folder) to the repository root.
   `index.html` must sit at the repo root.
2. Settings -> Pages -> Source: Deploy from a branch -> `main` -> `/ (root)`.
3. First deploy takes a few minutes; the Actions tab shows a green tick.

## Install on Android

Open the site in Chrome and wait a few seconds. An **Install** button appears in
the header once Chrome accepts it. If it does not, add `?check` to the address
for a pass/fail list of every install requirement.

## What is in v3

- New fish-rocket logo, in the header and across the icon set
- Wind and sea sampled 10, 15 and 20 km offshore, scored on the worst of them
- Swell period weighting, wind-against-tide bar warnings
- Ensemble probability of a usable window
- Your marks and catch log, feeding back into the bite score
- Non-blocking fonts, preconnects, parallel startup

Marks and catch log are stored on your device only and are never uploaded.
