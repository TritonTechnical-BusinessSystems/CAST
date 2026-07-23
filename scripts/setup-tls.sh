#!/usr/bin/env bash
# CAST TLS setup for cast.tritontechnical.com.
# Creates an interim self-signed cert now (HTTPS works immediately), and prints
# the steps to switch to the real auto-renewing acme-dns cert (LC's exact method).
set -euo pipefail
DOMAIN=cast.tritontechnical.com
LE="/etc/letsencrypt/live/$DOMAIN"

if [ ! -f "$LE/fullchain.pem" ]; then
  echo "Generating interim self-signed cert for $DOMAIN ..."
  sudo mkdir -p "$LE"
  sudo openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -keyout "$LE/privkey.pem" -out "$LE/fullchain.pem" \
    -subj "/CN=$DOMAIN" -addext "subjectAltName=DNS:$DOMAIN"
  echo "Self-signed cert written to $LE (browsers will warn until the real cert is installed)."
else
  echo "Cert already present at $LE — leaving it."
fi

cat <<'NOTE'

--- Switch to a real, auto-renewing Let's Encrypt cert (same method as Logistics Coordinator) ---
  1. sudo apt install -y certbot python3-certbot-dns-acmedns
  2. Register an acme-dns account for cast.tritontechnical.com against the SAME
     acme-dns server LC uses (server URL is in LC's /etc/letsencrypt/acmedns.ini),
     then write CAST's /etc/letsencrypt/acmedns.ini.
  3. Add the PUBLIC CNAME  _acme-challenge.cast.tritontechnical.com  ->  <acme-dns fulfillment host>
     in the tritontechnical.com zone. (Only this record is public; the app A record stays internal.)
  4. sudo certbot certonly -a dns-acmedns \
       --dns-acmedns-credentials /etc/letsencrypt/acmedns.ini \
       -d cast.tritontechnical.com
  5. Auto-reload nginx on renewal:
     echo '#!/bin/sh' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-cast.sh
     echo 'docker compose -f /opt/cast/app/docker-compose.yml exec -T web nginx -s reload' | sudo tee -a /etc/letsencrypt/renewal-hooks/deploy/reload-cast.sh
     sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-cast.sh
  certbot.timer (already enabled system-wide) renews twice daily.
NOTE
