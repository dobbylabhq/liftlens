#!/usr/bin/env bash
# Deploy LiftLens to Cloudflare (Workers static assets — the successor of Pages).
#
#   scripts/deploy.sh                       # worker "app" (name in wrangler.jsonc)
#   SITE=https://liftlens.example.com scripts/deploy.sh   # custom domain (zone on the same account)
#
# What gets deployed is a static site: the web app and the coach skills (synced by local agents).
# The local agent itself is published to npm by scripts/publish-agent.sh — run that first.
# Videos and training logs never leave the user's browser; there is no backend.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${PROJECT:-app}"
WRANGLER="npx --yes wrangler@4"

cd "$ROOT"
# deployment-specific values (site URL, Cloudflare account) come from the environment or a
# git-ignored .env — never from the repo. See .env.example.
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi
echo "▸ account"
$WRANGLER whoami | grep -E "logged in|Account" || true

# 1) site URL: explicit SITE / LIFTLENS_SITE. A custom domain is attached to the Worker on deploy
#    (the zone must be on the same Cloudflare account); a workers.dev URL is corrected from the
#    deploy output on the first run.
SITE="${SITE:-${LIFTLENS_SITE:-}}"
[ -n "$SITE" ] || { echo "✗ set LIFTLENS_SITE=https://<your-site> in .env (see .env.example)"; exit 1; }
SITE="${SITE%/}"
export LIFTLENS_SITE="$SITE"   # the web build reads it for SEO tags (canonical, og:url, sitemap)
HOST="${SITE#*://}"; HOST="${HOST%%/*}"
case "$HOST" in
  *.workers.dev) DOMAIN_ARGS=() ;;
  *) DOMAIN_ARGS=(--domain "$HOST") ;;
esac
deploy() { $WRANGLER deploy --config "$ROOT/wrangler.jsonc" ${DOMAIN_ARGS[@]+"${DOMAIN_ARGS[@]}"} 2>&1 | tee /dev/stderr | { grep -oE "https://[a-z0-9.-]+\.workers\.dev" || true; } | head -1; }
echo "▸ site: $SITE"

# 0) the local agent is an npm package (scripts/publish-agent.sh). The web app asks users to run the
#    exact version in agent/package.json, so that version must already be published from this source.
NAME="$(node -p 'require("./agent/package.json").name')"
VERSION="$(node -p 'require("./agent/package.json").version')"
BUILD="$(node -e 'import("./agent/src/build-id.mjs").then(m=>console.log(m.agentBuildId("agent/src")))')"
PUB_BUILD="$(npm view "$NAME@$VERSION" liftlens.build 2>/dev/null || true)"
if [ "$PUB_BUILD" != "$BUILD" ] && [ -z "${SKIP_AGENT_CHECK:-}" ]; then
  echo "✗ $NAME@$VERSION on npm was not built from this agent/src (npm: ${PUB_BUILD:-missing}, local: $BUILD)"
  echo "  run scripts/publish-agent.sh, commit agent/package.json, then deploy again"
  echo "  (forks without their own npm package: SKIP_AGENT_CHECK=1 scripts/deploy.sh)"
  exit 1
fi
echo "▸ agent: $NAME@$VERSION (build $BUILD)"

# 2) build the web app
echo "▸ build web"
npm --prefix web run build
# onnxruntime-web's wasm (27MB, over the 25MB Pages file limit) is loaded from jsDelivr at runtime
rm -f web/dist/assets/ort-wasm-*.wasm
find web/dist -type f -size +24M -print -exec false {} + || { echo "✗ files over 24MB in dist"; exit 1; }
# keep recent builds' chunks so already-open pages can still lazy-load them after this deploy
node scripts/keep-old-assets.mjs web/dist/assets .deploy-cache 8

# 3) coach skills: published with a content manifest so local agents sync them automatically
echo "▸ publish coach skills"
node scripts/coaches-manifest.mjs coaches web/dist/coaches

# 5) deploy (twice on the very first run on workers.dev: once to learn the URL, once with it baked into the SEO tags)
echo "▸ deploy"
URL="$(deploy)"
if [ -z "${SITE_FIXED:-}" ] && [ ${#DOMAIN_ARGS[@]} -eq 0 ] && [ -n "$URL" ] && [ "$URL" != "$SITE" ]; then
  echo "▸ site URL is $URL — rebuilding for it (also set LIFTLENS_SITE=$URL in .env)"
  SITE="$URL" SITE_FIXED=1 exec "$0"
fi

echo
echo "✓ $SITE"
echo "  local agent: npx -y $NAME@$VERSION"
