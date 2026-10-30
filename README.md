# UL Printer Management Dashboard

A lightweight, real-time dashboard for monitoring **20–25 network printers** (HP and Canon) across an organization's offices. It runs entirely on **localhost** — no database, no cloud hosting. Online/Offline status is checked every **60 seconds** via ICMP ping, while the heavier toner and maintenance-kit SNMP read runs every **15 minutes** — see "Refresh timing" below for why they're split.

---

## What this project does

- Reads your printer inventory from `config/Survey.xlsx` (IP, Name, Location) on startup.
- Pings every printer and shows **Online / Offline** status.
- Pulls live data over **SNMP**: per-color toner levels (Cyan/Magenta/Yellow/Black), maintenance kit life, model, serial number.
- Auto-detects each printer's SNMP version (tries **v2c**, falls back to **v1**) and remembers it in `config/SNMP.xlsx` so it doesn't need to re-detect every time.
- Displays everything on a corporate, 3D-styled card dashboard (10 cards per slide) that updates itself in the background — the page never reloads. Each card shows CMYK toner as four color-matched speedometer gauges, a vendor badge, and a maintenance-kit readout (percentage or "N/A" if the printer doesn't report one).
- Lets you add a new printer on the fly by typing its IP address into the header bar.
- Bootstrap is vendored locally (see below) — no CDN calls at runtime.

---

## What you need to install

### 1. Node.js
You need **Node.js version 16 or later**. Check with:
```bash
node -v
```
If you don't have it, download it from **https://nodejs.org** (choose the LTS version).

### 2. Project dependencies (npm packages)
Everything the project needs is listed in `package.json`. You install all of it with **one command** (see "How to run" below) — you don't need to install packages individually. For reference, here's what each one is for:

| Package | Why it's used |
|---|---|
| `express` | Web server that serves the dashboard and the API |
| `cors` | Allows the frontend's fetch requests to the API |
| `dotenv` | Loads settings (port, refresh interval, SNMP community) from a `.env` file |
| `net-snmp` | Talks to printers over SNMP (toner, serial number, status, etc.) |
| `ping` | Sends ICMP pings to check if a printer is online/offline |
| `xlsx` | Reads `Survey.xlsx` and reads/writes `SNMP.xlsx` |
| `bootstrap` | UI framework - installed as a normal dependency and copied locally (see below), not loaded from a CDN |
| `nodemon` *(dev only)* | Auto-restarts the server while you're developing — optional |

You do **not** need to install a database (MySQL, MongoDB, etc.) — this project intentionally has none.

### 3. Bootstrap is local, not a CDN

`npm install` also installs the `bootstrap` package, and a `postinstall` script (`scripts/copy-assets.js`) automatically copies the compiled `bootstrap.min.css` and `bootstrap.bundle.min.js` into `public/vendor/bootstrap/`. `views/index.html` loads Bootstrap from there. Net effect: **the dashboard makes zero external CDN calls at runtime** — the only time internet access is needed is once, during `npm install`, exactly like installing any other npm package.

If `public/vendor/bootstrap/` ever ends up empty (e.g. you copied the project without running install), just run:
```bash
node scripts/copy-assets.js
```

Icons throughout the dashboard are hand-written inline SVG (no icon font/webfont dependency at all).

---

## How to run it (step by step)

1. **Unzip the project** and open a terminal inside the `UL-Printer-Dashboard` folder.

2. **Install the dependencies:**
   ```bash
   npm install
   ```
   This reads `package.json`, downloads `express`, `cors`, `dotenv`, `net-snmp`, `ping`, `xlsx`, and `bootstrap` into `node_modules`, then automatically runs `scripts/copy-assets.js` to copy Bootstrap's compiled CSS/JS into `public/vendor/bootstrap/` (you'll see `[copy-assets] ...` log lines - that's expected).

3. **Create your `.env` file:**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and adjust values if needed (default port is `3000`, default refresh is `10000` ms). Change `SNMP_COMMUNITY` if your printers don't use the default `public` community string.

4. **Edit `config/Survey.xlsx`** with your real printer list (IP Address, Printer Name, Location). A sample file with 5 example rows is already included so you can test immediately.

5. **Start the server:**
   ```bash
   npm start
   ```
   Or, if you installed `nodemon` and want auto-restart while developing:
   ```bash
   npm run dev
   ```

6. **Open the dashboard:**
   Go to **http://localhost:3000** in your browser.

That's it — the dashboard will load your printers, ping them every 60 seconds for status, and pull toner/maintenance-kit data every 15 minutes automatically.

---

## Project structure

```
UL-Printer-Dashboard/
├── server.js                  # Express app entry point + refresh scheduler
├── package.json
├── .env.example                # Copy to .env and adjust
├── scripts/
│   └── copy-assets.js          # postinstall: vendors Bootstrap into public/vendor
├── config/
│   ├── Survey.xlsx             # YOU edit this: your printer inventory
│   └── SNMP.xlsx                # Auto-maintained: detected SNMP versions
├── routes/
│   └── printerRoutes.js        # /api/printers, /api/add-printer
├── controllers/
│   └── printerController.js    # In-memory printer list + refresh logic
├── services/
│   ├── snmpService.js          # SNMP version detection + CMYK/maintenance retrieval
│   ├── pingService.js          # ICMP ping wrapper
│   └── excelService.js         # Reads Survey.xlsx, reads/writes SNMP.xlsx
├── utils/
│   ├── oidList.js              # Printer-MIB + HP/Canon OID mappings
│   └── logger.js               # Simple timestamped console logger
├── public/
│   ├── css/style.css           # Dashboard styling (3D cards, speedometer gauges)
│   ├── js/dashboard.js         # Frontend: fetch, render, carousel, add-printer, 3D tilt
│   └── vendor/bootstrap/       # Auto-generated by copy-assets.js - Bootstrap served locally
└── views/
    └── index.html              # Dashboard page
```

---

## How the two Excel files work

**`config/Survey.xlsx`** — you maintain this by hand. It's your source of truth for *which* printers to monitor. Columns:

| IP Address | Printer Name | Location |
|---|---|---|
| 192.168.1.10 | Finance Printer | Finance Office |

**`config/SNMP.xlsx`** — the app maintains this automatically. Every time it successfully detects a printer's SNMP version, it saves the IP + version here so it doesn't have to re-detect (try v2c, fall back to v1) every single restart. You normally never need to edit this file yourself.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/printers` | Returns all monitored printers as JSON, plus a `schedule` object (`{ pingIntervalMs, snmpIntervalMs, nextPingAt, nextSnmpAt }`) used to drive the countdown widget |
| `POST` | `/api/add-printer` | Body: `{ "ip": "192.168.1.20" }` — validates the IP, auto-detects SNMP version, and adds it to the monitoring list |

---

## Refresh timing

Polling every printer's full SNMP data every few seconds is what causes a dashboard to feel laggy once you're monitoring 20-25 printers — SNMP round-trips are much slower than an ICMP ping, and they queue up fast. So the two jobs are deliberately split and run on independent schedules:

| When | What | Why |
|---|---|---|
| **At startup** | Read Model, Serial Number, and an initial toner/maintenance-kit reading for every reachable printer | These essentially never change during normal operation, so there's no need to re-read them on a timer. Location comes straight from `Survey.xlsx` and is never queried again either. |
| **Every 60 seconds** | ICMP ping every printer → update Online/Offline status | Cheap and fast - safe to run often so the dashboard's status feels current. |
| **Every 15 minutes** | Full SNMP read (toner levels + maintenance kit life) for every *online* printer | The heavier operation. Toner/maintenance levels don't move fast enough to justify checking them more than every 15 minutes, and keeping this off the frequent cycle is what fixes the delay. |

Both intervals are configurable in `.env`:
```
PING_INTERVAL_MS=60000            # 60 seconds
SNMP_REFRESH_INTERVAL_MS=900000   # 15 minutes
```
Adding a printer via the header's "Add Printer" field always does an immediate full SNMP read for just that one printer, regardless of these timers - so it doesn't sit blank waiting for the next cycle.

The frontend polls `GET /api/printers` every 15 seconds to redraw the dashboard - this only reads the server's in-memory data (no ICMP/SNMP traffic happens because of it), so it's independent of, and can safely be faster than, the two backend timers above.

---

## Refresh countdown widget

A small fixed panel in the **bottom-right corner** shows a live countdown to each of the two backend cycles described above: "Status check" (ping) and "Toner & kit update" (SNMP). Both tick down every second (`mm:ss`) and briefly pulse teal the instant they hit `00:00`, so it's visible when a cycle actually runs.

These countdowns are driven by real timestamps from the server (`nextPingAt` / `nextSnmpAt` in the `schedule` object returned by `GET /api/printers`), not guessed on the frontend — every 15-second dashboard poll re-syncs them, so they can't drift far even if a tab is left open for a long time. The widget respects light/dark mode like everything else on the page.

---

## Adjusting OIDs for your printer models

`utils/oidList.js` contains the SNMP OIDs used to read toner level, maintenance kit life, serial number, and status, based on the standard **Printer-MIB** (RFC 3805). Toner/maintenance-kit table indices can vary slightly between printer models — if a specific HP or Canon model reports the wrong supply as "toner," open `utils/oidList.js` and adjust the keyword matching or the vendor-specific index used in `services/snmpService.js`.

---

## Light / Dark mode

A toggle button (sun/moon icon) sits in the header next to the last-refresh chip. Clicking it swaps the entire dashboard between a light and dark theme instantly, and remembers your choice in the browser's `localStorage` so it stays put the next time you open the dashboard. If you've never toggled it before, it defaults to your OS/browser's preferred color scheme (`prefers-color-scheme`).

Everything is driven by a single set of CSS custom properties in `public/css/style.css` (`:root` for light, `:root[data-theme='dark']` for dark) — colors, shadows, the offline-alert gradient, and the CMYK ring colors all re-tint together. The toggle logic itself lives in `public/js/dashboard.js` (`initTheme()` / the `themeToggleBtn` click handler).

---

## Card design details

- **3D cards** — each card has a layered shadow recipe (contact + ambient + diffuse shadow) plus a glossy top-light overlay, and tilts genuinely in 3D toward your cursor on hover (`attachTiltEffect()` in `public/js/dashboard.js`). It settles back to flat on mouse-leave.
- **Vendor badge** — a small pill in the top-left of each card shows the manufacturer (HP / Canon / generic), detected server-side from the printer's SNMP `sysDescr` string. This is a plain text label with a generic printer glyph, not a reproduction of HP's or Canon's actual trademarked logo.
- **Brand watermark** — a faint printer glyph in the corner of every card, representing this project's own "UL" brand mark (the same icon shown in the header) — purely decorative.
- **CMYK toner rings** — four color-matched circular progress rings (Cyan #00AEEF, Magenta #EC008C, Yellow #F2C200, Black #2B2B2B), each independently populated from SNMP. If a printer doesn't report a given color, that ring shows **"N/A"** in its center instead of a number. Any channel below 10% shows its percentage in **bold red**.
- **Monochrome fallback** — if a printer never reports Cyan, Magenta, *or* Yellow at all (i.e. it's black-only), the four-ring cluster is replaced with a single **"Toner (Black)"** percentage progress bar instead — the same bold-red-under-10% rule applies.
- **Maintenance kit** — shown as a percentage + progress bar if the printer reports it, or **"N/A"** if that supply isn't found.
- **Offline alert styling** — an offline card gets a light red gradient background (`#fff6f6 → #ffe9e9 → #ffdcdc`, or a muted dark-red gradient in dark mode) and a soft red-tinted shadow, rather than just dimming the card. The alert triangle icon sits directly next to the "Offline" text itself, and the status dot blinks. The idea is to make an offline printer visually *stand out* as needing attention, not fade into the background.
- **Wider cards, 1em page gutter** — the page container has exactly `1em` of padding on the left/right edges (`.dashboard-header .container-fluid` and `.dashboard-main`), and the card grid uses 4 columns on desktop (down from 5) so each card gets more room. Responsive breakpoints step down to 3 / 2 / 1 columns on smaller screens.
- **Typography** — base font size increased to 16px, with card names, labels, and meta text bumped up a step throughout `public/css/style.css` for better on-screen readability at a glance across the room.
- **Incremental refresh** — every dashboard poll (and immediately after adding a printer) updates each card's existing DOM element in place — text, gauge values, status, everything — instead of tearing down and rebuilding the whole card grid. Only a genuinely *new* printer gets a freshly built card; every other card just has its numbers refreshed, so nothing flickers, resets scroll/hover state, or loses its 3D tilt binding on refresh.

---

## Running on Windows 11

This project runs fine on Windows 11 — everything is pure JavaScript with no native modules to compile, so there's no need for Visual Studio Build Tools or `windows-build-tools`.

1. Install **Node.js LTS** from https://nodejs.org (the Windows installer).
2. Open **PowerShell** or **Command Prompt** in the project folder.
3. Run the same commands as above: `npm install`, `copy .env.example .env` (use `copy` instead of `cp` on Windows), then `npm start`.
4. Open `http://localhost:3000` in your browser.

Two Windows-specific things to check if printers show as Offline or unreachable:

- **Windows Firewall** may prompt to allow Node.js network access the first time you run the server — allow it (both Private and Public networks if your printers are on a different subnet).
- **SNMP over UDP port 161** must be allowed outbound. Corporate/managed Windows machines sometimes block outbound UDP by policy — check with IT if every printer times out.

The ping and SNMP logic use only cross-platform-safe options (no OS-specific CLI flags), so status checks behave the same on Windows, macOS, and Linux.

---

## Troubleshooting

- **"Unable to communicate with printer"** — the printer didn't respond to SNMP v2c or v1. Confirm SNMP is enabled on the printer and that the community string in `.env` matches the printer's configuration.
- **A toner gauge or the Maintenance Kit shows "N/A"** — the printer didn't report that particular supply under a recognizable name. Check `utils/oidList.js` / the keyword lists in `services/snmpService.js` (`findSupplyByKeyword` calls) and adjust them to match how your printer model labels its supplies.
- **Printer shows Offline but you can ping it manually** — some environments block ICMP from Node's ping wrapper due to permissions; try running with elevated privileges, or confirm your OS's ping command works from the command line first.
- **Toner/maintenance data looks stale after a printer comes back online** — that's expected: the full SNMP read only runs every 15 minutes (`SNMP_REFRESH_INTERVAL_MS`). Status flips to Online within 60 seconds, but toner/maintenance numbers wait for the next 15-minute cycle to catch up. Lower `SNMP_REFRESH_INTERVAL_MS` in `.env` if you want it sooner, or just add the printer again via the header field for an instant one-off read.

---

## Planned future features (architecture already supports these)

- Search / filter by name, location, or manufacturer
- Dark mode
- Notification popups + email alerts for low toner/maintenance
- Export current fleet status to Excel
- Dashboard-wide statistics (average toner, printers needing attention, etc.)
- Printer history, uptime tracking, and event logs

---

## License

MIT — built for internal IT use.
