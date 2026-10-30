/**
 * ============================================================================
 * Excel Service
 * ============================================================================
 * Handles all reading/writing of the two Excel files used by the dashboard:
 *
 *   1. Survey.xlsx  -> Read-only source of truth for which printers to
 *                      monitor (IP Address, Printer Name, Location).
 *
 *   2. SNMP.xlsx    -> Automatically maintained by the system. Stores the
 *                      detected SNMP version for every printer so we don't
 *                      have to re-detect it (try v2c -> v1) on every restart.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const logger = require('../utils/logger');

const SURVEY_FILE = path.resolve(process.env.SURVEY_FILE || './config/Survey.xlsx');
const SNMP_FILE = path.resolve(process.env.SNMP_FILE || './config/SNMP.xlsx');

/**
 * Read the Survey.xlsx file and return an array of printer seed records.
 * Expected columns: "IP Address", "Printer Name", "Location"
 * @returns {Array<{ip: string, name: string, location: string}>}
 */
function readSurveyFile() {
  try {
    if (!fs.existsSync(SURVEY_FILE)) {
      logger.warn(`Survey.xlsx not found at ${SURVEY_FILE}. Starting with an empty printer list.`);
      return [];
    }

    const workbook = XLSX.readFile(SURVEY_FILE);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    return rows
      .map((row) => ({
        ip: String(row['IP Address'] || row['IP'] || '').trim(),
        name: String(row['Printer Name'] || row['Name'] || '').trim(),
        location: String(row['Location'] || '').trim(),
      }))
      .filter((row) => row.ip); // Ignore rows with no IP address
  } catch (err) {
    logger.error('Failed to read Survey.xlsx:', err.message);
    return [];
  }
}

/**
 * Read the SNMP.xlsx file and return a map of { ip: snmpVersion }.
 * Creates the file (with headers only) if it doesn't exist yet.
 * @returns {Object<string, string>}
 */
function readSnmpFile() {
  try {
    if (!fs.existsSync(SNMP_FILE)) {
      logger.info('SNMP.xlsx not found. Creating a new one.');
      createEmptySnmpFile();
      return {};
    }

    const workbook = XLSX.readFile(SNMP_FILE);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const map = {};
    rows.forEach((row) => {
      const ip = String(row['IP Address'] || row['IP'] || '').trim();
      const version = String(row['SNMP Version'] || row['Version'] || '').trim();
      if (ip) map[ip] = version;
    });
    return map;
  } catch (err) {
    logger.error('Failed to read SNMP.xlsx:', err.message);
    return {};
  }
}

/**
 * Create a fresh SNMP.xlsx file with just the header row.
 */
function createEmptySnmpFile() {
  const worksheet = XLSX.utils.json_to_sheet([], {
    header: ['IP Address', 'SNMP Version'],
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'SNMP');

  // Ensure the /config directory exists
  const dir = path.dirname(SNMP_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  XLSX.writeFile(workbook, SNMP_FILE);
}

/**
 * Append (or update) a single printer's SNMP version in SNMP.xlsx.
 * Avoids duplicate entries - if the IP already exists, its version is
 * updated instead of a new row being added.
 * @param {string} ip
 * @param {string} version - 'v1' | 'v2c'
 */
function saveSnmpVersion(ip, version) {
  try {
    const existing = readSnmpFile();
    existing[ip] = version; // Insert or overwrite - guarantees no duplicates

    const rows = Object.entries(existing).map(([ipAddr, ver]) => ({
      'IP Address': ipAddr,
      'SNMP Version': ver,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: ['IP Address', 'SNMP Version'],
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'SNMP');

    const dir = path.dirname(SNMP_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    XLSX.writeFile(workbook, SNMP_FILE);
    logger.info(`Saved SNMP version for ${ip}: ${version}`);
  } catch (err) {
    logger.error(`Failed to save SNMP version for ${ip}:`, err.message);
  }
}

module.exports = {
  readSurveyFile,
  readSnmpFile,
  saveSnmpVersion,
};
