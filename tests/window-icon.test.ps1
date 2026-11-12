$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
. (Join-Path $repo 'scripts\Common.ps1')
. (Join-Path $repo 'scripts\WindowIcon.ps1')
function Assert($Value,$Message) { if (-not $Value) { throw $Message }; Write-Output "PASS: $Message" }
Add-Type -Path (Join-Path $repo 'scripts\WindowProperties.cs')
$fixture = Join-Path $repo ('runtime\icon-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture -Force | Out-Null
$script:MonitorRuntime = Join-Path $fixture 'runtime'
$source = Join-Path $fixture 'source.ico'
[IO.File]::WriteAllBytes($source,[byte[]](1,2,3))
$client = [pscustomobject]@{Icon=$source;PackageFamily='Test.Package';Exe='C:\fake app\ChatGPT.exe'}
$stable = Get-MonitorStableIcon $client
Assert ((Get-FileHash $stable).Hash -eq (Get-FileHash $source).Hash) 'cached shortcut icon matches source'
[IO.File]::WriteAllBytes($source,[byte[]](4,5,6))
$updated = Get-MonitorStableIcon $client
Assert ($stable -ne $updated -and (Test-Path $stable)) 'package upgrade preserves old icon and caches new content'
$script:launches = @()
function Start-Process { param($FilePath,$ArgumentList,$WindowStyle)
    $script:launches += [pscustomobject]@{File=$FilePath;Args=$ArgumentList;Style=$WindowStyle}
}
$context = [pscustomobject]@{Client=$client.Exe}
Start-MeterWindowIcon $context ([pscustomobject]@{Owner=123}) $client
Assert ($script:launches.Count -eq 1 -and $script:launches[0].Style -eq 'Hidden') 'keeper launches hidden'
Assert ($script:launches[0].Args -contains '"C:\fake app\ChatGPT.exe"' -and $script:launches[0].Args -contains '123') 'launch preserves spaced path and verified PID'
$client.Icon = 'C:\fake app\ChatGPT.exe'
Start-MeterWindowIcon $context ([pscustomobject]@{Owner=123}) $client
Assert ($script:launches.Count -eq 1) 'client without ICO retains executable fallback'

$script:windows = @(10,20)
$script:icons = @{}
$script:props = @{}
$script:writes = 0
function Get-MeterIconWindows($ClientProcessId) { Assert ($ClientProcessId -eq 123) 'enumerates only verified client' | Out-Null; $script:windows }
function Get-MeterWindowIcon($Window,$Kind) { $script:icons["$Window/$Kind"] }
function Set-MeterWindowIcon($Window,$Kind,$Handle) { $script:icons["$Window/$Kind"]=$Handle; $script:writes++ }
function Get-MeterWindowProperty($Window,$Id) { $script:props["$Window/$Id"] }
function Set-MeterWindowProperty($Window,$Id,$Value) { $script:props["$Window/$Id"]=$Value; $script:writes++ }
$properties = @{2='launcher';3='stable.ico,0';4='ChatGPT';5='Test.Package!App'}
Repair-MeterWindowIcons 123 @(100,200) $properties
Assert ($script:writes -eq 12) 'repairs icons and metadata on both windows'
Repair-MeterWindowIcons 123 @(100,200) $properties
Assert ($script:writes -eq 12) 'unchanged windows are not rewritten'
$script:icons['10/0']=999
$script:props['20/3']='stale.ico,0'
Repair-MeterWindowIcons 123 @(100,200) $properties
Assert ($script:writes -eq 14) 'repairs later icon and metadata resets'
$script:windows=@()
Repair-MeterWindowIcons 123 @(100,200) $properties
Assert ($script:writes -eq 14) 'close-to-tray requires no writes'
$script:windows=@(30)
Repair-MeterWindowIcons 123 @(100,200) $properties
Assert ($script:writes -eq 20) 'recreated window receives icons and metadata'
function Get-Process { param($Id,$ErrorAction) [pscustomobject]@{Path='C:\foreign.exe';ProcessName='Other'} }
$rejected=$false
try { & (Join-Path $repo 'scripts\KeepWindowIcon.ps1') -ClientProcessId 987654 -ClientPath 'C:\fake app\ChatGPT.exe' -IconPath $stable } catch { $rejected=$true }
Assert $rejected 'keeper rejects a different process before native mutations'
