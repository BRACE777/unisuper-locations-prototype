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
- **Filter (both layouts):** one control for appointment type: *All locations · Walk-ins accepted · Appointment only*.

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
  - Guest pages on phones show "Prefer to talk? Call 1800 823 842" near the top.
  - Each location's details have one contact block. **Call 1800 823 842** (the advice line) is the main button, with Book an appointment underneath and Request a call back as a small link. The office's own number sits with its opening hours, labelled "for directions or general questions".
  - Members far from a location are offered a call before video.
- **Booking and call-back placeholders:** advice booking links (Book an appointment, Book, Book a video or phone appointment) open a full-screen "LINK TO ADVICE BOOKINGS FORM". **Request a call back** opens "LINK TO REQUEST A CALL BACK FORM". These mark where UniSuper's existing forms would take over.
- **On phones (website and app), a chosen location opens in a bottom sheet** over the results. It closes with a large Close button, a swipe or drag down, a tap on the dimmed area behind it, or Escape. On wider screens, the details open in the side panel instead.
- **On phones, search comes first:** the search box sits above the map, at 52px tall with 17px text. The map moves the way people expect, with no "use two fingers" or "Ctrl + scroll" messages: one finger pans it on phones, and the mouse wheel zooms it on desktop. The page still scrolls around it: on phones the map takes under half the screen, and on desktop the results panel sits beside it.
- Results sorted **nearest first** (road distance), with drive time. Live times are fetched for the 10 nearest locations, so API cost stays low. The details panel shows car, public transport and walking times.
- Appointment-type filter: walk-ins accepted, or appointment only.
- Live **"Open now · closes 5pm"** status, worked out in each office's own time zone.
- Details panel: travel time for all three modes, hours, services, **book an appointment**, and **directions** in Google Maps.
- **Virtual fallback:** if the nearest location is more than 90 minutes by car, suggests a video or phone appointment.
- **Smooth zooming:** zooms out, glides across, then zooms in one level at a time, so tiles load cleanly instead of showing a blurry jump. This also applies when you click a cluster.
- **Offices take priority:** office pins always show above everything else. Only campuses group into teal numbered clusters.
- **Details panel:**
  - "Financial advice is by appointment" near the top, with the advice line as the main action.
  - **Arrival information:** entrance and level, parking, public transport, accessibility, and what to do on arrival.
- A mobile layout.

**Guest:** address and postcode autocomplete, "use my location", and a prompt to log in. *Optional (Settings):* a public member-number field, kept for comparison with a privacy warning.

**Logged-in member:** always starts from the member's home address ("Near your home: Geelong VIC 3220, from your member profile"). After searching anywhere else, a **Back to your home address** link returns them. There's no Work option: members near or in retirement often have no workplace, so home is the one starting point that suits everyone. Shows their next appointment.

**Consultant (impersonating):** the consultant sees **exactly the member's page**: same header, appointment card, results, details panel and forms. There are only two additions:
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

Services, campus visit days, **arrival information** and **location phone numbers** are **illustrative**. Arrival content is in `js/data/arrival.js`, ready for a facilities team to replace with confirmed details. Phone numbers, including the demo members' mobiles, use the ranges ACMA reserves for fiction ((0X) 5550 xxxx and 0491 570 xxx), so none can reach a real person. Location names, addresses, coordinates and hours come from the live site's search endpoint (36 locations).

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
js/app.js              state, views, rendering, call-back flow, booking placeholder
js/lib/google.js       Maps loader, autocomplete, geocoding, Routes API with fallbacks
js/lib/map.js          map style, markers, clustering, route line
js/lib/hours.js        opening-hours parsing / open-now per state time zone
js/lib/geo.js          distance, travel estimates, formatting
js/data/locations.js   36 locations (cleaned)
js/data/members.js     fictional members, consultant, access reasons
js/data/demo-content.js  services and campus visit days (illustrative)
server.js              zero-dependency static server
```
