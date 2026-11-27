#!/usr/bin/env bash
# Production dependency license policy (one-way door #7). Permissive licenses
# only. Known exception: @img/sharp-libvips* (LGPL-3.0, Next.js image
# optimizer; dynamically linked native library, used unmodified).
set -euo pipefail
cd "$(dirname "$0")/.."
npx --yes license-checker-rseidelsohn@4 --production \
  --onlyAllow "MIT;Apache-2.0;ISC;0BSD;BSD-2-Clause;BSD-3-Clause;CC-BY-4.0;(MIT AND Zlib)" \
  --excludePackages "insurance-simplified@$(node -p 'require("./package.json").version')" \
  --excludePackagesStartingWith "@img/sharp-libvips" >/dev/null
echo "web licenses: ok"
