#!/usr/bin/env bash
# Source from cloud helper scripts; preserve HOME, injected auth and proxy trust.
PHOTOBOOTH_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export npm_config_cache="$PHOTOBOOTH_ROOT/.cache/npm"
export XDG_CACHE_HOME="$PHOTOBOOTH_ROOT/.cache"
export XDG_CONFIG_HOME="$PHOTOBOOTH_ROOT/.cache/config"
export WRANGLER_LOG_PATH="$PHOTOBOOTH_ROOT/.cache/wrangler/logs"
export WRANGLER_SEND_METRICS=false
export EXPO_NO_TELEMETRY=1
mkdir -p "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$PHOTOBOOTH_ROOT/.cache/wrangler"
