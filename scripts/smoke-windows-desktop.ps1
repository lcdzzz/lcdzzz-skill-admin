param([Parameter(Mandatory = $true)][string]$Executable)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path $Executable).Path
$base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$testRoot = Join-Path $base "Skill Manager 桌面 $([guid]::NewGuid())"
New-Item -ItemType Directory -Path $testRoot | Out-Null
$exe = Join-Path $testRoot 'SkillManager.exe'
Copy-Item $source $exe
$data = Join-Path $testRoot '.skill-manager'
$legacy = Join-Path $testRoot 'legacy-skills'
New-Item -ItemType Directory -Path $data, $legacy | Out-Null
@{ schemaVersion = 1; directories = @(@{ path = $legacy; enabled = $true }); skills = @{} } |
    ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8NoBOM (Join-Path $data 'state.json')
$log = Join-Path $testRoot 'desktop-smoke.jsonl'
$originalPath = $env:PATH
$originalSmoke = $env:SKILL_MANAGER_DESKTOP_SMOKE
$originalControl = $env:SKILL_MANAGER_SMOKE_CONTROLLED
$originalData = $env:SKILL_MANAGER_DATA_DIR
$process = $null
$second = $null
try {
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
    if (Get-Command node -ErrorAction SilentlyContinue) { throw 'System Node is still accessible.' }
    $env:SKILL_MANAGER_DESKTOP_SMOKE = $testRoot
    $env:SKILL_MANAGER_SMOKE_CONTROLLED = '1'
    Remove-Item Env:SKILL_MANAGER_DATA_DIR -ErrorAction SilentlyContinue
    $process = Start-Process -FilePath $exe -WorkingDirectory $testRoot -PassThru
    $deadline = (Get-Date).AddSeconds(120)
    $ready = $null
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $log) {
            $events = @(Get-Content $log | ForEach-Object { $_ | ConvertFrom-Json })
            if ($events.stage -contains 'failed') { throw (Get-Content $log -Raw) }
            $ready = $events | Where-Object stage -eq 'ready' | Select-Object -First 1
            if ($ready) { break }
        }
        if ($process.HasExited) { throw 'Portable EXE exited before its window was ready.' }
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) { throw 'Portable EXE did not open its window.' }
    if ($ready.dataDirectory -ne $data) { throw 'Data was not stored beside the original portable EXE.' }
    $second = Start-Process -FilePath $exe -WorkingDirectory $testRoot -PassThru
    if (-not $second.WaitForExit(60000)) { throw 'Second launch did not reuse the first window.' }
    if ($process.HasExited) { throw 'First instance unexpectedly exited.' }
    New-Item -ItemType File -Path (Join-Path $testRoot 'smoke-continue') | Out-Null
    if (-not $process.WaitForExit(120000)) { throw 'Desktop smoke did not finish.' }
    $events = @(Get-Content $log | ForEach-Object { $_ | ConvertFrom-Json })
    if (($events | Where-Object stage -eq 'ready').Count -ne 1) { throw 'More than one desktop service was started.' }
    if (($events.stage -contains 'failed') -or -not ($events.stage -contains 'checks-ok') -or -not ($events.stage -contains 'shutdown-ok')) {
        throw (Get-Content $log -Raw)
    }
    $state = Get-Content (Join-Path $data 'state.json') -Raw | ConvertFrom-Json
    if ($state.directories.Count -ne 2 -or $state.directories[0].path -ne $legacy) { throw 'Legacy state was not retained.' }
    if (-not (Test-Path (Join-Path $testRoot 'skills-share.zip'))) { throw 'Skill ZIP was not saved.' }
    Write-Host 'Portable desktop EXE passed: independent window, legacy state, single instance, registration, copy/paste, Markdown save, ZIP export/import, conflict preview/overwrite and clean shutdown without system Node.'
    Get-Content $log
} finally {
    foreach ($started in @($process, $second)) {
        if ($started -and -not $started.HasExited) { Stop-Process -Id $started.Id -ErrorAction SilentlyContinue }
    }
    $env:PATH = $originalPath
    $env:SKILL_MANAGER_DESKTOP_SMOKE = $originalSmoke
    $env:SKILL_MANAGER_SMOKE_CONTROLLED = $originalControl
    $env:SKILL_MANAGER_DATA_DIR = $originalData
}
