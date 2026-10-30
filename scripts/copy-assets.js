/**
 * ============================================================================
 * copy-assets.js
 * ============================================================================
 * Runs automatically after `npm install` (see the "postinstall" script in
 * package.json). Copies the compiled Bootstrap CSS/JS out of node_modules
 * and into public/vendor/bootstrap/, so the dashboard can load Bootstrap
 * from our own Express server instead of a CDN.
 *
 * (Icons in this dashboard are hand-written inline SVG, not the Bootstrap
 * Icons webfont, so there's nothing to vendor for those - one less
 * external dependency and no icon-font flash on load.)
 *
 * This means the app has NO external CDN dependency at runtime - the only
 * time internet access is needed is once, when you run `npm install`
 * (same as installing any other npm package).
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// [sourceRelativeToNodeModules, destinationRelativeToPublicVendor]
const FILES_TO_COPY = [
  ['bootstrap/dist/css/bootstrap.min.css', 'bootstrap/bootstrap.min.css'],
  ['bootstrap/dist/css/bootstrap.min.css.map', 'bootstrap/bootstrap.min.css.map'],
  ['bootstrap/dist/js/bootstrap.bundle.min.js', 'bootstrap/bootstrap.bundle.min.js'],
  ['bootstrap/dist/js/bootstrap.bundle.min.js.map', 'bootstrap/bootstrap.bundle.min.js.map'],
];

function copyFile(srcRel, destRel) {
  const src = path.join(ROOT, 'node_modules', srcRel);
  const dest = path.join(ROOT, 'public', 'vendor', destRel);

  if (!fs.existsSync(src)) {
    console.warn(`[copy-assets] Skipping missing file: ${srcRel}`);
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`[copy-assets] Copied ${srcRel} -> public/vendor/${destRel}`);
}

console.log('[copy-assets] Vendoring Bootstrap into public/vendor/bootstrap ...');
FILES_TO_COPY.forEach(([src, dest]) => copyFile(src, dest));
console.log('[copy-assets] Done. The dashboard will now load Bootstrap locally (no CDN).');
