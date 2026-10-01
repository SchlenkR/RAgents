param(
    [string] $Version,
    [string] $Prefix = (Join-Path $env:LOCALAPPDATA 'Programs/RAgents'),
    [switch] $NoPathUpdate,
    [switch] $Help
)

$ErrorActionPreference = 'Stop'

if ($Help) {
    Write-Output 'Usage: install.ps1 [-Version VERSION] [-Prefix DIRECTORY] [-NoPathUpdate]'
    Write-Output 'Defaults: latest release, %LOCALAPPDATA%/Programs/RAgents. No administrator access required.'
    return
}

if ($env:OS -ne 'Windows_NT') { throw 'This installer requires Windows. On macOS or Linux, use install.sh.' }
if (-not [IO.Path]::IsPathRooted($Prefix)) { throw 'The installation prefix must be an absolute path.' }
$architecture = $env:PROCESSOR_ARCHITEW6432
if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
$targetArchitecture = switch ($architecture) {
    'AMD64' { 'x64' }
    'ARM64' { 'arm64' }
    default { throw 'Supported architectures: x64 and arm64.' }
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$releases = 'https://github.com/SchlenkR/RAgents/releases'
if (-not $Version) {
    $response = Invoke-WebRequest -Uri "$releases/latest" -Method Head -UseBasicParsing
    $latest = $response.BaseResponse.ResponseUri
    if (-not $latest) { $latest = $response.BaseResponse.RequestMessage.RequestUri }
    $releasePrefix = "$releases/tag/v"
    if (-not $latest -or -not $latest.AbsoluteUri.StartsWith($releasePrefix)) { throw 'Could not resolve the latest release.' }
    $Version = $latest.AbsoluteUri.Substring($releasePrefix.Length)
}
$Version = $Version -replace '^v', ''
if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?\z') { throw 'Invalid version. Expected a version such as 0.1.0.' }

$directory = "ragents-$Version-win32-$targetArchitecture"
$asset = "$directory.zip"
$versions = Join-Path $Prefix 'versions'
$destination = Join-Path $versions $directory
$bin = Join-Path $Prefix 'bin'
New-Item -ItemType Directory -Path $versions, $bin -Force | Out-Null
$lockPath = Join-Path $Prefix '.install-lock'
try {
    $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch {
    throw "Another installation is active: $lockPath"
}
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
    } else {
        & (Join-Path $destination 'bin/ragents.cmd') --help | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "The existing installation at $destination could not start." }
    }

    $shim = Join-Path $stage 'ragents.cmd'
    $command = Join-Path $bin 'ragents.cmd'
    [IO.File]::WriteAllText($shim, "@echo off`r`nsetlocal DisableDelayedExpansion`r`n`"%~dp0..\versions\$directory\bin\ragents.cmd`" %*`r`n", [Text.Encoding]::ASCII)
    if (Test-Path -LiteralPath $command) {
        [IO.File]::Replace($shim, $command, $null)
    } else {
        [IO.File]::Move($shim, $command)
    }
    $userPath = [string][Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $NoPathUpdate -and $bin -notin ($userPath -split ';')) {
        [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ';' + $bin).TrimStart(';')), 'User')
    }
    if ($bin -notin ($env:Path -split ';')) { $env:Path = "$bin;$env:Path" }
    Write-Output "Installed RAgents $Version. Run: ragents --help"
    if ($NoPathUpdate) { Write-Output "Add this directory to your PATH: $bin" }
    else { Write-Output 'The user PATH is configured. Open a new terminal to use it.' }
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    $lock.Dispose()
}
