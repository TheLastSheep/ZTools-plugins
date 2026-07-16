#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')

if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "PasteboardPro build requires Node.js 24 or newer" >&2
  exit 1
fi

HELPER="$ROOT/apps/ztools/native/vision-helper/dist/pasteboard-vision"
if [ ! -f "$HELPER" ]; then
  echo "Missing macOS Vision helper artifact: $HELPER" >&2
  exit 1
fi
chmod +x "$HELPER"

corepack pnpm@11.7.0 install --frozen-lockfile
corepack pnpm@11.7.0 test
corepack pnpm@11.7.0 test:contract
corepack pnpm@11.7.0 typecheck
corepack pnpm@11.7.0 --filter @pasteboard-pro/ztools typecheck
corepack pnpm@11.7.0 --filter @pasteboard-pro/ztools build
