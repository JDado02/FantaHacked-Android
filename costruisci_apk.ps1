# Costruisce l'apk di FantaHacked su Windows, partendo da niente.
#
# Il progetto e' completo, ma per compilarlo servono due cose che questo
# script scarica e una che non puo' dare al posto tuo: **l'accettazione delle
# licenze dell'SDK Android**. E' un contratto con Google, e lo firma chi
# installa, non un programma. Quando lo script arriva li' si ferma e ti chiede
# di rispondere `y`.
#
# Cosa scarica, e dove:
#
#   strumenti\gradle-8.7\        Gradle, ~130 MB
#   strumenti\sdk\               SDK Android: piattaforma 34 e build-tools, ~700 MB
#
# Tutto dentro `strumenti\`, che e' fuori dal repository: si cancella la
# cartella e non resta niente sul computer.
#
# Uso:
#     powershell -ExecutionPolicy Bypass -File costruisci_apk.ps1
#
# Alla fine l'apk sta in
#     app\build\outputs\apk\debug\app-debug.apk
# e si installa sul telefono copiandolo e aprendolo (serve consentire
# «installa app sconosciute» per il gestore file), oppure via adb:
#     strumenti\sdk\platform-tools\adb install -r app\build\outputs\apk\debug\app-debug.apk

$ErrorActionPreference = 'Stop'
$QUI = Split-Path -Parent $MyInvocation.MyCommand.Path
$STRUMENTI = Join-Path $QUI 'strumenti'
$SDK = Join-Path $STRUMENTI 'sdk'
$GRADLE_VER = '8.7'
$GRADLE = Join-Path $STRUMENTI "gradle-$GRADLE_VER"

function Passo($testo) { Write-Host "`n=== $testo" -ForegroundColor Cyan }

# --- 1. Java -------------------------------------------------------------
Passo 'Java'
$javac = Get-Command javac -ErrorAction SilentlyContinue
if (-not $javac) {
    Write-Host "Non trovo javac. Serve un JDK 17 (Temurin va benissimo):" -ForegroundColor Yellow
    Write-Host "  https://adoptium.net/temurin/releases/?version=17"
    exit 1
}
$versione = (& javac -version 2>&1) -join ''
Write-Host "  $versione"
if ($versione -notmatch '\b(17|21)\b') {
    Write-Host "  Attenzione: il progetto e' tarato su Java 17." -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path $STRUMENTI | Out-Null

# --- 2. Gradle -----------------------------------------------------------
Passo "Gradle $GRADLE_VER"
if (Test-Path (Join-Path $GRADLE 'bin\gradle.bat')) {
    Write-Host '  gia'' presente'
} else {
    $zip = Join-Path $STRUMENTI "gradle-$GRADLE_VER-bin.zip"
    Write-Host '  scarico (~130 MB)...'
    Invoke-WebRequest -Uri "https://services.gradle.org/distributions/gradle-$GRADLE_VER-bin.zip" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $STRUMENTI -Force
    Remove-Item $zip
}

# --- 3. SDK Android ------------------------------------------------------
Passo 'SDK Android'
$sdkmanager = Join-Path $SDK 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path $sdkmanager)) {
    $zip = Join-Path $STRUMENTI 'cmdline-tools.zip'
    Write-Host '  scarico gli strumenti da riga di comando (~150 MB)...'
    Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' -OutFile $zip
    $tmp = Join-Path $STRUMENTI '_cmdline'
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $SDK 'cmdline-tools') | Out-Null
    Move-Item (Join-Path $tmp 'cmdline-tools') (Join-Path $SDK 'cmdline-tools\latest')
    Remove-Item $tmp -Recurse -Force
    Remove-Item $zip
}

$env:ANDROID_HOME = $SDK
$env:ANDROID_SDK_ROOT = $SDK

# --- 4. Le licenze: questa la firmi tu -----------------------------------
Passo 'Licenze'
Write-Host '  Adesso Google mostra i suoi contratti. Sono da leggere e da'
Write-Host '  accettare a mano: rispondi y a ciascuno.' -ForegroundColor Yellow
& $sdkmanager --sdk_root="$SDK" --licenses

Passo 'Piattaforma e strumenti di compilazione (~700 MB)'
& $sdkmanager --sdk_root="$SDK" 'platform-tools' 'platforms;android-34' 'build-tools;34.0.0'

# --- 5. local.properties -------------------------------------------------
$localProps = Join-Path $QUI 'local.properties'
$percorsoSdk = $SDK -replace '\\', '\\\\'
Set-Content -Path $localProps -Value "sdk.dir=$percorsoSdk" -Encoding utf8
Write-Host "  scritto local.properties"

# --- 6. L'apk ------------------------------------------------------------
Passo 'Compilazione'
Push-Location $QUI
try {
    & (Join-Path $GRADLE 'bin\gradle.bat') --no-daemon assembleDebug
} finally {
    Pop-Location
}

$apk = Join-Path $QUI 'app\build\outputs\apk\debug\app-debug.apk'
if (Test-Path $apk) {
    $mb = [math]::Round((Get-Item $apk).Length / 1MB, 1)
    Write-Host "`nFatto: $apk  ($mb MB)" -ForegroundColor Green
    Write-Host 'Per installarlo con il telefono collegato e il debug USB attivo:'
    Write-Host "  strumenti\sdk\platform-tools\adb install -r `"$apk`""
} else {
    Write-Host "`nL'apk non c'e': guarda sopra l'errore di Gradle." -ForegroundColor Red
    exit 1
}
