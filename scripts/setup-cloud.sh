#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/cloud-env.sh"
cd "$PHOTOBOOTH_ROOT"
node -e 'const major = Number(process.versions.node.split(".")[0]); if (major !== 24) throw new Error("Use Node 24; exact tested version is in .nvmrc")'
npm ci --no-audit --no-fund
npm run typecheck
npm test
CI=1 EXPO_OFFLINE=1 npm run bundle:ios
printf '%s\n' 'Cloud checks complete. A Mac/Xcode and the real iPad are still required for native verification.'
