# AgriGrow Control

A small HTML, CSS, and JavaScript dashboard for the AgriGrow development data.

## Run locally

From the repository root, run `python -m http.server 8765 --directory Web-Control-Dev` and open `http://localhost:8765`. The JavaScript modules need an HTTP server; opening `index.html` as a `file://` page is not sufficient.

The page uses Bootstrap 5.3.8 and Firebase's browser modules from their CDNs. Its Firebase web configuration is in `js/firebase-config.js`.

## Firestore data

- `marketPrices/{productId}`: one current demo price per product, including its previous price for the movement indicator. Prices are province-wide and fixed to PHP per kilogram.
- `weatherRecords/davao-del-sur_YYYY-MM-DD`: one simulated weather document per Philippine date. Existing legacy weather documents are preserved.
- `contentVersions/prices` and `contentVersions/weather`: revision counters. Weather revisions change transactionally only when a missing date is created or a period actually changes. The mobile app can check these before offering a sync.

The market board shows product name, category, price movement, and current price. Click a product name to edit or delete it. Its three editable fields are product name, category, and current price; movement is calculated automatically from the previously saved price.

Overview summarizes active products, price increases and decreases, average current price by category, and the five largest percentage movements using the previous saved price. It also shows the current Philippine-time weather period and the seven saved forecast days as a daily high/low chart. The market does not store historical daily prices, so the movement chart compares each product with its previous saved value. Missing or unavailable data is shown as such rather than invented.

The website uses a phone-width viewport and stacks each market row into a two-line layout on narrow screens. On a touch phone, pull down from the top of the page to refresh the Firestore data. Desktop users can use the browser's normal reload command.

`js/seed-data.js` remains as a reference dataset with 30 invented sample prices for fruits, vegetables, and spices. The page no longer offers a seed action and does not write these samples automatically.

Delete marks a record inactive (`isActive: false`) instead of removing its Firestore document. This lets a future mobile sync remove it from the visible local cache. Use **Show deleted** to edit or restore those records.

## Access

This development page intentionally has no login. Its browser code can write only where Firestore Security Rules permit it. Without authentication, Firestore cannot tell the site owner apart from another client with the same public web configuration. Do not deploy public write rules for this project. If the existing rules deny access, the page shows the Firestore error and leaves the data unchanged.

The page does not store a service-account key or any weather or market-provider API key.

## Seven-day weather board

Weather uses the device clock converted to `Asia/Manila` (UTC+8), Celsius, and today plus six upcoming days. All values are **simulated**, not a real weather service or warning system. The clock updates every second. Daytime Sunny is excluded from midnight and evening.

| Period ID | Philippine time (start inclusive, end exclusive) |
| --- | --- |
| `midnight` | 00:00–06:00 |
| `morning` | 06:00–11:00 |
| `lunch` | 11:00–13:00 |
| `afternoon` | 13:00–18:00 |
| `evening` | 18:00–24:00 |

Generation runs on opening, Weather-page entry, refresh/pull-to-refresh, reconnection, Philippine midnight, and browser resume. Nothing runs while the website is closed. The next opening fills the current window. There is no scheduler, server, billing setup, or authentication change.

The generator uses location, date, and generator version as its seed. A Firestore transaction reads the seven deterministic document IDs before creating only missing records. Simultaneous clients retry on conflict. Legacy or unsupported records are never replaced automatically. An edit transaction reads the latest document so edits to different periods do not discard each other.

Select a period to stop following the current time; **Now** resumes. Clicking a small day card previews its afternoon details in the main card, with Today placed in its original small-card slot. Both cards flip together over 600ms and replace content halfway through. Selecting another future date returns the previous date to its original slot. Clicking the small Today card restores today's live period. Swaps only change local viewing state and never write forecast data. All small cards animate. Reduced-motion users get immediate swaps. The Edit period and separate Today controls have been removed from the board.

The last successful window is saved under localStorage key `agrigrow.weather.window.v2`. While offline, the loaded page uses that cache and reports its age. Dates outside the cache are unavailable, not generated locally as saved data. An initial website load still needs the HTML/CDN runtime available; this phase does not install an offline application shell or integrate the mobile app.

### Schema v2

Documents contain `schemaVersion: 2`, `generatorVersion: 1`, `locationCode`, `locationName`, `forecastDate` (`YYYY-MM-DD`), `timezone`, `source: "Simulated weather"`, `isActive`, `createdAt`, `updatedAt`, `minTemperatureC`, `maxTemperatureC`, and `periods`.

`periods` is keyed by the five IDs above. Each entry contains `condition`, `temperatureC`, `rainChancePct`, `humidityPct`, `windKph`, and `overridden`. Condition IDs are `sunny`, `cloudy`, `rainy`, `heavy-rain`, and `heavy-rain-thunder`. Period boundaries are fixed in `js/weather-core.js`. Keep earlier generator implementations available if a future version changes the seed algorithm so old resets remain repeatable.

### Artwork

Weather now uses fixed transparent watercolor parts in `assets/weather/layers`, rendered by `js/weather-art.js`. Shapes and textures stay identical throughout the animation. Sunny has a fixed disc and foreground cloud with rays rotating over 40 seconds. Cloudy has two overlapping clouds drifting right over 20/28 seconds, fading only around their invisible reset. Rain clouds stay fixed; light/heavy drops fall independently with staggered timing. Thunder adds a gently fading bolt on a nine-second cycle, without a full-card flash.

Compact cards use the same animated layered composition, including two clouds for Cloudy. Reduced-motion preferences disable all layer animations, and hidden tabs/panels pause them. `animation.json` describes the reusable layer assets and motion parameters; `layers/prompt.json` records the built-in imagegen prompt, and `layers/extraction.json` records the atlas crop rectangles. Previous sprite sheets remain available; their metadata is preserved in `animation-sprites.json`.

### Verification

Run from the repository root:

```powershell
$env:TZ = 'America/Los_Angeles'
node --test Web-Control-Dev/tests/weather.test.mjs Web-Control-Dev/tests/weather-controller.test.mjs
```

The 13 tests cover time boundaries, midnight/month/year/leap-day rollover, resume after several days, deterministic bounds, edit/reset, optimistic transaction retries, no-op revisions, legacy preservation, offline cache, missing dates, failures, and reconnection. The transaction tests use an in-memory optimistic adapter rather than changing live data.

Live browser verification also covered Firebase generation, an override surviving reload, reset, two-tab reloads without a revision increase, date/card switching, dropdowns, 1440px desktop and 360px mobile layouts, no horizontal overflow, and scrolling with hidden scrollbars. The temporary live edit was reset to its generated values.
