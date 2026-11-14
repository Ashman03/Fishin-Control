# Fishin' Control history data

This branch holds the files behind the app's History tab. It is rebuilt every
morning by the **History update** workflow (`.github/workflows/history.yml` on
main) and replaced as a single commit, so do not edit it by hand.

- `summary.json`: one row per day for the last three years (see `history.js`).
- `hours/YYYY-MM.json`: each ramp's hours for every day of one month.

Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0).
