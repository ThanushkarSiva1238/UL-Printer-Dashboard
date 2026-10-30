/**
 * ============================================================================
 * Simple Logger Utility
 * ============================================================================
 * Lightweight console logger with timestamps and log levels.
 * Kept dependency-free intentionally (no winston/morgan) to preserve the
 * "lightweight, localhost-only" nature of this project.
 * ============================================================================
 */

function timestamp() {
  return new Date().toISOString();
}

const logger = {
  info: (...args) => console.log(`[INFO]  ${timestamp()} -`, ...args),
  warn: (...args) => console.warn(`[WARN]  ${timestamp()} -`, ...args),
  error: (...args) => console.error(`[ERROR] ${timestamp()} -`, ...args),
  debug: (...args) => {
    if (process.env.DEBUG === 'true') {
      console.log(`[DEBUG] ${timestamp()} -`, ...args);
    }
  },
};

module.exports = logger;
