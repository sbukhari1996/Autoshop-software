$ErrorActionPreference = "Stop"

$backupDirectory = "E:\AutoshopBackups\Postgres"
$databaseContainer = "collision-shop-db"
$uploadsVolume = "autoshopsoftware_api_uploads"
$timestamp = [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")
$databaseFileName = "collision_shop-$timestamp.dump"
$uploadsFileName = "autoshop_uploads-$timestamp.tar.gz"
$databaseTempPath = Join-Path $backupDirectory "$databaseFileName.partial"
$uploadsTempPath = Join-Path $backupDirectory "$uploadsFileName.partial"
$databasePath = Join-Path $backupDirectory $databaseFileName
$uploadsPath = Join-Path $backupDirectory $uploadsFileName
$containerDatabasePath = "/tmp/$databaseFileName"
$containerUploadsPath = "/tmp/$uploadsFileName"
$uploadsBackupContainer = "autoshop-uploads-backup-$([Guid]::NewGuid().ToString('N'))"
$logPath = Join-Path $backupDirectory "backup.log"

if (-not (Test-Path -LiteralPath "E:\")) {
  throw "E: drive is unavailable; no backup was written."
}

New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
Start-Transcript -Path $logPath -Append | Out-Null

try {
  $database = @(docker inspect $databaseContainer | ConvertFrom-Json)[0]
  if (-not $database.State.Running) {
    throw "Database container '$databaseContainer' is not running. Start Docker Desktop and the app before backing up."
  }

  $databaseEnvironment = @{}
  foreach ($item in $database.Config.Env) {
    $pair = $item -split "=", 2
    if ($pair.Length -eq 2) {
      $databaseEnvironment[$pair[0]] = $pair[1]
    }
  }
  $databaseUser = $databaseEnvironment["POSTGRES_USER"]
  $databaseName = $databaseEnvironment["POSTGRES_DB"]
  if (-not $databaseUser -or -not $databaseName) {
    throw "The database container does not expose the expected database name and user."
  }

  Write-Output "Creating PostgreSQL backup: $databaseFileName"
  docker exec $databaseContainer pg_dump -U $databaseUser -d $databaseName --format=custom --file=$containerDatabasePath
  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump failed with exit code $LASTEXITCODE."
  }
  docker exec $databaseContainer pg_restore --list $containerDatabasePath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL archive validation failed."
  }
  docker cp ("{0}:{1}" -f $databaseContainer, $containerDatabasePath) $databaseTempPath
  if ($LASTEXITCODE -ne 0 -or (Get-Item -LiteralPath $databaseTempPath).Length -eq 0) {
    throw "Copying or verifying the PostgreSQL backup failed."
  }
  Move-Item -LiteralPath $databaseTempPath -Destination $databasePath

  $volume = @(docker volume inspect $uploadsVolume | ConvertFrom-Json)[0]
  if (-not $volume.Name) {
    throw "Uploads volume '$uploadsVolume' does not exist."
  }

  Write-Output "Creating uploads backup: $uploadsFileName"
  docker create --name $uploadsBackupContainer `
    --mount "type=volume,source=$uploadsVolume,target=/data,readonly" `
    --entrypoint /bin/sh postgres:16-alpine `
    -c "tar -czf '$containerUploadsPath' -C /data . " | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create the temporary uploads backup container."
  }
  docker start -a $uploadsBackupContainer | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Archiving the uploads volume failed with exit code $LASTEXITCODE."
  }
  docker cp ("{0}:{1}" -f $uploadsBackupContainer, $containerUploadsPath) $uploadsTempPath
  if ($LASTEXITCODE -ne 0 -or (Get-Item -LiteralPath $uploadsTempPath).Length -eq 0) {
    throw "Copying the uploads archive failed."
  }
  $gzipFile = [System.IO.File]::OpenRead($uploadsTempPath)
  try {
    $gzipStream = [System.IO.Compression.GzipStream]::new(
      $gzipFile,
      [System.IO.Compression.CompressionMode]::Decompress
    )
    try {
      $buffer = New-Object byte[] 81920
      while ($gzipStream.Read($buffer, 0, $buffer.Length) -gt 0) { }
    }
    finally {
      $gzipStream.Dispose()
    }
  }
  finally {
    $gzipFile.Dispose()
  }
  Move-Item -LiteralPath $uploadsTempPath -Destination $uploadsPath

  $databaseHash = (Get-FileHash -LiteralPath $databasePath -Algorithm SHA256).Hash
  $uploadsHash = (Get-FileHash -LiteralPath $uploadsPath -Algorithm SHA256).Hash
  Write-Output "PostgreSQL: $databasePath"
  Write-Output "SHA256: $databaseHash"
  Write-Output "Uploads: $uploadsPath"
  Write-Output "SHA256: $uploadsHash"
}
catch {
  Write-Error $_
  throw
}
finally {
  docker exec $databaseContainer rm -f $containerDatabasePath 2>$null | Out-Null
  docker rm -f $uploadsBackupContainer 2>$null | Out-Null
  if (Test-Path -LiteralPath $databaseTempPath) {
    Remove-Item -LiteralPath $databaseTempPath -Force
  }
  if (Test-Path -LiteralPath $uploadsTempPath) {
    Remove-Item -LiteralPath $uploadsTempPath -Force
  }
  Stop-Transcript | Out-Null
}
