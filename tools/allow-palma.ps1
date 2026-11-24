# Run this in the folder you extracted Palma City into (right-click -> Run with
# PowerShell). It clears the "downloaded from the internet" mark that makes
# SmartScreen block the game, and adds a Defender exclusion for this folder.
# The exclusion step needs an Administrator PowerShell window.

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Palma City folder: $root"

# 1. clear the mark-of-the-web on everything here, including the exe and any zip
Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue |
  ForEach-Object {
    try { Unblock-File -Path $_.FullName -ErrorAction Stop } catch {}
  }
Write-Host "Unblocked every file in this folder."

# 2. Defender exclusion for the game folder (needs admin)
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if ($admin) {
  try {
    Add-MpPreference -ExclusionPath $root -ErrorAction Stop
    Write-Host "Added a Microsoft Defender exclusion for $root"
  } catch {
    Write-Host "Could not add the exclusion: $($_.Exception.Message)"
  }
} else {
  Write-Host "Not running as Administrator, so the Defender exclusion was skipped."
  Write-Host "Open PowerShell as Administrator and run this script again to add it."
}

# 3. start the game
$exe = Join-Path $root 'Palma City.exe'
if (Test-Path $exe) {
  Write-Host "Starting Palma City..."
  Start-Process -FilePath $exe
} else {
  Write-Host "Palma City.exe was not found here. Run this script from inside the extracted game folder."
}
