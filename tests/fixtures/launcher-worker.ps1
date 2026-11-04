param($SourceRoot,$FixtureRoot)
$ErrorActionPreference = 'Stop'
. (Join-Path $SourceRoot 'scripts\Lifecycle.ps1')
function Get-Command { param($Name) if ($Name -eq 'node.exe') { [pscustomobject]@{Source='C:\fake\node.exe'} } }
function Get-AppxPackage { [pscustomobject]@{InstallLocation='C:\fake';Version=[version]'1.0'} }
function Test-Path { return $true }
function Get-MeterEndpoint {
    $ready=[IO.File]::Exists((Join-Path $FixtureRoot 'client.ready'))
    [pscustomobject]@{State=$(if($ready){'ready'}else{'free'});Owner=123}
}
function Get-MeterClientProcesses { return @() }
function Get-MeterHelper {
    if ([IO.File]::Exists((Join-Path $FixtureRoot 'helper.ready'))) { [pscustomobject]@{state='running';debugPort=9339;pid=456} }
}
function Start-Process { param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,[switch]$PassThru)
    if ($FilePath -like '*ChatGPT.exe') {
        [IO.File]::AppendAllText((Join-Path $FixtureRoot 'launches.txt'),"client`n")
        Start-Sleep -Milliseconds 800
        [IO.File]::WriteAllText((Join-Path $FixtureRoot 'client.ready'),'ready')
    } else {
        [IO.File]::AppendAllText((Join-Path $FixtureRoot 'launches.txt'),"helper`n")
        [IO.File]::WriteAllText((Join-Path $FixtureRoot 'helper.ready'),'ready')
        [pscustomobject]@{HasExited=$false;Id=456}
    }
}
Invoke-MeterLauncher -Root $FixtureRoot
