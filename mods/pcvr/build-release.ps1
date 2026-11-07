$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$version = '0.1.15'
$project = Join-Path $root 'mods\pcvr\RiftPulse.Pcvr.csproj'
$manifestPath = Join-Path $root 'mods\pcvr\manifest.json'
$built = Join-Path $root 'mods\pcvr\bin\Release\net472\RiftPulse.Pcvr.dll'
$downloads = Join-Path $root 'public\downloads'
$install = 'C:\Users\chris\BSManager\BSInstances\1.40.8\Plugins'

# Build the exact source that will be packaged.
dotnet build $project -c Release
if ($LASTEXITCODE -ne 0) { throw 'PCVR build failed.' }

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ($manifest.version -ne $version) { throw "Manifest version $($manifest.version) does not match $version." }
Copy-Item $built (Join-Path $downloads 'RiftPulse.Pcvr.dll') -Force
Copy-Item $manifestPath (Join-Path $downloads 'RiftPulse.Pcvr.manifest.json') -Force
$assembly = [Reflection.Assembly]::LoadFile($built)
$resources = @($assembly.GetManifestResourceNames())
if (-not ($resources -contains 'RiftPulse.Pcvr.manifest.json')) {
    throw "Embedded BSIPA manifest missing. Found: $($resources -join ', ')"
}
if (-not ($resources -contains 'RiftPulse.Pcvr.pairing.bsml')) {
    throw "Embedded pairing BSML missing. Found: $($resources -join ', ')"
}

# Build a clean archive: package manifest at the root, DLL under Plugins, and README.
$stage = Join-Path $root "dist\pcvr-package-$version"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $stage 'Plugins') -Force | Out-Null
Copy-Item $manifestPath (Join-Path $stage 'manifest.json') -Force
Copy-Item $built (Join-Path $stage 'Plugins\RiftPulse.Pcvr.dll') -Force
Copy-Item (Join-Path $downloads 'PCVR-README.txt') (Join-Path $stage 'README.txt') -Force

$versionedZip = Join-Path $downloads "RiftPulse.Pcvr-$version.zip"
$stableZip = Join-Path $downloads 'RiftPulse.Pcvr.zip'
foreach ($zip in @($versionedZip, $stableZip)) {
    if (Test-Path $zip) { Remove-Item $zip -Force }
}
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $versionedZip -CompressionLevel Optimal
Copy-Item $versionedZip $stableZip -Force

# Retire stale sidecar manifests that duplicate the manifest embedded in the DLL.
foreach ($name in @('RiftPulse.Pcvr.manifest', 'RiftPulse.Pcvr.manifest.json')) {
    $sidecar = Join-Path $install $name
    if (Test-Path $sidecar) {
        $backup = "$sidecar.disabled-backup-$version"
        if (Test-Path $backup) { Remove-Item $backup -Force }
        Move-Item $sidecar $backup -Force
    }
}

# Install the same DLL that is in the ZIP; retain a rollback copy.
$installedDll = Join-Path $install 'RiftPulse.Pcvr.dll'
if (Test-Path $installedDll) {
    Copy-Item $installedDll "$installedDll.backup-before-$version" -Force
}
Copy-Item $built $installedDll -Force
$builtHash = (Get-FileHash $built -Algorithm SHA256).Hash
$installedHash = (Get-FileHash $installedDll -Algorithm SHA256).Hash
if ($builtHash -ne $installedHash) { throw 'Installed DLL hash differs from build output.' }

# Verify the archive structure and ensure it does not contain a Plugins sidecar manifest.
$entries = @(& tar -tf $versionedZip)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect PCVR ZIP.' }
if ($entries -notcontains 'manifest.json') { throw 'ZIP root manifest missing.' }
if ($entries -notcontains 'Plugins/RiftPulse.Pcvr.dll') { throw 'ZIP Plugins DLL missing.' }
if ($entries -contains 'Plugins/RiftPulse.Pcvr.manifest') { throw 'ZIP contains duplicate Plugins manifest.' }

Write-Output "PCVR $version build, package, and install verified."
Write-Output "DLL SHA256: $builtHash"
Write-Output "ZIP SHA256: $((Get-FileHash $versionedZip -Algorithm SHA256).Hash)"
Write-Output "ZIP entries: $($entries -join ', ')"
Write-Output "Embedded resources: $($resources -join ', ')"
