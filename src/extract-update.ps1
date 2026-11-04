param(
    [Parameter(Mandatory=$true)][string]$Archive,
    [Parameter(Mandatory=$true)][string]$Destination,
    [Parameter(Mandatory=$true)][string]$Prefix
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath($Destination).TrimEnd('\')
if (Test-Path -LiteralPath $root) { throw 'Update destination already exists' }
$null = [IO.Directory]::CreateDirectory($root)
$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
    if ($zip.Entries.Count -gt 2048) { throw 'Too many files in update' }
    $total = 0L
    foreach ($entry in $zip.Entries) {
        if (-not $entry.FullName.StartsWith($Prefix, [StringComparison]::Ordinal)) { throw 'Unexpected archive root' }
        $relative = $entry.FullName.Substring($Prefix.Length)
        if (-not $relative) { continue }
        $directory = $relative.EndsWith('/')
        $parts = $relative.TrimEnd('/').Split('/')
        foreach ($part in $parts) {
            if (-not $part -or $part -in @('.', '..', '.git', 'runtime') -or $part -match '[\\:<>|?*"\x00-\x1f]|[ .]$|^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\.|$)') {
                throw 'Unsafe path in update'
            }
        }
        $target = [IO.Path]::GetFullPath((Join-Path $root ($parts -join '\')))
        if (-not $target.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Update path escapes destination' }
        if ($directory) {
            $null = [IO.Directory]::CreateDirectory($target)
            continue
        }
        $total += $entry.Length
        if ($total -gt 64MB) { throw 'Expanded update is too large' }
        $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
        # Extract as regular files. CreateNew semantics reject collisions on Windows.
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
    }
} finally {
    $zip.Dispose()
}
