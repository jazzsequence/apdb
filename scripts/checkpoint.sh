#!/usr/bin/env bash
# Keep what an import step wrote, or discard it alone.
#
#   scripts/checkpoint.sh "<step name>"
#
# Valid data is staged, which makes it the point the next step can be rolled
# back to. Data that does not validate is thrown away back to that point, so one
# failed step costs its own output and nobody else's.
set -uo pipefail

# Discarding deletes uncommitted work. Only a throwaway runner may do that.
if [ "${GITHUB_ACTIONS:-}" != "true" ]; then
  echo "checkpoint.sh only runs in GitHub Actions." >&2
  exit 2
fi

name=${1:?step name required}
mkdir -p out

if npm run -s validate > out/checkpoint.log 2>&1; then
  git add -A -- data/
  exit 0
fi

{
  echo "$name: output discarded because it did not validate."
  tail -n 40 out/checkpoint.log
} >> out/discarded.log
echo "::warning::$name wrote data that does not validate. It was discarded."
git checkout -q -- data/
git clean -qfd -- data/
