#!/usr/bin/env bash
set -euo pipefail

# Set these before publishing your own images. This script never pushes to the upstream org.
GITHUB_ORG="${GITHUB_ORG:?Set GITHUB_ORG to your GitHub username or organization}"
GITHUB_USER="${GITHUB_USER:-$GITHUB_ORG}"
PLATFORM="${PLATFORM:-linux/amd64}"
FRONTEND_IMAGE="poofit3d-frontend"
BACKEND_IMAGE="poofit3d-backend"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

docker login ghcr.io -u "$GITHUB_USER"
docker buildx build --platform "$PLATFORM" -t "ghcr.io/$GITHUB_ORG/$BACKEND_IMAGE:latest" --push ./backend
docker buildx build --platform "$PLATFORM" -t "ghcr.io/$GITHUB_ORG/$FRONTEND_IMAGE:latest" --push -f proxy-server/Dockerfile .
