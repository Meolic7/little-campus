param([switch]$Release)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$projectRoot = Split-Path $PSScriptRoot -Parent
$localJdk = Join-Path $projectRoot '.tools\jdk'
$localSdk = Join-Path $projectRoot '.tools\android-sdk'
if (!$env:JAVA_HOME) {
    $bundled = Get-ChildItem -LiteralPath $localJdk -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($bundled) { $env:JAVA_HOME = $bundled.FullName }
    elseif (Test-Path 'C:\Program Files\Android\Android Studio\jbr') { $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr' }
    else { throw 'JDK 21 is required. Set JAVA_HOME or install Android Studio.' }
}
if (!$env:ANDROID_HOME) {
    if (Test-Path $localSdk) { $env:ANDROID_HOME = $localSdk }
    elseif (Test-Path "$env:LOCALAPPDATA\Android\Sdk") { $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk" }
    else { throw 'Android SDK 35 is required. Set ANDROID_HOME or install it with Android Studio.' }
}
$env:GRADLE_USER_HOME = Join-Path $projectRoot '.tools\gradle'
$env:DEBUG = ''
if (!(Test-Path 'node_modules')) { npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Web build failed' }
npx.cmd cap sync android
if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed' }
Push-Location android
try {
    $buildTask = if ($Release) {'assembleRelease'} else {'assembleDebug'}
    $localGradle = Join-Path $projectRoot '.tools\gradle-dist\gradle-8.11.1\bin\gradle.bat'
    if (Test-Path $localGradle) { & $localGradle $buildTask --no-daemon --no-watch-fs --max-workers=2 }
    else { .\gradlew.bat $buildTask --no-daemon --no-watch-fs --max-workers=2 }
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed' }
} finally { Pop-Location }
if ($Release) {
    Write-Host 'Unsigned release: android\app\build\outputs\apk\release\app-release-unsigned.apk'
} else {
    New-Item -ItemType Directory -Force -Path releases | Out-Null
    Copy-Item -LiteralPath 'android\app\build\outputs\apk\debug\app-debug.apk' -Destination 'releases\pixel-campus-debug.apk' -Force
    Write-Host 'Installable test APK: releases\pixel-campus-debug.apk'
}
