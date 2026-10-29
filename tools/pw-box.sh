#!/usr/bin/env bash
# Run a repo's Playwright suite in Chromium, Firefox and WebKit inside a rootless Podman box, with the Firestore
# emulator. For a host where the browsers' system libraries are not installable (Ubuntu 26.04).
#
#   cd <repo> && bash <devkit>/tools/pw-box.sh [--docker] [-b chromium,firefox,webkit] [-- <playwright test args>]
#   --docker (or PW_BOX_ENGINE=docker): use docker instead of podman, e.g. in a cloud session after starting dockerd.
#   Behind an HTTPS proxy (HTTPS_PROXY, CA in PW_BOX_CA or NODE_EXTRA_CA_CERTS) it runs on the host network with the proxy
#   and CA given to the box (Chromium NSS db; Firefox skips certificate errors), so all three browsers pass.
#
# The box is Playwright's own image (matching the repo's pinned @playwright/test) plus a JDK and firebase-tools,
# built once per versions pair and cached by tag. Each run is a fresh container with its own network namespace, so the
# fixed ports (4173, 8080, 9099) never clash with another run, and a fresh emulator (nothing kept between runs).
# The repo is mounted at /work; its playwright.config.mjs is wrapped so every project runs once per browser.
# Needs: podman (rootless, cgroup_manager = "cgroupfs" if there is no systemd user session), node or python3 for the pin.
set -euo pipefail

BROWSERS=chromium,firefox,webkit
ENGINE=${PW_BOX_ENGINE:-podman}
RUNARGS=()
NETARGS=()   # docker mode on a proxied host (a cloud session): the build uses the host network (the proxy is on 127.0.0.1) and its CA; the emulator jar is baked into the image
JDK_PKG=${PW_BOX_JDK:-openjdk-21-jre-headless}
FIREBASE_TOOLS=${PW_BOX_FIREBASE_TOOLS:-15.33.0}
while [ $# -gt 0 ]; do
  case $1 in
    -b|--browsers) BROWSERS=$2; shift 2 ;;
    --docker) ENGINE=docker; shift ;;
    --) shift; break ;;
    -h|--help) sed -n 2,17p "$0"; exit 0 ;;
    *) break ;;
  esac
done

CA=${PW_BOX_CA:-${NODE_EXTRA_CA_CERTS:-}}
if [ "$ENGINE" = docker ] && [ -n "${HTTPS_PROXY:-}" ]; then
  NETARGS=(--network host)   # the proxy listens on 127.0.0.1
  for v in HTTPS_PROXY HTTP_PROXY NO_PROXY https_proxy http_proxy no_proxy; do [ -n "${!v:-}" ] && RUNARGS+=(-e "$v=${!v}"); done
  # the service worker loads core.anawj.com live (importScripts is not routed), so the browsers need the proxy and its CA
  [ -f "$CA" ] && RUNARGS+=(-e PW_BOX_CA=/pw-box-ca.crt -e NODE_EXTRA_CA_CERTS=/pw-box-ca.crt -v "$CA":/pw-box-ca.crt:ro)
fi

KIT=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(pwd)
MOUNT=$REPO
case $(uname -s) in MINGW*|MSYS*) WIN=1; export MSYS_NO_PATHCONV=1; MOUNT=$(pwd -W) ;; *) WIN= ;; esac   # Git Bash + Docker Desktop
[ -n "${PW_BOX_JSON:-}" ] && RUNARGS+=(-e "PLAYWRIGHT_JSON_OUTPUT_NAME=$PW_BOX_JSON")   # pw-run.sh: the JSON report, under /work
[ -f "$REPO/playwright.config.mjs" ] || { echo "pw-box: run from a repo root with a playwright.config.mjs" >&2; exit 2; }

PW=$(node -e 'const p=require("./package.json");const v=(p.devDependencies||{})["@playwright/test"]||(p.dependencies||{})["@playwright/test"];console.log(v)')
case $PW in ''|undefined|*[^0-9.]*) echo "pw-box: @playwright/test must be pinned to an exact version (got '$PW')" >&2; exit 2 ;; esac

IMAGE=localhost/pw-box:$PW-fbt$FIREBASE_TOOLS
if ! $ENGINE image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "pw-box: building $IMAGE"
  # under the home cache, not /tmp: a job's private /tmp is invisible to podman
  mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}/pw-box"
  CTX=$(mktemp -d "${XDG_CACHE_HOME:-$HOME/.cache}/pw-box/ctx.XXXXXX")
  BUILDARGS=()
  if [ "${#NETARGS[@]}" -gt 0 ]; then   # the build runs behind the same proxy: host network, CA via a copy in the context
    BUILDARGS=(--network host --build-arg "HTTPS_PROXY=$HTTPS_PROXY" --build-arg "NO_PROXY=${NO_PROXY:-}")
    [ -f "$CA" ] && cp "$CA" "$CTX/ca.crt"
  fi
  cat > "$CTX/Containerfile" <<DOCKER
FROM mcr.microsoft.com/playwright:v$PW-noble
ARG HTTPS_PROXY
ARG NO_PROXY
$([ -f "$CTX/ca.crt" ] && echo 'COPY ca.crt /pw-box-ca.crt
ENV NODE_EXTRA_CA_CERTS=/pw-box-ca.crt SSL_CERT_FILE=/pw-box-ca.crt')
RUN apt-get update && apt-get install -y --no-install-recommends $JDK_PKG libnss3-tools && rm -rf /var/lib/apt/lists/*
RUN npm install -g firebase-tools@$FIREBASE_TOOLS
RUN firebase setup:emulators:firestore
DOCKER
  CTXD=$CTX; [ -n "$WIN" ] && CTXD=$(cd "$CTX" && pwd -W)   # Docker Desktop wants a Windows path
  $ENGINE build ${BUILDARGS[@]+"${BUILDARGS[@]}"} -f "$CTXD/Containerfile" -t "$IMAGE" "$CTXD"
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
  if (b === 'firefox') {
    delete use.isMobile;
    // behind a proxy CA (a cloud session) Firefox ignores the system store and the policy file; its own NSS db is not reachable
    // from the wrapper, so skip the certificate check there (the box is throwaway and only the proxy's CA is in play)
    if (process.env.PW_BOX_CA) use.ignoreHTTPSErrors = true;
  }
  projects.push({ ...p, name: `${p.name}-${b}`, use });
}
export default { ...base, projects };
JS
trap 'rm -rf "$REPO/.pw-box.config.mjs"' EXIT

# docker mode (a cloud session): the repo's git dependencies (github: ssh URLs) are installed here on the host, which has
# the git credentials, not in the box
# (not on Windows: a Windows node_modules would not run in the Linux box; there the box installs them over https)
if [ "$ENGINE" = docker ] && [ -z "$WIN" ] && [ ! -d "$REPO/node_modules" ]; then
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf GIT_CONFIG_VALUE_0=ssh://git@github.com/ npm ci --no-audit --no-fund
fi

START=$(date +%s)
$ENGINE run --rm --ipc=host --init ${NETARGS[@]+"${NETARGS[@]}"} ${RUNARGS[@]+"${RUNARGS[@]}"} \
  -v "$MOUNT":/work:Z -w /work \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf -e GIT_CONFIG_VALUE_0=ssh://git@github.com/ \
  -e CI=1 -e PW_BOX_BROWSERS="$BROWSERS" -e PW_CHROMIUM= \
  "$IMAGE" bash -c '[ -d node_modules ] || npm ci --no-audit --no-fund
  if [ -f /pw-box-ca.crt ]; then mkdir -p ~/.pki/nssdb; certutil -N --empty-password -d sql:$HOME/.pki/nssdb 2>/dev/null; awk "/BEGIN CERT/{n++} {print > \"/tmp/pwca\" n \".crt\"}" /pw-box-ca.crt; for c in /tmp/pwca*.crt; do certutil -d sql:$HOME/.pki/nssdb -A -t C,, -n "pw-box-$c" -i "$c"; done; fi
  npx playwright test -c .pw-box.config.mjs "$@"' _ "$@"
echo "pw-box: $BROWSERS passed in $(( $(date +%s) - START )) s"
