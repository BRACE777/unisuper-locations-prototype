# Call companion

Tools for member services calls, built only from the public UniSuper PDS documents issued 28 September 2026. Nothing here reads member data or connects to an internal system.

| What | File | How to open |
|---|---|---|
| Search page: rules, forms, timeframes, explainers, calculators | `dist/companion.html` | Double-click. One file, works offline, nothing typed is saved or sent. |
| Drawdown workbook: minimum and maximum, full tables, closing a pension | `dist/Flexi Pension drawdown calculator.xlsx` | Excel. No macros. Sheets are protected (no password) so Tab jumps between the yellow input cells, each with a hint and a check for impossible values. |

Both are generated. `dist/` is git-ignored, so build them first (below).

## Using the page

- **Explainers** are listed on the home page under the search hero, and have their own tab. Any phrase they cover (pro-rata, transfer balance cap, preservation age, binding nomination and so on) is underlined wherever it appears in a card: hover over it, or tab to it, for the everyday version, with the age-10 and informed versions one click away. Each version is a numbered chain: every step follows from the one before, or is the next thing to do. Acronyms (TBC, NOI, BDBN...) are dotted-underlined and show what they stand for.
- **Interactive figures** explain four rules by pointing at them: the minimum percentage by age (pillars), the first-year pro-rata (months), the drawdown order (stacked options) and the transfer balance cap (a box that fills). Arrow keys work too. They appear on the matching rule cards, explainers and hover-overs.

- Press `/` and type what the member said, a figure or an acronym: `ttr max`, `6000`, `noi deadline`, `change my bank`, `how long withdrawal`. `Esc` clears.
- Misspellings are fine: `perservation`, `reversonary`, `chnage my bank` and `nio` all work, and the page shows what it corrected.
- Pick the product (Super, DBD, Retirement Phase, TTR, BIS) to hide rules that don't apply. The **Member** box takes an age (`67`) or a date of birth in any common format (`14/5/1959`, `14.05.59`, `14 May 1959`, `14051959`); it highlights the right row in the minimum-percentage and preservation-age tables and fills the calculator.
- In the drawdown calculator, type or paste one line into **Quick entry**, such as `14/5/1959 500k 1/10/2026 TTR fortnightly`, and it fills every field. Each field also accepts loose formats (`500k`, `$500,000`, `1 Oct`, `today`) and shows what it understood underneath. Enter moves to the next field. An age works instead of a date of birth.
- Every rule card shows the PDS, issue date, PDF page and the exact sentence it relies on. The link opens the PDF at that page.
- No matching card? The page searches the full PDS text and shows the best passages.
- Alt+1 to Alt+6 switch tabs. The **date calculator** sits at the top of the Timeframes tab; timeframe cards have **Work out the date**, which fills it (business days skip weekends and Victorian public holidays). The **Drawdown calculator** has its own tab.
- The **Auto / Light / Dark** button in the header switches the theme; Auto follows Windows.

## Building

From the repository root:

```bash
npm run companion:sources   # download the 7 PDFs, extract page text (once, and when a PDS changes)
npm run companion:build     # check all data, build companion.html and the workbook
npm run companion:test      # search, dates and drawdown tests
npm run companion:workbook-check   # recalculates the workbook in Excel and checks 21 scenarios
```

Needs Node 20+, `pdftotext` (Poppler), Python with `openpyxl`, and Excel for the workbook check.

## What is checked automatically

- **Every quote is real.** `tools/check-data.mjs` finds each quoted sentence word for word in the PDS text and fails the build if one is missing. The build records the PDF page.
- **Explainer figures.** Any dollar amount in an explainer must appear in `rates.json`, its source quote, or its `allow_numbers` list.
- **Search quality.** `test/search-cases.json` holds 55 real queries and 17 misspelt ones; each must find its card in the top three, and correctly spelt card text must never be "corrected". Add a case whenever a search lets you down.
- **Workbook arithmetic.** The PDS worked examples (Gavin, Stacey, Bryn) are on the workbook's Checks sheet, and `tools/check-workbook.ps1` runs them and 20 more scenarios (including age-only entry and sheet protection) through Excel itself.

## Data files (`data/`)

| File | Contents | Edited by |
|---|---|---|
| `rates.json` | Every threshold and rate, with its PDS sentence | Hand |
| `rules/*.json` | 154 rule cards, one file per topic | Hand |
| `glossary.json` | Acronyms and member phrasing used to expand searches | Hand |
| `timeframes.json` | 39 timeframes from the PDS, with wording to say | Hand |
| `explainers.json` | 22 concepts, each told three ways (age 10, everyday, informed) as numbered steps | Hand |
| `forms-extra.json` | Directions, requirements and keywords added to each form | Hand |
| `forms.json` | Generated from the public forms page plus `forms-extra.json` | `tools/fetch-forms.mjs` |
| `holidays.json` | Grand Final eve holiday (set yearly by the Victorian Government) | Hand |
| `sources.json` | The seven PDFs, issue dates and hashes | `tools/fetch-sources.mjs` |

Local-only files, never committed: `glossary.local.json` (team shorthand) and `timeframes.local.json` (internal processing times). Same shape as the main files; the build merges them in.

## When a new PDS is issued

1. `npm run companion:sources`. It warns if an issue date or file changed.
2. `npm run companion:check`. Any quote that no longer appears word for word is listed: update the card and its figures.
3. Update `rates.json` for changed figures, then rebuild and run the tests.

## Assumptions

Anything the companion assumes rather than takes straight from the PDS has a **red dotted underline**. Hover over it (or tab to it) to see what's assumed, what the PDS actually says, and how to be sure. The footer link lists all 21. They live in `data/assumptions.json`; in text, mark the words that rely on one as `{{assumption-id:the words}}`. A test fails if a marker names an unknown assumption or an assumption is never shown. In the Excel workbook, labels that rely on an assumption are red, with the details in a cell comment, and listed on the Assumptions sheet.

## Checklists

The **Checklists** tab has step-by-step lists for 12 specific tasks, in the order you'd do them: notice of intent (NOI), starting a Retirement Phase or TTR pension, contribution splitting, binding nominations, pension lump sums, closing a pension, rolling out, downsizer contributions, stopped insurance, changing pension payments, and hardship release. Tick steps off during the call (nothing is saved), then **Copy as call note**. Steps that rely on a rule show the PDS wording underneath, and link to the form or rule card. Edit them in `data/procedures.json`.

## Fictional test members

Type a test member number (101 to 113) in the **Member** box, or pick one from **Test members**. It fills in the age and product, pre-fills the drawdown calculator, shows alerts for the rules that apply to that member (each linking to the rule or checklist), and adds notes for that member under checklist steps.

| No. | Name | Shows |
|---|---|---|
| 101 | Young Yasmin | Under 25 and under $6,000: no default insurance yet |
| 102 | John TTR | TTR pension at the 10% maximum, turns 65 in 2029 |
| 103 | Patricia Pensioner | Retirement Phase, fortnightly payments, reversionary spouse |
| 104 | Dave Div293 | Income plus concessional contributions over $250,000 |
| 105 | Helen Div296 | Total super balance over $3 million |
| 106 | Nina New Pension | About to start a pension (the PDS "Gavin" example: $18,700) |
| 107 | Ben BIS | Beneficiary Income Stream |
| 108 | Dana DBD | DBD member with a lapsing nomination about to expire |
| 109 | Carl Carry-forward | Under $500,000 with unused cap; notice of intent |
| 110 | Sam Spouse-split | Splitting to a spouse who isn't working |
| 111 | Ivy Inactive | No contributions for over a year, under $6,000 |
| 112 | Tom Temp-resident | Left Australia: DASP deadline |
| 113 | Lena Low-income | LISTO and the full co-contribution |

They live in `data/members.json`. **Import members (JSON)** loads your own fictional set for the current tab only (**Download template** gives the shape). Never import real member data: this is a public prototype.

## Hosting

The built page is committed in `site/` and published by the repository's GitHub Pages workflow at https://brace777.github.io/unisuper-locations-prototype/companion/ (with a no-index tag). After changing anything, run `npm run companion:build`, commit and push to `main`.

## ATO sources (supplementary)

The UniSuper PDS is the primary source for every card. 24 rule cards and 3 timeframes also show an **ATO · supplementary** block with the relevant ATO page, its "last updated" date and the sentence that backs the rule up (for example the co-contribution age limit of 71, which the PDS doesn't mention). The build refuses a card that cites the ATO as its main source.

ato.gov.au refuses automated downloads, so the ATO wording was copied from ordinary browser visits into `data/ato-excerpts.json` (15 pages, read 13 Nov 2026). Every ATO quote on a card is checked against that file. To refresh: open each page listed there, compare, and update the excerpt, `updated` and `retrieved`.

## Credits and licences

- Fonts: Schibsted Grotesk and Azeret Mono, embedded under the SIL Open Font Licence (`src/fonts/OFL-*.txt`).
- The isometric figures in `src/figures.js` adapt the camera maths, spring and animation loop of [hairline](https://github.com/lucasmarkes/hairline) by Lucas Marques (MIT licence, notice kept in the file). The figures themselves are new.

## Known gaps

- **Online account menu labels.** Four account paths are quoted in a PDS and marked verified. The rest are read from link addresses and show "menu labels not yet confirmed" until someone checks them while logged in.
- **Forms page.** The site sometimes serves a bot-check page to scripts. If `fetch-forms.mjs` stops, save the forms page from a browser and run it with `--file saved.html`. Don't try to get around the check.
- **Leap years.** The PDS example divides by 365. The workbook and page use the real number of days (366 in 2027-28) and flag it; confirm against the admin system.
- **Fortnightly pay cycle.** The PDS says "every second Friday" without an anchor date, so the calculators ask for one known pay Friday.
- **Closing a pension.** The pro-rata minimum on closure counts both the start and closure days. The PDS doesn't spell out the count; confirm before quoting.
- **Holidays.** Anzac Day is assumed to have no weekend substitute, and the Grand Final eve holiday is only counted once added to `holidays.json`.
- **Employer forms** on the public forms page aren't included.
