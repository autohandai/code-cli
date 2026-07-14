#!/usr/bin/env bash
# Install autohand CLI locally
# Usage: ./install-local.sh

set -e

SKIP_COMPILE=false
if [ "${1:-}" = "--skip-compile" ]; then
    SKIP_COMPILE=true
fi

echo "🚀 Installing Autohand CLI..."

# Detect platform
OS=$(uname -s)
ARCH=$(uname -m)

if [ "$OS" = "Darwin" ]; then
    if [ "$ARCH" = "arm64" ]; then
        BINARY="autohand-macos-arm64"
    else
        BINARY="autohand-macos-x64"
    fi
elif [ "$OS" = "Linux" ]; then
    if [ "$ARCH" = "x86_64" ]; then
        BINARY="autohand-linux-x64"
    elif [ "$ARCH" = "aarch64" ]; then
        BINARY="autohand-linux-arm64"
    else
        echo "❌ Unsupported architecture: $ARCH"
        exit 1
    fi
else
    echo "❌ Unsupported OS: $OS (use Windows installer for Windows)"
    exit 1
fi

# Remove existing installations from all common paths
echo "🧹 Removing existing autohand installations..."

POSSIBLE_PATHS=(
    "/usr/local/bin/autohand"
    "/usr/local/bin/autohand-code"
    "/usr/bin/autohand"
    "/usr/bin/autohand-code"
    "/opt/homebrew/bin/autohand"
    "/opt/homebrew/bin/autohand-code"
    "$HOME/.local/bin/autohand"
    "$HOME/.local/bin/autohand-code"
    "$HOME/bin/autohand"
    "$HOME/bin/autohand-code"
    "$HOME/.bun/bin/autohand"
    "$HOME/.bun/bin/autohand-code"
    "$HOME/.autohand/bin/autohand"
    "$HOME/.autohand/bin/autohand-code"
)

for path in "${POSSIBLE_PATHS[@]}"; do
    if [ -f "$path" ]; then
        echo "  Removing $path..."
        if [ -w "$(dirname "$path")" ]; then
            rm -f "$path"
        else
            sudo rm -f "$path"
        fi
    fi
done

# Also check if autohand is linked via npm/bun
if command -v autohand &> /dev/null; then
    EXISTING=$(which autohand 2>/dev/null || true)
    if [ -n "$EXISTING" ] && [ -f "$EXISTING" ]; then
        echo "  Removing $EXISTING..."
        if [ -w "$(dirname "$EXISTING")" ]; then
            rm -f "$EXISTING"
        else
            sudo rm -f "$EXISTING"
        fi
    fi
fi

echo "✅ Cleaned up existing installations"

if [ "$SKIP_COMPILE" = false ]; then
    # Always compile fresh to ensure latest code
    echo "📦 Compiling latest $BINARY..."
    case "$BINARY" in
        autohand-macos-arm64)
            env -i PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" bun build ./src/index.ts --compile --target=bun-darwin-arm64 --outfile ./binaries/autohand-macos-arm64
            ;;
        autohand-macos-x64)
            env -i PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" bun build ./src/index.ts --compile --target=bun-darwin-x64 --outfile ./binaries/autohand-macos-x64
            ;;
        autohand-linux-x64)
            env -i PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" bun build ./src/index.ts --compile --target=bun-linux-x64 --outfile ./binaries/autohand-linux-x64
            ;;
        autohand-linux-arm64)
            env -i PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" bun build ./src/index.ts --compile --target=bun-linux-arm64 --outfile ./binaries/autohand-linux-arm64
            ;;
        *)
            echo "❌ Unsupported binary target: $BINARY"
            exit 1
            ;;
    esac
elif [ ! -f "binaries/$BINARY" ]; then
    echo "❌ Missing precompiled binary: binaries/$BINARY"
    exit 1
fi

# Install to /usr/local/bin when writable, otherwise use the user-local bin.
if [ -w "/usr/local/bin" ]; then
    INSTALL_PATH="/usr/local/bin/autohand"
else
    mkdir -p "$HOME/.local/bin"
    INSTALL_PATH="$HOME/.local/bin/autohand"
fi
ALIAS_PATH="$(dirname "$INSTALL_PATH")/autohand-code"

echo "📥 Installing to $INSTALL_PATH..."
if [ -w "$(dirname "$INSTALL_PATH")" ]; then
    cp "binaries/$BINARY" "$INSTALL_PATH"
    chmod +x "$INSTALL_PATH"
    ln -sfn "$(basename "$INSTALL_PATH")" "$ALIAS_PATH"
else
    sudo cp "binaries/$BINARY" "$INSTALL_PATH"
    sudo chmod +x "$INSTALL_PATH"
    sudo ln -sfn "$(basename "$INSTALL_PATH")" "$ALIAS_PATH"
fi

# Verify installation
echo ""
echo "✅ Autohand installed successfully!"
INSTALLED_VERSION=$("$INSTALL_PATH" --version 2>/dev/null || echo "unknown")
echo "   Version: $INSTALLED_VERSION"
echo "   Path: $INSTALL_PATH"
echo ""
echo "Try it out:"
echo "  autohand --help"
echo "  autohand"
