/**
 * ============================================================================
 * Printer Routes
 * ============================================================================
 * Defines the two API endpoints required by the dashboard:
 *   GET  /api/printers     -> list all monitored printers + refresh schedule
 *   POST /api/add-printer  -> add a new printer by IP address
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const printerController = require('../controllers/printerController');
const logger = require('../utils/logger');

// GET /api/printers - returns all printer data as JSON, plus the current
// refresh schedule (next ping / next SNMP data refresh timestamps) so the
// frontend can render an accurate countdown widget.
router.get('/printers', (req, res) => {
  try {
    const printers = printerController.getAllPrinters();
    const schedule = printerController.getRefreshSchedule();
    res.json({ success: true, count: printers.length, printers, schedule });
  } catch (err) {
    logger.error('Error fetching printers:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch printer data.' });
  }
});

// POST /api/add-printer - adds a new printer to the monitoring list
router.post('/add-printer', async (req, res) => {
  try {
    const { ip, name, location } = req.body;

    if (!ip) {
      return res.status(400).json({ success: false, error: 'IP address is required.' });
    }

    const result = await printerController.addPrinter(ip, { name, location });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(201).json(result);
  } catch (err) {
    logger.error('Error adding printer:', err.message);
    res.status(500).json({ success: false, error: 'Unexpected server error while adding printer.' });
  }
});

module.exports = router;
