# Online one-click manager for existing Windows DevSpace installations.
# Publish alongside devspace-managed.ps1; this installer never touches tunnels, databases, or secrets.
[CmdletBinding()]
param(
    [ValidateSet('Boot','Logon')][string]$Mode = 'Boot',
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Windows only. Existing Linux systemd services do not need migration.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($identity.IsSystem -or $identity.Name -match '^NT AUTHORITY\\') {
    throw 'Run locally as the real Windows user, not SYSTEM. Existing user-level environment and credentials must remain attached to the same SID.'
}
if (-not $CheckOnly -and $Mode -eq 'Boot') {
    $admin = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'For unattended boot mode, launch an elevated PowerShell using the SAME Windows account. Do not use another administrator account.'
    }
    if (-not [Environment]::UserInteractive) {
        throw 'Boot mode needs an interactive local PowerShell for one-time Windows account credential input.'
    }
}
$base = 'https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/tools/devspace'
$expectedSha256 = '9C530C78B1A21C0C8EE7E021F66299FFBDA5AC518C7B5B57E61EB49F4D6F45F2'
$dir = Join-Path $env:TEMP ('devspace-online-' + [guid]::NewGuid().ToString('n'))
$script = Join-Path $dir 'devspace-managed.ps1'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri ($base + '/devspace-managed.ps1') -OutFile $script -TimeoutSec 45 -MaximumRedirection 3
    # Windows PowerShell installations with disabled modules may lack Get-FileHash.
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try { $actual = ([BitConverter]::ToString($sha256.ComputeHash([IO.File]::ReadAllBytes($script)))).Replace('-','') }
    finally { $sha256.Dispose() }
    if ($actual -ine $expectedSha256) {
        throw "Downloaded DevSpace manager hash mismatch. Expected $expectedSha256, got $actual. No services changed."
    }
    Write-Host ('DevSpace manager verified (SHA256). Running as ' + $identity.Name)
    & $script -Action Plan -Mode $Mode
    if (-not $CheckOnly) {
        Write-Host 'Installing same-user background task. Existing DevSpace process may briefly disconnect.'
        & $script -Action Install -Mode $Mode -Migrate
        Write-Host 'Background task installed. Local verification:'
        & $script -Action Doctor
    } else {
        Write-Host 'CheckOnly: no scheduled tasks or running processes were changed.'
    }
} finally {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
