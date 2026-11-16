#!/usr/bin/env bash
# Publish the local agent to npm (package name and version from agent/package.json).
#
#   scripts/publish-agent.sh            # publish if agent/src changed since the last release
#   scripts/publish-agent.sh --dry-run  # show what would be published, publish nothing
#   scripts/publish-agent.sh --otp=123456   # with npm 2FA: the 6-digit code from your authenticator
#
# The site URL (LIFTLENS_SITE, from .env) is baked into the package as its default web app, and
# the coach skills are bundled as an offline fallback. When the source fingerprint differs from the
# latest release, the patch version is bumped in agent/package.json — commit that change, then run
# scripts/deploy.sh so the web app asks for the new version.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DRY=""
OTP=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY="--dry-run" ;;
    --otp=*) OTP="$a" ;;
    *) echo "✗ unknown option: $a"; exit 1 ;;
  esac
done
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi
SITE="${SITE:-${LIFTLENS_SITE:-}}"
[ -n "$SITE" ] || { echo "✗ set LIFTLENS_SITE=https://<your-site> in .env (see .env.example)"; exit 1; }
SITE="${SITE%/}"

NAME="$(node -p 'require("./agent/package.json").name')"
BUILD="$(node -e 'import("./agent/src/build-id.mjs").then(m=>console.log(m.agentBuildId("agent/src")))')"
[ -n "$DRY" ] || npm whoami >/dev/null || { echo "✗ not logged in to npm: run npm login"; exit 1; }

# latest release: its version, source fingerprint and baked-in site
LATEST="$(npm view "$NAME" version 2>/dev/null || true)"
if [ -n "$LATEST" ]; then
  PUB_BUILD="$(npm view "$NAME@$LATEST" liftlens.build 2>/dev/null || true)"
  PUB_SITE="$(npm view "$NAME@$LATEST" liftlens.webUrl 2>/dev/null || true)"
  if [ "$PUB_BUILD" = "$BUILD" ] && [ "$PUB_SITE" = "$SITE" ]; then
    echo "✓ $NAME@$LATEST already matches agent/src (build $BUILD) — nothing to publish"
    exit 0
  fi
  # next version: one patch above both the local and the published version
  VERSION="$(node -e '
    const [a,b]=process.argv.slice(1).map(v=>v.split(".").map(Number));
    const hi=(a[0]-b[0]||a[1]-b[1]||a[2]-b[2])>=0?a:b; console.log(`${hi[0]}.${hi[1]}.${hi[2]+1}`)' \
    "$(node -p 'require("./agent/package.json").version')" "$LATEST")"
else
  VERSION="$(node -p 'require("./agent/package.json").version')"
fi
echo "▸ $NAME@$VERSION (build $BUILD, webUrl=$SITE)${DRY:+ — dry run}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R agent/src "$TMP/src"
cp -R coaches "$TMP/coaches"
cp LICENSE "$TMP/LICENSE"
node -e '
  const fs=require("fs"),[,src,dst,v,site,build]=process.argv,p=JSON.parse(fs.readFileSync(src));
  p.version=v; p.liftlens={webUrl:site,build}; delete p.scripts.prepack; delete p.scripts.postpack;
  fs.writeFileSync(dst,JSON.stringify(p,null,2)+"\n");' agent/package.json "$TMP/package.json" "$VERSION" "$SITE" "$BUILD"
cat > "$TMP/README.md" <<EOF
# $NAME

Local agent for [LiftLens]($SITE): lets the web app use the Claude Code / Codex / local models
already on your computer to review your training. It listens on 127.0.0.1 only.

\`\`\`bash
npx -y $NAME            # start and pair with the browser
npx -y $NAME install    # run in the background, start at login (macOS / Linux)
npx -y $NAME help       # all commands
\`\`\`

Source and privacy details: https://github.com/dobbylabhq/liftlens
EOF

(cd "$TMP" && npm publish $DRY $OTP)

if [ -z "$DRY" ]; then
  # keep the repo's version in step with the release
  node -e '
    const fs=require("fs"),f="agent/package.json",p=JSON.parse(fs.readFileSync(f));
    p.version=process.argv[1]; fs.writeFileSync(f,JSON.stringify(p,null,2)+"\n");' "$VERSION"
  echo
  echo "✓ published $NAME@$VERSION"
  echo "  agent/package.json is now $VERSION — commit it, then run scripts/deploy.sh"
fi
