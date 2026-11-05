$ErrorActionPreference = 'Stop'
$path = 'C:\Users\chris\Documents\RiftPulse Development\workspace\RiftPulseDev\mods\quest\src\main.cpp'
$blockPath = 'C:\Users\chris\Documents\RiftPulse Development\workspace\RiftPulseDev\mods\quest\scripts\network-block.txt'
$utf8 = [System.Text.UTF8Encoding]::new($false)
$nl = [Environment]::NewLine
$raw = [System.IO.File]::ReadAllText($path)
$block = [System.IO.File]::ReadAllText($blockPath)

$start = $raw.IndexOf('static bool SetRequestHeader')
$end = $raw.IndexOf('static std::string JsonString', $start)
if ($start -lt 0 -or $end -lt 0) { throw 'Old UnityWebRequest factory block was not found.' }
$raw = $raw.Substring(0, $start) + $block + $nl + $raw.Substring($end)

$start2 = $raw.IndexOf('static bool SendAsync(UnityWebRequest* request')
$end2 = $raw.IndexOf('static void RefreshModuleButtons', $start2)
if ($start2 -lt 0 -or $end2 -lt 0) { throw 'Old UnityWebRequest SendAsync function was not found.' }
$raw = $raw.Substring(0, $start2) + $raw.Substring($end2)

$alias = 'using RequestCompletion = std::function<void(int64_t, const std::string&)>;'
if ($raw.Contains($alias)) {
  $raw = $raw.Replace($alias + $nl + $nl, '')
}
$marker = 'using UiDispatchDelegate = System::Threading::SendOrPostCallback*;'
if (-not $raw.Contains('using RequestCompletion')) {
  $raw = $raw.Replace($marker, $marker + $nl + $alias)
}
$raw = $raw.Replace('using HttpTextTask = System::Threading::Tasks::Task_1<StringW>*;' + $nl, '')
if ($raw.Contains('UnityWebRequest') -or $raw.Contains('DownloadHandler') -or $raw.Contains('AsyncOperation')) {
  throw 'UnityWebRequest references remain in main.cpp; do not write partial migration.'
}
[System.IO.File]::WriteAllText($path, $raw, $utf8)
Write-Output 'Main Quest transport replaced with System.Net.Http.'
