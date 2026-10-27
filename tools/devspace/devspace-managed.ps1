# DevSpace Managed for Windows (portable, single-file).
# Install from the intended Windows user's PowerShell, never from SYSTEM.
# Modes: Logon = background while user logged on; Boot = user credentials held by Task Scheduler.
[CmdletBinding()]
param(
  [ValidateSet('Install','Plan','Doctor','Start','Stop','Restart','Uninstall','Run')]
  [string]$Action = 'Doctor',
  [ValidateSet('Logon','Boot')]
  [string]$Mode = 'Logon',
  [switch]$Migrate,
  [switch]$Elevated,
  [string]$NodePath = '',
  [string]$CliPath = '',
  [string]$WorkDir = '',
  [int]$Port = 7878
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$TaskName = 'DevSpace Managed'
$DataDir = Join-Path $env:LOCALAPPDATA 'DevSpaceManaged'
$InstalledScript = Join-Path $DataDir 'devspace-managed.ps1'
$SettingsPath = Join-Path $DataDir 'settings.json'
$LogPath = Join-Path $DataDir 'manager.log'
$ChildPidPath = Join-Path $DataDir 'child-pid.json'

function Identity {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return [pscustomobject]@{ Name = $id.Name; Sid = $id.User.Value }
}
function Log([string]$s) {
  if (-not (Test-Path -LiteralPath $DataDir)) { New-Item -ItemType Directory -Force -Path $DataDir | Out-Null }
  $line = '[{0}] {1}' -f (Get-Date -Format s),$s
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  try {
    $f = Get-Item -LiteralPath $LogPath
    if ($f.Length -gt 2MB) {
      $old = "$LogPath.1"
      Move-Item -LiteralPath $LogPath -Destination $old -Force
    }
  } catch {}
}
function Load-Settings {
  if (-not (Test-Path -LiteralPath $SettingsPath)) { throw "Settings absent: $SettingsPath. Run Install first." }
  return (Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json)
}
function Check-Owner($cfg) {
  $actual = Identity
  if ($actual.Sid -ne $cfg.sid) {
    throw "Wrong Windows identity $($actual.Name); configured for $($cfg.user). Do not use SYSTEM/profile spoofing."
  }
}
function Find-Node {
  if ($NodePath -and (Test-Path -LiteralPath $NodePath)) { return (Resolve-Path -LiteralPath $NodePath).Path }
  $p = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match '@waishnav[\\/]devspace[\\/]dist[\\/]cli\.js' } |
    Select-Object -First 1)
  if ($p.Count -gt 0 -and $p[0].ExecutablePath -and (Test-Path -LiteralPath $p[0].ExecutablePath)) { return $p[0].ExecutablePath }
  $found = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found -and (Test-Path -LiteralPath $found.Source)) { return $found.Source }
  foreach ($candidate in @('C:\nvm4w\nodejs\node.exe','C:\Program Files\nodejs\node.exe')) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw 'Node.exe not found; specify -NodePath.'
}
function Find-Cli([string]$node) {
  if ($CliPath -and (Test-Path -LiteralPath $CliPath)) { return (Resolve-Path -LiteralPath $CliPath).Path }
  $base = Split-Path -Parent $node
  $targets = @(
    (Join-Path $base 'node_modules\@waishnav\devspace\dist\cli.js'),
    (Join-Path $env:APPDATA 'npm\node_modules\@waishnav\devspace\dist\cli.js'),
    'C:\Program Files\nodejs\node_modules\@waishnav\devspace\dist\cli.js'
  )
  foreach ($candidate in $targets) { if (Test-Path -LiteralPath $candidate) { return $candidate } }
  throw 'DevSpace cli.js not found; specify -CliPath.'
}
function Server([int]$port) {
  $socket = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($socket.Count -eq 0) { return $null }
  $pidFound = [int]$socket[0].OwningProcess
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $pidFound" -ErrorAction SilentlyContinue
  if ($null -eq $proc) { return [pscustomobject]@{pid=$pidFound;devspace=$false;name='unknown'} }
  $match = $proc.Name -eq 'node.exe' -and $proc.CommandLine -match '@waishnav[\\/]devspace[\\/]dist[\\/]cli\.js'
  return [pscustomobject]@{pid=$pidFound;devspace=[bool]$match;name=$proc.Name}
}
function Healthy([int]$port) {
  try {
    $r = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/healthz" -f $port) -UseBasicParsing -TimeoutSec 3
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}
function Wait-Healthy([int]$port,[int]$seconds=28) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    $owner = Server $port
    if ($owner -and $owner.devspace -and (Healthy $port)) { return $true }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return $false
}
function Registered-Env([string]$profile) {
  # Freshly read machine + user registry, rather than the possibly stale task environment.
  $vars = @{}
  $machine = [Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::Machine)
  $user = [Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::User)
  foreach ($key in $machine.Keys) { $vars[[string]$key] = [string]$machine[$key] }
  foreach ($key in $user.Keys) { $vars[[string]$key] = [string]$user[$key] }
  $mPath = [string]$machine['Path']
  $uPath = [string]$user['Path']
  if ($mPath -or $uPath) { $vars['PATH'] = (($mPath,$uPath | Where-Object { $_ }) -join ';') }
  $vars['USERPROFILE'] = $profile
  $vars['HOME'] = $profile
  $vars['APPDATA'] = Join-Path $profile 'AppData\Roaming'
  $vars['LOCALAPPDATA'] = Join-Path $profile 'AppData\Local'
  if (-not $vars.ContainsKey('DEVSPACE_CONFIG_DIR')) { $vars['DEVSPACE_CONFIG_DIR'] = Join-Path $profile '.devspace' }
  if (-not $vars.ContainsKey('DEVSPACE_STATE_DIR')) { $vars['DEVSPACE_STATE_DIR'] = Join-Path $profile '.local\share\devspace' }
  if (-not $vars.ContainsKey('DEVSPACE_WORKTREE_ROOT')) { $vars['DEVSPACE_WORKTREE_ROOT'] = Join-Path $profile '.devspace\worktrees' }
  if (-not $vars.ContainsKey('DEVSPACE_AGENT_DIR')) { $vars['DEVSPACE_AGENT_DIR'] = Join-Path $profile '.codex' }
  return $vars
}
function Stop-Managed {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task -and $task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2
  }
  $cfg = Load-Settings
  $owner = Server ([int]$cfg.port)
  if ($owner -and $owner.devspace -and (Test-Path -LiteralPath $ChildPidPath)) {
    # Stop only the child owned by this managed runner, not a foreground/manual DevSpace.
    try {
      $record = Get-Content -LiteralPath $ChildPidPath -Raw | ConvertFrom-Json
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($owner.pid)" -ErrorAction SilentlyContinue
      if ($proc -and [int]$record.pid -eq $owner.pid -and
          $proc.CreationDate.ToUniversalTime().ToString('o') -eq [string]$record.createdUtc -and
          $proc.CommandLine -match [regex]::Escape([string]$cfg.cli)) {
        Stop-Process -Id $owner.pid -Force -ErrorAction SilentlyContinue
      }
    } catch { Log ('Stop child check: ' + $_.Exception.Message) }
  }
}
function Run-Server {
  $cfg = Load-Settings
  Check-Owner $cfg
  $lockName = 'Local\DevSpaceManaged_' + $cfg.sid.Replace('-','_')
  $mtx = New-Object Threading.Mutex($false,$lockName)
  $held = $false
  try {
    try { $held = $mtx.WaitOne(0) } catch [Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { Log 'Another managed runner already exists. Exiting.'; return }
    $restarts = @()
    while ($true) {
      $existing = Server ([int]$cfg.port)
      if ($existing) {
        Log ("Port {0} occupied by pid={1}, isDevSpace={2}; not taking over an unknown process." -f $cfg.port,$existing.pid,$existing.devspace)
        Start-Sleep -Seconds 30
        continue
      }
      $fresh = Registered-Env ([string]$cfg.profile)
      $si = New-Object System.Diagnostics.ProcessStartInfo
      $si.FileName = [string]$cfg.node
      $si.Arguments = ('"{0}" serve' -f $cfg.cli)
      $si.WorkingDirectory = [string]$cfg.cwd
      $si.UseShellExecute = $false
      $si.CreateNoWindow = $true
      $si.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
      foreach ($key in $fresh.Keys) { $si.EnvironmentVariables[[string]$key] = [string]$fresh[$key] }
      $p = New-Object System.Diagnostics.Process
      $p.StartInfo = $si
      Log ("Starting node under {0}, profile={1}, port={2}; environment refreshed from registry." -f $cfg.user,$cfg.profile,$cfg.port)
      try {
        if (-not $p.Start()) { throw 'Process.Start returned false' }
        $created = (Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $p.Id) -ErrorAction Stop).CreationDate
        [ordered]@{pid=$p.Id;createdUtc=$created.ToUniversalTime().ToString('o')} |
          ConvertTo-Json | Set-Content -LiteralPath $ChildPidPath -Encoding UTF8
        $failures = 0
        while (-not $p.WaitForExit(20000)) {
          if (Healthy ([int]$cfg.port)) { $failures = 0 }
          else { $failures += 1 }
          if ($failures -ge 4) {
            Log ("Health endpoint failed {0} consecutive checks. Restarting only this node." -f $failures)
            try { $p.Kill() } catch {}
            break
          }
        }
        try { $p.WaitForExit() } catch {}
        Log ("Node stopped, exitCode={0}" -f $p.ExitCode)
      } catch { Log ("Node start/runtime error: " + $_.Exception.Message) }
      finally {
        try {
          if (Test-Path -LiteralPath $ChildPidPath) {
            $record = Get-Content -LiteralPath $ChildPidPath -Raw | ConvertFrom-Json
            if ([int]$record.pid -eq $p.Id) { Remove-Item -LiteralPath $ChildPidPath -Force }
          }
        } catch {}
        $p.Dispose()
      }
      $now = Get-Date
      $restarts = @($restarts | Where-Object { $_ -gt $now.AddHours(-1) })
      $restarts += $now
      if ($restarts.Count -ge 7) {
        Log 'Restart budget 7/hour reached; cooling down for 10 minutes.'
        Start-Sleep -Seconds 600
      } else { Start-Sleep -Seconds 10 }
    }
  } finally {
    if ($held) { $mtx.ReleaseMutex() }
    $mtx.Dispose()
  }
}
function Install {
  $identity = Identity
  if ($identity.Name -match '^(NT AUTHORITY\\SYSTEM|NT AUTHORITY\\NETWORK SERVICE|NT AUTHORITY\\LOCAL SERVICE)$') {
    throw 'Run the installer in the intended human Windows account, not SYSTEM.'
  }
  if ($Mode -eq 'Boot' -and -not [Environment]::UserInteractive) {
    throw 'Boot installation needs an interactive local PowerShell for one-time credential input.'
  }
  $node = Find-Node
  $cli = Find-Cli $node
  $cwd = if ($WorkDir -and (Test-Path -LiteralPath $WorkDir)) { (Resolve-Path -LiteralPath $WorkDir).Path } else { $env:USERPROFILE }
  if (-not (Test-Path -LiteralPath $cwd)) { throw "Working directory missing: $cwd" }
  if (-not (Test-Path -LiteralPath $DataDir)) { New-Item -ItemType Directory -Force -Path $DataDir | Out-Null }
  $cfg = [ordered]@{
    version=1; user=$identity.Name; sid=$identity.Sid; profile=$env:USERPROFILE
    node=$node; cli=$cli; cwd=$cwd; port=$Port; mode=$Mode
    installedAt=(Get-Date).ToUniversalTime().ToString('o')
  }
  # Neither token values nor account passwords are stored by this script.
  $cfg | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $SettingsPath -Encoding UTF8
  if ((Resolve-Path -LiteralPath $PSCommandPath).Path -ne $InstalledScript) {
    Copy-Item -LiteralPath $PSCommandPath -Destination $InstalledScript -Force
  }
  $psExe = Join-Path $PSHOME 'powershell.exe'
  if (-not (Test-Path -LiteralPath $psExe)) { $psExe = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" }
  $arg = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Action Run' -f $InstalledScript
  $actionSpec = New-ScheduledTaskAction -Execute $psExe -Argument $arg -WorkingDirectory $cwd
  $trigger = if ($Mode -eq 'Boot') { New-ScheduledTaskTrigger -AtStartup } else { New-ScheduledTaskTrigger -AtLogOn -User $identity.Name }
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $level = if ($Mode -eq 'Boot' -or $Elevated) { 'Highest' } else { 'Limited' }
  $principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType $(if ($Mode -eq 'Boot') {'Password'} else {'Interactive'}) -RunLevel $level
  $task = New-ScheduledTask -Action $actionSpec -Trigger $trigger -Settings $settings -Principal $principal
  if ($Mode -eq 'Boot') {
    $credential = Get-Credential -UserName $identity.Name -Message 'Windows account password for Task Scheduler. Stored by Windows, NOT in this script.'
    if (-not $credential -or $credential.UserName -ine $identity.Name) { throw 'Credential cancelled or identity mismatch.' }
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential.Password)
    try {
      $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
      Register-ScheduledTask -TaskName $TaskName -InputObject $task -User $identity.Name -Password $password -Force | Out-Null
    } finally {
      Remove-Variable password -ErrorAction SilentlyContinue
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
  } else {
    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
  }
  Log ("Installed task mode={0}, identity={1}; no tokens copied." -f $Mode,$identity.Name)

  $legacy = @('DevSpace Background','DevSpace Health Check') | ForEach-Object {
    Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue
  }
  $legacyEnabled = @($legacy | Where-Object { $_.State -ne 'Disabled' } | ForEach-Object { $_.TaskName })
  if ($Migrate) {
    $preexisting = Server $Port
    if ($preexisting -and -not $preexisting.devspace) {
      throw "Port $Port is owned by unrelated $($preexisting.name) PID $($preexisting.pid); legacy tasks were not changed."
    }
    try {
    # Prevent old watchdog from racing with the replacement. Preserve old task definitions.
    foreach ($name in $legacyEnabled) {
      if ($name -eq 'DevSpace Health Check') { Disable-ScheduledTask -TaskName $name | Out-Null }
    }
    foreach ($name in $legacyEnabled) {
      if ($name -eq 'DevSpace Background') {
        Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        Disable-ScheduledTask -TaskName $name | Out-Null
      }
    }
    Start-Sleep -Seconds 2
    $owner = Server $Port
    if ($owner) {
      if (-not $owner.devspace) { throw "Port $Port owned by unrelated $($owner.name) PID $($owner.pid); refusing takeover." }
      # Commandline verified as DevSpace node, not another service.
      Stop-Process -Id $owner.pid -Force
      Start-Sleep -Seconds 2
    }
    Start-ScheduledTask -TaskName $TaskName
    if (-not (Wait-Healthy $Port)) {
      throw 'New DevSpace did not pass the health check.'
    }
    Log 'Migrated to background user identity; health check passed.'
    Write-Output "Migration passed: $($identity.Name) / $Mode. Legacy definitions retained but disabled."
    } catch {
      Log ('Migration failed. Restoring old task enablement: ' + $_.Exception.Message)
      Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      foreach ($name in $legacyEnabled) { Enable-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue | Out-Null }
      if ($legacyEnabled -contains 'DevSpace Background') { Start-ScheduledTask -TaskName 'DevSpace Background' -ErrorAction SilentlyContinue }
      throw
    }
  } else {
    $occupant = Server $Port
    if ($occupant) {
      Write-Output "Task installed but port $Port is occupied by PID $($occupant.pid). Re-run Install -Migrate to switch safely."
    } else {
      Start-ScheduledTask -TaskName $TaskName
      if (Wait-Healthy $Port) { Write-Output "DevSpace background task started and healthy on port $Port." }
      else { Write-Warning 'Task registered, but endpoint not yet healthy. Run Doctor and inspect manager.log.' }
    }
  }
}
function Plan {
  $identity = Identity
  $node = Find-Node
  $cli = Find-Cli $node
  $allVars = Registered-Env $env:USERPROFILE
  $existing = Server $Port
  [pscustomobject]@{
    account=$identity.Name; mode=$Mode
    supportedInstallAccount=($identity.Name -notmatch '^(NT AUTHORITY\\SYSTEM|NT AUTHORITY\\NETWORK SERVICE|NT AUTHORITY\\LOCAL SERVICE)$')
    nodeExe=$node; devspaceCli=$cli
    profile=$env:USERPROFILE
    configFileExists=(Test-Path (Join-Path $env:USERPROFILE '.devspace\config.json'))
    authFileExists=(Test-Path (Join-Path $env:USERPROFILE '.devspace\auth.json'))
    task=$TaskName; port=$Port
    currentServerPid=$(if ($existing) { $existing.pid } else { $null })
    currentServerIsDevSpace=$(if ($existing) { $existing.devspace } else { $false })
    registryVariableCount=$allVars.Count
    childWillInheritUserPortainerVariable=(@($allVars.Keys | Where-Object { $_ -match 'PORTAINER' }).Count -gt 0)
    legacyTaskNames=@(Get-ScheduledTask | Where-Object { $_.TaskName -in @('DevSpace Background','DevSpace Health Check') } | ForEach-Object { $_.TaskName })
  } | Format-List
  Write-Output 'This is a read-only preflight. Tokens and environment variable values were not displayed.'
}
function Doctor {
  $cfg = if (Test-Path -LiteralPath $SettingsPath) { Load-Settings } else { $null }
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $p = if ($cfg) { [int]$cfg.port } else { $Port }
  $owner = Server $p
  $id = Identity
  $userVars = [Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::User)
  [pscustomobject]@{
    machine=$env:COMPUTERNAME; currentIdentity=$id.Name
    configuredIdentity=$(if ($cfg) { $cfg.user } else { $null })
    mode=$(if ($cfg) { $cfg.mode } else { $null })
    task=$(if ($task) { $task.State.ToString() } else { 'NotInstalled' })
    taskIdentity=$(if ($task) { $task.Principal.UserId } else { $null })
    taskLogonType=$(if ($task) { $task.Principal.LogonType.ToString() } else { $null })
    port=$p; portOwnerPid=$(if ($owner) { $owner.pid } else { $null })
    portOwnerIsDevspace=$(if ($owner) { $owner.devspace } else { $false })
    health=(Healthy $p)
    authFileExists=(Test-Path (Join-Path $env:USERPROFILE '.devspace\auth.json'))
    configFileExists=(Test-Path (Join-Path $env:USERPROFILE '.devspace\config.json'))
    userVariableCount=$userVars.Count
    hasUserPortainerVariable=(@($userVars.Keys | Where-Object { $_ -match 'PORTAINER' }).Count -gt 0)
    managerLog=$LogPath
  } | Format-List
  Write-Output 'Health is local HTTP only: it does NOT prove an OAuth client refresh token is valid.'
}

if ($Action -eq 'Run') { Run-Server; return }
if ($Action -eq 'Doctor') { Doctor; return }
if ($Action -eq 'Plan') { Plan; return }
if ($Action -eq 'Install') { Install; Doctor; return }
if ($Action -eq 'Stop') { Stop-Managed; Doctor; return }
if ($Action -eq 'Restart') { Stop-Managed; Start-ScheduledTask -TaskName $TaskName; if (-not (Wait-Healthy (Load-Settings).port)) { Write-Warning 'Restart health not yet confirmed.' }; Doctor; return }
if ($Action -eq 'Start') { Start-ScheduledTask -TaskName $TaskName; if (-not (Wait-Healthy (Load-Settings).port)) { Write-Warning 'Start health not yet confirmed.' }; Doctor; return }
if ($Action -eq 'Uninstall') {
  Stop-Managed
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Task removed. Config, auth, client approvals, and $DataDir remain untouched."
  Doctor
}
