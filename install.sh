#!/bin/sh
set -e

REPO="autohandai/cli"
BINARY_NAME="autohand"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

main() {
    printf "${BLUE}"
    cat << 'EOF'
    ___         __        __                    __
   /   | __  __/ /_____  / /_  ____ _____  ____/ /
  / /| |/ / / / __/ __ \/ __ \/ __ `/ __ \/ __  /
 / ___ / /_/ / /_/ /_/ / / / / /_/ / / / / /_/ /
/_/  |_\__,_/\__/\____/_/ /_/\__,_/_/ /_/\__,_/

EOF
    printf "${NC}"
    echo ""

    need_cmd curl
    need_cmd uname
    need_cmd chmod

    get_architecture || return 1
    local _arch="$RETVAL"

    local _version="${AUTOHAND_VERSION:-latest}"
    local _url

    if [ "$_version" = "latest" ]; then
        _url="https://github.com/${REPO}/releases/latest/download/autohand-${_arch}"
    else
        _url="https://github.com/${REPO}/releases/download/v${_version}/autohand-${_arch}"
    fi

    if [ "$_arch" = "windows-x64" ]; then
        _url="${_url}.exe"
        BINARY_NAME="autohand.exe"
    fi

    local _dir
    if [ -n "${AUTOHAND_INSTALL_DIR:-}" ]; then
        _dir="$AUTOHAND_INSTALL_DIR"
    elif [ "$(id -u)" = "0" ]; then
        _dir="/usr/local/bin"
    elif [ -d "$HOME/.local/bin" ]; then
        _dir="$HOME/.local/bin"
    else
        _dir="$HOME/.local/bin"
        mkdir -p "$_dir"
    fi

    printf "${YELLOW}Downloading Autohand CLI...${NC}\n"
    echo "  Platform: $_arch"
    echo "  Version:  $_version"
    echo "  Target:   $_dir/$BINARY_NAME"
    echo ""

    local _tmp
    _tmp=$(mktemp)

    if ! curl -fsSL "$_url" -o "$_tmp" 2>/dev/null; then
        printf "${RED}Error: Failed to download from $_url${NC}\n"
        printf "${YELLOW}Hint: Check if the version exists at https://github.com/${REPO}/releases${NC}\n"
        rm -f "$_tmp"
        exit 1
    fi

    if [ ! -s "$_tmp" ]; then
        printf "${RED}Error: Downloaded file is empty${NC}\n"
        rm -f "$_tmp"
        exit 1
    fi

    chmod +x "$_tmp"

    if [ -w "$_dir" ]; then
        mv "$_tmp" "$_dir/$BINARY_NAME"
    else
        printf "${YELLOW}Elevated permissions required to install to $_dir${NC}\n"
        sudo mv "$_tmp" "$_dir/$BINARY_NAME"
    fi

    if ! echo "$PATH" | tr ':' '\n' | grep -qx "$_dir"; then
        echo ""
        printf "${YELLOW}Note: Add $_dir to your PATH:${NC}\n"
        echo ""
        echo "  # For bash (~/.bashrc):"
        echo "  export PATH=\"\$PATH:$_dir\""
        echo ""
        echo "  # For zsh (~/.zshrc):"
        echo "  export PATH=\"\$PATH:$_dir\""
        echo ""
    fi

    echo ""
    printf "${GREEN}Autohand CLI installed successfully!${NC}\n"
    echo ""

    if command -v "$_dir/$BINARY_NAME" > /dev/null 2>&1; then
        echo "Version: $("$_dir/$BINARY_NAME" --version 2>/dev/null || echo 'unknown')"
        echo ""
        echo "Get started:"
        echo "  autohand              # Start interactive mode"
        echo "  autohand --help       # Show all options"
        echo "  autohand /login       # Sign in to your account"
    fi

    echo ""
}

get_architecture() {
    local _ostype _cputype

    _ostype="$(uname -s)"
    _cputype="$(uname -m)"

    case "$_ostype" in
        Linux)
            _ostype="linux"
            ;;
        Darwin)
            _ostype="macos"
            ;;
        MINGW* | MSYS* | CYGWIN* | Windows_NT)
            _ostype="windows"
            ;;
        FreeBSD)
            _ostype="linux"
            ;;
        *)
            err "Unsupported operating system: $_ostype"
            return 1
            ;;
    esac

    case "$_cputype" in
        x86_64 | amd64)
            _cputype="x64"
            ;;
        aarch64 | arm64)
            _cputype="arm64"
            ;;
        armv7l)
            err "32-bit ARM is not supported. Please use a 64-bit system."
            return 1
            ;;
        i686 | i386)
            err "32-bit x86 is not supported. Please use a 64-bit system."
            return 1
            ;;
        *)
            err "Unsupported CPU architecture: $_cputype"
            return 1
            ;;
    esac

    RETVAL="${_ostype}-${_cputype}"
}

say() {
    printf 'autohand: %s\n' "$1"
}

err() {
    printf "${RED}Error: %s${NC}\n" "$1" >&2
    exit 1
}

need_cmd() {
    if ! command -v "$1" > /dev/null 2>&1; then
        err "Required command not found: $1"
    fi
}

main "$@" || exit 1
