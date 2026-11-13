$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$version = '0.1.22'
$project = Join-Path $root 'mods\pcvr\RiftPulse.Pcvr.csproj'
$manifestPath = Join-Path $root 'mods\pcvr\manifest.json'
$built = Join-Path $root 'mods\pcvr\bin\Release\net472\RiftPulse.Pcvr.dll'
$downloads = Join-Path $root 'public\downloads'
# Remove obsolete loose metadata and packages that can cause duplicate manifest discovery.
foreach ($legacyFile in @('manifest.json', 'RiftPulse.Pcvr.manifest.json', 'RiftPulse.Pcvr-0.1.14.zip', 'RiftPulse.Pcvr-0.1.15.zip', 'RiftPulse.Pcvr-0.1.16.zip', 'RiftPulse.Pcvr-0.1.17.zip', 'RiftPulse.Pcvr-0.1.18.zip', 'RiftPulse.Pcvr-0.1.19.zip')) {
    $legacyPath = Join-Path $downloads $legacyFile
    if (Test-Path $legacyPath) { Remove-Item $legacyPath -Force }
}
$install = 'C:\Users\chris\BSManager\BSInstances\1.40.8\Plugins'

# Build the exact source that will be packaged.
dotnet build $project -c Release
if ($LASTEXITCODE -ne 0) { throw 'PCVR build failed.' }

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ($manifest.version -ne $version) { throw "Manifest version $($manifest.version) does not match $version." }

# Validate BSML component/action IDs against the controller before publishing.
$bsmlPath = Join-Path $root 'mods\pcvr\pairing.bsml'
$controllerPath = Join-Path $root 'mods\pcvr\RiftPulseFlowCoordinator.cs'
$bsmlText = Get-Content $bsmlPath -Raw
$controllerText = Get-Content $controllerPath -Raw
foreach ($componentId in @('pairingCodeText', 'statusText', 'connectButton', 'chatToggleButton', 'bsrToggleButton', 'modulePreviewStatus')) {
    if ($bsmlText -notmatch ('id="' + [regex]::Escape($componentId) + '"')) {
        throw "BSML component ID missing: $componentId"
    }
    if ($controllerText -notmatch ('UIComponent\("' + [regex]::Escape($componentId) + '"\)')) {
        throw "Controller has no UIComponent binding for: $componentId"
    }
}
foreach ($actionId in @('connect-click', 'toggle-chat', 'toggle-bsr', 'move-chat-panel')) {
    if ($bsmlText -notmatch ('on-click="' + [regex]::Escape($actionId) + '"')) {
        throw "BSML click action missing: $actionId"
    }
    if ($controllerText -notmatch ('UIAction\("' + [regex]::Escape($actionId) + '"\)')) {
        throw "Controller has no UIAction for: $actionId"
    }
}
if ($bsmlText -match '\{(pairing-code|status-text|chat-toggle-label|bsr-toggle-label|module-preview-status)\}') {
    throw 'BSML contains unsupported property interpolation placeholders.'
}
Copy-Item $built (Join-Path $downloads 'RiftPulse.Pcvr.dll') -Force

# BSIPA requires the plugin manifest as an embedded DLL resource. Do not ship
# a second loose manifest: it can be installed into Plugins and shadow the DLL.
$assembly = [Reflection.Assembly]::LoadFile($built)
$resources = @($assembly.GetManifestResourceNames())
if (-not ($resources -contains 'RiftPulse.Pcvr.manifest.json')) {
    throw "Embedded BSIPA manifest missing. Found: $($resources -join ', ')"
}
if (-not ($resources -contains 'RiftPulse.Pcvr.pairing.bsml')) {
    throw "Embedded pairing BSML missing. Found: $($resources -join ', ')"
}

# The ZIP mirrors the Beat Saber game root. It contains only the plugin DLL
# under Plugins and its README; there is intentionally no loose manifest.json.
$stage = Join-Path $root "dist\pcvr-package-$version"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $stage 'Plugins') -Force | Out-Null
Copy-Item $built (Join-Path $stage 'Plugins\RiftPulse.Pcvr.dll') -Force
Copy-Item (Join-Path $downloads 'PCVR-README.txt') (Join-Path $stage 'README.txt') -Force

$versionedZip = Join-Path $downloads "RiftPulse.Pcvr-$version.zip"
$stableZip = Join-Path $downloads 'RiftPulse.Pcvr.zip'
foreach ($zip in @($versionedZip, $stableZip)) {
    if (Test-Path $zip) { Remove-Item $zip -Force }
}
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $versionedZip -CompressionLevel Optimal
Copy-Item $versionedZip $stableZip -Force

# Move aside only old RiftPulse manifests. Leave unrelated files untouched.
foreach ($name in @('manifest.json', 'RiftPulse.Pcvr.manifest', 'RiftPulse.Pcvr.manifest.json')) {
    $sidecar = Join-Path $install $name
    if (Test-Path $sidecar) {
        $belongsToRiftPulse = $false
        try {
            $candidate = Get-Content $sidecar -Raw | ConvertFrom-Json
            $belongsToRiftPulse = $candidate.id -eq 'RiftPulse.Pcvr'
        } catch { }
        if ($belongsToRiftPulse) {
            $backup = "$sidecar.disabled-backup-$version"
            if (Test-Path $backup) { Remove-Item $backup -Force }
            Move-Item $sidecar $backup -Force
        }
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

# Verify archive structure and reject all external manifest files.
$entries = @(& tar -tf $versionedZip)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect PCVR ZIP.' }
if ($entries -notcontains 'Plugins/RiftPulse.Pcvr.dll') { throw 'ZIP Plugins DLL missing.' }
if ($entries -notcontains 'README.txt') { throw 'ZIP README missing.' }
if ($entries | Where-Object { $_ -match '(^|/)manifest\.json$|RiftPulse\.Pcvr\.manifest' }) {
    throw 'ZIP contains a loose manifest; BSIPA manifest must remain embedded in the DLL.'
}

Write-Output "PCVR $version build, package, and install verified."
Write-Output "DLL SHA256: $builtHash"
Write-Output "ZIP SHA256: $((Get-FileHash $versionedZip -Algorithm SHA256).Hash)"
Write-Output "ZIP entries: $($entries -join ', ')"
Write-Output "Embedded resources: $($resources -join ', ')"
