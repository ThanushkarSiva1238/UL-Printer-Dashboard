/**
 * ============================================================================
 * OID List (Printer-MIB + Vendor-Specific OIDs)
 * ============================================================================
 * This file centralizes every SNMP OID used by the dashboard.
 *
 * Standard OIDs come from Printer-MIB (RFC 3805) and Host-Resources-MIB,
 * which are supported by almost every network printer regardless of brand.
 *
 * Some values (like accurate toner/maintenance-kit percentages) are more
 * reliable when read from vendor-specific MIBs. This file exposes a
 * `getOidMap(sysDescr)` helper so the SNMP service can automatically pick
 * the correct OID set based on the printer's manufacturer/model, without
 * duplicating logic elsewhere in the codebase.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// Generic Printer-MIB OIDs (work for the vast majority of HP & Canon printers)
// ---------------------------------------------------------------------------
const GENERIC_OIDS = {
  // System
  sysName: '1.3.6.1.2.1.1.5.0',        // System / Printer Name
  sysDescr: '1.3.6.1.2.1.1.1.0',       // System Description (used to detect vendor/model)
  sysUpTime: '1.3.6.1.2.1.1.3.0',      // System Uptime

  // Printer-MIB: General
  serialNumber: '1.3.6.1.2.1.43.5.1.1.17.1', // Printer Serial Number
  printerStatus: '1.3.6.1.2.1.25.3.5.1.1.1', // hrPrinterStatus (1=other,3=idle,4=printing,5=warmup)
  deviceStatus: '1.3.6.1.2.1.25.3.2.1.5.1',  // hrDeviceStatus (1=unknown,2=running,3=warning,4=testing,5=down)

  // Printer-MIB: Supplies (Toner / Maintenance Kit)
  // These are indexed tables; the SNMP service walks them and matches by description.
  suppliesDescriptionTable: '1.3.6.1.2.1.43.11.1.1.6.1', // prtMarkerSuppliesDescription
  suppliesLevelTable: '1.3.6.1.2.1.43.11.1.1.9.1',       // prtMarkerSuppliesLevel (current level)
  suppliesMaxCapacityTable: '1.3.6.1.2.1.43.11.1.1.8.1', // prtMarkerSuppliesMaxCapacity
  suppliesClassTable: '1.3.6.1.2.1.43.11.1.1.4.1',       // prtMarkerSuppliesClass (1=Other,3=supplyThatIsConsumed,4=Filled)

  // Printer-MIB: Model / Console
  modelName: '1.3.6.1.2.1.25.3.2.1.3.1', // hrDeviceDescr (often includes model name)
};

// ---------------------------------------------------------------------------
// HP-specific OIDs (HP JetDirect / HP LaserJet MIB) — used as a fallback
// when generic supply tables don't return clean HP naming.
// ---------------------------------------------------------------------------
const HP_OIDS = {
  ...GENERIC_OIDS,
  tonerLevel: '1.3.6.1.2.1.43.11.1.1.9.1.1',      // Black toner level (first supply index)
  tonerMaxCapacity: '1.3.6.1.2.1.43.11.1.1.8.1.1',
  maintenanceKitLevel: '1.3.6.1.2.1.43.11.1.1.9.1.2', // Typically 2nd supply index on many HP models
  maintenanceKitMaxCapacity: '1.3.6.1.2.1.43.11.1.1.8.1.2',
};

// ---------------------------------------------------------------------------
// Canon-specific OIDs (Canon printers largely follow Printer-MIB as well,
// but supply table indices can differ). Adjust indices per deployed model.
// ---------------------------------------------------------------------------
const CANON_OIDS = {
  ...GENERIC_OIDS,
  tonerLevel: '1.3.6.1.2.1.43.11.1.1.9.1.1',
  tonerMaxCapacity: '1.3.6.1.2.1.43.11.1.1.8.1.1',
  maintenanceKitLevel: '1.3.6.1.2.1.43.11.1.1.9.1.3',
  maintenanceKitMaxCapacity: '1.3.6.1.2.1.43.11.1.1.8.1.3',
};

/**
 * Detect the printer vendor from its SNMP sysDescr string.
 * @param {string} sysDescr
 * @returns {'HP'|'CANON'|'GENERIC'}
 */
function detectVendor(sysDescr = '') {
  const descr = sysDescr.toUpperCase();
  if (descr.includes('HP') || descr.includes('HEWLETT')) return 'HP';
  if (descr.includes('CANON')) return 'CANON';
  return 'GENERIC';
}

/**
 * Return the correct OID map for a printer based on its sysDescr.
 * Falls back to GENERIC_OIDS + dynamic supply-table walking if the
 * vendor isn't recognized.
 * @param {string} sysDescr
 */
function getOidMap(sysDescr = '') {
  const vendor = detectVendor(sysDescr);
  switch (vendor) {
    case 'HP':
      return { vendor, oids: HP_OIDS };
    case 'CANON':
      return { vendor, oids: CANON_OIDS };
    default:
      return { vendor: 'GENERIC', oids: GENERIC_OIDS };
  }
}

module.exports = {
  GENERIC_OIDS,
  HP_OIDS,
  CANON_OIDS,
  detectVendor,
  getOidMap,
};
