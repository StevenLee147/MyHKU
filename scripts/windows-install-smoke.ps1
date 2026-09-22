$ErrorActionPreference = 'Stop'
# Installation tests belong only on disposable GitHub-hosted runners.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Run this test on a disposable GitHub-hosted Windows runner.' }
$metadata = Get-Content package.json | ConvertFrom-Json
$installer = (Resolve-Path "release/desktop/MyHKU.Setup.$($metadata.version).exe").Path
$installDirectory = Join-Path $env:RUNNER_TEMP 'Custom Applications/MyHKU'
$baseline = Join-Path $env:RUNNER_TEMP 'MyHKU-baseline.exe'
Invoke-WebRequest 'https://github.com/StevenLee147/MyHKU/releases/download/v0.2.0-alpha/MyHKU.Setup.0.2.0-alpha.exe' -OutFile $baseline

function Install-MyHKU($file, $arguments) {
    $process = Start-Process -FilePath $file -ArgumentList $arguments -PassThru -Wait -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
}
Install-MyHKU $baseline "/S /D=$installDirectory"
if (!(Test-Path -LiteralPath (Join-Path $installDirectory 'MyHKU.exe'))) { throw 'Custom installation directory was not honored.' }
$sentinelDirectory = Join-Path $env:APPDATA 'myhku-dashboard'
New-Item -ItemType Directory -Path $sentinelDirectory -Force | Out-Null
$sentinel = Join-Path $sentinelDirectory 'upgrade-test.txt'
Set-Content -LiteralPath $sentinel -Value 'preserve-local-data'
# With no /D override, NSIS must discover and replace the earlier installation.
Install-MyHKU $installer '/S'
if (!(Test-Path -LiteralPath (Join-Path $installDirectory 'MyHKU.exe'))) { throw 'Upgrade did not reuse the existing location.' }
if ((Get-Content -LiteralPath $sentinel).Trim() -ne 'preserve-local-data') { throw 'Upgrade removed user data.' }
$env:MYHKU_TEST_INSTALLED_ASAR = Join-Path $installDirectory 'resources/app.asar'
node --input-type=module -e 'import {extractFile} from "@electron/asar"; import fs from "node:fs"; import path from "node:path"; const current = JSON.parse(fs.readFileSync("package.json")); const installed = JSON.parse(extractFile(process.env.MYHKU_TEST_INSTALLED_ASAR,"package.json")); if(current.version !== installed.version) throw Error("Installed version mismatch"); for(const file of ["dist/brand/logo.svg","dist/legal/agreements.json"]) if(!extractFile(process.env.MYHKU_TEST_INSTALLED_ASAR,path.normalize(file)).length) throw Error("Missing packaged asset");'
if ($LASTEXITCODE -ne 0) { throw 'Installed package verification failed.' }
Write-Output 'PASS previous Windows release upgraded in its custom directory; local data, logo and agreements verified.'
