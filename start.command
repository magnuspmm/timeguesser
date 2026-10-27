#!/bin/bash
cd "$(dirname "$0")"

PORT=5173
URL="http://127.0.0.1:${PORT}/"

echo "TimeGuesser – starter lokal server…"

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js/npm mangler. Installer fra https://nodejs.org og prøv igjen."
  read -r -p "Trykk Enter for å lukke…"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installerer avhengigheter (første gang)…"
  npm install
fi

# Frigjør porten – ellers åpner nettleseren feil prosess (uten /api/challenges)
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "Port $PORT er opptatt – stopper gammel prosess…"
    # shellcheck disable=SC2086
    kill $PIDS 2>/dev/null || true
    sleep 1
  fi
fi

# Open browser shortly after Vite starts
(sleep 2 && open "$URL") &

npm run dev -- --host 127.0.0.1 --port "$PORT" --strictPort
