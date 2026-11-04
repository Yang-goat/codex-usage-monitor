# Isolated lifecycle tests: no real desktop, process termination or network traffic.
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts\Lifecycle.ps1')
$root = Split-Path $PSScriptRoot -Parent
$context = [pscustomobject]@{Root=$root;Client='C:\fake\app\ChatGPT.exe';Node='C:\fake\node.exe';Cli=$null;Port=9339;Key=(Get-MeterKey $root)}
$script:passed = 0
function Assert($Condition,$Label) { if (-not $Condition) { throw $Label }; $script:passed++; Write-Output "PASS: $Label" }
function Reset-Scenario {
    $script:cliAvailable=$false; $script:running=$false; $script:ready=$false; $script:free=$true
    $script:listeners=@(); $script:owner='client'; $script:launches=@(); $script:helper=$null
    $script:httpCalls=0; $script:onSleep=$null; $script:clientArguments=@(); $script:helperEnvironment=$null
}
function Get-Command { param($Name)
    if ($Name -eq 'node.exe') { [pscustomobject]@{Source='C:\fake\node.exe'} }
    if ($Name -eq 'codex.exe' -and $script:cliAvailable) { [pscustomobject]@{Source='C:\fake\codex.exe'} }
}
function Get-AppxPackage { param($Name) [pscustomobject]@{InstallLocation='C:\fake';Version=[version]'1.0'} }
function Test-Path { param($LiteralPath) return $true }
function Get-NetTCPConnection { $script:listeners }
function Test-MeterPortFree { return $script:free }
function Get-Process { param($Name,$Id)
    if ($Id) {
        if ($script:owner -eq 'missing') { return }
        $ownerPath = if ($script:owner -eq 'foreign') {'C:\other.exe'} else {'C:\fake\app\ChatGPT.exe'}
        return [pscustomobject]@{Id=$Id;Path=$ownerPath}
    }
    if ($script:running) { [pscustomobject]@{Id=123;Path='C:\fake\app\ChatGPT.exe'} }
}
function Invoke-RestMethod {
    $script:httpCalls++
    if (-not $script:ready) { throw 'not ready' }
    [pscustomobject]@{Browser='Chrome/test';webSocketDebuggerUrl='ws://127.0.0.1:9339/devtools/browser/mock'}
}
function Get-MeterHelper { $script:helper }
function Start-Process { param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,[switch]$PassThru)
    $script:launches += $FilePath
    if ($FilePath -like '*ChatGPT.exe') {
        $script:clientArguments=$ArgumentList; $script:running=$true; $script:ready=$true
        $script:listeners=@([pscustomobject]@{LocalPort=9339;LocalAddress='127.0.0.1';OwningProcess=123})
    } else {
        if ($WindowStyle -ne 'Hidden') { throw 'helper must be hidden' }
        $script:helperEnvironment=@($env:CODEX_METER_PORT,$env:CODEX_METER_CLI,$env:CODEX_METER_CLIENT_PID)
        $script:helper=[pscustomobject]@{protocol='codex-meter/1';state='running';debugPort=9339;pid=456}
        [pscustomobject]@{HasExited=$false;Id=456}
    }
}
function Start-Sleep { param($Milliseconds)
    if ($script:onSleep) { & $script:onSleep }
    [Threading.Thread]::Sleep(2)
}
foreach ($available in @($false,$true)) {
    Reset-Scenario; $script:cliAvailable=$available
    $savedPort=$env:CODEX_METER_PORT; $savedCli=$env:CODEX_METER_CLI
    Invoke-MeterLauncher -Root $root
    Assert ($script:launches.Count -eq 2) "desktop and helper start once (CLI present: $available)"
    Assert ($script:clientArguments -contains '--remote-debugging-port=9339' -and $script:helperEnvironment[0] -eq '9339') 'desktop and helper use original port 9339'
    Assert ($script:helperEnvironment[2] -eq '123') 'helper receives verified desktop owner PID'
    Assert (($available -and $script:helperEnvironment[1] -eq 'C:\fake\codex.exe') -or (-not $available -and -not $script:helperEnvironment[1])) 'optional CLI handled'
    Assert ($env:CODEX_METER_PORT -eq $savedPort -and $env:CODEX_METER_CLI -eq $savedCli) 'caller environment restored'
    Invoke-MeterLauncher -Root $root
    Assert ($script:launches.Count -eq 2) 'repeated launch reuses ready desktop and helper'
}
Reset-Scenario
$script:owner='foreign'; $script:listeners=@([pscustomobject]@{LocalPort=9339;LocalAddress='127.0.0.1';OwningProcess=99})
$rejected=$false; try { Invoke-MeterLauncher -Root $root } catch { $rejected=$true }
Assert ($rejected -and $script:httpCalls -eq 0 -and $script:launches.Count -eq 0) 'foreign owner rejected before HTTP or launch'
Reset-Scenario
$script:listeners=@([pscustomobject]@{LocalPort=9339;LocalAddress='0.0.0.0';OwningProcess=123})
$rejected=$false; try { Invoke-MeterLauncher -Root $root } catch { $rejected=$true }
Assert ($rejected -and $script:httpCalls -eq 0) 'non-loopback listener rejected before HTTP'
Reset-Scenario
$script:owner='missing'; $script:listeners=@([pscustomobject]@{LocalPort=9339;LocalAddress='127.0.0.1';OwningProcess=99})
$script:onSleep={ $script:owner='client';$script:listeners=@();$script:onSleep=$null }
Invoke-MeterLauncher -Root $root
Assert ($script:launches.Count -eq 2) 'orphan listener is retried and launch proceeds after release'
Reset-Scenario
$script:free=$false
$script:onSleep={ $script:free=$true;$script:onSleep=$null }
Invoke-MeterLauncher -Root $root
Assert ($script:launches.Count -eq 2) 'actual bind failure is retried without changing port'
Reset-Scenario
$script:running=$true
$script:onSleep={ $script:running=$false;$script:onSleep=$null }
Invoke-MeterLauncher -Root $root
Assert ($script:launches.Count -eq 2) 'existing desktop gets time to exit before relaunch'
Reset-Scenario
$script:running=$true
$rejected=$false; try { Wait-MeterEndpoint $context 15 } catch { $rejected=$true }
Assert ($rejected -and $script:launches.Count -eq 0) 'desktop without debug endpoint times out without duplicate or termination'
Reset-Scenario
$script:free=$false
$rejected=$false; try { Wait-MeterEndpoint $context 15 } catch { $rejected=$true }
Assert ($rejected -and $script:launches.Count -eq 0) 'persistent port reservation fails boundedly without switching port'
Reset-Scenario
$script:helper=[pscustomobject]@{state='stopping';debugPort=9339}
$script:onSleep={ $script:helper=$null;$script:onSleep=$null }
Ensure-MeterHelper $context ([pscustomobject]@{Owner=123})
Assert ($script:launches.Count -eq 1) 'helper shutdown is awaited before replacement'
Reset-Scenario
$script:helper=[pscustomobject]@{state='running';debugPort=9340}
$rejected=$false; try { Ensure-MeterHelper $context ([pscustomobject]@{Owner=123}) 15 } catch { $rejected=$true }
Assert ($rejected -and $script:launches.Count -eq 0) 'helper on another port is preserved and diagnosed'
Reset-Scenario
$check=Invoke-MeterLauncher -Root $root -CheckOnly | ConvertFrom-Json
Assert ($check.Port -eq 9339 -and $script:launches.Count -eq 0) 'CheckOnly performs no launch'
Reset-Scenario
$context.Port=9441
$custom=Invoke-MeterLauncher -Root $root -Context $context -CheckOnly | ConvertFrom-Json
Assert ($custom.Port -eq 9441) 'configured port preserved in diagnostic path'
$null=Start-MeterHelper $context 123
Assert ($script:helperEnvironment[0] -eq '9441') 'configured port passed to helper'
$context.Port=9339
Write-Output "Launcher checks passed: $script:passed"
