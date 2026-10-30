/**
 * ============================================================================
 * UL Printer Management Dashboard - Server Entry Point
 * ============================================================================
 * Sets up the Express server, loads printers from Survey.xlsx on startup,
 * and runs TWO independent refresh cycles:
 *
 *   - Ping-only (Online/Offline status)      : every PING_INTERVAL_MS
 *   - Full SNMP data (toner + maintenance kit): every SNMP_REFRESH_INTERVAL_MS
 *
 * These are deliberately decoupled: ICMP ping is cheap and safe to run
 * often, while a full SNMP read across 20-25 printers is slower and was
 * previously the cause of the dashboard feeling laggy when it ran on the
 * same 10-second cycle as the ping check. Model, Serial Number, and
 * Location are read once at startup and not polled afterward, since they
 * essentially never change during normal operation.
 * ============================================================================
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const printerRoutes = require('./routes/printerRoutes');
const printerController = require('./controllers/printerController');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Ping (Online/Offline) refresh cadence - cheap, safe to run often.
const PING_INTERVAL_MS = parseInt(process.env.PING_INTERVAL_MS, 10) || 60000; // 60 seconds

// Full SNMP data refresh cadence (toner levels + maintenance kit life).
// Model, Serial Number, and Location are read once at startup only (see
// the startup sequence below) and are not part of this recurring job.
const SNMP_REFRESH_INTERVAL_MS =
  parseInt(process.env.SNMP_REFRESH_INTERVAL_MS, 10) || 900000; // 15 minutes

// ----------------------------------------------------------------------------
// Middleware
// ----------------------------------------------------------------------------
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------
app.use('/api', printerRoutes);

// Serve the dashboard's main HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Fallback error handler - keeps error messages friendly instead of leaking stack traces
app.use((err, req, res, next) => {
  logger.error('Unhandled server error:', err.message);
  res.status(500).json({ success: false, error: 'Something went wrong on the server.' });
});

// ----------------------------------------------------------------------------
// Startup sequence
// ----------------------------------------------------------------------------
async function start() {
  // 1. Load printers from Survey.xlsx + SNMP.xlsx (IP, Name, Location,
  //    and any previously-detected SNMP version).
  printerController.initializePrinters();
  printerController.configureSchedule(PING_INTERVAL_MS, SNMP_REFRESH_INTERVAL_MS);

  // 2. Ping every printer once immediately, so we know which ones are
  //    reachable before attempting any SNMP calls.
  await printerController.refreshPingOnly();
  printerController.markPingRun();

  // 3. One-time full SNMP read for every online printer: Model, Serial
  //    Number, vendor, and an initial toner/maintenance-kit reading, so
  //    the dashboard isn't showing blank fields while waiting for the
  //    first SNMP refresh cycle. Location already came from Survey.xlsx
  //    in step 1 and is never re-queried.
  await printerController.refreshSnmpData();
  printerController.markSnmpRun();

  // 4. Schedule the recurring ping-only status check (frequent, cheap).
  setInterval(() => {
    printerController
      .refreshPingOnly()
      .catch((err) => logger.error('Error during scheduled ping refresh:', err.message))
      .finally(() => printerController.markPingRun());
  }, PING_INTERVAL_MS);

  // 5. Schedule the recurring full SNMP data refresh (infrequent, heavier).
  setInterval(() => {
    printerController
      .refreshSnmpData()
      .catch((err) => logger.error('Error during scheduled SNMP refresh:', err.message))
      .finally(() => printerController.markSnmpRun());
  }, SNMP_REFRESH_INTERVAL_MS);

  // 6. Start listening
  app.listen(PORT, () => {
    logger.info(`UL Printer Management Dashboard running at http://localhost:${PORT}`);
    logger.info(`Checking Online/Offline status every ${PING_INTERVAL_MS / 1000} seconds.`);
    logger.info(
      `Refreshing toner + maintenance kit data every ${SNMP_REFRESH_INTERVAL_MS / 60000} minute(s).`
    );
  });
}

start();
