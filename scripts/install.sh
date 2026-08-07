#!/usr/bin/env bash
# Clarity Linux installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/CaptainHacX/Clarity/main/scripts/install.sh | bash
#   curl -fsSL ... | bash -s            (installs the GUI + CLI binary)

set -euo pipefail

REPO="CaptainHacX/Clarity"
INSTALL_DIR="/opt/clarity"
BIN_LINK="/usr/local/bin/clarity"

# ── Helpers ──────────────────────────────────────────────────────
log()  { echo -e "\033[1;34m==>\033[0m $*"; }
ok()   { echo -e "\033[1;32m==>\033[0m $*"; }
err()  { echo -e "\033[1;31m==>\033[0m $*" >&2; }

require() {
  if ! command -v "$1" &>/dev/null; then
    err "Required command not found: $1"
    exit 1
  fi
}

# ── Preflight ────────────────────────────────────────────────────
require curl
require jq

if [[ "$(uname -s)" != "Linux" ]]; then
  err "This installer is for Linux only."
  exit 1
fi

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  ARCH_LABEL="x86_64" ;;
  *)       err "Unsupported architecture: $ARCH (only x86_64 is supported)"; exit 1 ;;
esac

if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (use sudo)."
  exit 1
fi

# ── Install runtime dependencies ─────────────────────────────────
log "Installing runtime dependencies..."
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1
apt-get update -qq
# libasound2 was renamed to libasound2t64 in Ubuntu 24.04+
if dpkg -s libasound2t64 &>/dev/null || apt-get install -y -qq --dry-run libasound2t64 &>/dev/null; then
  ALSA_PKG=libasound2t64
else
  ALSA_PKG=libasound2
fi

apt-get install -y -qq \
  libfuse2 \
  libgtk-3-0 \
  libatk1.0-0 \
  libnss3 \
  libxss1 \
  "$ALSA_PKG" \
  libgbm1 \
  > /dev/null
ok "Dependencies installed."

# ── Fetch latest release ────────────────────────────────────────
log "Finding latest Clarity release..."
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")
VERSION=$(echo "$RELEASE_JSON" | jq -r '.tag_name')
ASSET_NAME="Clarity-${VERSION#v}-prod-${ARCH_LABEL}.AppImage"
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | jq -r \
  --arg name "$ASSET_NAME" \
  '.assets[] | select(.name == $name) | .browser_download_url')

if [[ -z "$DOWNLOAD_URL" || "$DOWNLOAD_URL" == "null" ]]; then
  err "Could not find AppImage asset: $ASSET_NAME"
  err "Available assets:"
  echo "$RELEASE_JSON" | jq -r '.assets[].name' >&2
  exit 1
fi

log "Latest version: $VERSION"
log "Downloading $ASSET_NAME..."

# ── Download and install ─────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
APPIMAGE_PATH="${INSTALL_DIR}/Clarity.AppImage"

# Download to temp file first, then move atomically
TMP_FILE=$(mktemp "${INSTALL_DIR}/.clarity-download.XXXXXX")
trap 'rm -f "$TMP_FILE"' EXIT

curl -fSL --progress-bar "$DOWNLOAD_URL" -o "$TMP_FILE"
chmod +x "$TMP_FILE"
mv -f "$TMP_FILE" "$APPIMAGE_PATH"
trap - EXIT

# Remove any old symlink first — if BIN_LINK is a symlink pointing at
# APPIMAGE_PATH, writing through it would overwrite the real binary.
rm -f "$BIN_LINK"

# Create wrapper script in PATH (instead of a plain symlink) so that
# --no-sandbox and --ozone-platform=headless are always injected for
# CLI usage.  Chromium checks the real argv for --no-sandbox before
# Electron's app.commandLine.appendSwitch runs, so the flag must be on
# the actual command line.
cat > "$BIN_LINK" <<'WRAPPER'
#!/usr/bin/env bash
EXTRA_ARGS=()
# Always add --no-sandbox when running as root (required by Chromium)
if [[ $EUID -eq 0 ]]; then
  EXTRA_ARGS+=(--no-sandbox)
fi
# Add headless ozone platform for CLI (no display needed)
for arg in "$@"; do
  case "$arg" in
    --cli)
      EXTRA_ARGS+=(--ozone-platform=headless)
      break
      ;;
  esac
done
# Run without FUSE mount (avoids hang on servers without libfuse)
export APPIMAGE_EXTRACT_AND_RUN=1
exec /opt/clarity/Clarity.AppImage "${EXTRA_ARGS[@]}" "$@"
WRAPPER
chmod +x "$BIN_LINK"

ok "Installed Clarity $VERSION to $APPIMAGE_PATH"

# ── Summary ──────────────────────────────────────────────────────
echo ""
ok "Clarity $VERSION installation complete!"
echo ""
echo "  Binary:   $APPIMAGE_PATH"
echo "  Symlink:  $BIN_LINK"
echo ""
echo "  Run GUI:        clarity --no-sandbox"
echo "  Run CLI:        clarity --no-sandbox --cli"
echo ""
