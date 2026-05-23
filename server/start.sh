#!/bin/bash
cd /Users/nzlhehe22/draw-game/server
npx tsx index.ts &
sleep 2
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=60 -o ExitOnForwardFailure=yes -R 80:localhost:3001 nokey@localhost.run 2>&1 | while read line; do
  echo "$line" >> /tmp/draw-tunnel.log
  echo "$line" | grep -o 'https://[a-z0-9]*\.lhr\.life' >> /tmp/draw-tunnel-url.txt
done
