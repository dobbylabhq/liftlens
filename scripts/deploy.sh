#!/usr/bin/env bash
# Deploy LiftLens to Cloudflare (Workers static assets — the successor of Pages).
#
#   scripts/deploy.sh                       # worker "app" (name in wrangler.jsonc)
#   SITE=https://liftlens.example.com scripts/deploy.sh   # custom domain (zone on the same account)
#
# What gets deployed is a static site: the web app + the local-agent tarball
# (so users can run `npx -y https://<site>/agent/liftlens-agent.tgz` without an npm account).
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

# 4) pack the local agent with the site URL baked in; versioned by source fingerprint
BUILD="$(node -e 'import("./agent/src/build-id.mjs").then(m=>console.log(m.agentBuildId("agent/src")))')"
echo "▸ pack agent build $BUILD (webUrl=$SITE)"
TMP="$(mktemp -d)"
cp -R agent/src agent/package.json "$TMP/"
cp -R coaches "$TMP/coaches"
node -e '
  const fs=require("fs"),f=process.argv[1]+"/package.json",p=JSON.parse(fs.readFileSync(f));
  p.liftlens={webUrl:process.argv[2]}; delete p.scripts.prepack; delete p.scripts.postpack;
  fs.writeFileSync(f,JSON.stringify(p,null,2));' "$TMP" "$SITE"
mkdir -p web/dist/agent
(cd "$TMP" && npm pack --silent --pack-destination "$ROOT/web/dist/agent" >/dev/null)
mv web/dist/agent/liftlens-agent-*.tgz "web/dist/agent/liftlens-agent-$BUILD.tgz"
cp "web/dist/agent/liftlens-agent-$BUILD.tgz" web/dist/agent/liftlens-agent.tgz   # stable alias for old links
echo "{\"build\":\"$BUILD\"}" > web/dist/agent/version.json
rm -rf "$TMP"

# 5) deploy (twice on the very first run: once to learn the URL, once with the agent tarball baked for it)
echo "▸ deploy"
URL="$(deploy)"
if [ -z "${SITE_FIXED:-}" ] && [ ${#DOMAIN_ARGS[@]} -eq 0 ] && [ -n "$URL" ] && [ "$URL" != "$SITE" ]; then
  echo "▸ site URL is $URL — repacking agent for it"
  SITE="$URL" SITE_FIXED=1 exec "$0"
fi

echo
echo "✓ $SITE"
echo "  local agent: npx -y $SITE/agent/liftlens-agent-$BUILD.tgz"
