This folder is intentionally empty until you run `npm install`.

scripts/copy-assets.js runs automatically after install (via the
"postinstall" script in package.json) and copies:

  node_modules/bootstrap/dist/css/bootstrap.min.css
  node_modules/bootstrap/dist/js/bootstrap.bundle.min.js

into public/vendor/bootstrap/, so the dashboard (views/index.html) can
load Bootstrap from your own local server instead of a CDN.

Icons are hand-written inline SVG (see views/index.html and
public/js/dashboard.js), so there's no icon font to vendor.

If this folder is still empty after `npm install`, run it manually:
  node scripts/copy-assets.js
