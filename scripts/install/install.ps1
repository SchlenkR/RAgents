param(
    [string] $Version,
    [string] $Prefix,
    [switch] $Local,
    [switch] $Global,
    [switch] $Uninstall,
    [switch] $NoPathUpdate,
    [switch] $Help
)

$ErrorActionPreference = 'Stop'
$releases = 'https://github.com/SchlenkR/RAgents/releases'
$rerun = "& ([scriptblock]::Create((irm $releases/latest/download/install.ps1)))"

if ($Help) {
    Write-Output 'Usage: install.ps1 [-Local | -Global] [-Version VERSION] [-Prefix DIRECTORY] [-Uninstall] [-NoPathUpdate]'
    Write-Output ''
    Write-Output '  -Local         for the current user in %LOCALAPPDATA%\Programs\RAgents and the user PATH (default)'
    Write-Output '  -Global        for all users in %ProgramFiles%\RAgents and the machine PATH; needs an elevated PowerShell'
    Write-Output '  -Version       install this release instead of the latest, for example 0.1.21'
    Write-Output '  -Prefix        use DIRECTORY instead of the folder of the scope'
    Write-Output '  -Uninstall     remove the command, all versions, and the PATH entry from the scope or prefix'
    Write-Output '  -NoPathUpdate  leave PATH unchanged'
    return
}

if ($Local -and $Global) { throw 'Choose either -Local or -Global.' }
if ($Version) {
    if ($Uninstall) { throw '-Uninstall removes every version and takes no -Version.' }
    $Version = $Version -replace '^v', ''
    if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?\z') { throw 'Invalid version. Expected a version such as 0.1.0.' }
}
if ($env:OS -ne 'Windows_NT') { throw 'This installer requires Windows. On macOS or Linux, use install.sh.' }
$programFiles = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
$localPrefix = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\RAgents' }
$globalPrefix = if ($programFiles) { Join-Path $programFiles 'RAgents' }
if (-not $Prefix) {
    $Prefix = if ($Global) { $globalPrefix } else { $localPrefix }
    if (-not $Prefix) { throw 'The default folder is unknown. Choose a folder with -Prefix.' }
}
if (-not [IO.Path]::IsPathRooted($Prefix)) { throw 'The installation prefix must be an absolute path.' }
if ($Prefix.Length -gt 3) { $Prefix = $Prefix.TrimEnd('\', '/') }
$versions = Join-Path $Prefix 'versions'
$bin = Join-Path $Prefix 'bin'
$command = Join-Path $bin 'ragents.cmd'
$lockPath = Join-Path $Prefix '.install-lock'

function Test-CreatedHere([string] $Root) {
    $file = Join-Path $Root 'bin\ragents.cmd'
    (Test-Path -LiteralPath $file -PathType Leaf) -and [IO.File]::ReadAllText($file).Contains('"%~dp0..\versions\ragents-')
}

function Assert-Elevated {
    if (-not $Global) { return }
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw '-Global needs an elevated PowerShell. Start PowerShell with "Run as administrator" and run the command again, or leave out -Global to work for the current user.'
    }
}

function Send-EnvironmentChange {
    if (-not ('RAgentsInstaller.Native' -as [type])) {
        Add-Type -Namespace RAgentsInstaller -Name Native -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);'
    }
    $result = [UIntPtr]::Zero
    [RAgentsInstaller.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref] $result) | Out-Null
}

function Set-PathEntry([bool] $Present) {
    # The registry keeps unexpanded entries such as %SystemRoot%, which [Environment]::SetEnvironmentVariable would flatten.
    $key = if ($Global) { [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Control\Session Manager\Environment', $true) }
        else { [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment') }
    try {
        $current = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $entries = @($current -split ';' | Where-Object { $_ })
        $others = @($entries | Where-Object { $_.TrimEnd('\') -ne $bin })
        if ($Present -eq ($others.Count -lt $entries.Count)) { return }
        $updated = if ($Present) { $others + $bin } else { $others }
        $key.SetValue('Path', ($updated -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
    } finally { $key.Dispose() }
    Send-EnvironmentChange
}

function Find-PathCommand {
    $entries = ([Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')) -split ';'
    foreach ($entry in $entries) {
        $folder = $entry.Trim('"').TrimEnd('\')
        if (-not $folder) { continue }
        foreach ($name in 'ragents.exe', 'ragents.cmd', 'ragents.bat', 'ragents.ps1') {
            if ([IO.File]::Exists("$folder\$name")) { return "$folder\$name" }
        }
    }
}

function Write-Others {
    foreach ($other in @($localPrefix, $globalPrefix)) {
        if ($other -and $other -ne $Prefix -and (Test-CreatedHere $other)) {
            $flag = if ($other -eq $globalPrefix) { ' -Global' } else { '' }
            Write-Output "Another RAgents installation remains in $other. Remove it with:"
            Write-Output "  $rerun -Uninstall$flag"
        }
    }
    $found = Find-PathCommand
    if ($Uninstall) {
        if ($found) { Write-Output "The ragents command on your PATH is now $found." }
    } elseif ($found -and $found -ne $command) {
        Write-Output "Warning: a new terminal runs $found, not this installation."
        Write-Output "Remove that copy, or put $bin before it on your PATH."
    }
}

function Initialize-Version([string] $Root) {
    & (Join-Path $Root 'runtime\node.exe') --input-type=module -e "const { pathToFileURL } = await import('node:url'); const { ensureHostLinks } = await import(pathToFileURL(process.argv[1]).href); ensureHostLinks(process.argv[2]);" (Join-Path $Root 'app\scripts\package\host-links.mjs') (Join-Path $Root 'app') | Out-Null
    $LASTEXITCODE -eq 0
}

function Open-Lock {
    try {
        [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch {
        throw "Another installation is active: $lockPath"
    }
}

if ($Uninstall) {
    if (-not (Test-Path -LiteralPath $versions) -and -not (Test-Path -LiteralPath $command)) {
        Write-Output "No RAgents installation in $Prefix."
        Write-Others
        return
    }
    Assert-Elevated
    $lock = Open-Lock
    try {
        if (Test-Path -LiteralPath $command) {
            if (Test-CreatedHere $Prefix) { Remove-Item -LiteralPath $command -Force }
            else { Write-Output "Kept ${command}: this installer did not create it." }
        }
        if (Test-Path -LiteralPath $versions) { [IO.Directory]::Delete($versions, $true) }
        if (-not $NoPathUpdate) { Set-PathEntry $false }
        $env:Path = @($env:Path -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $bin }) -join ';'
    } finally { $lock.Dispose() }
    Remove-Item -LiteralPath $lockPath -Force
    foreach ($folder in $bin, $Prefix) {
        if ((Test-Path -LiteralPath $folder) -and -not (Get-ChildItem -LiteralPath $folder -Force)) { Remove-Item -LiteralPath $folder }
    }
    Write-Output "Removed RAgents from $Prefix. Settings and runs stay in %LOCALAPPDATA%\ragents of each user."
    Write-Others
    return
}

$architecture = $env:PROCESSOR_ARCHITEW6432
if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
$targetArchitecture = switch ($architecture) {
    'AMD64' { 'x64' }
    'ARM64' { 'arm64' }
    default { throw 'Supported architectures: x64 and arm64.' }
}
if ((Test-Path -LiteralPath $command) -and -not (Test-CreatedHere $Prefix)) {
    throw "$command was not created by this installer. Remove it, or choose another -Prefix."
}
Assert-Elevated

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not $Version) {
    $response = Invoke-WebRequest -Uri "$releases/latest" -Method Head -UseBasicParsing
    $latest = $response.BaseResponse.ResponseUri
    if (-not $latest) { $latest = $response.BaseResponse.RequestMessage.RequestUri }
    $releasePrefix = "$releases/tag/v"
    if (-not $latest -or -not $latest.AbsoluteUri.StartsWith($releasePrefix)) { throw 'Could not resolve the latest release.' }
    $Version = $latest.AbsoluteUri.Substring($releasePrefix.Length)
    if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?\z') { throw 'Invalid version. Expected a version such as 0.1.0.' }
}

$directory = "ragents-$Version-win32-$targetArchitecture"
$asset = "$directory.zip"
$destination = Join-Path $versions $directory
New-Item -ItemType Directory -Path $versions, $bin -Force | Out-Null
$lock = Open-Lock
$stage = Join-Path $versions ('.install-' + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $stage | Out-Null
    if (-not (Test-Path -LiteralPath $destination)) {
        Write-Output "Downloading RAgents $Version for win32-$targetArchitecture..."
        $archive = Join-Path $stage $asset
        $checksums = Join-Path $stage 'SHA256SUMS'
        Invoke-WebRequest -Uri "$releases/download/v$Version/$asset" -OutFile $archive -UseBasicParsing
        Invoke-WebRequest -Uri "$releases/download/v$Version/SHA256SUMS" -OutFile $checksums -UseBasicParsing
        $entries = @(Get-Content -LiteralPath $checksums | Where-Object { $_ -match ('^[0-9a-fA-F]{64}\s+' + [regex]::Escape($asset) + '$') })
        if ($entries.Count -ne 1) { throw "Missing or invalid checksum for $asset." }
        $expected = ($entries[0] -split '\s+')[0]
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) { throw "Checksum mismatch for $asset." }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::OpenRead($archive)
        try {
            foreach ($entry in $zip.Entries) {
                $entryName = $entry.FullName.Replace('\', '/')
                if (-not $entryName.StartsWith("$directory/") -or $entryName -match '(^|/)\.\.(/|$)') {
                    throw 'The archive contains unexpected paths.'
                }
            }
        } finally { $zip.Dispose() }
        Expand-Archive -LiteralPath $archive -DestinationPath $stage
        $launcher = Join-Path $stage "$directory/bin/ragents.cmd"
        if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'The archive has no bin/ragents.cmd.' }
        & $launcher --help | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'The downloaded application could not start.' }
        Move-Item -LiteralPath (Join-Path $stage $directory) -Destination $destination
        if (-not (Initialize-Version $destination)) {
            [IO.Directory]::Delete($destination, $true)
            throw 'The downloaded application could not be prepared.'
        }
    } else {
        & (Join-Path $destination 'bin/ragents.cmd') --help | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "The existing installation at $destination could not start." }
        if (-not (Initialize-Version $destination)) { throw "The existing installation at $destination could not be prepared." }
    }

    $shim = Join-Path $stage 'ragents.cmd'
    [IO.File]::WriteAllText($shim, "@echo off`r`nsetlocal DisableDelayedExpansion`r`n`"%~dp0..\versions\$directory\bin\ragents.cmd`" %*`r`n", [Text.Encoding]::ASCII)
    if (Test-Path -LiteralPath $command) {
        [IO.File]::Replace($shim, $command, (Join-Path $stage 'previous-ragents.cmd'))
    } else {
        [IO.File]::Move($shim, $command)
    }
    if (-not $NoPathUpdate) { Set-PathEntry $true }
    if ($bin -notin ($env:Path -split ';')) { $env:Path = "$bin;$env:Path" }
    $audience = if ($Global) { 'all users' } else { 'the current user' }
    Write-Output "Installed RAgents $Version for $audience in $Prefix."
    if ($NoPathUpdate) { Write-Output "Add $bin to your PATH, or run $command." }
    else {
        $pathScope = if ($Global) { 'machine' } else { 'user' }
        Write-Output "The $pathScope PATH contains $bin. Open a new terminal, then run: ragents --help"
    }
    Write-Others
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    $lock.Dispose()
}
