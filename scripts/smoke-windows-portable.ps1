param([Parameter(Mandatory = $true)][string]$Archive)

$ErrorActionPreference = 'Stop'
$extractPath = Join-Path $env:RUNNER_TEMP 'skill-manager-portable-smoke'
Expand-Archive -Path $Archive -DestinationPath $extractPath

$nodePath = Join-Path $extractPath 'runtime\node.exe'
$licensePath = Join-Path $extractPath 'runtime\LICENSE'
if (-not (Test-Path $nodePath) -or -not (Test-Path $licensePath)) {
  throw 'Windows archive is missing the bundled Node.js runtime or license.'
}

$env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
$env:PORT = '18791'
$env:SKILL_MANAGER_NO_BROWSER = '1'
if (Get-Command node -ErrorAction SilentlyContinue) {
  throw 'The smoke test still has a system Node.js on PATH.'
}

try {
  Push-Location $extractPath
  try {
    & $env:ComSpec /d /c start.cmd
    if ($LASTEXITCODE -ne 0) { throw "start.cmd exited with $LASTEXITCODE" }
  } finally {
    Pop-Location
  }

  $url = 'http://127.0.0.1:18791/api/directories'
  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $ready) { throw "Portable app did not respond at $url" }
  $skillRoot = Join-Path $extractPath 'smoke-skills'
  New-Item -Path $skillRoot -ItemType Directory | Out-Null
  $body = @{ path = $skillRoot } | ConvertTo-Json -Compress
  $registered = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType 'application/json'
  if (-not $registered.data.directoryId) { throw 'Registering a Skill directory failed.' }
  $directories = Invoke-RestMethod -Uri $url
  if (@($directories.data).Count -ne 1) { throw 'Registered directory was not persisted.' }
  Write-Host "Portable app registered a directory without system Node.js."
  Write-Host "Portable app responded at $url without system Node.js."
} finally {
  Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object { $_.ExecutablePath -eq $nodePath } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}
