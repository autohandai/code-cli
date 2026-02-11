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
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture

    switch ($arch) {
        "X64" { return "windows-x64" }
        "Arm64" { return "windows-arm64" }
        default {
            throw "Unsupported CPU architecture: $arch"
        }
    }
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
    $apiUrl = "https://api.github.com/repos/$REPO/releases?per_page=10"

    try {
        $headers = @{
            "Accept" = "application/vnd.github.v3+json"
            "Cache-Control" = "no-cache"
        }

        $releases = Invoke-RestMethod -Uri $apiUrl -Headers $headers -UseBasicParsing

        foreach ($release in $releases) {
            if ($release.prerelease -eq $true) {
                $tagName = $release.tag_name
                if ($tagName.StartsWith("v")) {
                    $tagName = $tagName.Substring(1)
                }
                return $tagName
            }
        }

        throw "No alpha (pre-release) builds found"
    }
    catch {
        throw "Failed to fetch latest alpha version from GitHub API: $_"
    }
}

function Remove-ExistingInstallation {
    Write-Step "Cleaning up existing installation..."

    # Common installation locations
    $locations = @(
        "$env:LOCALAPPDATA\autohand\autohand.exe",
        "$env:LOCALAPPDATA\Programs\autohand\autohand.exe",
        "$env:ProgramFiles\autohand\autohand.exe",
        "$env:USERPROFILE\.local\bin\autohand.exe"
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

    # Construct download URL
    $downloadUrl = "https://github.com/$REPO/releases/download/v$targetVersion/autohand-$arch.exe"

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

    $binaryPath = Join-Path $installPath $BINARY_NAME

    Write-Step "Downloading Autohand CLI..."
    Write-Host "  Channel:  $channel"
    Write-Host "  Platform: $arch"
    Write-Host "  Version:  $targetVersion"
    Write-Host "  Target:   $binaryPath"
    Write-Host ""

    # Download binary
    try {
        $webClient = New-Object System.Net.WebClient

        if ($NoCache) {
            $webClient.Headers.Add("Cache-Control", "no-cache, no-store")
            $webClient.Headers.Add("Pragma", "no-cache")
        }

        $webClient.DownloadFile($downloadUrl, $binaryPath)
    }
    catch {
        Write-Error-Custom "Failed to download from $downloadUrl"
        Write-Host "Hint: Check if the version exists at https://github.com/$REPO/releases" -ForegroundColor Yellow
        throw $_
    }

    # Verify download
    if (-not (Test-Path $binaryPath) -or (Get-Item $binaryPath).Length -eq 0) {
        throw "Downloaded file is empty or missing"
    }

    Write-Success "Download complete"
    Write-Step "Installing to $installPath"
    Write-Success "Installed to $binaryPath"

    # Add to PATH if not already present
    $currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($currentPath -notlike "*$installPath*") {
        Write-Host ""
        Write-Host "Next steps" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "1) Add to PATH (run in PowerShell as Administrator or for current user):"
        Write-Host ""
        Write-Host "   # For current user only:" -ForegroundColor Gray
        Write-Host "   `$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')"
        Write-Host "   [Environment]::SetEnvironmentVariable('PATH', `"`$userPath;$installPath`", 'User')"
        Write-Host ""
        Write-Host "   # Or add to current session only:" -ForegroundColor Gray
        Write-Host "   `$env:PATH += `";$installPath`""
        Write-Host ""
        Write-Host "2) Restart your terminal or run:"
        Write-Host "   refreshenv  (if using Chocolatey)"
        Write-Host ""
    }

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
    Write-Host "  autohand /login       # Sign in to your account"
    Write-Host ""
}

# Run installer
Install-Autohand
