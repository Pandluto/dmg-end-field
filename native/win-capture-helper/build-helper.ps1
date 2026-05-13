$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcPath = Join-Path $scriptDir 'src\WinCaptureHelper.cs'
$outDir = Join-Path $scriptDir 'bin'
$outPath = Join-Path $outDir 'WinCaptureHelper.exe'
$cscPath = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path $cscPath)) {
  throw "csc.exe not found: $cscPath"
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

& $cscPath `
  /nologo `
  /target:exe `
  /platform:x64 `
  /out:$outPath `
  /reference:System.Drawing.dll `
  $srcPath

if ($LASTEXITCODE -ne 0) {
  throw "helper build failed"
}

Write-Host "Built $outPath"
