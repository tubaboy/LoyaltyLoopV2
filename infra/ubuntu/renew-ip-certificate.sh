#!/usr/bin/env bash
set -euo pipefail

cd /opt/loyaltyloop-v2-ubuntu
docker compose --profile certificates --env-file .env.ubuntu \
  -f docker-compose.ubuntu.yml run --rm certbot renew \
  --webroot --webroot-path /var/www/certbot
docker kill --signal HUP loyaltyloop-v2-proxy >/dev/null
