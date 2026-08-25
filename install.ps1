#Requires -Version 5.1
<#
.SYNOPSIS
    Autohand CLI Installer for Windows
.DESCRIPTION
    Downloads and installs the Autohand CLI for Windows.
.PARAMETER Alpha
    Install the latest alpha (pre-release) build
.PARAMETER Clean
    Remove existing installation before installing
.PARAMETER NoCache
    Bypass CDN cache and fetch fresh release from GitHub
.PARAMETER Version
    Install specific version (e.g., 0.7.3)
.PARAMETER InstallDir
    Custom installation directory
.EXAMPLE
    iwr -useb https://autohand.ai/install.ps1 | iex
.EXAMPLE
    iwr -useb https://autohand.ai/install.ps1 -OutFile install.ps1; .\install.ps1 -Alpha
.EXAMPLE
    iwr -useb https://autohand.ai/install.ps1 -OutFile install.ps1; .\install.ps1 -Clean
.EXAMPLE
    $env:AUTOHAND_VERSION = "0.7.3"; iwr -useb https://autohand.ai/install.ps1 | iex
#>

param(
    [switch]$Alpha,
    [switch]$Clean,
    [switch]$NoCache,
    [string]$Version,
    [string]$InstallDir,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

$REPO = "autohandai/code-cli"
$BINARY_NAME = "autohand.exe"
$COMPAT_BINARY_NAME = "autohand-code.cmd"
$AGENT_ALIAS_NAME = "agent.cmd"

function Write-Logo {
    $logo = @"
    ___         __        __                    __
   /   | __  __/ /_____  / /_  ____ _____  ____/ /
  / /| |/ / / / __/ __ \/ __ \/ __ `/ __ \/ __  /
 / ___ / /_/ / /_/ /_/ / / / / /_/ / / / / /_/ /
/_/  |_\__,_/\__/\____/_/ /_/\__,_/_/ /_/\__,_/

"@
    Write-Host $logo -ForegroundColor Blue
}

function Write-Step {
    param([string]$Message)
    Write-Host "==> " -ForegroundColor Blue -NoNewline
    Write-Host $Message
}

function Write-Success {
    param([string]$Message)
    Write-Host "OK " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "Error: " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

function Show-Help {
    @"
Autohand CLI Installer for Windows

Usage: iwr -useb https://autohand.ai/install.ps1 | iex

Or download and run with options:
  iwr -useb https://autohand.ai/install.ps1 -OutFile install.ps1
  .\install.ps1 [OPTIONS]

Options:
  -Alpha        Install the latest alpha (pre-release) build
  -Clean        Remove existing installation before installing
  -NoCache      Bypass CDN cache and fetch fresh release from GitHub
  -Version      Install specific version (e.g., 0.7.3)
  -InstallDir   Custom installation directory
  -Help         Show this help message

Environment variables:
  AUTOHAND_VERSION      Install specific version (e.g., 0.7.3)
  AUTOHAND_INSTALL_DIR  Custom installation directory
  AUTOHAND_CHANNEL      Set to "alpha" for pre-release builds

Examples:
  iwr -useb https://autohand.ai/install.ps1 | iex
  .\install.ps1 -Alpha
  .\install.ps1 -Clean
  .\install.ps1 -Version 0.7.3
  `$env:AUTOHAND_CHANNEL = "alpha"; iwr -useb https://autohand.ai/install.ps1 | iex
"@
}

function Get-Architecture {
    param(
        [AllowNull()][object]$RuntimeArchitecture,
        [AllowNull()][string]$ProcessorArchitectureW6432,
        [AllowNull()][string]$ProcessorArchitecture
    )

    if (-not $PSBoundParameters.ContainsKey("RuntimeArchitecture")) {
        try {
            $RuntimeArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
        }
        catch {
            $RuntimeArchitecture = $null
        }
    }
    if (-not $PSBoundParameters.ContainsKey("ProcessorArchitectureW6432")) {
        $ProcessorArchitectureW6432 = $env:PROCESSOR_ARCHITEW6432
    }
    if (-not $PSBoundParameters.ContainsKey("ProcessorArchitecture")) {
        $ProcessorArchitecture = $env:PROCESSOR_ARCHITECTURE
    }

    $architectureCandidates = @(
        $RuntimeArchitecture,
        $ProcessorArchitectureW6432,
        $ProcessorArchitecture
    )

    foreach ($candidate in $architectureCandidates) {
        if ([string]::IsNullOrWhiteSpace([string]$candidate)) {
            continue
        }

        switch (([string]$candidate).Trim().ToUpperInvariant()) {
            "X64" { return "windows-x64" }
            "AMD64" { return "windows-x64" }
        }
    }

    $runtimeDisplay = if ([string]::IsNullOrWhiteSpace([string]$RuntimeArchitecture)) { "<empty>" } else { [string]$RuntimeArchitecture }
    $wow64Display = if ([string]::IsNullOrWhiteSpace($ProcessorArchitectureW6432)) { "<empty>" } else { $ProcessorArchitectureW6432 }
    $processDisplay = if ([string]::IsNullOrWhiteSpace($ProcessorArchitecture)) { "<empty>" } else { $ProcessorArchitecture }

    throw "Unsupported CPU architecture. RuntimeInformation.OSArchitecture=$runtimeDisplay; PROCESSOR_ARCHITEW6432=$wow64Display; PROCESSOR_ARCHITECTURE=$processDisplay. Autohand currently supports 64-bit Intel/AMD Windows (x64). Please include this message when contacting support at https://autohand.ai/support."
}

function Get-LatestVersion {
    $apiUrl = "https://api.github.com/repos/$REPO/releases/latest"

    try {
        $headers = @{
            "Accept" = "application/vnd.github.v3+json"
            "Cache-Control" = "no-cache"
        }

        $response = Invoke-RestMethod -Uri $apiUrl -Headers $headers -UseBasicParsing
        $tagName = $response.tag_name

        # Remove 'v' prefix if present
        if ($tagName.StartsWith("v")) {
            $tagName = $tagName.Substring(1)
        }

        return $tagName
    }
    catch {
        throw "Failed to fetch latest version from GitHub API: $_"
    }
}

function Get-LatestAlphaVersion {
    $apiUrl = "https://api.github.com/repos/$REPO/releases?per_page=100"

    try {
        $headers = @{
            "Accept" = "application/vnd.github.v3+json"
            "Cache-Control" = "no-cache"
        }

        $releases = Invoke-RestMethod -Uri $apiUrl -Headers $headers -UseBasicParsing

        $alphaReleases = $releases | Where-Object { $_.prerelease -eq $true -and $_.tag_name }
        if (-not $alphaReleases) {
            throw "No alpha (pre-release) builds found"
        }

        # GitHub releases API order is not guaranteed chronological for prereleases.
        # Choose newest by published_at (fallback to created_at).
        $latestAlpha = $alphaReleases |
            Sort-Object -Property @{
                Expression = {
                    if ($_.published_at) {
                        [DateTime]$_.published_at
                    } elseif ($_.created_at) {
                        [DateTime]$_.created_at
                    } else {
                        [DateTime]::MinValue
                    }
                }
                Descending = $true
            } |
            Select-Object -First 1

        $tagName = $latestAlpha.tag_name
        if ($tagName.StartsWith("v")) {
            $tagName = $tagName.Substring(1)
        }
        return $tagName
    }
    catch {
        throw "Failed to fetch latest alpha version from GitHub API: $_"
    }
}

function Get-ArchiveAssetName {
    param([string]$Architecture)

    switch ($Architecture) {
        "windows-x64" { return "autohand-windows-x64.zip" }
        default { throw "Unsupported installer architecture: $Architecture" }
    }
}

function Remove-ExistingInstallation {
    Write-Step "Cleaning up existing installation..."

    # Common installation locations
    $locations = @(
        "$env:LOCALAPPDATA\autohand\autohand.exe",
        "$env:LOCALAPPDATA\autohand\autohand-code.cmd",
        "$env:LOCALAPPDATA\autohand\agent.cmd",
        "$env:LOCALAPPDATA\Programs\autohand\autohand.exe",
        "$env:LOCALAPPDATA\Programs\autohand\autohand-code.cmd",
        "$env:LOCALAPPDATA\Programs\autohand\agent.cmd",
        "$env:ProgramFiles\autohand\autohand.exe",
        "$env:ProgramFiles\autohand\autohand-code.cmd",
        "$env:ProgramFiles\autohand\agent.cmd",
        "$env:USERPROFILE\.local\bin\autohand.exe",
        "$env:USERPROFILE\.local\bin\autohand-code.cmd",
        "$env:USERPROFILE\.local\bin\agent.cmd"
    )

    foreach ($loc in $locations) {
        if (Test-Path $loc) {
            Write-Host "  Removing: $loc"
            Remove-Item -Path $loc -Force -ErrorAction SilentlyContinue
        }
    }

    # Remove autohand cache
    $cacheDir = "$env:LOCALAPPDATA\autohand"
    if (Test-Path "$cacheDir\version-check-stable.json") {
        Write-Host "  Removing: $cacheDir\version-check-stable.json"
        Remove-Item -Path "$cacheDir\version-check-stable.json" -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path "$cacheDir\version-check-alpha.json") {
        Write-Host "  Removing: $cacheDir\version-check-alpha.json"
        Remove-Item -Path "$cacheDir\version-check-alpha.json" -Force -ErrorAction SilentlyContinue
    }
    # Clean up legacy cache file
    if (Test-Path "$cacheDir\version-check.json") {
        Write-Host "  Removing: $cacheDir\version-check.json"
        Remove-Item -Path "$cacheDir\version-check.json" -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path "$cacheDir\cache") {
        Write-Host "  Removing: $cacheDir\cache\"
        Remove-Item -Path "$cacheDir\cache" -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Success "Cleanup complete."
    Write-Host ""
}

$USER_ENVIRONMENT_SUBKEY = "Environment"

function Get-UpdatedUserPath {
    # Pure decision helper: given the raw user PATH and the directory to add, return the
    # value that should be written, or $null when the directory is already listed.
    # Append-only by construction - it can never drop, reorder, or rewrite an existing
    # entry, which is what makes a PATH wipe unrepresentable rather than merely unlikely.
    param(
        [AllowNull()][AllowEmptyString()][string]$CurrentPath,
        [Parameter(Mandatory = $true)][string]$InstallPath
    )

    $target = $InstallPath.Trim().TrimEnd('\', '/')
    if ([string]::IsNullOrWhiteSpace($target)) {
        throw "Refusing to add an empty directory to PATH"
    }

    if (-not [string]::IsNullOrWhiteSpace($CurrentPath)) {
        foreach ($entry in $CurrentPath.Split(';')) {
            # Compared literally, never with -like: install directories may legitimately
            # contain wildcard characters such as [ and ].
            $normalized = $entry.Trim().Trim('"').Trim().TrimEnd('\', '/')
            if ([string]::IsNullOrWhiteSpace($normalized)) {
                continue
            }
            if ($normalized -ieq $target) {
                return $null
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($CurrentPath)) {
        return $target
    }

    if ($CurrentPath.EndsWith(';')) {
        return "$CurrentPath$target"
    }

    return "$CurrentPath;$target"
}

function Get-RawUserPath {
    # Reads HKCU\Environment\PATH verbatim. [Environment]::GetEnvironmentVariable('PATH',
    # 'User') expands REG_EXPAND_SZ values, so reading through it and writing the result
    # back would bake %LOCALAPPDATA%\Microsoft\WindowsApps into a literal path and demote
    # the value to REG_SZ, breaking winget/wt and every other execution alias.
    param([string]$SubKeyName = $USER_ENVIRONMENT_SUBKEY)

    $missing = [pscustomobject]@{
        Exists = $false
        Value  = ""
        Kind   = [Microsoft.Win32.RegistryValueKind]::ExpandString
    }

    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($SubKeyName, $false)
    if ($null -eq $key) {
        return $missing
    }

    try {
        $value = $key.GetValue(
            "PATH",
            $null,
            [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
        )
        if ($null -eq $value) {
            return $missing
        }

        $kind = $key.GetValueKind("PATH")
        if ($kind -ne [Microsoft.Win32.RegistryValueKind]::String) {
            $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
        }

        return [pscustomobject]@{
            Exists = $true
            Value  = [string]$value
            Kind   = $kind
        }
    }
    finally {
        $key.Dispose()
    }
}

function Set-RawUserPath {
    # Writes the value back with its original kind. setx is deliberately not used: it
    # truncates PATH at 1024 characters.
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [AllowNull()][object]$Kind,
        [string]$SubKeyName = $USER_ENVIRONMENT_SUBKEY
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "Refusing to write an empty user PATH"
    }

    $valueKind = if ($null -eq $Kind) {
        [Microsoft.Win32.RegistryValueKind]::ExpandString
    } else {
        [Microsoft.Win32.RegistryValueKind]$Kind
    }

    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($SubKeyName)
    if ($null -eq $key) {
        throw "Unable to open HKCU\$SubKeyName for writing"
    }

    try {
        $key.SetValue("PATH", $Value, $valueKind)
    }
    finally {
        $key.Dispose()
    }
}

function Save-UserPathBackup {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value,
        [Parameter(Mandatory = $true)][string]$BackupDirectory
    )

    if (-not (Test-Path -LiteralPath $BackupDirectory)) {
        New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
    }

    $backupPath = Join-Path $BackupDirectory ("user-path-backup-" + (Get-Date).ToString("yyyyMMdd-HHmmss") + ".txt")
    [System.IO.File]::WriteAllText($backupPath, $Value, [System.Text.Encoding]::UTF8)
    return $backupPath
}

function Send-EnvironmentChangeNotification {
    # Best effort: lets Explorer and already-open shells re-read the environment block.
    try {
        if (-not ("Autohand.NativeMethods" -as [type])) {
            Add-Type -Namespace Autohand -Name NativeMethods -MemberDefinition @"
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
"@
        }

        $result = [UIntPtr]::Zero
        [void][Autohand.NativeMethods]::SendMessageTimeout(
            [IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, "Environment", 0x0002, 5000, [ref]$result
        )
    }
    catch {
        # Non-fatal: the value is already stored, new terminals will pick it up.
    }
}

function Show-ManualPathInstructions {
    param([Parameter(Mandatory = $true)][string]$InstallPath)

    # Single self-contained statement, guarded on the existing value. The previous
    # installer printed a two-line recipe whose second line wiped HKCU\Environment\PATH
    # when it ran without the first, so nothing here may depend on earlier input.
    $manualCommand = '$existing = [Environment]::GetEnvironmentVariable(''PATH'',''User''); if ($existing) { [Environment]::SetEnvironmentVariable(''PATH'', "$existing;<INSTALL_DIR>", ''User'') }'

    Write-Host ""
    Write-Host "Add Autohand to your PATH manually" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Run this as a single line - it appends, and does nothing if the existing" -ForegroundColor Gray
    Write-Host "  value cannot be read:" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   $($manualCommand.Replace('<INSTALL_DIR>', $InstallPath))"
    Write-Host ""
    Write-Host "  Or for the current session only:" -ForegroundColor Gray
    Write-Host "   `$env:PATH += `";$InstallPath`""
    Write-Host ""
}

function Add-AutohandToUserPath {
    param(
        [Parameter(Mandatory = $true)][string]$InstallPath,
        [string]$BackupDirectory,
        [string]$SubKeyName = $USER_ENVIRONMENT_SUBKEY
    )

    if ([string]::IsNullOrWhiteSpace($BackupDirectory)) {
        # Someone repairing a damaged environment may not have LOCALAPPDATA either, and
        # losing the backup is the one failure this function cannot afford.
        $BackupDirectory = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
            $InstallPath
        } else {
            Join-Path $env:LOCALAPPDATA "autohand"
        }
    }

    try {
        $current = Get-RawUserPath -SubKeyName $SubKeyName
    }
    catch {
        Write-Error-Custom "Could not read your user PATH: $($_.Exception.Message)"
        Show-ManualPathInstructions -InstallPath $InstallPath
        return
    }

    $updated = Get-UpdatedUserPath -CurrentPath $current.Value -InstallPath $InstallPath
    if ($null -eq $updated) {
        Write-Success "$InstallPath is already on your user PATH"
        return
    }

    # Defense in depth. This installer only ever appends, so a shorter result means the
    # logic above is broken - and a bug here costs people their environment.
    if ($updated.Length -lt $current.Value.Length) {
        Write-Error-Custom "Refusing to update PATH: the computed value would shorten your user PATH."
        Show-ManualPathInstructions -InstallPath $InstallPath
        return
    }

    try {
        $backupPath = Save-UserPathBackup -Value $current.Value -BackupDirectory $BackupDirectory
        Set-RawUserPath -Value $updated -Kind $current.Kind -SubKeyName $SubKeyName
    }
    catch {
        Write-Error-Custom "Could not update your user PATH: $($_.Exception.Message)"
        Show-ManualPathInstructions -InstallPath $InstallPath
        return
    }

    $env:PATH = "$env:PATH;$InstallPath"
    Send-EnvironmentChangeNotification

    Write-Success "Added $InstallPath to your user PATH"
    Write-Host "  Previous PATH saved to: $backupPath" -ForegroundColor Gray
    Write-Host "  Open a new terminal for the change to take effect." -ForegroundColor Gray
}

function Claim-PathWideAgentAlias {
    # agent is a generic name other AI CLIs also claim. Reclaim it in every
    # writable PATH directory other than our own install path, so "agent"
    # resolves to Autohand instead of whichever competing tool won the PATH
    # race. User-writable directories only: no elevation into directories the
    # current user can't already write to.
    param(
        [string]$OwnInstallPath,
        [string]$CanonicalBinaryPath,
        [string[]]$AgentCollisionNames
    )

    $foreignShim = @(
        '@echo off',
        "`"$CanonicalBinaryPath`" %*",
        'exit /b %ERRORLEVEL%'
    )

    $pathDirs = ($env:PATH -split [IO.Path]::PathSeparator) |
        Where-Object { $_ } | Select-Object -Unique

    foreach ($dir in $pathDirs) {
        if ($dir -ieq $OwnInstallPath) { continue }
        try {
            if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }

            $foundExisting = $false
            foreach ($name in $AgentCollisionNames) {
                $candidate = Join-Path $dir $name
                if (Test-Path -LiteralPath $candidate) {
                    $foundExisting = $true
                    Remove-Item -Path $candidate -Force -Recurse -ErrorAction Stop
                }
            }

            if ($foundExisting) {
                $shimPath = Join-Path $dir "agent.cmd"
                [System.IO.File]::WriteAllLines($shimPath, $foreignShim, [System.Text.Encoding]::ASCII)
                Write-Success "Claimed existing 'agent' command in $dir"
            }
        }
        catch {
            # Permission denied / locked / read-only volume: skip silently, no elevation.
            continue
        }
    }
}

function Install-Autohand {
    Write-Logo

    if ($Help) {
        Show-Help
        return
    }

    # Clean existing installation if requested
    if ($Clean) {
        Remove-ExistingInstallation
    }

    # Determine channel
    $channel = "stable"
    if ($Alpha) {
        $channel = "alpha"
    }
    if ($env:AUTOHAND_CHANNEL) {
        $channel = $env:AUTOHAND_CHANNEL
    }

    # Detect architecture
    Write-Step "Detecting system architecture..."
    $arch = Get-Architecture
    Write-Success "Detected $arch"
    Write-Host ""

    # Determine version
    $targetVersion = $Version
    if ([string]::IsNullOrEmpty($targetVersion)) {
        $targetVersion = $env:AUTOHAND_VERSION
    }
    if ([string]::IsNullOrEmpty($targetVersion)) {
        if ($channel -eq "alpha") {
            Write-Step "Fetching latest alpha version..."
            $targetVersion = Get-LatestAlphaVersion
            Write-Success "Latest alpha version: v$targetVersion"
        } else {
            Write-Step "Fetching latest version..."
            $targetVersion = Get-LatestVersion
            Write-Success "Latest version: v$targetVersion"
        }
        Write-Host ""
    }

    # Construct bundle download URL
    $archiveName = Get-ArchiveAssetName -Architecture $arch
    $downloadUrl = "https://github.com/$REPO/releases/download/v$targetVersion/$archiveName"
    $checksumUrl = "$downloadUrl.sha256"

    # Determine installation directory
    $installPath = $InstallDir
    if ([string]::IsNullOrEmpty($installPath)) {
        $installPath = $env:AUTOHAND_INSTALL_DIR
    }
    if ([string]::IsNullOrEmpty($installPath)) {
        $installPath = "$env:LOCALAPPDATA\autohand"
    }

    # Create installation directory
    if (-not (Test-Path $installPath)) {
        New-Item -ItemType Directory -Path $installPath -Force | Out-Null
    }
    # Resolve before anything records it so a relative -InstallDir never reaches PATH.
    $installPath = (Resolve-Path -LiteralPath $installPath).Path
    $binaryPath = Join-Path $installPath $BINARY_NAME
    $compatBinaryPath = Join-Path $installPath $COMPAT_BINARY_NAME
    $agentAliasPath = Join-Path $installPath $AGENT_ALIAS_NAME
    $agentCollisionNames = @("agent.com", "agent.exe", "agent.bat", "agent.cmd")
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("autohand-install-" + [System.Guid]::NewGuid().ToString("N"))
    $archivePath = Join-Path $tempRoot $archiveName
    $checksumPath = "$archivePath.sha256"
    $extractPath = Join-Path $tempRoot "extract"

    Write-Step "Downloading Autohand CLI..."
    Write-Host "  Channel:  $channel"
    Write-Host "  Platform: $arch"
    Write-Host "  Version:  $targetVersion"
    Write-Host "  Target:   $binaryPath"
    Write-Host ""

    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $extractPath -Force | Out-Null

    try {
        # Download archive + checksum
        try {
            $headers = @{}
            if ($NoCache) {
                $headers["Cache-Control"] = "no-cache, no-store"
                $headers["Pragma"] = "no-cache"
            }

            Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -Headers $headers -UseBasicParsing
            Invoke-WebRequest -Uri $checksumUrl -OutFile $checksumPath -Headers $headers -UseBasicParsing
        }
        catch {
            Write-Error-Custom "Failed to download from $downloadUrl"
            Write-Host "Hint: Check if the version exists at https://github.com/$REPO/releases" -ForegroundColor Yellow
            throw $_
        }

        if (-not (Test-Path $archivePath) -or (Get-Item $archivePath).Length -eq 0) {
            throw "Downloaded archive is empty or missing"
        }

        $expectedHash = (Get-Content $checksumPath -TotalCount 1).Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries)[0]
        if (-not $expectedHash) {
            throw "Checksum file is empty"
        }

        $actualHash = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($expectedHash.ToLowerInvariant() -ne $actualHash) {
            throw "Checksum verification failed"
        }

        Write-Success "Checksum verification passed"

        Expand-Archive -Path $archivePath -DestinationPath $extractPath -Force

        $extractedAutohand = Get-ChildItem -Path $extractPath -Filter "autohand.exe" -Recurse | Select-Object -First 1 -ExpandProperty FullName
        if (-not $extractedAutohand) {
            throw "Bundle does not contain autohand.exe"
        }

        Copy-Item -Path $extractedAutohand -Destination $binaryPath -Force
        foreach ($agentCollisionName in $agentCollisionNames) {
            $agentCollisionPath = Join-Path $installPath $agentCollisionName
            if (Test-Path -LiteralPath $agentCollisionPath) {
                Remove-Item -Path $agentCollisionPath -Force -Recurse
            }
        }
        $compatShim = @(
            '@echo off',
            '"%~dp0autohand.exe" %*',
            'exit /b %ERRORLEVEL%'
        )
        [System.IO.File]::WriteAllLines($compatBinaryPath, $compatShim, [System.Text.Encoding]::ASCII)
        [System.IO.File]::WriteAllLines($agentAliasPath, $compatShim, [System.Text.Encoding]::ASCII)
        Write-Success "Installed to $binaryPath"
        Write-Success "Installed compatibility alias to $compatBinaryPath"
        Write-Success "Installed agent alias to $agentAliasPath"
        Claim-PathWideAgentAlias -OwnInstallPath $installPath -CanonicalBinaryPath $binaryPath -AgentCollisionNames $agentCollisionNames
    }
    finally {
        if (Test-Path $tempRoot) {
            Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Step "Installing to $installPath"

    Add-AutohandToUserPath -InstallPath $installPath

    Write-Host ""
    Write-Success "Autohand CLI installed successfully!"
    Write-Host ""

    # Try to get version (with timeout to guard against binary hangs)
    try {
        $job = Start-Job -ScriptBlock { param($p) & $p --version 2>$null } -ArgumentList $binaryPath
        $completed = $job | Wait-Job -Timeout 5
        if ($completed) {
            $versionOutput = Receive-Job -Job $job
            Write-Host "Version: $versionOutput"
        } else {
            Stop-Job -Job $job
            Write-Host "Version: $targetVersion"
        }
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
    catch {
        Write-Host "Version: $targetVersion"
    }

    Write-Host ""
    Write-Host "Get started:"
    Write-Host "  autohand              # Start interactive mode"
    Write-Host "  autohand --help       # Show all options"
    Write-Host "  autohand login        # Sign in to your account"
    Write-Host ""
}

# Run installer
Install-Autohand
