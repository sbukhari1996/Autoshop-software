#!/usr/bin/env bash
# Run this ON the production server (Ubuntu VM) from the repo root.
# Pulls latest prod branch and rebuilds/restarts the stack with zero manual steps.
set -euo pipefail

BRANCH="prod"

echo "==> Fetching latest ${BRANCH}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git reset --hard "origin/${BRANCH}"

echo "==> Building and starting containers"
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build

echo "==> Pruning old images"
docker image prune -f

echo "==> Current status"
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
