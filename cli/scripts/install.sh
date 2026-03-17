#!/usr/bin/env bash
# Sherwood CLI installer
#
# Installs the CLI from source into ~/.sherwood/cli/ with full native binding
# support (XMTP chat). Creates a `sherwood` symlink in /usr/local/bin.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/imthatcarlos/sherwood/main/cli/scripts/install.sh | bash

set -euo pipefail

INSTALL_DIR="$HOME/.sherwood/cli"
BIN_DIR="/usr/local/bin"
REPO="https://github.com/imthatcarlos/sherwood.git"

info()  { printf "\033[0;32m%s\033[0m\n" "$*"; }
warn()  { printf "\033[0;33m%s\033[0m\n" "$*"; }
error() { printf "\033[0;31m%s\033[0m\n" "$*"; exit 1; }

# ── Prerequisites ──
command -v node >/dev/null 2>&1 || error "Node.js is required. Install it: https://nodejs.org"
command -v npm  >/dev/null 2>&1 || error "npm is required. Install it: https://nodejs.org"
command -v git  >/dev/null 2>&1 || error "git is required."

NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d v)
[ "$NODE_MAJOR" -ge 20 ] || error "Node.js v20+ required (found $(node -v))"

# ── Install ──
info "Installing Sherwood CLI..."

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing install..."
  git -C "$INSTALL_DIR" pull --ff-only origin main 2>/dev/null || {
    warn "Pull failed — reinstalling fresh"
    rm -rf "$INSTALL_DIR"
  }
fi

if [ ! -d "$INSTALL_DIR" ]; then
  info "Cloning repository..."
  git clone --depth 1 --filter=blob:none --sparse "$REPO" "$INSTALL_DIR"
  git -C "$INSTALL_DIR" sparse-checkout set cli
fi

cd "$INSTALL_DIR/cli"

info "Installing dependencies..."
npm install --no-fund --no-audit 2>&1 | tail -1

info "Building..."
npm run build 2>&1 | tail -1

# ── Create launcher script ──
LAUNCHER="$INSTALL_DIR/sherwood"
cat > "$LAUNCHER" << 'LAUNCHER_EOF'
#!/usr/bin/env bash
# Sherwood CLI launcher — runs from ~/.sherwood/cli/
exec node "$HOME/.sherwood/cli/cli/dist/index.js" "$@"
LAUNCHER_EOF
chmod +x "$LAUNCHER"

# ── Symlink ──
if [ -w "$BIN_DIR" ]; then
  ln -sf "$LAUNCHER" "$BIN_DIR/sherwood"
  info "Installed: sherwood → $BIN_DIR/sherwood"
else
  warn "Cannot write to $BIN_DIR — trying with sudo"
  sudo ln -sf "$LAUNCHER" "$BIN_DIR/sherwood"
  info "Installed: sherwood → $BIN_DIR/sherwood"
fi

# ── Verify ──
if command -v sherwood >/dev/null 2>&1; then
  info ""
  info "Sherwood CLI installed successfully!"
  info "  Version: $(sherwood --version 2>/dev/null || echo 'unknown')"
  info "  Run: sherwood --help"
  info ""
else
  warn ""
  warn "Installed but 'sherwood' not in PATH."
  warn "Add to your shell profile: export PATH=\"$BIN_DIR:\$PATH\""
  warn ""
fi
