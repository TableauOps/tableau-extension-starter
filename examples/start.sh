#!/usr/bin/env sh
# One command to serve ALL three viz extensions from a single origin.
#
#   ./start.sh              -> http://localhost:1111
#   PORT=8080 ./start.sh    -> override the port
#
# No install step, no dependencies — just Node.js (v14+).
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed or not on your PATH."
  echo "Install it from https://nodejs.org/ (v14 or newer), then re-run ./start.sh"
  exit 1
fi

exec node server.js
