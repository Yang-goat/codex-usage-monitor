param([string]$Archive, [string]$ExtraEntry)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($Archive, [IO.Compression.ZipArchiveMode]::Create)
try {
    $files = [ordered]@{
        'package.json' = '{"name":"codex-usage-monitor","version":"0.1.5"}'
        'src/main.mjs' = 'export {};'
        'src/renderer.js' = '(() => {})();'
        'src/restart.mjs' = 'export {};'
    }
    if ($ExtraEntry) { $files[$ExtraEntry] = 'unsafe' }
    foreach ($name in $files.Keys) {
        $entry = $zip.CreateEntry('codex-usage-monitor-v0.1.5/' + $name)
        $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
        try { $writer.Write($files[$name]) } finally { $writer.Dispose() }
    }
} finally {
    $zip.Dispose()
}
