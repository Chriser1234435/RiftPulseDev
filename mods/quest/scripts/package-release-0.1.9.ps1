$ErrorActionPreference='Stop'
$root='C:\Users\chris\Documents\RiftPulse Development\workspace\RiftPulseDev'
$q=Join-Path $root 'mods\quest'
$out=Join-Path $root 'public\downloads\RiftPulse.Quest.qmod'
$stage=Join-Path $q 'release-stage-0.1.12'
if(Test-Path $stage){Remove-Item $stage -Recurse -Force}
New-Item -ItemType Directory $stage -Force|Out-Null
Copy-Item (Join-Path $q 'mod.json') (Join-Path $stage 'mod.json') -Force
Copy-Item (Join-Path $q 'build\libriftpulse.so') (Join-Path $stage 'libriftpulse.so') -Force
if(Test-Path $out){Remove-Item $out -Force}
$tempZip=Join-Path $q 'RiftPulse.Quest.0.1.12.zip'
if(Test-Path $tempZip){Remove-Item $tempZip -Force}
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $tempZip -CompressionLevel Optimal
Move-Item $tempZip $out -Force
$entries=tar -tf $out
if(-not ($entries -contains 'mod.json')){throw 'mod.json missing from QMOD'}
if(-not ($entries -contains 'libriftpulse.so')){throw 'libriftpulse.so missing from QMOD'}
$meta=Get-Content (Join-Path $stage 'mod.json') -Raw|ConvertFrom-Json
if($meta.version -ne '0.1.12'){throw 'Unexpected Quest package version'}
Write-Output "Quest 0.1.12 QMOD built at $out"
Write-Output "QMOD SHA256: $((Get-FileHash $out -Algorithm SHA256).Hash)"
Write-Output "Archive entries: $($entries -join ', ')"
