#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
binary=$1
version=$2
traces=${3:-}
host_archive=${4:-}
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
mkdir -p "$test_root/payload" "$test_root/bin" "$test_root/shims" "$test_root/user/.autohand"
cp "$binary" "$test_root/payload/autohand"
chmod +x "$test_root/payload/autohand"
if [ -n "$traces" ]; then
    cp "$traces" "$test_root/payload/ahtraces"
    chmod +x "$test_root/payload/ahtraces"
fi
if [ -n "$host_archive" ]; then
    tar -xzf "$host_archive" -C "$test_root/payload"
fi
tar -czf "$test_root/bundle.tar.gz" -C "$test_root/payload" .
if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$test_root/bundle.tar.gz" > "$test_root/bundle.sha256"
else
    shasum -a 256 "$test_root/bundle.tar.gz" > "$test_root/bundle.sha256"
fi
cat > "$test_root/shims/curl" <<'CURL'
#!/bin/sh
set -eu
url= output=
while [ "$#" -gt 0 ]; do
    case "$1" in
        -o) output=$2; shift 2 ;;
        http*) url=$1; shift ;;
        *) shift ;;
    esac
done
case "$url" in
    "https://github.com/autohandai/code-cli/releases/download/v$AUTOHAND_VERSION/"*.tar.gz.sha256)
        cp "$INSTALL_SMOKE_ROOT/bundle.sha256" "$output" ;;
    "https://github.com/autohandai/code-cli/releases/download/v$AUTOHAND_VERSION/"*.tar.gz)
        cp "$INSTALL_SMOKE_ROOT/bundle.tar.gz" "$output" ;;
    *) echo "Unexpected installer request: $url" >&2; exit 1 ;;
esac
CURL
chmod +x "$test_root/shims/curl"
printf '%s\n' '{"manualTestSentinel":true}' > "$test_root/user/.autohand/config.json"
printf '%s\n' '#!/bin/sh' 'echo stale-version' > "$test_root/bin/autohand"
chmod +x "$test_root/bin/autohand"
unset AUTOHAND_HOME AUTOHAND_CONFIG AUTOHAND_CUA_DRIVER_PATH AUTOHAND_COMPUTER_USE_APP_PATH AUTOHAND_COMPUTER_USE_APP_SOURCE
export AUTOHAND_VERSION="$version" AUTOHAND_CHANNEL=alpha AUTOHAND_INSTALL_FIRST_RUN=no
export AUTOHAND_SKIP_COMPUTER_USE_PERMISSIONS=1 INSTALL_SMOKE_ROOT="$test_root"
export AUTOHAND_INSTALL_DIR="$test_root/bin"
test_path="$test_root/shims:$test_root/bin:/usr/bin:/bin:/usr/sbin:/sbin"
install_alpha() {
    env HOME="$test_root/user" PATH="$test_path" /bin/sh "$repo_root/install.sh" --alpha --fresh
}
install_alpha
first_profile=$(cat "$test_root/bin/autohand-alpha.profile")
[ -d "$first_profile" ]
[ -z "$(ls -A "$first_profile")" ]
printf '%s\n' 'retain earlier test run' > "$first_profile/previous-run"
install_alpha
second_profile=$(cat "$test_root/bin/autohand-alpha.profile")
[ "$first_profile" != "$second_profile" ]
[ -z "$(ls -A "$second_profile")" ]
[ "$(cat "$first_profile/previous-run")" = 'retain earlier test run' ]
[ ! -e "$test_root/user/.autohand/config.json" ]
[ -d "$test_root/user/.autohand" ]
backup_count=0
sentinel_found=0
for backup in "$test_root/user"/.autohand.backup.*/profile; do
    [ -d "$backup" ]
    backup_count=$((backup_count + 1))
    if [ -f "$backup/config.json" ] && [ "$(cat "$backup/config.json")" = '{"manualTestSentinel":true}' ]; then
        sentinel_found=1
    fi
done
[ "$backup_count" -eq 2 ]
[ "$sentinel_found" -eq 1 ]
installed_version=$(env HOME="$test_root/user" PATH="$test_path" "$test_root/bin/autohand-alpha" --version)
[ "$installed_version" != 'stale-version' ]
expected_version=$("$binary" --version)
[ "$installed_version" = "$expected_version" ]
env HOME="$test_root/user" PATH="$test_path" "$test_root/bin/autohand-alpha" --help >/dev/null
if [ "${AUTOHAND_SKIP_COMPUTER_CONTROL_INSTALL:-0}" != '1' ]; then
    env HOME="$test_root/user" PATH="$test_path" "$test_root/bin/autohand-alpha" computer status --json
fi
printf 'Fresh alpha install and reinstall passed: %s\n' "$installed_version"
