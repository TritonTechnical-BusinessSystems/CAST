#!/usr/bin/env bash
# Pack + sign the CAST browser extension -> components/browser-extension/deploy/cast.crx
#
# Runtime-only files (manifest, src, icons) are staged first so the signing key
# NEVER enters the package. crx3 is installed in an isolated temp dir so its
# node_modules can't leak in either. Same key in => same extension ID
# (cijknnchejganljdmpdmdkajcmknmdpp), so self-update keeps working.
#
# Requires: the signing key at components/browser-extension/.keys/cast-ext-signing.pem
# (gitignored; backed up on forge + /opt/cast/keys), Node, and network for crx3.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/components/browser-extension"
KEY="$EXT/.keys/cast-ext-signing.pem"
OUT="$EXT/deploy/cast.crx"
[ -f "$KEY" ] || { echo "Missing signing key: $KEY" >&2; exit 1; }

STAGE="$(mktemp -d)"; BUILD="$(mktemp -d)"
trap 'rm -rf "$STAGE" "$BUILD"' EXIT

# Stage runtime-only files (never the .keys dir, README, or deploy scripts).
cp "$EXT/manifest.json" "$STAGE"/
cp -r "$EXT/src" "$STAGE"/
cp -r "$EXT/icons" "$STAGE"/
if find "$STAGE" \( -iname '*.pem' -o -iname '*.key*' \) | grep -q .; then
  echo "Refusing to pack: key material found in stage" >&2; exit 1
fi

# crx3 in an isolated dir so its node_modules never enters the package.
( cd "$BUILD" && npm init -y >/dev/null 2>&1 && npm install crx3@2.0.0 >/dev/null 2>&1 )

STAGE="$STAGE" KEY="$KEY" OUT="$OUT" NODE_PATH="$BUILD/node_modules" node -e '
const path = require("path"), fs = require("fs"), crx3 = require("crx3");
const stage = process.env.STAGE;
function walk(d, b, a) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f, b, a) : a.push(path.relative(b, f)); } return a; }
process.chdir(stage);
const files = walk(stage, stage, []).sort((x, y) => (x === "manifest.json" ? -1 : y === "manifest.json" ? 1 : x.localeCompare(y)));
if (!files.includes("manifest.json")) throw new Error("manifest.json missing from stage");
crx3(files, { keyPath: process.env.KEY, crxPath: process.env.OUT })
  .then(() => console.log("packed", process.env.OUT))
  .catch((e) => { console.error(e); process.exit(1); });
'

# Post-pack safety: refuse to ship a package containing key material.
if grep -aiqE "PRIVATE KEY|cast-ext-signing" "$OUT"; then
  echo "ABORT: key material found in $OUT — removing" >&2; rm -f "$OUT"; exit 1
fi
head -c4 "$OUT" | grep -q "Cr24" || { echo "ABORT: $OUT is not a CRX3 (bad magic)" >&2; exit 1; }
echo "OK: $OUT ($(wc -c < "$OUT") bytes)"
