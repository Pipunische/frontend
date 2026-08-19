#!/usr/bin/env bash
# Deploy Polupoker frontend BFF after git pull.
# Usage on server:
#   cd /path/to/frontend && bash scripts/deploy-frontend.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

BRANCH="${DEPLOY_BRANCH:-test}"

echo "==> Fetch & pull ($BRANCH)"
git fetch origin "$BRANCH"
git pull --ff-only origin "$BRANCH"

GIT_SHA="$(git rev-parse --short HEAD)"
export APP_VERSION="$GIT_SHA"
echo "==> APP_VERSION=$APP_VERSION"

if command -v docker >/dev/null 2>&1 && [ -f Dockerfile ]; then
  IMAGE="${DOCKER_IMAGE:-polupoker-bff}"
  CONTAINER="${DOCKER_CONTAINER:-polupoker-bff}"

  echo "==> Docker build ($IMAGE)"
  docker build --build-arg "GIT_SHA=$GIT_SHA" -t "$IMAGE" .

  echo "==> Restart container ($CONTAINER)"
  docker stop "$CONTAINER" 2>/dev/null || true
  docker rm "$CONTAINER" 2>/dev/null || true

  if [ -f .env ]; then
    docker run -d --name "$CONTAINER" --env-file .env -e "APP_VERSION=$GIT_SHA" -e "SPA_SERVE=1" -p 8000:8000 "$IMAGE"
  else
    echo "WARN: .env not found — pass env vars manually"
    docker run -d --name "$CONTAINER" -e "APP_VERSION=$GIT_SHA" -e "SPA_SERVE=1" -p 8000:8000 "$IMAGE"
  fi
else
  echo "==> No Docker — restart uvicorn/systemd manually with:"
  echo "    export APP_VERSION=$GIT_SHA"
  echo "    systemctl restart polupoker-bff   # or your service name"
fi

echo "==> Health check"
sleep 2
curl -sf "http://127.0.0.1:8000/api/health" | head -c 200
echo ""
echo "Done. CSS URL will use ?v=$APP_VERSION after restart."
