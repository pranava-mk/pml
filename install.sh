#!/usr/bin/env bash
# pml one-command installer.
#
#   curl -fsSL https://raw.githubusercontent.com/pranava-mk/pml/main/install.sh | bash
#
# Checks for git/node/npm (offers to install anything missing, asking first),
# clones pranava-mk/pml if you're not already inside a clone of it, runs
# `npm install`, and boots the real local dev workflow (`npm run demo`).
set -euo pipefail

REPO_URL="https://github.com/pranava-mk/pml.git"
MIN_NODE_MAJOR=20

# --- output helpers ---------------------------------------------------------
info()  { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn()  { printf '\033[1;33m!!\033[0m %s\n' "$1"; }
die()   { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

# When piped through `curl | bash`, stdin is the script itself, so prompts
# must read from the controlling terminal directly, not from stdin.
ask_yes_no() {
  local prompt="$1" reply
  if [ -r /dev/tty ]; then
    read -r -p "$prompt [y/N] " reply </dev/tty || reply="n"
  else
    warn "No terminal available to ask '$prompt' — defaulting to no."
    reply="n"
  fi
  case "$reply" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

detect_pkg_manager() {
  if command -v apt-get >/dev/null 2>&1; then echo "apt"; return; fi
  if command -v pacman  >/dev/null 2>&1; then echo "pacman"; return; fi
  if command -v brew    >/dev/null 2>&1; then echo "brew"; return; fi
  if command -v dnf     >/dev/null 2>&1; then echo "dnf"; return; fi
  echo "none"
}

install_with_pkg_manager() {
  local pkgs="$1" pm
  pm=$(detect_pkg_manager)
  case "$pm" in
    apt)
      info "Installing: $pkgs (apt-get, sudo may prompt for your password)"
      sudo apt-get update && sudo apt-get install -y $pkgs
      ;;
    pacman)
      info "Installing: $pkgs (pacman, sudo may prompt for your password)"
      sudo pacman -Sy --noconfirm $pkgs
      ;;
    brew)
      info "Installing: $pkgs (brew)"
      brew install $pkgs
      ;;
    dnf)
      info "Installing: $pkgs (dnf, sudo may prompt for your password)"
      sudo dnf install -y $pkgs
      ;;
    none)
      die "No supported package manager (apt/pacman/brew/dnf) found. Install $pkgs manually and re-run."
      ;;
  esac
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then
    info "git found: $(git --version)"
    return
  fi
  warn "git is not installed."
  if ask_yes_no "Install git now?"; then
    install_with_pkg_manager "git"
  else
    die "git is required. Install it and re-run this script."
  fi
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major=$(node -e 'console.log(process.versions.node.split(".")[0])')
    if [ "$major" -ge "$MIN_NODE_MAJOR" ]; then
      info "node found: $(node --version) (>= v${MIN_NODE_MAJOR} required)"
      return
    fi
    warn "node $(node --version) is older than the required v${MIN_NODE_MAJOR}+."
  else
    warn "node is not installed (pml requires Node >= ${MIN_NODE_MAJOR})."
  fi

  if ask_yes_no "Install/upgrade Node.js now?"; then
    local pm
    pm=$(detect_pkg_manager)
    case "$pm" in
      brew) install_with_pkg_manager "node" ;;
      apt)
        info "Installing Node ${MIN_NODE_MAJOR}.x via nodesource (sudo may prompt)"
        curl -fsSL "https://deb.nodesource.com/setup_${MIN_NODE_MAJOR}.x" | sudo -E bash -
        sudo apt-get install -y nodejs
        ;;
      pacman) install_with_pkg_manager "nodejs npm" ;;
      dnf) install_with_pkg_manager "nodejs" ;;
      none) die "No supported package manager found. Install Node >= ${MIN_NODE_MAJOR} manually and re-run." ;;
    esac
  else
    die "Node.js >= ${MIN_NODE_MAJOR} is required. Install it and re-run this script."
  fi
}

ensure_npm() {
  if command -v npm >/dev/null 2>&1; then
    info "npm found: $(npm --version)"
    return
  fi
  warn "npm is not installed (usually ships with Node.js)."
  if ask_yes_no "Install npm now?"; then
    install_with_pkg_manager "npm"
  else
    die "npm is required. Install it and re-run this script."
  fi
}

# --- main --------------------------------------------------------------------
info "pml installer starting"

ensure_git
ensure_node
ensure_npm

# Are we already inside a clone of this repo? Walk up looking for package.json
# whose "name" is pmlkit.
IN_REPO=0
if [ -f "package.json" ] && grep -q '"name": *"pmlkit"' package.json 2>/dev/null; then
  IN_REPO=1
fi

if [ "$IN_REPO" = "1" ]; then
  info "Already inside a pml checkout: $(pwd)"
else
  TARGET_DIR="pml"
  if [ -d "$TARGET_DIR" ]; then
    if [ -f "$TARGET_DIR/package.json" ] && grep -q '"name": *"pmlkit"' "$TARGET_DIR/package.json" 2>/dev/null; then
      info "Found existing clone at ./$TARGET_DIR — reusing it."
    else
      die "./$TARGET_DIR already exists and is not a pml checkout. Remove it or run this script elsewhere."
    fi
  else
    info "Cloning $REPO_URL into ./$TARGET_DIR"
    git clone "$REPO_URL" "$TARGET_DIR"
  fi
  cd "$TARGET_DIR"
fi

info "Installing npm dependencies"
npm install

info "Starting pml (serves the example decks at http://localhost:4321)"
info "Press Ctrl+C to stop."
exec npm run demo
