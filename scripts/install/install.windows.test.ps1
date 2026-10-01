$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('ragents-install-test-' + [Guid]::NewGuid().ToString('N'))
$prefix = Join-Path $root "install with spaces and 'quotes'"
$installer = Join-Path $PSScriptRoot 'install.ps1'
$downloads = [System.Collections.Generic.List[string]]::new()
$latestVersion = '1.0.0'
$env:PROCESSOR_ARCHITEW6432 = ''
$env:PROCESSOR_ARCHITECTURE = 'AMD64'

function Assert-True($Condition, $Message) {
    if (-not $Condition) { throw $Message }
}

function New-Release($Version, [switch] $Corrupt, [switch] $Broken, $Architecture = 'x64') {
    $directory = "ragents-$Version-win32-$Architecture"
    $build = Join-Path $root "build-$Version"
    $bin = Join-Path $build "$directory/bin"
    $release = Join-Path $root "releases/$Version"
    New-Item -ItemType Directory -Path $bin, $release -Force | Out-Null
    $body = if ($Broken) { '@exit /b 9' } else { "@echo $Version`r`n@exit /b 0" }
    Set-Content -LiteralPath (Join-Path $bin 'ragents.cmd') -Value $body -Encoding Ascii
    $asset = "$directory.zip"
    $archive = Join-Path $release $asset
    Compress-Archive -LiteralPath (Join-Path $build $directory) -DestinationPath $archive
    $hash = if ($Corrupt) { '0' * 64 } else { (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash }
    Set-Content -LiteralPath (Join-Path $release 'SHA256SUMS') -Value "$hash  $asset" -Encoding Ascii
}

function Invoke-WebRequest {
    param($Uri, $Method, $OutFile, [switch] $UseBasicParsing)
    $downloads.Add([string]$Uri)
    if ($Uri.EndsWith('/latest')) {
        return @{ BaseResponse = @{ RequestMessage = @{ RequestUri = [Uri]"https://github.com/SchlenkR/RAgents/releases/tag/v$latestVersion" } } }
    }
    if ($Uri -notmatch '/download/v([^/]+)/(.+)$') { throw "Unexpected download: $Uri" }
    Copy-Item -LiteralPath (Join-Path $root "releases/$($Matches[1])/$($Matches[2])") -Destination $OutFile
}

try {
    New-Release '1.0.0'
    & $installer -Prefix $prefix -NoPathUpdate
    Assert-True (($downloads | Where-Object { $_.EndsWith('/latest') }).Count -eq 1) 'Latest must resolve once.'
    Assert-True ((& (Join-Path $prefix 'bin/ragents.cmd')) -eq '1.0.0') 'Installed command must work with spaces in its path.'
    New-Release '1.1.0'
    & $installer -Prefix $prefix -Version 'v1.1.0' -NoPathUpdate
    Assert-True ((& (Join-Path $prefix 'bin/ragents.cmd')) -eq '1.1.0') 'Update did not activate the new version.'
    Assert-True (Test-Path -LiteralPath (Join-Path $prefix 'versions/ragents-1.0.0-win32-x64')) 'Update removed the previous version.'
    $before = $downloads.Count
    & $installer -Prefix $prefix -Version '1.1.0' -NoPathUpdate
    Assert-True ($downloads.Count -eq $before) 'Existing versions must not be downloaded again.'
    New-Release '1.2.0' -Corrupt
    try { & $installer -Prefix $prefix -Version '1.2.0' -NoPathUpdate; throw 'Accepted corrupt archive.' }
    catch { if ($_ -notmatch 'Checksum mismatch') { throw } }
    New-Release '1.3.0' -Broken
    try { & $installer -Prefix $prefix -Version '1.3.0' -NoPathUpdate; throw 'Accepted broken application.' }
    catch { if ($_ -notmatch 'could not start') { throw } }
    Assert-True ((& (Join-Path $prefix 'bin/ragents.cmd')) -eq '1.1.0') 'A failed update replaced the active version.'
    Assert-True ((Get-ChildItem -LiteralPath (Join-Path $prefix 'versions')).Count -eq 2) 'Failed updates left version directories behind.'
    New-Release '2.0.0' -Architecture 'arm64'
    $env:PROCESSOR_ARCHITECTURE = 'ARM64'
    & $installer -Prefix $prefix -Version '2.0.0' -NoPathUpdate
    Assert-True (Test-Path -LiteralPath (Join-Path $prefix 'versions/ragents-2.0.0-win32-arm64')) 'ARM64 selected the wrong archive.'
} finally {
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
