$ErrorActionPreference = 'Stop'
$root = 'C:\Users\chris\Documents\RiftPulse Development\workspace\RiftPulseDev'
$q = Join-Path $root 'mods\quest'
$downloads = Join-Path $root 'public\downloads'
$version = '0.1.39'
$manifestPath = Join-Path $q 'mod.json'
$libPath = Join-Path $q 'build\libriftpulse.so'
$out = Join-Path $downloads "RiftPulse-Quest-$version-Alpha.qmod"
$stable = Join-Path $downloads 'RiftPulse.Quest.qmod'
$sourceMod = [IO.File]::ReadAllText($manifestPath)
$meta = $sourceMod | ConvertFrom-Json
if ($meta.version -ne $version) { throw "Manifest version is $($meta.version), expected $version" }
if (-not (Test-Path $libPath)) { throw 'Quest library not found; compile before packaging.' }

# A QMOD is a ZIP container. Write UTF-8 mod.json without a BOM and include
# only the native ARM64 library and manifest, never a generic ZIP download.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($target in @($out, $stable)) {
  if (Test-Path $target) { Remove-Item $target -Force }
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
$stream = [IO.File]::Open($out, [IO.FileMode]::CreateNew)
try {
  $archive = New-Object System.IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    $entry = $archive.CreateEntry('mod.json', [IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    try {
      $bytes = $utf8.GetBytes($sourceMod.TrimStart([char]0xFEFF))
      $entryStream.Write($bytes, 0, $bytes.Length)
    } finally { $entryStream.Dispose() }
    $entry = $archive.CreateEntry('libriftpulse.so', [IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    $libStream = [IO.File]::OpenRead($libPath)
    try { $libStream.CopyTo($entryStream) } finally { $libStream.Dispose(); $entryStream.Dispose() }
  } finally { $archive.Dispose() }
} finally { $stream.Dispose() }
Copy-Item $out $stable -Force

# Independently parse the embedded manifest and inspect all package members.
$check = [IO.Compression.ZipFile]::OpenRead($out)
try {
  $entry = $check.GetEntry('mod.json')
  if (-not $entry) { throw 'mod.json is missing in QMOD' }
  $reader = New-Object IO.StreamReader($entry.Open(), $utf8, $false)
  try { $json = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  if ($json.version -ne $version) { throw 'Embedded version mismatch' }
  $names = @($check.Entries | ForEach-Object FullName | Sort-Object)
  if ($names.Count -ne 2 -or $names -notcontains 'mod.json' -or $names -notcontains 'libriftpulse.so') {
    throw "Unexpected QMOD entries: $($names -join ', ')"
  }
  $manifestBytes = New-Object byte[] 3
  $entryStream = $check.GetEntry('mod.json').Open()
  try { [void]$entryStream.Read($manifestBytes, 0, 3) } finally { $entryStream.Dispose() }
  if ($manifestBytes[0] -eq 0xEF -and $manifestBytes[1] -eq 0xBB -and $manifestBytes[2] -eq 0xBF) {
    throw 'Embedded mod.json has a UTF-8 BOM'
  }
  Write-Output "Quest QMOD $version packaged and verified."
  Write-Output "Entries: $($names -join ', ')"
  Write-Output "Versioned SHA256: $((Get-FileHash $out -Algorithm SHA256).Hash)"
  Write-Output "Stable SHA256: $((Get-FileHash $stable -Algorithm SHA256).Hash)"
} finally { $check.Dispose() }
