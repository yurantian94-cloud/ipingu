[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$WrapperRoot)

$ErrorActionPreference = 'Stop'
$androidRoot = Join-Path $WrapperRoot 'android'
$mainActivity = Get-ChildItem -LiteralPath (Join-Path $androidRoot 'app\src\main\java') -Recurse -Filter 'MainActivity.kt' -File -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $mainActivity) { throw "找不到 MainActivity.kt：$androidRoot" }

$activityText = Get-Content -LiteralPath $mainActivity.FullName -Raw
$packageMatch = [regex]::Match($activityText, '(?m)^package\s+([\w.]+)')
if (-not $packageMatch.Success) { throw "无法识别 MainActivity 的 package：$($mainActivity.FullName)" }
$packageName = $packageMatch.Groups[1].Value
$packagePath = $packageName.Replace('.', '\')
$pluginDir = Join-Path $androidRoot "app\src\main\java\$packagePath"
New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null

$pluginSource = Join-Path $PSScriptRoot '..\native\android\ScreenTimePlugin.kt'
$pluginText = (Get-Content -LiteralPath $pluginSource -Raw) -replace '(?m)^package\s+com\.aetheros\.simulator', "package $packageName"
Set-Content -LiteralPath (Join-Path $pluginDir 'ScreenTimePlugin.kt') -Value $pluginText -Encoding UTF8

$manifest = Join-Path $androidRoot 'app\src\main\AndroidManifest.xml'
$manifestText = Get-Content -LiteralPath $manifest -Raw
if ($manifestText -notmatch 'android\.permission\.PACKAGE_USAGE_STATS') {
    $manifestText = [regex]::Replace($manifestText, '(<manifest\b[^>]*>)', ('$1' + [Environment]::NewLine + '    <uses-permission android:name="android.permission.PACKAGE_USAGE_STATS" />'), 1)
    Set-Content -LiteralPath $manifest -Value $manifestText -Encoding UTF8
}

if ($activityText -notmatch 'ScreenTimePlugin::class\.java') {
    if ($activityText -notmatch 'import com\.getcapacitor\.BridgeActivity') {
        $activityText = [regex]::Replace($activityText, '(?m)^(package\s+[^\r\n]+)', ('$1' + [Environment]::NewLine + [Environment]::NewLine + 'import com.getcapacitor.BridgeActivity'), 1)
    }
    $activityText = $activityText -replace '(?m)^import com\.getcapacitor\.BridgeActivity', "import com.getcapacitor.BridgeActivity`r`nimport $packageName.ScreenTimePlugin"
    if ($activityText -match '(?s)override\s+fun\s+onCreate\([^)]*\)\s*\{') {
        $activityText = [regex]::Replace($activityText, '(?s)(override\s+fun\s+onCreate\([^)]*\)\s*\{)', ('$1' + [Environment]::NewLine + '        registerPlugin(ScreenTimePlugin::class.java)'), 1)
    } else {
        $activityText = [regex]::Replace($activityText, '(?s)(class\s+MainActivity\s*:\s*BridgeActivity\s*\{)', ('$1' + [Environment]::NewLine + '    override fun onCreate(savedInstanceState: android.os.Bundle?) {' + [Environment]::NewLine + '        registerPlugin(ScreenTimePlugin::class.java)' + [Environment]::NewLine + '        super.onCreate(savedInstanceState)' + [Environment]::NewLine + '    }'), 1)
    }
    Set-Content -LiteralPath $mainActivity.FullName -Value $activityText -Encoding UTF8
}

Write-Host "ScreenTime 原生插件已同步到 $WrapperRoot"
