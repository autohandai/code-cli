#!/usr/bin/env python3
"""Exercise today's installer against an independently published release."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--channel', choices=['stable', 'alpha'], default='stable')
parser.add_argument('--version', default='latest')
parser.add_argument('--installer', type=Path)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[3]
with tempfile.TemporaryDirectory(prefix='autohand-release-install-') as folder:
    root = Path(folder)
    user = root / 'home'
    binary_dir = root / 'bin'
    user.mkdir()
    binary_dir.mkdir()
    # Do not inherit a developer's config, opt-outs, executable paths or aliases.
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith('AUTOHAND_') and key not in ['HOME', 'PATH']}
    environment.update(HOME=str(user), PATH=f'{binary_dir}:/usr/bin:/bin:/usr/sbin:/sbin',
                       AUTOHAND_INSTALL_DIR=str(binary_dir), AUTOHAND_CHANNEL=args.channel,
                       AUTOHAND_VERSION=args.version, AUTOHAND_INSTALL_FIRST_RUN='no',
                       AUTOHAND_SKIP_COMPUTER_USE_PERMISSIONS='1')
    result = subprocess.run(['/bin/sh', str((args.installer or repo / 'install.sh').resolve())], env=environment,
                            capture_output=True, text=True, timeout=360)
    print(result.stdout, end='')
    print(result.stderr, end='')
    assert result.returncode == 0, f'installer exit {result.returncode}'
    assert 'Autohand CLI installed successfully' in result.stdout
    assert 'Installation is incomplete' not in result.stdout
    binary = binary_dir / 'autohand'
    def probe(executable, *arguments):
        return subprocess.check_output([str(executable), *arguments], env=environment,
                                       text=True, timeout=30)
    help_text = probe(binary, '--help')
    supported = any(line.strip().startswith('computer ') for line in help_text.splitlines())
    if not supported:
        assert 'Computer control arrives in the next release' in result.stdout
        assert 'Retry with:' not in result.stdout
        assert 'autohand computer doctor' not in result.stdout
    if args.channel == 'alpha':
        assert supported, 'alpha is expected to expose Computer control'
    for alias in ['agent', 'ah', 'autohand-code']:
        assert (binary_dir / alias).resolve() == binary.resolve()
    assert (binary_dir / 'ahtraces').is_file(), 'trace companion installed'
    version = probe(binary, '--version').strip()
    traces_version = probe(binary_dir / 'ahtraces', '--version').strip()
    if args.version != 'latest':
        assert args.version.lstrip('v') in version, version
    print(f'PASS clean HOME {args.channel}/{args.version}: CLI={version}; ahtraces={traces_version}; computer={supported}')
