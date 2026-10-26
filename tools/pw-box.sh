#!/usr/bin/env bash
# Run a repo's Playwright suite in Chromium, Firefox and WebKit inside a rootless Podman box, with the Firestore
# emulator. For a host where the browsers' system libraries are not installable (Ubuntu 26.04).
#
#   cd <repo> && bash <devkit>/tools/pw-box.sh [-b chromium,firefox,webkit] [-- <playwright test args>]
#
# The box is Playwright's own image (matching the repo's pinned @playwright/test) plus a JDK and firebase-tools,
# built once per versions pair and cached by tag. Each run is a fresh container with its own network namespace, so the
# fixed ports (4173, 8080, 9099) never clash with another run, and a fresh emulator (nothing kept between runs).
# The repo is mounted at /work; its playwright.config.mjs is wrapped so every project runs once per browser.
# Needs: podman (rootless, cgroup_manager = "cgroupfs" if there is no systemd user session), node or python3 for the pin.
set -euo pipefail

BROWSERS=chromium,firefox,webkit
JDK_PKG=${PW_BOX_JDK:-openjdk-21-jre-headless}
FIREBASE_TOOLS=${PW_BOX_FIREBASE_TOOLS:-15.33.0}
while [ $# -gt 0 ]; do
  case $1 in
    -b|--browsers) BROWSERS=$2; shift 2 ;;
    --) shift; break ;;
    -h|--help) sed -n 2,13p "$0"; exit 0 ;;
    *) break ;;
  esac
done

KIT=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(pwd)
[ -f "$REPO/playwright.config.mjs" ] || { echo "pw-box: run from a repo root with a playwright.config.mjs" >&2; exit 2; }

PW=$(node -e 'const p=require("./package.json");const v=(p.devDependencies||{})["@playwright/test"]||(p.dependencies||{})["@playwright/test"];console.log(v)')
case $PW in ''|undefined|*[^0-9.]*) echo "pw-box: @playwright/test must be pinned to an exact version (got '$PW')" >&2; exit 2 ;; esac

IMAGE=localhost/pw-box:$PW-fbt$FIREBASE_TOOLS
if ! podman image exists "$IMAGE"; then
  echo "pw-box: building $IMAGE"
  # under the home cache, not /tmp: a job's private /tmp is invisible to podman
  mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}/pw-box"
  CTX=$(mktemp -d "${XDG_CACHE_HOME:-$HOME/.cache}/pw-box/ctx.XXXXXX")
  cat > "$CTX/Containerfile" <<DOCKER
FROM mcr.microsoft.com/playwright:v$PW-noble
RUN apt-get update && apt-get install -y --no-install-recommends $JDK_PKG && rm -rf /var/lib/apt/lists/*
RUN npm install -g firebase-tools@$FIREBASE_TOOLS
DOCKER
  podman build -t "$IMAGE" "$CTX"
  rm -rf "$CTX"
fi

# The kit's shared config, where setup-browser puts it in CI.
rm -rf "$REPO/.devkit"; mkdir -p "$REPO/.devkit"
cp -R "$KIT/playwright" "$KIT/rules" "$KIT/tools" "$KIT/worker" "$REPO/.devkit/"

# Wrapper config: each project of the repo's config, once per browser (touch/mobile flags dropped where Firefox lacks them).
cat > "$REPO/.pw-box.config.mjs" <<'JS'
import base from './playwright.config.mjs';
const browsers = (process.env.PW_BOX_BROWSERS || 'chromium,firefox,webkit').split(',');
const projects = [];
for (const b of browsers) for (const p of base.projects || [{ name: 'default', use: {} }]) {
  const use = { ...p.use, browserName: b };
  if (b === 'firefox') { delete use.isMobile; }
  projects.push({ ...p, name: `${p.name}-${b}`, use });
}
export default { ...base, projects };
JS
trap 'rm -rf "$REPO/.pw-box.config.mjs"' EXIT

START=$(date +%s)
podman run --rm --ipc=host --init \
  -v "$REPO":/work:Z -w /work \
  -e CI=1 -e PW_BOX_BROWSERS="$BROWSERS" -e PW_CHROMIUM= \
  "$IMAGE" bash -c '[ -d node_modules ] || npm ci --no-audit --no-fund; npx playwright test -c .pw-box.config.mjs "$@"' _ "$@"
echo "pw-box: $BROWSERS passed in $(( $(date +%s) - START )) s"
