# Changelog

## 6.1.1

- **One name for the area.** The header and the browser tab now say "Wide Bay", to match
  the loading screen (they said "Bundaberg coast").
- Tests: 223.

## 6.1.0

Everything since 6.0.4 in one release: the new Caution and advisory panel, the Rivers
page's own fish list with five new paintings, the ten design-critique fixes, and a fix
for a spacing bug on wide screens. Scores, limits, windows and the GO / HOLD / NO GO calls
are unchanged: on four test forecasts every score, verdict, limit check, window, session
and launch note is byte-for-byte the same as 6.0.4.

- **No gaps on a day with a bar warning or a closed season coming up.** Those cards sat
  at the foot of the launch sites column. On a computer that column runs beside the
  score, countdown and panel, so a longer column opened gaps of up to 160 px above and
  below the countdown (every day from 18 October, with the barramundi closure coming
  up). The Rivers page had the same gap under its score card. The cards now sit in a row
  of their own: under the launch sites on the Ocean page, under the panel on the Rivers
  page. When a site brief runs long, the panel's bezel grows to meet the foot of the
  sites instead. On a phone the order is unchanged.
- Tests: 223.

A design tidy-up from the design critique of 13 October: all ten fixes. Scores, limits,
windows, sessions and the GO / HOLD / NO GO calls are unchanged. On four test forecasts
every score, window, limit check and session time is byte-for-byte the same as before.

- **No more big gaps on a tablet or computer.** The cards under the panel now pair up so
  neighbours end level. On the Ocean page: conditions beside tide, the flight plan beside
  what's biting, then the pre-launch checks. From 1180 px, conditions and tide run down
  the left, with the flight plan and pre-launch checks side by side and what's biting
  (its fish in one row) under both. On the Rivers page, tide sits beside the flight plan
  with what's biting full width below. The launch sites and rivers lists run to the foot
  of the column beside them.
- **The daily score says what it is made from.** Under the Ocean tank: "Launch 16 · Bite
  65". The tank blends the best ramp's launch score with the bite, so it used to show 29
  while every ramp showed 16, with nothing to say why.
- **The best ramp's figures sit beside the call** (best ramp, swell and period, wind,
  gusts, close in, at 20 km, chop, bar). This fills the empty half of the score card on a
  phone and replaces the loose tags that sat under the caution panel.
- **Colours agree with their words.** A ramp's wind tag turns red over your limit, as
  swell and gusts already did (it could only reach amber). The best ramp is green or
  amber only when it is a go or a maybe, never a red "launch here". "River day" now has
  "Ocean · No go" above it, so its red reads as the ocean's, not the rivers'.
- **One word for amber: HOLD.** The map legend says Hold (was Marginal), and the loading
  screen says Hold for some feeds down or a saved copy (was Partial or Saved). The big
  call keeps its words (Worth a look, Marginal).
- **The Rivers caution and advisory panel is an annunciator too,** with seven keys. Long
  readings are shortened on the key (Turns: "2 turns", Water: "run-off") and read out in
  full to screen readers. The tide times are on the tide chart just below.
- **The conditions chart is easier to read.** Storm hours are white hatching instead of
  an amber tick that matched the wind line. Swell has its scale on the left and wind on
  the right. The legend fits on one line.
- **A shorter Ocean page on a phone.** On a river day, "Outside is out today, so fish the
  system instead" is said once at the top of the flight plan instead of in every
  session. Pre-launch checks show four links (BOM Capricornia Coast, BOM Hervey Bay
  Waters, BOM radar, MSQ tide tables), with the other eight under "More links".
- **Bigger targets and labels.** Link buttons are 44 px tall (40 px in pre-launch
  checks), as are the fold-out rows. "River view" is a full-size button beside the other
  links. Labels in the sections bar, the countdown, the ramp tags, the score caption and
  the call's heading go from 10 px to 11 px.
- **Polish.** The call's heading wraps whole, so the date never splits ("Oct" alone on a
  line). The countdown moves under the 7-day forecast on a phone, and runs as a strip
  under the score and chart on a wider screen. The loading screen is centred on a tall
  phone.

- Tests: 222.

The Rivers page now has its own "What's biting" list. It used to show the ocean list, so
spanish mackerel, coral trout and red emperor turned up on the rivers. Scores, limits and
the GO / NO GO calls are unchanged: on four test forecasts every score, verdict, limit
check, window, session and launch note is byte-for-byte the same as 6.0.4.

- **River and creek fish only on the Rivers page,** month by month, for Baffle Creek, the
  Kolan, Burnett, Elliott, Gregory and Burrum: mangrove jack, barramundi, king threadfin,
  blue salmon, grunter, flathead, whiting, bream, estuary cod, trevally, queenfish,
  mulloway, mud crabs and prawns, with river baits, lures and a note for each month.
  Built from the Bundaberg fishing reports and the Queensland rules.
- **Barramundi are off the river list from November to January,** while the east coast
  closure is on, since the rule is not to target them at all. The month notes say so.
- **The day's notes on the Rivers page talk about the river.** Neap tides suggest the
  flats and snags instead of going wide, and warm water mentions jacks and threadfin
  instead of pelagics.
- **The Ocean page's fish list is unchanged.**
- **The catch log** offers the river fish as well as the ocean ones.
- **New paintings for the river fish:** estuary cod, trevally, queenfish, mulloway and
  prawns, in the same style, size and framing as the other 21. A species added later
  without a painting shows a faint fish silhouette until its picture arrives.

The Caution and advisory panel on the Ocean page is redrawn as a cockpit annunciator
panel, and the wide-screen layout no longer leaves gaps. Scores, limits and the GO /
HOLD / NO GO calls are unchanged: the same eight lamps, worked out the same way.

- **The panel looks like the advisory panel in a cockpit.** A navy bezel with a screw in
  each corner holds eight glass keys. Each key glows green, amber or red, with the call
  in small letters on top, the station name large (WIND, SWELL…) and its figure
  underneath. The heading and the tally (for example 3 GO · 1 HOLD · 4 NO GO) sit on the
  bezel. Two keys to a row on a phone, four on a tablet or computer.
- **No more gaps on a wide screen.** The panel now sits straight under the daily score,
  the week and the chart, with the launch sites after it. From 1180 px wide the launch
  sites run down a third column beside the panel, so the panel fills the space under the
  score and the chart that used to sit empty.
- The Rivers page keeps its panel as a list, as its readings are longer.

- Tests: 212.

## 6.0.4

New names, and the week moves up so the page reads from the top: today's score, then the
week's scores, then the detail. Scores, limits and the GO / NO GO calls are unchanged: on
the sample forecast every day, ramp and figure on the page is the same as 6.0.3, only
the headings and their order differ.

- **New names.** 7-day telemetry is now the **7-day forecast** and the score tank is now
  the **Daily score**, on the Ocean and Rivers pages alike. The launch poll is now the
  **Caution and advisory panel** on both pages. The chart heading
  "Launch control · chart" is now just **Launch control**. Screen readers hear the new
  names too.
- **The loading screen now reads "Wide Bay"** under the name, instead
  of "Launch control · Bundaberg coast".
- **The 7-day forecast sits straight under the daily score,** where the launch poll was,
  and the Caution and advisory panel follows it, on the Ocean and Rivers pages. On a wide
  screen the week sits in the first column under the score, and the panel runs across
  the full width under the three columns, where the week was: four stations to a row on
  the Ocean page, the river stations in two columns.
- Tests: 202.

## 6.0.3

- **Tapping a day in the 7-day telemetry keeps you where you are.** It used to scroll
  back to the top of the page. The tapped day now stays under your finger, so you can
  scroll up to the call or down to the chart from there.
- **Go-day alerts now come on Go days only (75 or more),** the same days the app calls Go.
  They used to come from 70, so a "Worth a look" day could send "Go for launch". The
  alerts panel says so. Scores, limits and the GO / NO GO calls are unchanged.
- Tests: 199.

## 6.0.2

Colours now match the words beside them. GO / NO GO calls, scores, limits and fishing
logic are unchanged: on 88 test forecasts the old and new versions give the same calls,
verdicts and figures. Only colours differ, plus the two lines of wording below.

- **Score tank:** changes colour where the verdict changes. Green from 75 (Go), amber from
  42 (Worth a look, Marginal), red below (River day). A score of 70 to 74 used to show a
  green tank beside "Worth a look". The river tank does the same at the river verdict's
  70 and 40. The tank ticks and the 7-day telemetry dashed lines moved to match.
- The same lines colour every other ocean score (launch sites list, map pins, the
  Launch pill, the 7-day bars) and the river score, so they all agree with the tank.
- **Bite:** the figure turns green at 60 and amber at 45, the same as the Bite lamp in the
  launch poll. It used to be 70 and 48.
- **Models:** the ensemble % turns amber from 35%, where the Models lamp turns HOLD, and
  green from 70%. It used to be red below 48%.

**Fixes (from the senior dev review)**

- The Models % now takes the colour of its Models lamp. When the forecast models disagree,
  the lamp drops to HOLD even at a high %, and the figure used to stay green beside it.
- The pre-launch checks sentence now calls 35% to 69% "genuinely borderline", matching the
  HOLD lamp. Between 35% and 39% it used to say "most runs say you get nothing".
- The go-day alerts panel said you are notified "when a day turns green". Alerts still go
  at a score of 70 or more, which can now be an amber day, so it says that instead.
- Tests for the river colours, the week chart's dashed lines and the verdict word cut-offs,
  which were not covered. Tests: 198.

## 6.0.1

Checks that the forecast and other sources are still coming through the way the app
expects, so a change at their end is caught rather than quietly giving wrong calls.
Scores, limits and fishing logic are unchanged.

**In the app**

- If a forecast answers but leaves something out (gusts, storm codes, tide heights,
  sunrise times and so on) or sends it in different units, the forecast screen shows a red
  **Forecast data incomplete** panel naming what is missing. Before, a missing figure
  quietly read as zero: with no gust figures, gusts could never stop a GO.
- No go-day alert is sent from a forecast with fields missing, on the phone or in the
  background, just as none is sent from a saved copy.
- Data sources has a new **Forecast details** line: "all fields present", or what is
  missing.

**Daily check (on GitHub, not in the app)**

- Every morning just after 6 am a check on GitHub makes the same forecast requests the app makes,
  reads the DPI closed seasons page and tries every link in the app. If something has
  changed (a model renamed, a field dropped, the DPI page updated, a link gone), it opens
  an issue on the repository and GitHub emails you. It closes the issue itself once
  things are back to normal. A busy or briefly down service does not raise an alert.
- DPI's website turns away GitHub's machines, so a monthly Claude check reads the closed
  seasons page instead and reports in the project only if DPI has updated it.

- Every pull request and every change to the live site now runs the tests and the
  formatting check on GitHub too, so a broken change is caught before it goes live.

**Fixes (from the senior dev review)**

- A go-day alert could be sent from a forecast with gust or storm figures missing, which
  read as calm. Alerts now wait for a complete forecast.
- A day when the forecast service was busy could close a reported problem as "back to
  normal" without proving it. Only a clean run closes it now.
- If the forecast service was rate limiting GitHub, every request was retried, long
  enough to outlast the run. After one request has used its retries, the rest are tried
  once.
- The schedule keep-alive was skipped on any run where an earlier step had failed.
- The link check downloaded every page; it now only needs the answer code.
- GitHub's own actions updated to their current versions (the old ones were warning).
- The Willyweather Burnett Heads tide link had moved (the first run of the new check
  found it). It now points to the current page.

**Tests**

- 189 tests (25 new): the app flagging a dropped field, new units, missing tide heights
  and sunrise times, the backup wave model not being faulted for what it has never sent,
  the warning on screen, no alert from an incomplete forecast, the daily check telling a
  change from an outage, and one test for each review fix.

## 6.0.0

The "Flight Deck" redesign: every screen rebuilt as a launch-control console, and a
proper layout for a computer screen. Look and feel only. Scores, limits and fishing logic
are unchanged — checked by building the same forecasts (88 cases, across both sides of
every limit) with 5.1.1 and 6.0.0 and comparing every figure.

**New look**

- Square panels on a faint chart grid, spaced capital labels, and corner brackets on the
  launch clock, the import panel and the log form.
- The score is a **tank** that fills with water to the score, with ticks at the green (70)
  and amber (48) lines. It keeps the faint water and drawn surface line of the old dial.
- The verdict is big beside the tank ("GO for launch"), in the colour of what it says.
- The launch poll is a board of station lights: one tile per station, each with its own
  lamp. The rivers poll lists its stations one per line.
- The week is a **7-day telemetry** bar chart: one bar per day at its score, dashed lines
  at 70 and 48, the window track and the ensemble odds under each day.
- Map: square score markers, and ramp names on dark plates with a bar of the ramp's
  colour. The markers and your marks are easier to tap.
- The sections bar (Forecast, My marks, Catch log) sits along the bottom of a phone
  screen, within thumb reach, with icons.
- Header: the live / saved / sample status sits under the wordmark with a coloured lamp,
  and Refresh and Install are icon buttons.
- My marks: the Helix steps are numbered. Catch log: patterns show as bars.
- The conditions and tide charts are drawn at phone width, so their labels are readable.

**Loading screen**

- The logo on a radar scope in corner brackets, and a **systems check** that reports what
  the app has really done: the app loaded, how many forecast feeds came back and how many
  answered (amber if some are down or the phone's saved copy stood in), the forecast
  built, and whether go-day alerts are on. The loading bar is in 20 segments.

**Computer screens (900 px and wider)**

- The sections bar moves to the top, with the Ocean / Rivers switch at its right.
- The forecast spreads into three columns: clock, score and poll; the chart; launch sites
  and warnings. The week runs full width beneath, then the rest as cards in columns.
- My marks and Catch log sit in two columns.

**Fixes (from the senior dev review)**

- Keyboard focus could jump to the wrong control after a tap: to a ramp's map marker
  instead of its list entry, or to the first species chip.
- The `?check` install self-check page had lost its styling.
- An error during start-up could leave the loading screen up for good. It now shows the
  error with a Try again button.
- "0 of N up" for data sources now shows red, not amber.
- One date style everywhere ("Tue 13 Oct").
- Screen readers no longer read out each line of the loading checklist as it changes.
- The smallest labels are 10 px, and secondary text no longer uses the dimmest colour.

**Tests**

- 164 tests (14 new), including the tank level, the week chart, every ocean section still
  being present, the systems check, and one test for each fix above.

## 5.1.1

Map tidy-up and a senior dev review. Scores, limits and fishing logic are unchanged in
normal running — checked by building the same forecasts with 5.0.1 and 5.1.1 and
comparing every figure.

**Fixes (most important first)**

- **A saved swell copy could be a day out, and was shown as live.** If the wave service
  was busy or down while the wind service answered, the phone's saved swell forecast
  stood in, which is right, but its figures were matched to the wind hour by hour from
  the top of the list. A copy saved yesterday therefore put every swell figure a day out,
  under a "Live" label. Swell is now matched to the wind by the actual time, and a saved
  swell copy is flagged on screen ("Saved swell forecast — not live"). Go-day alerts
  are never sent from it, the same as for a saved wind forecast.
- **Data sources panel.** It now says when the swell came from the backup wave model,
  and when any source answered from the phone's saved copy, rather than "best match".

**Map**

- Ramp names back to their earlier size, on smaller pills.
- "10 KM" and "20 KM" are plain text again, with no background. Each one moves to the
  other side of its ring if it would otherwise land on the coast.
- Town names back to their earlier size.

**Code quality**

- The coastline is projected onto the chart once, not twice.

## 5.1.0

Look and feel only. Scores, limits and fishing logic are unchanged.

**Loading screen**

- A proper loading screen with the real logo on a radar scope, the wordmark and
  "Reading the water…" over a loading bar. The bar follows the forecast requests as they
  come back, so it shows real progress, then the screen fades into the app. With reduced
  motion switched on in Android, the sweep and the glint on the bar stay still.
- The "files missing from the site" help still appears if the app's files fail to load.
- New file: `logo-448.webp` (the logo at splash size, stored for offline use).

**Score dial**

- Kept the water filling the dial, but the water is now much fainter with its surface drawn
  as a line, and "out of 100" is in light text. It now reads clearly in green, amber and red.

**Map**

- No more dark outlines around map text — nothing else in the app has them. Ramp names
  now sit on pills edged in the ramp's colour, like the score pills elsewhere in the app.
- Distances ("10 KM", "20 KM", the scale bar) are small spaced capitals like the app's
  section labels, set in a gap cut into their ring. Town names are plain text.
- Ramp markers and their scores are a little larger, so they're easier to tap and read.

## 5.0.1

Senior dev review of 5.0. Scores, limits and fishing logic are unchanged — checked by
building the same forecast with 5.0 and 5.0.1 and comparing every score.

**Fixes**

- **Windows ran past your cut-off.** A window could end up to an hour after "an hour
  after sunset", because the last hour was counted to its end. Windows now stop exactly at
  the end of your fishing hours (affects the countdown, alerts and session times only).
- **Swell fallback could fail for the wrong reason.** When the main wave forecast failed,
  the backup request also asked for tidal currents and sea temperature, which that backup
  model may not provide. It now asks only for the wave figures it is there to supply.
- **Double-saved catch log entries.** Tapping Save again while the phone was finding your
  location saved the session twice. A second tap is now ignored until the first finishes.
- **Go-day alerts opened the river page** if that was where you left the app. Tapping an
  alert now always opens the ocean page for that day.
- **A blank mark position was read as 0°, 0°.** Damaged positions are now dropped.

**Accessibility**

- The map was marked as an image, which hides its ramp and mark buttons from screen
  readers. It is now a group of controls.
- The "Choose file" button for importing marks now works from a keyboard.

**Code quality**

- The "how close to new or full moon" sum was written out in four places; now one helper.
- River tide turns and feeding times are worked out once in the model, not again in the
  page.
- New tests for every fix, each confirmed to fail when its fix is removed.

## 5.0

Built from your answers about how you actually fish. Your limits are unchanged: nothing
here can turn a NO GO into a GO.

**Ocean**

- **Fishing hours** now run from an hour before sunrise to an hour after sunset (were 15
  minutes either side), so early and late windows count.
- **Northerlies** take a few points off the score (up to 4 at your wind limit, straight
  from the north, fading to nothing by east and west).
- **Wind against the tide.** The forecast now includes the tidal current at each 10, 15
  and 20 km point. When the wind blows against it, the score drops a little — more the
  harder both are running.
- **Thunderstorms.** Hours with a forecast thunderstorm, and the hour before, lose 20
  points; hot, unstable, showery hours lose 8. A new **Storms** row on the launch poll says
  when the risk starts (HOLD at worst — never a hard stop), and the conditions chart marks
  storm hours with an amber tick.

**Rivers and creeks**

- A switch at the top of the Forecast tab: **Ocean / Rivers and creeks**. The river page
  has its own score, day strip and poll — tide, turns in fishing hours, moon, feeding
  times, run-off after heavy rain, and wind only when it's strong close in.
- Pick the system (Baffle, Kolan, Burnett, Elliott, Gregory) and get tide-based sessions
  told for the river.

**Marks**

- **Import from your Helix.** Choose DATA.HWR (or a GPX file) on the My marks tab. Each
  mark is matched to its nearest ramp with its real distance, given a ground type from its
  name, and kept on your phone only. Marks more than 25 km from your ramps are left out;
  importing twice adds nothing twice. Long lists fold away per ramp.
- **On the map:** your marks for the selected ramp show as dots; tap one for its name,
  distance and depth.

**Catch log**

- Tap the species you caught instead of typing them (this month's species first).
- Save while you're out and the nearest of your marks is added from the phone's location.

## 4.9.2

- The northern and southern limit markers are no longer drawn on the chart, and the
  shaded range is simply every ramp's 20 km reach (cutting it off at invisible limit lines
  left odd straight edges). The limits are unchanged in the app itself: the ramps,
  sample points and forecasts are exactly as before. Chart scale and framing unchanged.

## 4.9.1

The chart, redrawn. Scores and forecasts are unchanged.

- **Real coastline.** The blocky 1 km outline is replaced with full-resolution GSHHG data,
  so the Baffle, Kolan, Burnett, Elliott and Gregory river mouths and the headlands are
  drawn properly. Smaller than before (~5 KB).
- **Framed on your water.** The chart now covers Baffle Creek to Walkers Point and 20 km
  out, instead of a lot of empty bay and K'gari, so everything is larger.
- **Limit markers.** Northern and southern limits drawn as amber dashed lines (removed
  again in 4.9.2).
- **Your 20 km range** is shaded.
- New chart styling to match the logo: a glow along the shore, a fine dot texture on the
  land, a faint 10-minute grid, compass and 10 km scale, launch-control corner brackets,
  and larger ramp markers with labels that stay readable over the coastline.
- Bundaberg and Bargara marked for orientation.
- Focus is restored after a redraw only for keyboard users, so a tap never leaves a focus
  ring behind.

## 4.9

New logo, then a full code review. Forecast logic, scoring and limits are unchanged.

**Logo**

- The new fish-rocket badge in the header, the favicon, notifications and the install
  icons (including Android's maskable icon, drawn inside the safe zone).

**Fixes**

- The service worker could store stale files on an update: GitHub Pages lets browsers
  cache files for ten minutes, and the install step read from that cache. It now always
  fetches fresh copies.
- Every update threw away the saved forecast used when you're out of signal. That store is
  no longer tied to the version.
- Saving a forecast or a page for offline use could be cut short when the phone suspended
  the worker. Each save now holds the worker open until it finishes.
- Tapping a go-day notification now opens the app on that day, as the alert promises.
- Keyboard focus is kept on the button you pressed instead of being lost on every redraw.
- Marks and catch-log entries are cleaned when loaded, so a damaged entry can't break the
  page or inject markup.
- Scroll-to-top respects the phone's "reduce motion" setting.

**Faster and simpler**

- The 1,900-line SVG fish-drawing kit is gone (53 KB of code on every load). Every species
  has a picture now, so it was dead weight.
- Fonts are now served by the site itself instead of Google Fonts: no third-party request,
  the right fonts work offline, and the security policy is tighter. One variable font per
  family covers every weight.
- Every module is preloaded, so the browser fetches them in parallel instead of one level
  of imports at a time.
- The page request starts while the service worker wakes up (navigation preload), and
  update checks skip the HTTP cache.
- The large install icons are no longer stored by the app; only Chrome's installer reads
  them.
- The model no longer rebuilds the same lookup table for every ramp and day.
- Dead code and unused styles were removed.

**Best practice**

- Native controls (the date picker and drop-downs) use the dark theme, and the layout
  respects the safe areas on phones with a notch or rounded corners.
- The section switcher uses plain buttons with `aria-current` rather than half-built ARIA
  tabs.
- Data and map attribution in the footer: Open-Meteo (CC BY 4.0) and OpenStreetMap
  contributors.
- The manifest states the app's id explicitly, keeping the id Chrome already uses, so the
  installed app stays the same app.
- The single-file preview carries all its images and fonts.
- The tests now also check that every referenced file exists and is stored for offline
  use, that fonts are self-hosted, that the page connects only to the forecast service,
  the service worker's update rules, icon sizes, and version numbers.

## 4.8.1

- **New species artwork.** All 21 illustrations replaced with a cleaner, more
  detailed set, each drawn on its own canvas, so none are cut off and none carry
  pieces of neighbouring animals. Prepared the same way (600 × 320 WebP, centred,
  scaled whole); about 0.5 MB in all. Nothing else changed.

## 4.8

- **Painted species illustrations.** The "what's biting" cards now show a set of 21
  painted illustrations in place of the drawn fish. Names, seasons, scores and closures
  are unchanged.
- Each picture was cleaned up: background haze removed, stray pieces of neighbouring
  animals from the source sheet removed, and the eight that were cut off (barramundi,
  tuskfish, red emperor, mangrove jack, flathead, whiting, squid, mud crab) replaced with
  redrawn versions.
- Every picture sits centred on the same 15:8 canvas and is scaled whole
  (`object-fit: contain`), so cards line up and nothing is stretched or cropped. Closed
  species grey out as before.
- About 0.5 MB in all (from 14 MB of source PNGs), stored by the service worker so the
  cards work offline. Same-site files only, so the security policy is unchanged.
- The SVG drawings stay as the fallback for any species without a picture.
- The single-file preview carries the pictures inside it.
- New `tools/prepare-species.py` rebuilds the pictures from source artwork.

## 4.7

- **Fins rebuilt to real anatomy.** On nine perch-shaped species the dorsal fin was
  drawn back to front — spines towards the tail, soft rays towards the head — and the
  anal fins' tallest rays were at the rear. Fins are now defined ray by ray from the
  head end, with real spine and soft-ray counts, so each species carries its own
  profile: the grunter's tall spiny dorsal and long anal "javelin" spine, the
  barramundi's separate triangular spiny dorsal, the coral trout's low spines rising
  into a tall soft dorsal, the bream's stout spines, the sickle-shaped second dorsals
  of the threadfins, mackerels and tunas, and the mac tuna's tall leading dorsal.
- Spines stand just proud of the membrane, which dips between them; soft rays share
  a smooth edge. Tuned at phone size so fins read as fins, not combs.
- **Mouths** are now a fine gape line sized to each species — small on bream, whiting
  and grunter, a wide gape on barramundi, coral trout, jack and flathead — instead of
  a thick stroke that read as a grin. The big-mouthed predators show the outline of
  the upper jawbone.

## 4.6

- **Every species redrawn** in a flat illustration style: side-on, no gradients, fins
  tucked behind the body so they join cleanly, crescent scale marks, a curved gill
  cover, fin rays, a lateral line along the flank, and an eye with a catchlight.
  Each species is drawn individually with its own proportions and markings — the
  snapper's blue spots, the bream's yellow ventral fins, the barramundi's concave
  forehead, fan tail and red-amber eye, the mackerels' finlets and lunate tails, the
  threadfins' free pectoral rays. Squid and mud crab are redrawn to match; the crab
  now has the heavy crushers and nine-toothed shell edge of a real mud crab.
- No outlines: every fish was checked on the app's card colour and holds its edge
  without one, matching the reference style.
- The biting list shows two to a row on phones so the illustrations have room, and
  closed species grey out cleanly.

## 4.5

- **Launch clock.** The countdown is now a NASA-style clock — T− DD : HH : MM : SS with
  Days, Hrs, Min and Sec beneath — ticking every second while the app is in view. Once a
  window opens it turns green and switches to T+, counting up from the opening as a
  launch clock does after liftoff, with the closing time above. Set in the same face and
  spaced capitals as the wordmark, with fixed-width digits so nothing shifts as it ticks.
- The tick updates only the digits each second and pauses while the app is in the
  background.

## 4.4

- **Models station read NO GO beside "100%".** The row showed the ensemble figure but
  took its verdict from a separate comparison of the three headline models. The
  ensemble — built specifically to measure forecast uncertainty — now leads; the
  three-model spread can only downgrade a GO to a HOLD.
- That comparison also no longer caps the day when the ensemble is confident (70 % of
  runs or more). Without an ensemble it still caps as before.
- The model comparison was flawed in two ways, fixed: it compared the _swell_ partition,
  which wave models split very differently at short periods (a 4 s sea is mostly wind
  sea), so it read a labelling difference as disagreement — it now compares total wave
  height. And it compared all 24 hours; it now compares daylight only.
- Poll figures now describe the hours the verdict is about: Swell, Wind and Gusts show
  the best window's values, and Window shows its times. Previously a day-peak gust of
  16 kn sat beside a GO for a window where gusts stayed under 12.

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
