#!/bin/sh
set -e

REPO="autohandai/code-cli"
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

    # Determine channel from flags or environment
    local _channel="stable"
    for arg in "$@"; do
        case "$arg" in
            --alpha)
                _channel="alpha"
                ;;
        esac
    done

    # Environment variable override
    if [ -n "${AUTOHAND_CHANNEL:-}" ]; then
        _channel="$AUTOHAND_CHANNEL"
    fi

    get_architecture || return 1
    local _arch="$RETVAL"

    local _version="${AUTOHAND_VERSION:-latest}"
    local _url

    if [ "$_channel" = "alpha" ]; then
        # Alpha: fetch the latest prerelease tag from GitHub API
        printf "${YELLOW}Fetching latest alpha release...${NC}\n"
        local _alpha_tag
        _alpha_tag=$(get_latest_alpha_tag) || {
            printf "${RED}Error: Failed to find an alpha release${NC}\n"
            printf "${YELLOW}Hint: Check available releases at https://github.com/${REPO}/releases${NC}\n"
            exit 1
        }
        _version=$(echo "$_alpha_tag" | sed 's/^v//')
        _url="https://github.com/${REPO}/releases/download/${_alpha_tag}/autohand-${_arch}"
    elif [ "$_version" = "latest" ]; then
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
    echo "  Channel:  $_channel"
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
        # Use timeout to guard against binary hangs (e.g., circular dependency deadlock)
        _ver=""
        if command -v timeout > /dev/null 2>&1; then
            _ver=$(timeout 5 "$_dir/$BINARY_NAME" --version < /dev/null 2>/dev/null) || true
        else
            # macOS doesn't have timeout by default; use a background job
            "$_dir/$BINARY_NAME" --version < /dev/null > /tmp/.autohand_ver 2>/dev/null &
            _pid=$!
            sleep 3
            if kill -0 "$_pid" 2>/dev/null; then
                kill "$_pid" 2>/dev/null
                wait "$_pid" 2>/dev/null || true
            else
                wait "$_pid" 2>/dev/null || true
                _ver=$(cat /tmp/.autohand_ver 2>/dev/null) || true
            fi
            rm -f /tmp/.autohand_ver
        fi
        echo "Version: ${_ver:-unknown}"
        echo ""
        echo "Get started:"
        echo "  autohand              # Start interactive mode"
        echo "  autohand --help       # Show all options"
        echo "  autohand /login       # Sign in to your account"
    fi

    echo ""
}

get_latest_alpha_tag() {
    # Fetch recent releases and find the first prerelease
    local _releases_json
    _releases_json=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=10" 2>/dev/null) || return 1

    # Parse JSON to find first prerelease tag
    # Uses a simple approach compatible with sh (no jq dependency)
    echo "$_releases_json" | tr ',' '\n' | while IFS= read -r line; do
        case "$line" in
            *'"tag_name"'*)
                _current_tag=$(echo "$line" | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
                ;;
            *'"prerelease"'*true*)
                if [ -n "$_current_tag" ]; then
                    echo "$_current_tag"
                    return 0
                fi
                ;;
            *'"prerelease"'*false*)
                _current_tag=""
                ;;
        esac
    done

    return 1
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
