#!/bin/bash
cd /Users/nzlhehe22/draw-game/web
LAST=""
while true; do
  URL=$(grep -o 'https://[a-z0-9]*\.lhr\.life' /tmp/draw-tunnel.log 2>/dev/null | tail -1)
  if [ -n "$URL" ] && [ "$URL" != "$LAST" ]; then
    echo "$URL" | npx vercel env add NEXT_PUBLIC_SERVER_URL production --force -y 2>/dev/null
    npx vercel --prod --yes 2>/dev/null
    LAST="$URL"
    echo "$(date): synced $URL" >> /tmp/draw-keepalive.log
  fi
  sleep 60
done
