# Dot-source only; native APIs are loaded by the keeper after client validation.
function Start-MeterWindowIcon($Context, $Endpoint, $Client) {
    $icon = Get-MonitorStableIcon $Client
    if ([IO.Path]::GetExtension($icon) -ne '.ico') { return }
    $arguments = @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',
        ('"' + (Join-Path $PSScriptRoot 'KeepWindowIcon.ps1') + '"'),
        '-ClientProcessId', [string]$Endpoint.Owner,
        '-ClientPath', ('"' + $Context.Client + '"'),
        '-IconPath', ('"' + $icon + '"'))
    if ($Client.PackageFamily) { $arguments += @('-AppId', ('"' + $Client.PackageFamily + '!App"')) }
    Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList $arguments -WindowStyle Hidden | Out-Null
}

function Get-MeterIconWindows($ClientProcessId) { [MeterWindowProperties]::Windows($ClientProcessId) }
function Get-MeterWindowIcon($Window, $Kind) { [MeterWindowProperties]::Icon($Window,$Kind) }
function Set-MeterWindowIcon($Window, $Kind, $Handle) { [MeterWindowProperties]::SetIcon($Window,$Kind,$Handle) }
function Get-MeterWindowProperty($Window, $Id) { [MeterWindowProperties]::Read($Window,$Id) }
function Set-MeterWindowProperty($Window, $Id, $Value) { [MeterWindowProperties]::Write($Window,$Id,$Value) }

function Repair-MeterWindowIcons($ClientProcessId, $Handles, $Properties) {
    foreach ($window in @(Get-MeterIconWindows $ClientProcessId)) {
        # A window may disappear between enumeration and mutation; retry on the next tick.
        try {
            foreach ($kind in @(0,1)) {
                if ((Get-MeterWindowIcon $window $kind) -ne $Handles[$kind]) {
                    Set-MeterWindowIcon $window $kind $Handles[$kind]
                }
            }
            # Set the application identity last, once its relaunch metadata is available.
            foreach ($id in @(2,3,4,5)) {
                if ($Properties.ContainsKey($id) -and (Get-MeterWindowProperty $window $id) -ne $Properties[$id]) {
                    Set-MeterWindowProperty $window $id $Properties[$id]
                }
            }
        } catch { Write-Warning ('Taskbar icon: ' + $_.Exception.Message) }
    }
}
