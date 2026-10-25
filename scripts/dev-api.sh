#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/cloud-env.sh"
cd "$PHOTOBOOTH_ROOT"
exec npm run dev --workspace @wedding-booth/api
