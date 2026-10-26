#!/usr/bin/env bash
# Verify that a pi package is really live on npm and indexed by the pi package catalog.
#
# Usage:
#   bash .agents/skills/publish-to-npm/scripts/verify-publish.sh            # verify package.json version
#   bash .agents/skills/publish-to-npm/scripts/verify-publish.sh 0.2.0      # verify an explicit version
#
# Exit codes: 0 all checks passed, 1 at least one check failed.
set -uo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
REGISTRY="https://registry.npmjs.org"
CATALOG="https://pi.dev/packages"

fail=0
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=1; }
note() { printf '  \033[33mNOTE\033[0m %s\n' "$1"; }

command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }

NAME="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["name"])' "$PKG_DIR/package.json")"
LOCAL_VERSION="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$PKG_DIR/package.json")"
WANT="${1:-$LOCAL_VERSION}"

echo "package: $NAME"
echo "target version: $WANT (package.json: $LOCAL_VERSION)"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

code="$(curl -s -o "$tmp" -w '%{http_code}' --max-time 20 "$REGISTRY/$NAME")"
if [ "$code" != "200" ]; then
  bad "registry lookup $REGISTRY/$NAME -> HTTP $code (package not published yet?)"
  echo "verification failed"; exit 1
fi
ok "registry doc reachable"

python3 - "$tmp" "$NAME" "$WANT" <<'PY'
import json, sys
path, name, want = sys.argv[1], sys.argv[2], sys.argv[3]
doc = json.load(open(path))
fail = 0
def ok(m): print(f"  \033[32mPASS\033[0m {m}")
def bad(m):
    global fail
    fail = 1
    print(f"  \033[31mFAIL\033[0m {m}")
def note(m): print(f"  \033[33mNOTE\033[0m {m}")

latest = (doc.get("dist-tags") or {}).get("latest")
if latest == want:
    ok(f"dist-tags.latest == {want}")
elif latest == "0.0.0-stage":
    bad("dist-tags.latest is the 0.0.0-stage placeholder: staged publishing has not been approved yet")
    note("wait 2-3 min and re-run; else: npx --yes npm@11 stage list %s && npx --yes npm@11 stage approve <stage-id>" % name)
else:
    bad(f"dist-tags.latest is {latest!r}, expected {want!r}")

versions = doc.get("versions") or {}
meta = versions.get(want)
if not meta:
    bad(f"version {want} not present in registry (have: {', '.join(sorted(versions)) or 'none'})")
    sys.exit(fail)

kw = meta.get("keywords") or []
if "pi-package" in kw:
    ok("keywords contain 'pi-package' (required for pi catalog discovery)")
else:
    bad(f"keywords missing 'pi-package' (got: {kw})")

ext = (meta.get("pi") or {}).get("extensions")
if ext:
    ok(f"pi manifest: extensions={ext}")
else:
    bad("pi.extensions missing: pi installs the tarball but loads no extension")

repo = (meta.get("repository") or {}).get("url")
if repo:
    ok(f"repository: {repo}")
else:
    note("repository field missing (catalog link will be empty)")

dist = meta.get("dist") or {}
if dist.get("fileCount"):
    ok(f"tarball: {dist.get('fileCount')} files, {dist.get('unpackedSize')} bytes")
if dist.get("tarball"):
    print("TARBALL " + dist["tarball"])
sys.exit(fail)
PY
[ $? -ne 0 ] && fail=1

TARBALL="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d["versions"][sys.argv[3]]["dist"]["tarball"])' "$tmp" "$NAME" "$WANT" 2>/dev/null)"
if [ -n "$TARBALL" ]; then
  tcode="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$TARBALL")"
  [ "$tcode" = "200" ] && ok "tarball download -> HTTP 200" || bad "tarball download -> HTTP $tcode"
fi

ccode="$(curl -s -o "$tmp" -w '%{http_code}' --max-time 20 "$CATALOG/$NAME")"
if [ "$ccode" = "200" ] && grep -q "pi install npm:$NAME" "$tmp"; then
  ok "catalog page $CATALOG/$NAME lists 'pi install npm:$NAME'"
elif [ "$ccode" = "200" ]; then
  bad "catalog page exists but does not list the npm install command (catalog may be stale; recheck later)"
else
  bad "catalog page $CATALOG/$NAME -> HTTP $ccode (discovery is keyword-based; may lag behind publish)"
fi

if [ "$fail" -eq 0 ]; then
  echo "verification passed"
else
  echo "verification failed"
fi
exit "$fail"
