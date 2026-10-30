/**
 * ============================================================================
 * Printer Controller
 * ============================================================================
 * Holds the in-memory list of monitored printers and exposes the logic used
 * by the API routes:
 *
 *   - initializePrinters() -> loads Survey.xlsx + SNMP.xlsx, then does ONE
 *                             full SNMP read per printer (model, serial,
 *                             toner, maintenance kit) at startup only.
 *   - refreshPingOnly()    -> ICMP ping only, updates Online/Offline status.
 *                             Cheap - safe to run often (every 60s).
 *   - refreshSnmpData()    -> full SNMP read (toner levels + maintenance
 *                             kit life) for printers that are online.
 *                             Heavier - runs infrequently (every 15 min).
 *   - getAllPrinters()     -> returns current in-memory state as JSON
 *   - addPrinter(ip)       -> validates, detects SNMP version, adds printer
 *
 * Splitting ping from SNMP polling is deliberate: querying SNMP on every
 * printer every few seconds is what causes the "printer delay" (SNMP
 * round-trips are far slower than an ICMP ping, and 20-25 printers queued
 * up every 10 seconds compounds fast). ICMP ping is cheap and can safely
 * run every 60 seconds to keep Online/Offline status fresh, while the
 * heavier SNMP read (toner/maintenance kit) only needs to run once an
 * hour - those values don't change quickly enough to justify polling them
 * as often as connectivity status.
 *
 * The in-memory array is intentionally simple (no database, per project
 * requirements) - it is the dashboard's single source of truth at runtime.
 * ============================================================================
 */

const { readSurveyFile, readSnmpFile, saveSnmpVersion } = require('../services/excelService');
const { pingAll } = require('../services/pingService');
const { detectSnmpVersion, getPrinterInfo } = require('../services/snmpService');
const logger = require('../utils/logger');

// In-memory printer list. Each printer object looks like:
// {
//   ip, name, location, snmpVersion, vendor,
//   model, serialNumber,
//   tonerLevels: { c, m, y, k } (each a 0-100 % or null if not reported),
//   maintenanceKitLife (0-100 % or null if not reported),
//   status: 'Online' | 'Offline', lastSeen: ISOString|null
// }
let printers = [];

// Tracks when each recurring job last ran / is next due, purely so the
// frontend can render an accurate "next refresh in..." countdown (see the
// bottom-right widget in public/js/dashboard.js). server.js calls
// configureSchedule() once at startup with the configured intervals, then
// markPingRun()/markSnmpRun() every time each job actually executes.
const refreshSchedule = {
  pingIntervalMs: null,
  snmpIntervalMs: null,
  nextPingAt: null, // epoch ms
  nextSnmpAt: null, // epoch ms
};

function configureSchedule(pingIntervalMs, snmpIntervalMs) {
  refreshSchedule.pingIntervalMs = pingIntervalMs;
  refreshSchedule.snmpIntervalMs = snmpIntervalMs;
}

function markPingRun() {
  refreshSchedule.nextPingAt = Date.now() + refreshSchedule.pingIntervalMs;
}

function markSnmpRun() {
  refreshSchedule.nextSnmpAt = Date.now() + refreshSchedule.snmpIntervalMs;
}

function getRefreshSchedule() {
  return { ...refreshSchedule };
}

/**
 * Basic IPv4 format validation (does not guarantee reachability).
 * @param {string} ip
 * @returns {boolean}
 */
function isValidIp(ip) {
  const pattern =
    /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  return pattern.test(ip);
}

/**
 * Load printers from Survey.xlsx (seed data) and merge in any previously
 * detected SNMP versions from SNMP.xlsx. Called once on server startup.
 * (Model, Serial Number, and Location are populated by the startup SNMP
 * pass in server.js right after this runs - Location itself comes
 * straight from Survey.xlsx and never needs a refresh.)
 */
function initializePrinters() {
  const surveyRows = readSurveyFile();
  const snmpVersions = readSnmpFile();

  printers = surveyRows.map((row) => ({
    ip: row.ip,
    name: row.name || `Printer (${row.ip})`,
    location: row.location || 'Unknown',
    snmpVersion: snmpVersions[row.ip] || null,
    vendor: null,
    model: '',
    serialNumber: '',
    tonerLevels: { c: null, m: null, y: null, k: null },
    maintenanceKitLife: null,
    status: 'Offline',
    lastSeen: null,
  }));

  logger.info(`Initialized ${printers.length} printer(s) from Survey.xlsx.`);
  return printers;
}

/**
 * Return the current in-memory printer list.
 */
function getAllPrinters() {
  return printers;
}

/**
 * Lightweight refresh: ICMP ping every printer and update Online/Offline
 * status only. No SNMP traffic at all - safe to run frequently (every 60
 * seconds) without adding load to the printers or slowing the dashboard.
 */
async function refreshPingOnly() {
  if (printers.length === 0) return;

  const ipList = printers.map((p) => p.ip);
  const pingResults = await pingAll(ipList);

  printers.forEach((printer) => {
    const isAlive = pingResults[printer.ip]?.alive;
    printer.status = isAlive ? 'Online' : 'Offline';
    if (isAlive) printer.lastSeen = new Date().toISOString();
    // If offline, lastSeen and all last-known SNMP values are left
    // untouched so the dashboard keeps showing the most recent good data.
  });
}

/**
 * Heavier refresh: for every printer that's currently online, detect its
 * SNMP version if unknown, then pull a full SNMP read (model, serial,
 * vendor, CMYK toner levels, maintenance kit life). Intended to run once
 * at startup and then only every 15 minutes - toner and maintenance kit
 * life don't change fast enough to justify polling them any more often
 * than that, and it keeps SNMP traffic (the slow part) off the critical
 * path of the frequent Online/Offline ping cycle.
 */
async function refreshSnmpData() {
  if (printers.length === 0) return;

  await Promise.all(
    printers.map(async (printer) => {
      if (printer.status !== 'Online') return; // Skip unreachable printers

      // If we don't know the SNMP version yet, try to detect it now
      if (!printer.snmpVersion) {
        const detection = await detectSnmpVersion(printer.ip);
        if (detection) {
          printer.snmpVersion = detection.version;
          saveSnmpVersion(printer.ip, detection.version);
        } else {
          return; // Can't retrieve SNMP data without a working version
        }
      }

      const info = await getPrinterInfo(printer.ip, printer.snmpVersion);
      if (info.success) {
        printer.vendor = info.vendor;
        printer.model = info.model;
        printer.serialNumber = info.serialNumber;
        printer.tonerLevels = info.tonerLevels;
        printer.maintenanceKitLife = info.maintenanceKitLife;
        // Keep the Survey.xlsx name if provided; otherwise use SNMP sysName
        if (!printer.name || printer.name.startsWith('Printer (')) {
          printer.name = info.name || printer.name;
        }
      } else {
        logger.warn(`Could not refresh SNMP data for ${printer.ip}: ${info.error}`);
      }
    })
  );
}

/**
 * Add a new printer by IP: validate format, auto-detect SNMP version,
 * retrieve initial info, persist SNMP version, and add to the monitoring
 * list.
 * @param {string} ip
 * @param {object} [meta] - optional { name, location } overrides
 * @returns {Promise<{success: boolean, printer?: object, error?: string}>}
 */
async function addPrinter(ip, meta = {}) {
  if (!ip || !isValidIp(ip)) {
    return { success: false, error: 'Invalid IP address format.' };
  }

  if (printers.some((p) => p.ip === ip)) {
    return { success: false, error: 'Printer already exists in the monitoring list.' };
  }

  const detection = await detectSnmpVersion(ip);
  if (!detection) {
    return { success: false, error: 'Unable to communicate with printer.' };
  }

  saveSnmpVersion(ip, detection.version);

  const info = await getPrinterInfo(ip, detection.version);

  const newPrinter = {
    ip,
    name: meta.name || info.name || `Printer (${ip})`,
    location: meta.location || 'Unassigned',
    snmpVersion: detection.version,
    vendor: info.success ? info.vendor : null,
    model: info.success ? info.model : '',
    serialNumber: info.success ? info.serialNumber : '',
    tonerLevels: info.success ? info.tonerLevels : { c: null, m: null, y: null, k: null },
    maintenanceKitLife: info.success ? info.maintenanceKitLife : null,
    status: 'Online',
    lastSeen: new Date().toISOString(),
  };

  printers.push(newPrinter);
  logger.info(`Added new printer: ${ip} (SNMP ${detection.version})`);

  return { success: true, printer: newPrinter };
}

module.exports = {
  initializePrinters,
  getAllPrinters,
  refreshPingOnly,
  refreshSnmpData,
  addPrinter,
  isValidIp,
  configureSchedule,
  markPingRun,
  markSnmpRun,
  getRefreshSchedule,
};
