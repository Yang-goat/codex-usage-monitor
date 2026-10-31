# Synthetic install/restore tests. All shortcuts and fake clients stay under runtime/.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$fixture = Join-Path $repo ('runtime\scripts-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
$node = (Get-Command node.exe -ErrorAction Stop).Source
$envBefore = @{}
foreach ($name in @('CODEX_METER_PORT','CODEX_METER_CLI','CODEX_METER_RUNTIME')) { $envBefore[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
New-Item -ItemType Directory -Path $fixture -Force | Out-Null
$client = Join-Path $fixture 'client\ChatGPT.exe'
New-Item -ItemType Directory -Path (Join-Path $fixture 'client\resources') -Force | Out-Null
[IO.File]::WriteAllText($client,'synthetic client - never executed')
[IO.File]::WriteAllText((Join-Path $fixture 'client\resources\app.asar'),'synthetic marker')
$fakeCli = Join-Path $fixture 'fake-cli.exe'
[IO.File]::WriteAllText($fakeCli,'synthetic CLI - never executed')
$shell = New-Object -ComObject WScript.Shell

function Assert($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Expect-Error([scriptblock]$Action) { $caught=$false; try { & $Action } catch { $caught=$true }; Assert $caught 'Expected operation to stop safely.' }
function Get-AppxPackage { param($Name) return $null }
function New-FixtureProject([string]$Name) {
    $project = Join-Path $fixture $Name
    New-Item -ItemType Directory -Path (Join-Path $project 'scripts') -Force | Out-Null
    Copy-Item -Path (Join-Path $repo 'scripts\*.ps1') -Destination (Join-Path $project 'scripts')
    return $project
}
try {
    Get-ChildItem -LiteralPath (Join-Path $repo 'scripts') -Filter '*.ps1' | ForEach-Object {
        $errors=$null
        [System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$null,[ref]$errors) | Out-Null
        Assert (@($errors).Count -eq 0) ('Parse errors in ' + $_.Name)
    }
    # No pre-existing icon: create, remove, reinstall, remove again.
    $new = New-FixtureProject 'new'
    $newLink = Join-Path $new 'Codex.lnk'
    & (Join-Path $new 'scripts\Install.ps1') -AppPath $client -NodePath $node -ShortcutPath $newLink
    Assert (Test-Path -LiteralPath $newLink) 'Missing newly created shortcut.'
    & (Join-Path $new 'scripts\Uninstall.ps1')
    Assert (-not (Test-Path -LiteralPath $newLink)) 'Created shortcut was not removed.'
    & (Join-Path $new 'scripts\Install.ps1') -AppPath $client -NodePath $node -ShortcutPath $newLink
    & (Join-Path $new 'scripts\Uninstall.ps1')

    # Existing verified icon: backup, repeat install, restore exact bytes.
    $existing = New-FixtureProject 'existing'
    $existingLink = Join-Path $existing 'Codex.lnk'
    $link = $shell.CreateShortcut($existingLink); $link.TargetPath=$client; $link.Description='Synthetic original'; $link.Save()
    $originalHash = (Get-FileHash -LiteralPath $existingLink -Algorithm SHA256).Hash
    & (Join-Path $existing 'scripts\Install.ps1') -AppPath $client -NodePath $node -ShortcutPath $existingLink
    & (Join-Path $existing 'scripts\Install.ps1') -AppPath $client -NodePath $node -ShortcutPath $existingLink
    & (Join-Path $existing 'scripts\Uninstall.ps1')
    Assert ((Get-FileHash -LiteralPath $existingLink -Algorithm SHA256).Hash -eq $originalHash) 'Original bytes were not restored.'
    & (Join-Path $existing 'scripts\Install.ps1') -AppPath $client -NodePath $node -ShortcutPath $existingLink
    $link = $shell.CreateShortcut($existingLink); $link.Description='Synthetic later user change'; $link.Save()
    $changedHash = (Get-FileHash -LiteralPath $existingLink -Algorithm SHA256).Hash
    Expect-Error { & (Join-Path $existing 'scripts\Uninstall.ps1') }
    Assert ((Get-FileHash -LiteralPath $existingLink -Algorithm SHA256).Hash -eq $changedHash) 'Later user change was overwritten.'

    # Unknown icon: reject rather than replace it.
    $unknown = New-FixtureProject 'unknown'
    $unknownLink = Join-Path $unknown 'Codex.lnk'
    $link=$shell.CreateShortcut($unknownLink);$link.TargetPath=$node;$link.Save()
    $unknownHash=(Get-FileHash -LiteralPath $unknownLink -Algorithm SHA256).Hash
    Expect-Error { & (Join-Path $unknown 'scripts\Install.ps1') -AppPath $client -NodePath $node -ShortcutPath $unknownLink }
    Assert ((Get-FileHash -LiteralPath $unknownLink -Algorithm SHA256).Hash -eq $unknownHash) 'Unknown icon was overwritten.'

    # Start with and without CLI: only simulated process launches.
    $global:MonitorTestCliAvailable=$false
    function Get-Command { param($Name) if($Name -eq 'codex.exe'){if($global:MonitorTestCliAvailable){return [pscustomobject]@{Source=$fakeCli}};return $null}; Microsoft.PowerShell.Core\Get-Command -Name $Name -ErrorAction SilentlyContinue }
    function Get-NetTCPConnection { }
    function Get-Process { }
    function Start-Process { param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle) $global:MonitorTestLaunches += [pscustomobject]@{File=$FilePath;Style=$WindowStyle} }
    foreach($available in @($false,$true)) {
        $global:MonitorTestCliAvailable=$available;$global:MonitorTestLaunches=@()
        & (Join-Path $new 'scripts\Start.ps1') -AppPath $client -NodePath $node
        Assert ($global:MonitorTestLaunches.Count -eq 2) 'Expected a client and helper launch.'
        Assert ($global:MonitorTestLaunches[0].File -eq $client -and $global:MonitorTestLaunches[0].Style -eq 'Normal') 'Client must launch visibly.'
        Assert ($global:MonitorTestLaunches[1].File -eq $node -and $global:MonitorTestLaunches[1].Style -eq 'Hidden') 'Helper must launch hidden.'
        if($available){Assert ($env:CODEX_METER_CLI -eq $fakeCli) 'CLI path was not passed.'}else{Assert (-not $env:CODEX_METER_CLI) 'Missing CLI must remain optional.'}
    }
    Write-Output 'PASS: parsing, create/remove/reinstall, exact restoration, later-change protection, unknown-icon protection, optional CLI and hidden helper.'
} finally {
    foreach ($name in $envBefore.Keys) { [Environment]::SetEnvironmentVariable($name,$envBefore[$name],'Process') }
    # Keep only synthetic test evidence under the ignored runtime directory.
}
