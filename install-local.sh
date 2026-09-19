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
TRACES_BINARY="${BINARY/autohand-/ahtraces-}"

# Compile first: a failed build must never leave the machine without autohand.
if [ "$SKIP_COMPILE" = false ]; then
    # Always compile fresh to ensure latest code
    echo "📦 Compiling latest $BINARY..."
    case "$BINARY" in
        autohand-macos-arm64)
            env -i PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" bun build ./src/index.ts --compile --target=bun-darwin-arm64 --outfile ./binaries/autohand-macos-arm64
            env -i PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" bun build ./src/ahtraces.ts --compile --target=bun-darwin-arm64 --outfile ./binaries/ahtraces-macos-arm64
            ;;
        autohand-macos-x64)
            env -i PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" bun build ./src/index.ts --compile --target=bun-darwin-x64 --outfile ./binaries/autohand-macos-x64
            env -i PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" bun build ./src/ahtraces.ts --compile --target=bun-darwin-x64 --outfile ./binaries/ahtraces-macos-x64
            ;;
        autohand-linux-x64)
            env -i PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" bun build ./src/index.ts --compile --target=bun-linux-x64 --outfile ./binaries/autohand-linux-x64
            env -i PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" bun build ./src/ahtraces.ts --compile --target=bun-linux-x64 --outfile ./binaries/ahtraces-linux-x64
            ;;
        autohand-linux-arm64)
            env -i PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" bun build ./src/index.ts --compile --target=bun-linux-arm64 --outfile ./binaries/autohand-linux-arm64
            env -i PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" bun build ./src/ahtraces.ts --compile --target=bun-linux-arm64 --outfile ./binaries/ahtraces-linux-arm64
            ;;
        *)
            echo "❌ Unsupported binary target: $BINARY"
            exit 1
            ;;
    esac
elif [ ! -f "binaries/$BINARY" ] || [ ! -f "binaries/$TRACES_BINARY" ]; then
    echo "❌ Missing precompiled binaries: binaries/$BINARY and binaries/$TRACES_BINARY"
    exit 1
fi

# Install to /usr/local/bin when writable, otherwise use the user-local bin.
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
    "/usr/local/bin/ahtraces"
    "/usr/bin/ahtraces"
    "/opt/homebrew/bin/ahtraces"
    "$HOME/.local/bin/ahtraces"
    "$HOME/bin/ahtraces"
    "$HOME/.bun/bin/ahtraces"
    "$HOME/.autohand/bin/ahtraces"
)

if command -v ahtraces >/dev/null 2>&1; then
    ahtraces stop >/dev/null 2>&1 || true
fi

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

if [ -w "/usr/local/bin" ]; then
    INSTALL_PATH="/usr/local/bin/autohand"
else
    mkdir -p "$HOME/.local/bin"
    INSTALL_PATH="$HOME/.local/bin/autohand"
fi
ALIAS_PATH="$(dirname "$INSTALL_PATH")/autohand-code"
AGENT_ALIAS_PATH="$(dirname "$INSTALL_PATH")/agent"
SHORT_ALIAS_PATH="$(dirname "$INSTALL_PATH")/ah"
TRACES_INSTALL_PATH="$(dirname "$INSTALL_PATH")/ahtraces"

echo "📥 Installing to $INSTALL_PATH..."
if [ -w "$(dirname "$INSTALL_PATH")" ]; then
    cp "binaries/$BINARY" "$INSTALL_PATH"
    cp "binaries/$TRACES_BINARY" "$TRACES_INSTALL_PATH"
    chmod +x "$INSTALL_PATH"
    chmod +x "$TRACES_INSTALL_PATH"
    ln -sfn "$(basename "$INSTALL_PATH")" "$ALIAS_PATH"
    ln -sfn "$(basename "$INSTALL_PATH")" "$AGENT_ALIAS_PATH"
    ln -sfn "$(basename "$INSTALL_PATH")" "$SHORT_ALIAS_PATH"
else
    sudo cp "binaries/$BINARY" "$INSTALL_PATH"
    sudo cp "binaries/$TRACES_BINARY" "$TRACES_INSTALL_PATH"
    sudo chmod +x "$INSTALL_PATH"
    sudo chmod +x "$TRACES_INSTALL_PATH"
    sudo ln -sfn "$(basename "$INSTALL_PATH")" "$ALIAS_PATH"
    sudo ln -sfn "$(basename "$INSTALL_PATH")" "$AGENT_ALIAS_PATH"
    sudo ln -sfn "$(basename "$INSTALL_PATH")" "$SHORT_ALIAS_PATH"
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

if [ "$OS" = "Darwin" ] && [ "$ARCH" = "arm64" ]; then
    if [ "${AUTOHAND_INSTALL_LOCAL_AI:-0}" = "1" ]; then
        echo ""
        echo "Installing Autohand AI Local runtime..."
        # Keep this pin in sync with MLX_LM_PINNED_VERSION in
        # src/providers/autohandAILocalSetup.ts so the installer and the in-app
        # setup wizard provision the same MLX runtime.
        MLX_LM_SPEC="mlx-lm==0.31.3"
        if ! command -v mlx_lm.server >/dev/null 2>&1; then
            if command -v uv >/dev/null 2>&1; then
                uv tool install "$MLX_LM_SPEC"
            elif command -v pipx >/dev/null 2>&1; then
                pipx install "$MLX_LM_SPEC"
            else
                python3 -m pip install --user "$MLX_LM_SPEC"
            fi
        fi
        if ! command -v llmfit >/dev/null 2>&1; then
            # --local installs to ~/.local/bin without sudo (no password prompt).
            curl -fsSL https://llmfit.axjns.dev/install.sh | sh -s -- --local
        fi
        echo "✅ Autohand AI Local runtime installed"
    else
        echo ""
        echo "Autohand AI Local:"
        echo "  Run /model, choose Autohand AI, then Local."
        echo "  To preinstall MLX and llmfit during install, set AUTOHAND_INSTALL_LOCAL_AI=1."
    fi
fi
