#!/usr/bin/env bash
# Fetches the Onshape FeatureScript standard library (MIT, (c) PTC Inc.) at the
# commit fs_sim was tested against, into fs_sim/std.
set -euo pipefail
COMMIT=a2a7b13ea823f144b20d27198043aea35a64d928   # std v2960.0
DEST="$(cd "$(dirname "$0")" && pwd)/std"
if [ -f "$DEST/geometry.fs" ]; then echo "std already present at $DEST"; exit 0; fi
rm -rf "$DEST" && mkdir -p "$DEST" && cd "$DEST"
git init -q && git remote add origin https://github.com/javawizard/onshape-std-library-mirror
git fetch -q --depth 1 origin "$COMMIT" && git checkout -q FETCH_HEAD
echo "Fetched Onshape std $(git log -1 --format=%s) into $DEST"
