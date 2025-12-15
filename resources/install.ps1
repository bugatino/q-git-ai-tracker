$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# --- Logging Setup ---
$Global:LogFile = Join-Path $HOME ".git-ai\install.log"
# Ensure dir exists (it might not default exist yet, but we usually create .git-ai later. Let's create it now if needed for logging)
$LogDir = Split-Path $Global:LogFile -Parent
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
}
try {
    "--- Install Log Started: $(Get-Date) ---" | Out-File -FilePath $Global:LogFile -Encoding UTF8 -Force
} catch {
    Write-Host "Warning: Could not create log file at $Global:LogFile" -ForegroundColor Yellow
}

function Log-Message {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [Parameter(Mandatory = $false)][string]$Color = "White"
    )
    # Write to console
    Write-Host $Message -ForegroundColor $Color
    
    # Write to file
    try {
        "$(Get-Date -Format 'HH:mm:ss') $Message" | Out-File -FilePath $Global:LogFile -Append -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
}

function Write-ErrorAndExit {
    param(
        [Parameter(Mandatory = $true)][string]$Message
    )
    Log-Message "Error: $Message" -Color Red
    Log-Message "Log file is available at: $Global:LogFile" -Color Yellow
    exit 1
}

function Write-Success {
    param(
        [Parameter(Mandatory = $true)][string]$Message
    )
    Log-Message $Message -Color Green
}

function Write-Warning {
    param(
        [Parameter(Mandatory = $true)][string]$Message
    )
    Log-Message $Message -Color Yellow
}

function Wait-ForFileAvailable {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $false)][int]$MaxWaitSeconds = 300,
        [Parameter(Mandatory = $false)][int]$RetryIntervalSeconds = 5
    )
    
    $elapsed = 0
    while ($elapsed -lt $MaxWaitSeconds) {
        try {
            # Try to open the file for writing to check if it's available
            $stream = [System.IO.File]::Open($Path, 'Open', 'Write', 'None')
            $stream.Close()
            return $true
        } catch {
            if ($elapsed -eq 0) {
                Log-Message "Waiting for file to be available: $Path" -Color Yellow
            }
            Start-Sleep -Seconds $RetryIntervalSeconds
            $elapsed += $RetryIntervalSeconds
        }
    }
    return $false
}

function Get-StdGitPath {
    $cmd = Get-Command git.exe -ErrorAction SilentlyContinue
    $gitPath = $null
    if ($cmd -and $cmd.Path) {
        # Ensure we never return a path for git that contains git-ai (recursive)
        if ($cmd.Path -notmatch "git-ai") {
            $gitPath = $cmd.Path
        }
    }

    # If detection failed or was our own shim, try to recover from saved config
    if (-not $gitPath) {
        try {
            $cfgPath = Join-Path $HOME ".git-ai\config.json"
            if (Test-Path -LiteralPath $cfgPath) {
                $cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
                if ($cfg -and $cfg.git_path -and ($cfg.git_path -notmatch 'git-ai') -and (Test-Path -LiteralPath $cfg.git_path)) {
                    $gitPath = $cfg.git_path
                }
            }
        } catch { }
    }

    # If still not found, fail with a clear message
    if (-not $gitPath) {
        Write-ErrorAndExit "Could not detect a standard git binary on PATH. Please ensure you have Git installed and available on your PATH. If you believe this is a bug with the installer, please file an issue at https://github.com/acunniffe/git-ai/issues."
    }

    try {
        & $gitPath --version | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'bad' }
    } catch {
        Write-ErrorAndExit "Detected git at $gitPath is not usable (--version failed). Please ensure you have Git installed and available on your PATH. If you believe this is a bug with the installer, please file an issue at https://github.com/acunniffe/git-ai/issues."
    }

    return $gitPath
}

# Ensure $PathToAdd is inserted before any PATH entry that contains "git" (case-insensitive)
function Set-PathPrependBeforeGit {
    param(
        [Parameter(Mandatory = $true)][string]$PathToAdd
    )

    $sep = ';'

    function NormalizePath([string]$p) {
        try { return ([IO.Path]::GetFullPath($p.Trim())).TrimEnd('\\').ToLowerInvariant() }
        catch { return ($p.Trim()).TrimEnd('\\').ToLowerInvariant() }
    }

    $normalizedAdd = NormalizePath $PathToAdd

    # Helper to build new PATH string with PathToAdd inserted before first 'git' entry
    function BuildPathWithInsert([string]$existingPath, [string]$toInsert) {
        $entries = @()
        if ($existingPath) { $entries = ($existingPath -split $sep) | Where-Object { $_ -and $_.Trim() -ne '' } }

        # De-duplicate and remove any existing instance of $toInsert
        $list = New-Object System.Collections.Generic.List[string]
        $seen = New-Object 'System.Collections.Generic.HashSet[string]'
        foreach ($e in $entries) {
            $n = NormalizePath $e
            if (-not $seen.Contains($n) -and $n -ne $normalizedAdd) {
                $seen.Add($n) | Out-Null
                $list.Add($e) | Out-Null
            }
        }

        # Find first index that matches 'git' anywhere (case-insensitive)
        $insertIndex = 0
        for ($i = 0; $i -lt $list.Count; $i++) {
            if ($list[$i] -match '(?i)git') { $insertIndex = $i; break }
        }

        $list.Insert($insertIndex, $toInsert)
        return ($list -join $sep)
    }

    $userStatus = 'Skipped'
    try {
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        $newUserPath = BuildPathWithInsert -existingPath $userPath -toInsert $PathToAdd
        if ($newUserPath -ne $userPath) {
            [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
            $userStatus = 'Updated'
        } else {
            $userStatus = 'AlreadyPresent'
        }
    } catch {
        Log-Message "Error updating User PATH: $_" -Color Red
        $userStatus = 'Error'
    }

    # Try to update Machine PATH
    $machineStatus = 'Skipped'
    try {
        # Check if we are running as admin basically by trying to access machine path
        # If this fails, we catch it.
        $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
        $newMachinePath = BuildPathWithInsert -existingPath $machinePath -toInsert $PathToAdd
        if ($newMachinePath -ne $machinePath) {
            [Environment]::SetEnvironmentVariable('Path', $newMachinePath, 'Machine')
            $machineStatus = 'Updated'
        } else {
            # Nothing changed at Machine scope; still treat as Machine for reporting
            $machineStatus = 'AlreadyPresent'
        }
    } catch {
        # Access denied or not elevated
        
        # If User update was successful, this is just a warning (likely Domain/Non-Admin user)
        if ($userStatus -eq 'Updated' -or $userStatus -eq 'AlreadyPresent') {
            Log-Message "Warning: Unable to update SYSTEM PATH (admin rights required). This is normal for non-admin users." -Color Yellow
            Log-Message "git-ai is configured for your User account only." -Color Yellow
            $machineStatus = 'AccessDenied_Ignored'
        } else {
            # Critical error: neither User nor Machine could be updated
            $origGit = $null
            try { $origGit = Get-StdGitPath } catch { }
            $origGitDir = if ($origGit) { (Split-Path $origGit -Parent) } else { 'your Git installation directory' }
            
            Log-Message ''
            Log-Message 'ERROR: Unable to update either USER or SYSTEM PATH.' -Color Red
            Log-Message 'To ensure git-ai takes precedence over Git:' -Color Red
            Log-Message ("  1) Run PowerShell as Administrator and re-run this installer; OR") -Color Red
            Log-Message ("  2) Manually edit the Environment Variables." ) -Color Red
            Log-Message ''
            $machineStatus = 'Error'
        }
    }

    # Update current process PATH immediately for this session
    try {
        $procPath = $env:PATH
        $newProcPath = BuildPathWithInsert -existingPath $procPath -toInsert $PathToAdd
        if ($newProcPath -ne $procPath) { $env:PATH = $newProcPath }
    } catch { }

    return [PSCustomObject]@{
        UserStatus    = $userStatus
        MachineStatus = $machineStatus
    }
}

# Detect standard Git early and validate (fail-fast behavior)
$stdGitPath = Get-StdGitPath

# Install directory: %USERPROFILE%\.git-ai\bin
$installDir = Join-Path $HOME ".git-ai\bin"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

# Resolve source binary
# Assuming this script is running from resources/
$scriptDir = $PSScriptRoot
$sourceBinary = Join-Path $scriptDir "bin\git-ai-windows-x64.exe"

if (-not (Test-Path -LiteralPath $sourceBinary)) {
    Write-ErrorAndExit "Could not find bundled binary at $sourceBinary"
}

# Determine binary name
BINARY_NAME="git-ai-${OS}-${ARCH}"

# Resolve script directory to find binaries
$scriptDir = $PSScriptRoot
$sourceBinary = Join-Path $scriptDir "bin\git-ai-windows-x64.exe"

if (-not (Test-Path -LiteralPath $sourceBinary)) {
    Write-ErrorAndExit "Could not find bundled binary at $sourceBinary"
}

Log-Message "Installing git-ai from $sourceBinary..."
$finalExe = Join-Path $installDir 'git-ai.exe'

# Wait for git-ai.exe to be available if it exists and is in use
if (Test-Path -LiteralPath $finalExe) {
    if (-not (Wait-ForFileAvailable -Path $finalExe -MaxWaitSeconds 300 -RetryIntervalSeconds 5)) {
        Write-ErrorAndExit "Timeout waiting for $finalExe to be available. Please close any running git-ai processes and try again."
    }
}

Copy-Item -Force -Path $sourceBinary -Destination $finalExe
try { Unblock-File -Path $finalExe -ErrorAction SilentlyContinue } catch { }

# Create a shim so calling `git` goes through git-ai by PATH precedence
$gitShim = Join-Path $installDir 'git.exe'

# Wait for git.exe shim to be available if it exists and is in use
if (Test-Path -LiteralPath $gitShim) {
    if (-not (Wait-ForFileAvailable -Path $gitShim -MaxWaitSeconds 300 -RetryIntervalSeconds 5)) {
        Write-ErrorAndExit "Timeout waiting for $gitShim to be available. Please close any running git processes and try again."
    }
}

Copy-Item -Force -Path $finalExe -Destination $gitShim
try { Unblock-File -Path $gitShim -ErrorAction SilentlyContinue } catch { }

# Create a shim so calling `git-og` invokes the standard Git
$gitOgShim = Join-Path $installDir 'git-og.cmd'
$gitOgShimContent = "@echo off$([Environment]::NewLine)`"$stdGitPath`" %*$([Environment]::NewLine)"
Set-Content -Path $gitOgShim -Value $gitOgShimContent -Encoding ASCII -Force
try { Unblock-File -Path $gitOgShim -ErrorAction SilentlyContinue } catch { }

# Install hooks
Log-Message 'Setting up IDE/agent hooks...'
try {
    & $finalExe install-hooks | Out-Host
    Write-Success 'Successfully set up IDE/agent hooks'
} catch {
    Write-Warning "Warning: Failed to set up IDE/agent hooks. Please try running 'git-ai install-hooks' manually."
}

# Update PATH so our shim takes precedence over any Git entries
$pathUpdate = Set-PathPrependBeforeGit -PathToAdd $installDir
if ($pathUpdate.UserStatus -eq 'Updated') {
    Write-Success 'Successfully added git-ai to the user PATH.'
} elseif ($pathUpdate.UserStatus -eq 'AlreadyPresent') {
    Write-Success 'git-ai already present in the user PATH.'
} elseif ($pathUpdate.UserStatus -eq 'Error') {
    Log-Message 'Failed to update the user PATH.' -Color Red
}

if ($pathUpdate.MachineStatus -eq 'Updated') {
    Write-Success 'Successfully added git-ai to the system PATH.'
} elseif ($pathUpdate.MachineStatus -eq 'AlreadyPresent') {
    Write-Success 'git-ai already present in the system PATH.'
} elseif ($pathUpdate.MachineStatus -eq 'Error') {
    Log-Message 'PATH update failed: system PATH unchanged.' -Color Red
}

Write-Success "Successfully installed git-ai into $installDir"
Write-Success "You can now run 'git-ai' from your terminal"

# Write JSON config at %USERPROFILE%\.git-ai\config.json (only if it doesn't exist)
try {
    $configDir = Join-Path $HOME '.git-ai'
    $configJsonPath = Join-Path $configDir 'config.json'
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null

    if (-not (Test-Path -LiteralPath $configJsonPath)) {
        $cfg = @{
            git_path = $stdGitPath
        } | ConvertTo-Json -Compress
        $cfg | Out-File -FilePath $configJsonPath -Encoding UTF8 -Force
    }
} catch {
    Log-Message "Warning: Failed to write config.json: $($_.Exception.Message)" -Color Yellow
}

Log-Message 'Close and reopen your terminal and IDE sessions to use git-ai.' -Color Yellow
