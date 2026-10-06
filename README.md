# UniSuper "Our locations" — prototype

A working prototype of an improved [Our locations](https://www.unisuper.com.au/contact-us/our-locations) page, shown in three versions:

| View | URL | Who it simulates |
|---|---|---|
| **Guest** | `?view=guest` | Public visitor, not logged in |
| **Logged-in member** | `?view=member` | Member signed in to MemberOnline |
| **Consultant (impersonating)** | `?view=consultant` | Member Services consultant already in a session with a member (as if opened from the CRM on an inbound call) |
| **Mobile web (guest)** | `?view=mobile-web` | The website in a phone browser, not logged in, inside a phone frame |
| **App (logged in)** | `?view=app` (`&member=10000004` to choose the member) | The UniSuper app's **More** tab, recreated from a screenshot of the real app (blue header, grouped cards, Overview / Investments / Transactions / More tab bar), with a new **Find a location** row under Support that opens the locator |

Switch views with the dark prototype bar at the top of the page. Each view has a **Map / List** toggle, also available as `&layout=map|list`.

## Design

The page matches unisuper.com.au using styles measured from the live site:
- White two-row header: utility links, an outlined blue **Login** button, a solid blue **Join** button, and the main navigation row.
- A 200px blue gradient banner with a white serif "Our Locations" heading.
- Navy serif headings (Tiempos on the live site; Source Serif 4 here because Tiempos is licensed) and grey Source Sans body text (`#696969`).
- 4px-radius buttons in blue `#0E71F2`, and a flat `#F9F9F9` search panel.
- A greyscale map with the live site's marker style: light pin, navy-to-blue gradient for offices, teal for campuses.
- A navy footer.

To swap in the official logo, replace the inline SVG in `.us-logo` in `index.html`.

## Map and List

- **Map:** a search panel with the results list on the left and the map on the right. Clicking a result opens its details in the panel and draws the route.
- **List:** full width with no map. Enter a location and every office and campus is listed in a table, **nearest first**, with distance, travel time, appointment type and Book / Map actions.
- **Filter (both layouts):** one control for appointment type: *All locations · Walk-ins accepted · Appointment needed*.

## Run it

```bash
npm start
```

Open http://localhost:5173. No dependencies are needed (Node 18+).

### Share it online (GitHub Pages)

The site is published from GitHub. Every push to `main` runs `.github/workflows/pages.yml`, which builds `dist/` with `build.js` and deploys it to GitHub Pages.

**The Google key is not in the repository.** Locally it lives in `js/config.local.js`, which git ignores. On GitHub, the workflow writes that file from the repository secret `GOOGLE_MAPS_API_KEY`. To set or change the secret:

```bash
gh secret set GOOGLE_MAPS_API_KEY --repo BRACE777/unisuper-locations-prototype
```

Then re-run the deploy from the **Actions** tab, or push a commit. In Google Cloud, add `https://brace777.github.io/*` to the key's allowed websites. The live site still uses the key, so it can be seen in the browser like any Maps key; the website restriction and quotas limit misuse.

### Google Maps key

Put a browser key in `js/config.js` (`GOOGLE_MAPS_API_KEY`). The key's project needs these APIs enabled:

- Maps JavaScript API: the map
- Places API (New): address autocomplete
- Geocoding API: postcode and address search, "use my location" labels
- Routes API: live drive, transit and walking times, and the route line

Restrict the key to the referrer `http://localhost:5173/*`. **Without a key** the prototype still runs: there's no map, travel times are estimated from straight-line distance, and search only works for capital-city postcodes and the demo members' postcodes. If the Routes API isn't enabled, the app falls back to the legacy Distance Matrix and Directions services, then to estimates.

## What's in each view

**All views**
- **Phone first:**
  - A "Prefer to talk to someone?" strip with the advice line and call back sits at the top. On phones it shrinks to one line and a "Call us · 1800 823 842" bar stays fixed at the bottom of the screen.
  - In each location's details, the call buttons come first, then "Request a call back", then "Book an appointment".
  - The booking form lists Phone first, and members far from a location are offered a call before video.
- **On phones, search comes first:** the search box sits above the map, at 52px tall with 17px text. The map needs two fingers to move, so one finger always scrolls the page.
- Results sorted **nearest first** (road distance), with drive time. Live times are fetched for the 10 nearest locations, so API cost stays low. The details panel shows car, public transport and walking times.
- Appointment-type filter: walk-ins accepted, or appointment needed.
- Live **"Open now · closes 5pm"** status, worked out in each office's own time zone.
- Details panel: travel time for all three modes, hours, services, upcoming events, **book an appointment**, and **directions** in Google Maps.
- **Virtual fallback:** if the nearest location is more than 90 minutes by car, suggests a video or phone appointment.
- **Smooth zooming:** zooms out, glides across, then zooms in one level at a time, so tiles load cleanly instead of showing a blurry jump. This also applies when you click a cluster.
- **Offices take priority:** office pins always show above everything else. Only campuses group into teal numbered clusters.
- **Details panel:**
  - "Financial advice is by appointment" shown near the top, with **Book an appointment** and **Request a call back**. The call-back form asks for a topic and the best time to call; consultants can schedule one for the member.
  - The location's direct phone number, plus the advice line.
  - **Arrival information:** entrance and level, parking, public transport, accessibility, and what to do on arrival.
- A mobile layout.

**Guest:** address and postcode autocomplete, "use my location", and a prompt to log in. *Optional (Settings):* a public member-number field, kept for comparison with a privacy warning.

**Logged-in member:** starts from the member's home address. A Home / Work switch uses their employer's campus as the starting point. Shows their next appointment, and the booking form is pre-filled with confirmation sent to their email or mobile (masked on screen).

**Consultant (impersonating):** the consultant sees **exactly the member's page**: same header, appointment card, results, details panel and booking forms. There are only two additions:
- A yellow **impersonation bar**: "Viewing as Alex Chen (member 10000001) · Reason: Inbound phone call · All actions are logged", with **End session**.
- A small yellow **consultant notes box** above the member's content:
  - **Accessibility warnings** from the member record, e.g. needs step-free access or an interpreter.
  - The **closest location** to the current starting point, which can be clicked to open it.
  - Whether the **nearest office is over 45 minutes' drive** (`OFFICE_FAR_MINUTES` in `js/config.js`), with a prompt to offer video or phone. Otherwise it shows the nearest office and its drive time.

The session opens already impersonating, as if started from the CRM on an inbound call. The member and the reason for access can be changed in Prototype settings.

## Demo members (fictional)

| Number | Member | Shows |
|---|---|---|
| 10000001 | Alex Chen, Geelong VIC | Upcoming appointment; regional commute |
| 10000002 | Priya Sharma, Newtown NSW | Accessibility flag (wheelchair) |
| 10000003 | Jordan Lee, Toowoomba QLD | Postal address in Brisbane, different from residential |
| 10000004 | Sam Taylor, Albany WA | 5+ hours from any location, so the virtual fallback appears |
| 10000005 | Morgan Ng, Glenelg SA | Interpreter flag, upcoming appointment |

Appointment slots, events, services, campus visit days, **arrival information** and **location phone numbers** are **illustrative**. Arrival content is in `js/data/arrival.js`, ready for a facilities team to replace with confirmed details. Phone numbers, including the demo members' mobiles, use the ranges ACMA reserves for fiction ((0X) 5550 xxxx and 0491 570 xxx), so none can reach a real person. Location names, addresses, coordinates and hours come from the live site's search endpoint (36 locations).

## Data quality issues found on the live site

These were found while extracting the data and are fixed in `js/data/locations.js`, where each fix is noted in a `dataFix` field:

- **Bond University** shows Curtin University's room and campus ("Building 106A, Room 111, Bentley campus").
- **RMIT** postcode is "VIC 300" (should be 3000).
- **UWA** postcode is 6099 (Nedlands is 6009).
- **Swinburne, Curtin, Edith Cowan** are missing suburb, state and postcode. **UQ** is missing the state.
- **Monash** address HTML contains pasted inline colour styles.

## Files

```
index.html             page shell + view bar
css/styles.css         tokens measured from unisuper.com.au (navy #112C5C, blue #0E71F2, text #696969, panel #F9F9F9)
js/config.js           API key + thresholds
js/app.js              state, views, rendering, booking/send flows
js/lib/google.js       Maps loader, autocomplete, geocoding, Routes API with fallbacks
js/lib/map.js          map style, markers, clustering, route line
js/lib/hours.js        opening-hours parsing / open-now per state time zone
js/lib/geo.js          distance, travel estimates, formatting
js/data/locations.js   36 locations (cleaned)
js/data/members.js     fictional members, consultant, access reasons
js/data/demo-content.js  services, events, appointment slots (illustrative)
server.js              zero-dependency static server
```
