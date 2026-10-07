$ErrorActionPreference = "Stop"

$repositoryDirectory = Split-Path -Parent $PSScriptRoot
$logPath = "E:\AutoshopBackups\Postgres\startup.log"
$dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"

New-Item -ItemType Directory -Path (Split-Path -Parent $logPath) -Force | Out-Null
Start-Transcript -Path $logPath -Append | Out-Null

try {
  if (-not (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)) {
    if (-not (Test-Path -LiteralPath $dockerDesktop)) {
      throw "Docker Desktop was not found at $dockerDesktop."
    }
    Start-Process -FilePath $dockerDesktop
  }

  $deadline = (Get-Date).AddMinutes(3)
  do {
    docker info 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      break
    }
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $deadline)

  if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop did not become ready within three minutes."
  }

  Push-Location $repositoryDirectory
  try {
    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) {
      throw "Could not start the Autoshop Docker Compose services."
    }
  }
  finally {
    Pop-Location
  }

  Write-Output "Autoshop services are running. PostgreSQL data stays in its named Docker volume."
}
catch {
  Write-Error $_
  throw
}
finally {
  Stop-Transcript | Out-Null
}
