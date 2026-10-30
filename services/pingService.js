/**
 * ============================================================================
 * Ping Service
 * ============================================================================
 * Wraps the `ping` package to check whether a printer is Online/Offline
 * via ICMP. Kept as a thin, isolated module so the polling logic in
 * printerController.js stays clean.
 * ============================================================================
 */

const ping = require('ping');
const logger = require('../utils/logger');

const PING_TIMEOUT = parseInt(process.env.PING_TIMEOUT, 10) || 2; // seconds

/**
 * Ping a single IP address.
 * @param {string} ip
 * @returns {Promise<{alive: boolean, time: number|string}>}
 */
async function pingHost(ip) {
  try {
    // NOTE: We deliberately do NOT pass an `extra` args array here.
    // Ping CLI flags differ per OS (e.g. "-i" means packet interval on
    // Linux/macOS but TTL on Windows), so any raw flag risks doing the
    // wrong thing depending on where this runs. The `ping` package already
    // picks correct default flags (-c/-n, -W/-w, etc.) per platform - we
    // only set `timeout`, which it translates correctly on every OS.
    const result = await ping.promise.probe(ip, {
      timeout: PING_TIMEOUT,
    });
    return {
      alive: !!result.alive,
      time: result.time === 'unknown' ? null : result.time,
    };
  } catch (err) {
    logger.warn(`Ping failed for ${ip}:`, err.message);
    return { alive: false, time: null };
  }
}

/**
 * Ping multiple IPs concurrently using Promise.all for performance.
 * @param {string[]} ipList
 * @returns {Promise<Object<string, {alive: boolean, time: number|string}>>}
 */
async function pingAll(ipList) {
  const results = await Promise.all(
    ipList.map(async (ip) => {
      const res = await pingHost(ip);
      return [ip, res];
    })
  );
  return Object.fromEntries(results);
}

module.exports = {
  pingHost,
  pingAll,
};
