#!/usr/bin/env bash
# Write the audit's full worklist to a file without touching the committed
# AUDIT.md.
#
#   scripts/audit-snapshot.sh out/audit-before.md
set -euo pipefail

out=${1:?output path required}
mkdir -p "$(dirname "$out")"
if ! git diff --quiet -- AUDIT.md; then
  echo "AUDIT.md has uncommitted changes; not overwriting them." >&2
  exit 2
fi
trap 'git checkout -q -- AUDIT.md' EXIT
rm -f AUDIT.md
# The audit exits non-zero when it has high findings. A missing report is the
# failure that matters, and the move below catches it.
npm run -s audit -- --report > /dev/null || true
mv AUDIT.md "$out"
