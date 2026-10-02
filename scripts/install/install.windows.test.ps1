$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('ragents-install-test-' + [Guid]::NewGuid().ToString('N'))
$prefix = Join-Path $root "install with spaces and 'quotes'"
$installer = Join-Path $PSScriptRoot 'install.ps1'
$downloads = [System.Collections.Generic.List[string]]::new()
$latestVersion = '1.0.0'
$env:PROCESSOR_ARCHITEW6432 = ''
$env:PROCESSOR_ARCHITECTURE = 'AMD64'
if (-not $env:TEST_NODE) { throw 'TEST_NODE must name the node.exe that the fixture releases carry.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Assert-True($Condition, $Message) {
    if (-not $Condition) { throw $Message }
}

function Assert-Rejected([scriptblock] $Call, [string] $Expected) {
    $accepted = $true
    try { & $Call | Out-Null } catch { $accepted = $false; if ($_ -notmatch $Expected) { throw } }
    if ($accepted) { throw "The installer accepted a call that must fail with: $Expected" }
}

function New-Release($Version, [switch] $Corrupt, [switch] $Broken, [switch] $Unprepared, $Architecture = 'x64') {
    $directory = "ragents-$Version-win32-$Architecture"
    $build = Join-Path $root "build-$Version"
    $bundle = Join-Path $build $directory
    $release = Join-Path $root "releases/$Version"
    New-Item -ItemType Directory -Path (Join-Path $bundle 'bin'), (Join-Path $bundle 'runtime'), (Join-Path $bundle 'app/scripts/package'), $release -Force | Out-Null
    $body = if ($Broken) { '@exit /b 9' } else { "@echo $Version`r`n@exit /b 0" }
    Set-Content -LiteralPath (Join-Path $bundle 'bin/ragents.cmd') -Value $body -Encoding Ascii
    if (-not $Corrupt -and -not $Broken) { Copy-Item -LiteralPath $env:TEST_NODE -Destination (Join-Path $bundle 'runtime/node.exe') }
    $links = if ($Unprepared) { 'export const ensureHostLinks = () => { throw new Error("links failed"); };' }
        else { "import { writeFileSync } from 'node:fs';`nimport { join } from 'node:path';`nexport const ensureHostLinks = (root) => writeFileSync(join(root, 'linked'), root);" }
    Set-Content -LiteralPath (Join-Path $bundle 'app/scripts/package/host-links.mjs') -Value $links -Encoding Ascii
    $asset = "$directory.zip"
    $archive = Join-Path $release $asset
    [IO.Compression.ZipFile]::CreateFromDirectory($bundle, $archive, [IO.Compression.CompressionLevel]::NoCompression, $true)
    $hash = if ($Corrupt) { '0' * 64 } else { (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash }
    Add-Content -LiteralPath (Join-Path $release 'SHA256SUMS') -Value "$hash  $asset" -Encoding Ascii
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
    $installed = & $installer -Prefix $prefix -NoPathUpdate
    Assert-True ($installed -contains "Installed RAgents 1.0.0 for the current user in $prefix.") "Unexpected output: $installed"
    Assert-True (($downloads | Where-Object { $_.EndsWith('/latest') }).Count -eq 1) 'Latest must resolve once.'
    Assert-True ((& (Join-Path $prefix 'bin/ragents.cmd')) -eq '1.0.0') 'Installed command must work with spaces in its path.'
    $app = Join-Path (Join-Path (Join-Path $prefix 'versions') 'ragents-1.0.0-win32-x64') 'app'
    Assert-True ((Get-Content -Raw -LiteralPath (Join-Path $app 'linked')) -eq $app) 'The installer must prepare the version in its final folder.'
    New-Release '1.1.0'
    & $installer -Prefix $prefix -Version 'v1.1.0' -NoPathUpdate | Out-Null
    Assert-True ((& (Join-Path $prefix 'bin/ragents.cmd')) -eq '1.1.0') 'Update did not activate the new version.'
    Assert-True (Test-Path -LiteralPath (Join-Path $prefix 'versions/ragents-1.0.0-win32-x64')) 'Update removed the previous version.'
    $before = $downloads.Count
    & $installer -Prefix $prefix -Version '1.1.0' -NoPathUpdate | Out-Null
    Assert-True ($downloads.Count -eq $before) 'Existing versions must not be downloaded again.'
    New-Release '1.2.0' -Corrupt
    Assert-Rejected { & $installer -Prefix $prefix -Version '1.2.0' -NoPathUpdate } 'Checksum mismatch'
    New-Release '1.3.0' -Broken
    Assert-Rejected { & $installer -Prefix $prefix -Version '1.3.0' -NoPathUpdate } 'could not start'
    New-Release '1.4.0' -Unprepared
    Assert-Rejected { & $installer -Prefix $prefix -Version '1.4.0' -NoPathUpdate } 'could not be prepared'
    Assert-True ((& (Join-Path $prefix 'bin/ragents.cmd')) -eq '1.1.0') 'A failed update replaced the active version.'
    Assert-True ((Get-ChildItem -LiteralPath (Join-Path $prefix 'versions')).Count -eq 2) 'Failed updates left version directories behind.'
    New-Release '2.0.0' -Architecture 'arm64'
    $env:PROCESSOR_ARCHITECTURE = 'ARM64'
    & $installer -Prefix $prefix -Version '2.0.0' -NoPathUpdate | Out-Null
    Assert-True (Test-Path -LiteralPath (Join-Path $prefix 'versions/ragents-2.0.0-win32-arm64')) 'ARM64 selected the wrong archive.'
    $env:PROCESSOR_ARCHITECTURE = 'AMD64'

    $foreign = Join-Path $root 'foreign'
    New-Item -ItemType Directory -Path (Join-Path $foreign 'bin') | Out-Null
    Set-Content -LiteralPath (Join-Path $foreign 'bin/ragents.cmd') -Value '@echo npm' -Encoding Ascii
    $before = $downloads.Count
    Assert-Rejected { & $installer -Prefix $foreign -Version '1.1.0' -NoPathUpdate } 'was not created by this installer'
    Assert-True ($downloads.Count -eq $before) 'A refused installation must not download.'

    $removed = & $installer -Prefix $prefix -Uninstall -NoPathUpdate
    Assert-True ($removed -contains "Removed RAgents from $prefix. Settings and runs stay in %LOCALAPPDATA%\ragents of each user.") "Unexpected output: $removed"
    Assert-True (-not (Test-Path -LiteralPath $prefix)) 'Uninstall left the installation folder behind.'
    Assert-True ((& $installer -Prefix $prefix -Uninstall -NoPathUpdate) -contains "No RAgents installation in $prefix.") 'A second uninstall must find nothing.'

    $global = Join-Path $root 'global'
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $installed = & $installer -Global -Prefix $global -Version '1.1.0' -NoPathUpdate
        Assert-True ($installed -contains "Installed RAgents 1.1.0 for all users in $global.") "Unexpected output: $installed"
        Assert-True ((& (Join-Path $global 'bin/ragents.cmd')) -eq '1.1.0') 'The global installation does not start.'
        & $installer -Global -Prefix $global -Uninstall -NoPathUpdate | Out-Null
        Assert-True (-not (Test-Path -LiteralPath $global)) 'The global uninstall left files behind.'
    } else {
        Assert-Rejected { & $installer -Global -Prefix $global -Version '1.1.0' -NoPathUpdate } 'elevated PowerShell'
        Assert-True (-not (Test-Path -LiteralPath $global)) '-Global without elevation must not write anything.'
    }
} finally {
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
