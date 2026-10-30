/**
 * ============================================================================
 * UL Printer Management Dashboard — Frontend Logic
 * ============================================================================
 * - Fetches printer data from /api/printers every 15 seconds (no page reload)
 * - Renders printer cards in slides of 10 (paginated with Next/Previous)
 * - Handles the "Add Printer" form via /api/add-printer
 *
 * Card DOM nodes are reused across refreshes (see cardRegistry below) -
 * on every fetch we UPDATE the existing card's fields in place rather than
 * destroying and rebuilding it, so adding a printer or a routine refresh
 * doesn't flicker/reset the other cards on screen.
 *
 * All DOM work is done with vanilla JS + a <template> tag (no framework),
 * per the project's "lightweight" requirement.
 * ============================================================================
 */

// How often the BROWSER re-fetches /api/printers to redraw the dashboard.
// This is just reading the server's already-in-memory printer list (no
// ICMP/SNMP traffic happens because of this call), so it's independent of
// - and can safely be faster than - the backend's own ping/SNMP cadence
// (PING_INTERVAL_MS / SNMP_REFRESH_INTERVAL_MS in server.js / .env).
const REFRESH_INTERVAL_MS = 15000;
const CARDS_PER_SLIDE = 10;

let currentSlide = 0;
let printerData = [];

// Latest { pingIntervalMs, snmpIntervalMs, nextPingAt, nextSnmpAt } from the
// server (see routes/printerRoutes.js) - drives the bottom-right countdown
// widget. Ticked locally every second between fetches for a smooth display.
let refreshSchedule = null;
let pingCountdownPulsed = false;
let snmpCountdownPulsed = false;

// Persistent map of ip -> { col, card } DOM node references, so refreshes
// update existing elements instead of tearing the whole card down.
const cardRegistry = new Map();

const carouselInner = document.getElementById('carouselInner');
const emptyState = document.getElementById('emptyState');
const carouselWrapper = document.getElementById('carouselWrapper');
const slideIndicator = document.getElementById('slideIndicator');
const prevBtn = document.getElementById('prevSlideBtn');
const nextBtn = document.getElementById('nextSlideBtn');
const onlineCountEl = document.getElementById('onlineCount');
const offlineCountEl = document.getElementById('offlineCount');
const lastRefreshLabel = document.getElementById('lastRefreshLabel');
const cardTemplate = document.getElementById('printerCardTemplate');

const addForm = document.getElementById('addPrinterForm');
const newPrinterIpInput = document.getElementById('newPrinterIp');
const addPrinterFeedback = document.getElementById('addPrinterFeedback');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const pingCountdownEl = document.getElementById('pingCountdown');
const snmpCountdownEl = document.getElementById('snmpCountdown');

/* -------------------------------------------------------------------- */
/* Data fetching                                                         */
/* -------------------------------------------------------------------- */

async function fetchPrinters() {
  try {
    const res = await fetch('/api/printers');
    const data = await res.json();
    if (data.success) {
      printerData = data.printers;
      renderDashboard();
      updateRefreshLabel();
      if (data.schedule) {
        refreshSchedule = data.schedule;
        updateCountdownDisplay();
      }
    }
  } catch (err) {
    console.error('Failed to fetch printer data:', err);
  }
}

function updateRefreshLabel() {
  const now = new Date();
  lastRefreshLabel.textContent = `Updated ${now.toLocaleTimeString()}`;
}

/* -------------------------------------------------------------------- */
/* Rendering                                                             */
/* -------------------------------------------------------------------- */

function renderDashboard() {
  // Summary counts
  const online = printerData.filter((p) => p.status === 'Online').length;
  const offline = printerData.length - online;
  onlineCountEl.textContent = online;
  offlineCountEl.textContent = offline;

  if (printerData.length === 0) {
    emptyState.classList.remove('d-none');
    carouselWrapper.classList.add('d-none');
    return;
  }
  emptyState.classList.add('d-none');
  carouselWrapper.classList.remove('d-none');

  const totalSlides = Math.ceil(printerData.length / CARDS_PER_SLIDE);
  if (currentSlide >= totalSlides) currentSlide = totalSlides - 1;
  if (currentSlide < 0) currentSlide = 0;

  renderSlides(totalSlides);
  updateCarouselControls(totalSlides);
  pruneRemovedPrinters();
}

function renderSlides(totalSlides) {
  carouselInner.innerHTML = '';

  for (let slideIdx = 0; slideIdx < totalSlides; slideIdx++) {
    const start = slideIdx * CARDS_PER_SLIDE;
    const slicePrinters = printerData.slice(start, start + CARDS_PER_SLIDE);

    const slideEl = document.createElement('div');
    slideEl.className = `carousel-item${slideIdx === currentSlide ? ' active' : ''}`;

    const gridEl = document.createElement('div');
    gridEl.className = 'card-grid';

    slicePrinters.forEach((printer) => {
      // getOrCreateCardCol() reuses the existing DOM node for this IP
      // (if we've seen it before) and just updates its content - it does
      // NOT rebuild the card from scratch. appendChild() below moves that
      // existing node into place rather than cloning it.
      gridEl.appendChild(getOrCreateCardCol(printer));
    });

    slideEl.appendChild(gridEl);
    carouselInner.appendChild(slideEl);
  }
}

/**
 * Return the `.col` wrapper element for a printer's card - reusing the
 * existing DOM node (and just refreshing its content) if we've already
 * built one for this IP, or creating it fresh the first time we see it.
 */
function getOrCreateCardCol(printer) {
  let entry = cardRegistry.get(printer.ip);

  if (!entry) {
    const node = cardTemplate.content.cloneNode(true);
    const col = node.querySelector('.col');
    const card = node.querySelector('.printer-card');
    // Subtle interactive 3D tilt - attached once per card, not re-attached
    // on every refresh.
    attachTiltEffect(card);
    entry = { col, card };
    cardRegistry.set(printer.ip, entry);
  }

  updateCardContent(entry.card, printer);
  return entry.col;
}

/**
 * Remove cards from the registry for printers that no longer exist in the
 * latest fetch (keeps memory/DOM tidy if a printer is ever removed).
 */
function pruneRemovedPrinters() {
  const currentIps = new Set(printerData.map((p) => p.ip));
  for (const ip of cardRegistry.keys()) {
    if (!currentIps.has(ip)) cardRegistry.delete(ip);
  }
}

/**
 * Update every dynamic field on an existing (or brand-new) card element.
 * Called on every refresh - this is the ONLY place that mutates a card's
 * content, so a routine refresh never rebuilds/replaces the DOM node.
 */
function updateCardContent(card, printer) {
  const isOnline = printer.status === 'Online';

  card.classList.remove('status-online', 'status-offline');
  card.classList.add(isOnline ? 'status-online' : 'status-offline');

  // Status indicator + inline alert icon next to the "Offline" label
  const statusIndicator = card.querySelector('.status-indicator');
  statusIndicator.classList.remove('status-online', 'status-offline');
  statusIndicator.classList.add(isOnline ? 'status-online' : 'status-offline');
  card.querySelector('.status-label').textContent = isOnline ? 'Online' : 'Offline';
  card.querySelector('.warning-icon-inline').classList.toggle('d-none', isOnline);

  // Text fields
  card.querySelector('.printer-name').textContent = printer.name || 'Unnamed Printer';
  card.querySelector('.printer-model').textContent = printer.model || 'Model unknown';
  card.querySelector('.serial-number').textContent = printer.serialNumber || '—';
  card.querySelector('.location').textContent = printer.location || 'Unassigned';

  const ipLink = card.querySelector('.ip-link');
  ipLink.textContent = printer.ip;
  ipLink.href = `http://${printer.ip}`;

  // Vendor badge (HP / Canon / generic) - vendor is detected server-side
  // from the printer's SNMP sysDescr (see services/snmpService.js)
  const vendorBadge = card.querySelector('.vendor-badge');
  const vendorText = card.querySelector('.vendor-text');
  const vendor = (printer.vendor || 'Printer').toString();
  vendorText.textContent = vendor;
  vendorBadge.classList.remove('vendor-hp', 'vendor-canon');
  if (vendor.toUpperCase() === 'HP') vendorBadge.classList.add('vendor-hp');
  else if (vendor.toUpperCase() === 'CANON') vendorBadge.classList.add('vendor-canon');

  // Toner: color printers get 4 circular ring gauges (C/M/Y/K); printers
  // that only ever report Black (no C/M/Y at all) get a single black
  // percentage progress bar instead.
  const tonerLevels = printer.tonerLevels || {};
  const isMonochrome = tonerLevels.c == null && tonerLevels.m == null && tonerLevels.y == null;

  card.querySelector('.toner-gauges').classList.toggle('d-none', isMonochrome);
  card.querySelector('.toner-mono').classList.toggle('d-none', !isMonochrome);

  if (isMonochrome) {
    renderMonoToner(card, tonerLevels.k);
  } else {
    ['c', 'm', 'y', 'k'].forEach((channel) => {
      renderTonerRing(card, channel, tonerLevels[channel]);
    });
  }

  // Maintenance kit - percentage if the printer reports it, otherwise "N/A"
  renderMaintenanceKit(card, printer.maintenanceKitLife);

  // Last seen (offline printers only)
  const lastSeenEl = card.querySelector('.last-seen');
  if (!isOnline && printer.lastSeen) {
    lastSeenEl.classList.remove('d-none');
    lastSeenEl.querySelector('.last-seen-value').textContent = new Date(
      printer.lastSeen
    ).toLocaleString();
  } else {
    lastSeenEl.classList.add('d-none');
  }
}

/**
 * Render a single CMYK circular ring gauge (Cyan/Magenta/Yellow/Black).
 * `value` is a 0-100 percentage, or null/undefined if the printer doesn't
 * report that supply.
 */
function renderTonerRing(card, channel, value) {
  const gaugeEl = card.querySelector(`.toner-gauge[data-channel="${channel}"]`);
  const ring = gaugeEl.querySelector('.gauge-ring');
  const pctLabel = gaugeEl.querySelector('.gauge-pct');
  const gaugeColors = { c: '#00AEEF', m: '#EC008C', y: '#F2C200', k: '#2B2B2B' };

  ring.style.setProperty('--gcolor', gaugeColors[channel]);

  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    gaugeEl.classList.add('no-data');
    ring.style.setProperty('--pct', 0);
    pctLabel.textContent = 'N/A';
    pctLabel.classList.add('pct-na');
    pctLabel.classList.remove('pct-low');
    return;
  }

  gaugeEl.classList.remove('no-data');
  const pct = clampPercent(value);
  ring.style.setProperty('--pct', pct);
  pctLabel.textContent = `${pct}%`;
  pctLabel.classList.remove('pct-na');
  pctLabel.classList.toggle('pct-low', pct < 10);
}

/**
 * Render the single black-toner progress bar used for monochrome
 * printers (i.e. no Cyan/Magenta/Yellow ever reported).
 */
function renderMonoToner(card, value) {
  const pctLabel = card.querySelector('.toner-mono-pct');
  const bar = card.querySelector('.toner-mono-bar');
  bar.classList.remove('level-ok', 'level-low', 'level-na');

  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    pctLabel.textContent = 'N/A';
    pctLabel.classList.add('pct-na');
    pctLabel.classList.remove('pct-low');
    bar.style.width = '100%';
    bar.classList.add('level-na');
    return;
  }

  const pct = clampPercent(value);
  bar.style.width = `${pct}%`;
  bar.classList.add(pct > 10 ? 'level-ok' : 'level-low');
  pctLabel.textContent = `${pct}%`;
  pctLabel.classList.remove('pct-na');
  pctLabel.classList.toggle('pct-low', pct < 10);
}

/**
 * Render the maintenance kit readout: a percentage + progress bar if the
 * printer reports it, or a plain "N/A" if that supply wasn't found.
 */
function renderMaintenanceKit(card, value) {
  const pctLabel = card.querySelector('.maint-pct');
  const bar = card.querySelector('.maint-bar');
  bar.classList.remove('level-ok', 'level-low', 'level-na');

  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    pctLabel.textContent = 'N/A';
    pctLabel.classList.add('pct-na');
    pctLabel.classList.remove('pct-low');
    bar.style.width = '100%';
    bar.classList.add('level-na');
    return;
  }

  const pct = clampPercent(value);
  bar.style.width = `${pct}%`;
  bar.classList.add(pct > 10 ? 'level-ok' : 'level-low');
  pctLabel.textContent = `${pct}%`;
  pctLabel.classList.remove('pct-na');
  pctLabel.classList.toggle('pct-low', pct < 10);
}

/**
 * Give each card a subtle, genuine 3D tilt that follows the cursor,
 * reinforcing the "raised card" look from the CSS shadows/perspective.
 * Attached ONCE per card (at creation time), not re-attached on refresh.
 */
function attachTiltEffect(card) {
  const MAX_TILT_DEG = 7;

  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width; // 0 -> 1
    const y = (e.clientY - rect.top) / rect.height; // 0 -> 1
    const rotateY = (x - 0.5) * MAX_TILT_DEG * 2;
    const rotateX = (0.5 - y) * MAX_TILT_DEG * 2;
    card.style.transform = `perspective(900px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateZ(6px)`;
  });

  card.addEventListener('mouseleave', () => {
    card.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg) translateZ(0px)';
  });
}

function clampPercent(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/* -------------------------------------------------------------------- */
/* Carousel navigation                                                   */
/* -------------------------------------------------------------------- */

function updateCarouselControls(totalSlides) {
  slideIndicator.textContent = `Slide ${currentSlide + 1} of ${totalSlides}`;
  prevBtn.disabled = currentSlide === 0;
  nextBtn.disabled = currentSlide === totalSlides - 1;

  // Update active class without re-rendering all card content
  document.querySelectorAll('#carouselInner .carousel-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === currentSlide);
  });
}

prevBtn.addEventListener('click', () => {
  if (currentSlide > 0) {
    currentSlide -= 1;
    const totalSlides = Math.ceil(printerData.length / CARDS_PER_SLIDE);
    updateCarouselControls(totalSlides);
  }
});

nextBtn.addEventListener('click', () => {
  const totalSlides = Math.ceil(printerData.length / CARDS_PER_SLIDE);
  if (currentSlide < totalSlides - 1) {
    currentSlide += 1;
    updateCarouselControls(totalSlides);
  }
});

/* -------------------------------------------------------------------- */
/* Add Printer form                                                      */
/* -------------------------------------------------------------------- */

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const ip = newPrinterIpInput.value.trim();

  addPrinterFeedback.textContent = 'Detecting SNMP version and retrieving printer info…';
  addPrinterFeedback.className = 'form-text mt-1 text-muted';

  try {
    const res = await fetch('/api/add-printer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip }),
    });
    const result = await res.json();

    if (result.success) {
      addPrinterFeedback.textContent = `Printer ${ip} added successfully.`;
      addPrinterFeedback.className = 'form-text mt-1 text-success';
      newPrinterIpInput.value = '';
      // Re-fetch and re-render: existing cards are reused/updated in
      // place (see getOrCreateCardCol), so this only adds a new card
      // for the printer just added - it doesn't rebuild the others.
      await fetchPrinters();
    } else {
      addPrinterFeedback.textContent = result.error || 'Unable to communicate with printer.';
      addPrinterFeedback.className = 'form-text mt-1 text-danger';
    }
  } catch (err) {
    addPrinterFeedback.textContent = 'Unexpected error while adding printer.';
    addPrinterFeedback.className = 'form-text mt-1 text-danger';
    console.error(err);
  }
});

/* -------------------------------------------------------------------- */
/* Bottom-right refresh countdown widget                                 */
/* -------------------------------------------------------------------- */

/**
 * Format a millisecond duration as mm:ss (never negative - clamps at 00:00
 * for the brief window between a countdown reaching zero and the next
 * server response confirming the cycle actually ran).
 */
function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * Recompute and redraw both countdowns from the last known schedule.
 * Called every second (ticks locally, independent of the 15s dashboard
 * fetch) and also immediately whenever a fresh schedule arrives from the
 * server, so the widget both feels smooth and self-corrects any drift.
 */
function updateCountdownDisplay() {
  if (!refreshSchedule || !refreshSchedule.nextPingAt || !refreshSchedule.nextSnmpAt) return;

  const now = Date.now();
  const pingRemainingMs = refreshSchedule.nextPingAt - now;
  const snmpRemainingMs = refreshSchedule.nextSnmpAt - now;

  pingCountdownEl.textContent = formatCountdown(pingRemainingMs);
  snmpCountdownEl.textContent = formatCountdown(snmpRemainingMs);

  pulseWhenDue(pingCountdownEl, pingRemainingMs, 'pingCountdownPulsed');
  pulseWhenDue(snmpCountdownEl, snmpRemainingMs, 'snmpCountdownPulsed');
}

/**
 * Give a countdown value a brief pulse the moment it hits zero, so it's
 * visibly obvious a cycle just completed - then re-arm itself once the
 * next schedule update pushes the target time back into the future.
 */
function pulseWhenDue(el, remainingMs, pulseFlagName) {
  const pulsed = pulseFlagName === 'pingCountdownPulsed' ? pingCountdownPulsed : snmpCountdownPulsed;

  if (remainingMs <= 0 && !pulsed) {
    el.classList.add('just-refreshed');
    setTimeout(() => el.classList.remove('just-refreshed'), 650);
    if (pulseFlagName === 'pingCountdownPulsed') pingCountdownPulsed = true;
    else snmpCountdownPulsed = true;
  } else if (remainingMs > 1000) {
    if (pulseFlagName === 'pingCountdownPulsed') pingCountdownPulsed = false;
    else snmpCountdownPulsed = false;
  }
}

// Tick the countdown every second, independent of the 15s data fetch.
setInterval(updateCountdownDisplay, 1000);

/* -------------------------------------------------------------------- */
/* Light / Dark mode                                                     */
/* -------------------------------------------------------------------- */

const THEME_STORAGE_KEY = 'ulDashboardTheme'; // 'light' | 'dark'

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggleBtn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
}

function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') {
    applyTheme(saved);
    return;
  }
  // No saved preference yet - default to the OS/browser's preferred scheme.
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(prefersDark ? 'dark' : 'light');
}

themeToggleBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch (err) {
    // Private browsing / storage disabled - theme just won't persist across reloads.
    console.warn('Could not save theme preference:', err);
  }
});

initTheme();

/* -------------------------------------------------------------------- */
/* Init                                                                  */
/* -------------------------------------------------------------------- */

fetchPrinters();
setInterval(fetchPrinters, REFRESH_INTERVAL_MS);
