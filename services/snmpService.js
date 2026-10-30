/**
 * ============================================================================
 * SNMP Service
 * ============================================================================
 * Responsible for:
 *   1. Auto-detecting SNMP version (tries v2c first, falls back to v1).
 *   2. Retrieving printer information: Name, Model, Serial Number,
 *      per-color Toner Levels (Cyan/Magenta/Yellow/Black), Maintenance
 *      Kit Life, Status, System Description.
 *
 * Uses the `net-snmp` package. All SNMP calls are wrapped in Promises so
 * they can be used with async/await and Promise.all() for concurrent,
 * non-blocking polling of many printers at once.
 * ============================================================================
 */

const snmp = require('net-snmp');
const { getOidMap } = require('../utils/oidList');
const logger = require('../utils/logger');

const COMMUNITY = process.env.SNMP_COMMUNITY || 'public';
const TIMEOUT = parseInt(process.env.SNMP_TIMEOUT, 10) || 2000;
const RETRIES = parseInt(process.env.SNMP_RETRIES, 10) || 1;

/**
 * Create a net-snmp session for a given IP + version.
 * @param {string} ip
 * @param {number} version - snmp.Version1 or snmp.Version2c
 */
function createSession(ip, version) {
  return snmp.createSession(ip, COMMUNITY, {
    port: 161,
    retries: RETRIES,
    timeout: TIMEOUT,
    version,
  });
}

/**
 * Perform a single SNMP GET for a list of OIDs. Wrapped in a Promise
 * so callers can use async/await instead of nested callbacks.
 * @param {object} session - an active net-snmp session
 * @param {string[]} oids
 * @returns {Promise<object[]>} varbinds
 */
function snmpGet(session, oids) {
  return new Promise((resolve, reject) => {
    session.get(oids, (error, varbinds) => {
      if (error) return reject(error);
      // Check for SNMP-level errors on individual varbinds
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) {
          return reject(new Error(snmp.varbindError(vb)));
        }
      }
      resolve(varbinds);
    });
  });
}

/**
 * Walk an SNMP subtree (used for the supplies tables, which are indexed
 * and can have a variable number of entries per printer).
 * @param {object} session
 * @param {string} oid - base OID to walk
 * @returns {Promise<object[]>} array of varbinds found under the OID
 */
function snmpWalk(session, oid) {
  return new Promise((resolve, reject) => {
    const results = [];
    session.walk(
      oid,
      20, // maxRepetitions
      (varbinds) => {
        varbinds.forEach((vb) => {
          if (!snmp.isVarbindError(vb)) results.push(vb);
        });
      },
      (error) => {
        if (error && error.name !== 'RequestTimedOutError') {
          return reject(error);
        }
        resolve(results);
      }
    );
  });
}

/**
 * Try to fetch the sysDescr OID using a specific SNMP version.
 * Used purely for auto-detecting which version a printer supports.
 * @param {string} ip
 * @param {number} version
 * @returns {Promise<string|null>} sysDescr string, or null if it failed
 */
function tryGetSysDescr(ip, version) {
  return new Promise((resolve) => {
    const session = createSession(ip, version);
    session.get(['1.3.6.1.2.1.1.1.0'], (error, varbinds) => {
      session.close();
      if (error || snmp.isVarbindError(varbinds?.[0])) {
        return resolve(null);
      }
      resolve(varbinds[0].value.toString());
    });
  });
}

/**
 * Auto-detect SNMP version for a printer: try v2c first, then v1.
 * @param {string} ip
 * @returns {Promise<{version: string, sysDescr: string}|null>}
 *          version = 'v2c' | 'v1', or null if both failed.
 */
async function detectSnmpVersion(ip) {
  // 1. Try SNMP v2c
  const v2cDescr = await tryGetSysDescr(ip, snmp.Version2c);
  if (v2cDescr !== null) {
    logger.info(`SNMP v2c detected for ${ip}`);
    return { version: 'v2c', sysDescr: v2cDescr };
  }

  // 2. Fallback to SNMP v1
  const v1Descr = await tryGetSysDescr(ip, snmp.Version1);
  if (v1Descr !== null) {
    logger.info(`SNMP v1 detected for ${ip}`);
    return { version: 'v1', sysDescr: v1Descr };
  }

  // 3. Both failed
  logger.warn(`Unable to communicate with printer at ${ip} (SNMP v1/v2c both failed).`);
  return null;
}

/**
 * Convert our internal version string to the net-snmp version constant.
 */
function toSnmpVersionConstant(versionStr) {
  return versionStr === 'v1' ? snmp.Version1 : snmp.Version2c;
}

/**
 * Find the supply level/max-capacity pair matching a keyword
 * (e.g. "toner" or "maintenance") from the walked supplies tables.
 * Falls back to the first supply entry if no keyword match is found.
 */
function findSupplyByKeyword(descriptions, levels, maxCapacities, keywords) {
  for (const desc of descriptions) {
    const index = desc.oid.split('.').pop();
    const text = desc.value.toString().toLowerCase();
    if (keywords.some((kw) => text.includes(kw))) {
      const level = levels.find((l) => l.oid.split('.').pop() === index);
      const max = maxCapacities.find((m) => m.oid.split('.').pop() === index);
      if (level && max) {
        return { level: Number(level.value), max: Number(max.value) };
      }
    }
  }
  return null;
}

/**
 * Compute a 0-100 percentage from raw level/max SNMP values.
 * Printer-MIB uses -2 to mean "level unknown but supply present" and
 * -1 for "unknown", so we guard against those.
 */
function computePercentage(level, max) {
  if (level == null || max == null || max <= 0 || level < 0) return null;
  return Math.round((level / max) * 100);
}

/**
 * Retrieve full printer information via SNMP: Name, Model, Serial Number,
 * Toner Level (%), Maintenance Kit Life (%), Status, System Description.
 *
 * @param {string} ip
 * @param {string} versionStr - 'v1' | 'v2c'
 * @returns {Promise<object>} printer SNMP data
 */
async function getPrinterInfo(ip, versionStr) {
  const version = toSnmpVersionConstant(versionStr);
  const session = createSession(ip, version);

  try {
    // 1. Basic scalar OIDs (name, sysDescr, serial, status)
    const { GENERIC_OIDS } = require('../utils/oidList');
    const scalarOids = [
      GENERIC_OIDS.sysName,
      GENERIC_OIDS.sysDescr,
      GENERIC_OIDS.serialNumber,
      GENERIC_OIDS.deviceStatus,
      GENERIC_OIDS.modelName,
    ];

    const varbinds = await snmpGet(session, scalarOids);
    const sysName = varbinds[0].value.toString();
    const sysDescr = varbinds[1].value.toString();
    const serialNumber = varbinds[2].value.toString();
    const deviceStatusCode = Number(varbinds[3].value);
    const modelName = varbinds[4].value.toString();

    // 2. Select the correct OID map based on detected vendor (HP/Canon/Generic)
    const { vendor, oids } = getOidMap(sysDescr);

    // 3. Walk the supplies tables to find Toner + Maintenance Kit levels
    const [descriptions, levels, maxCapacities] = await Promise.all([
      snmpWalk(session, GENERIC_OIDS.suppliesDescriptionTable),
      snmpWalk(session, GENERIC_OIDS.suppliesLevelTable),
      snmpWalk(session, GENERIC_OIDS.suppliesMaxCapacityTable),
    ]);

    const tonerLevels = {
      c: findSupplyByKeyword(descriptions, levels, maxCapacities, ['cyan']),
      m: findSupplyByKeyword(descriptions, levels, maxCapacities, ['magenta']),
      y: findSupplyByKeyword(descriptions, levels, maxCapacities, ['yellow']),
      k: findSupplyByKeyword(descriptions, levels, maxCapacities, ['black', 'toner cartridge', 'toner']),
    };
    const maintenanceSupply = findSupplyByKeyword(descriptions, levels, maxCapacities, [
      'maintenance',
      'kit',
      'drum',
      'fuser',
    ]);

    // Each channel resolves to a 0-100 percentage, or null if that
    // color simply isn't present on this printer (e.g. monochrome
    // devices will only ever report "k").
    const tonerPercentages = {
      c: tonerLevels.c ? computePercentage(tonerLevels.c.level, tonerLevels.c.max) : null,
      m: tonerLevels.m ? computePercentage(tonerLevels.m.level, tonerLevels.m.max) : null,
      y: tonerLevels.y ? computePercentage(tonerLevels.y.level, tonerLevels.y.max) : null,
      k: tonerLevels.k ? computePercentage(tonerLevels.k.level, tonerLevels.k.max) : null,
    };
    const maintenanceKitLife = maintenanceSupply
      ? computePercentage(maintenanceSupply.level, maintenanceSupply.max)
      : null;

    // hrDeviceStatus: 1=unknown, 2=running, 3=warning, 4=testing, 5=down
    const statusMap = {
      1: 'Unknown',
      2: 'Running',
      3: 'Warning',
      4: 'Testing',
      5: 'Down',
    };

    return {
      success: true,
      vendor,
      name: sysName,
      model: modelName || sysDescr,
      serialNumber,
      sysDescr,
      tonerLevels: tonerPercentages, // { c, m, y, k } - each a % or null
      maintenanceKitLife, // % or null if not reported by the printer
      deviceStatus: statusMap[deviceStatusCode] || 'Unknown',
    };
  } catch (err) {
    logger.warn(`SNMP data retrieval failed for ${ip}:`, err.message);
    return { success: false, error: err.message };
  } finally {
    session.close();
  }
}

module.exports = {
  detectSnmpVersion,
  getPrinterInfo,
};
