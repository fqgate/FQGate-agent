[CmdletBinding()]
param(
    [string]$McpUrl = "http://127.0.0.1:17281/mcp",
    [ValidateRange(10, 120)]
    [int]$WaitSeconds = 45
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$downloadPath = $null
$stagedPath = $null
$programInstalled = $false

function Read-JsonFile([string]$Path) {
    try {
        return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "读取文件失败：$Path。$($_.Exception.Message)"
    }
}

function Get-CompatibilityFile {
    $candidates = @(
        [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\metadata\fqgate-compatibility.json")),
        [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\fqgate\compatibility.json"))
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    throw "安装包不完整：缺少 FQGate 兼容信息。"
}

function Assert-MinimumFqgateVersion([string]$Version, [string]$Minimum) {
    try {
        $current = [Version]$Version
        $minimumVersion = [Version]$Minimum
    }
    catch {
        throw "FQGate 版本号格式不正确：$Version"
    }
    if ($current -lt $minimumVersion) {
        throw "FQGate $Version 低于最低要求 $Minimum，请升级后重试。"
    }
}

function Get-NodePath {
    if (-not [string]::IsNullOrWhiteSpace($env:FQGATE_NODE_PATH) -and
        (Test-Path -LiteralPath $env:FQGATE_NODE_PATH -PathType Leaf)) {
        return $env:FQGATE_NODE_PATH
    }

    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -ne $nodeCommand) { return $nodeCommand.Source }

    $qianwenNode = Join-Path $env:LOCALAPPDATA "Qianwen\User Data\qwen-agent\resources\bins\node.exe"
    if (Test-Path -LiteralPath $qianwenNode -PathType Leaf) { return $qianwenNode }

    $doubaoRuntime = Join-Path $env:LOCALAPPDATA "Doubao\User Data\sandbox_runtime\bases"
    if (Test-Path -LiteralPath $doubaoRuntime -PathType Container) {
        $doubaoNode = Get-ChildItem -LiteralPath $doubaoRuntime -Filter node.exe -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "\\node\\node\.exe$" } |
            Sort-Object LastWriteTimeUtc -Descending |
            Select-Object -First 1
        if ($null -ne $doubaoNode) { return $doubaoNode.FullName }
    }

    throw "没有找到 Node.js，暂时不能完成 FQGate 连接验收。请先安装或修复当前 AI 工具后重试。"
}

function Stop-InstalledFqgate([string]$ExecutablePath) {
    $normalizedTarget = [IO.Path]::GetFullPath($ExecutablePath)
    foreach ($process in Get-Process -Name "fqgate" -ErrorAction SilentlyContinue) {
        try {
            if ([string]::Equals([IO.Path]::GetFullPath($process.Path), $normalizedTarget, [StringComparison]::OrdinalIgnoreCase)) {
                Write-Output "正在更新已经安装的 FQGate…"
                Stop-Process -Id $process.Id -Force
                $process.WaitForExit(5000)
            }
        }
        catch {
            throw "旧版 FQGate 仍在运行，请先退出后再试。"
        }
    }
}

function New-FqgateShortcut([string]$ExecutablePath) {
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    if ([string]::IsNullOrWhiteSpace($desktopPath)) {
        throw "没有找到桌面目录，无法创建 FQGate 快捷方式。"
    }
    $shortcutPath = Join-Path $desktopPath "FQGate.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $ExecutablePath
    $shortcut.WorkingDirectory = Split-Path -Parent $ExecutablePath
    $shortcut.IconLocation = "$ExecutablePath,0"
    $shortcut.Description = "启动 FQGate"
    $shortcut.Save()
    return $shortcutPath
}

function Wait-FqgateHealth([string]$Url, [int]$Seconds) {
    try {
        $mcpUri = [Uri]$Url
    }
    catch {
        throw "FQGate 连接地址不正确：$Url"
    }
    if ($mcpUri.Scheme -ne "http" -or $mcpUri.AbsolutePath -ne "/mcp" -or
        $mcpUri.Host -notin @("127.0.0.1", "localhost", "::1")) {
        throw "FQGate 只能连接当前电脑上的 http://.../mcp 地址。"
    }

    $healthUrl = "{0}://{1}:{2}/v1/market/health" -f $mcpUri.Scheme, $mcpUri.Host, $mcpUri.Port
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $healthUrl -Method Get -UseBasicParsing -TimeoutSec 2
            if ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300) { return }
        }
        catch {
            # 首次启动可能需要用户先在 FQGate 窗口完成风险确认，因此在限定时间内继续等待。
        }
        Start-Sleep -Milliseconds 750
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "FQGate 已经启动，但还没有准备好。请在 FQGate 窗口完成首次使用确认后重新运行这条命令。"
}

try {
    if ($env:OS -ne "Windows_NT") {
        throw "这条自动安装命令目前只支持 Windows。macOS 请从 FQGate 官方发行页下载对应安装包。"
    }
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw "没有找到当前用户的本地应用目录。"
    }

    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor
        [Net.SecurityProtocolType]::Tls12

    $compatibilityPath = Get-CompatibilityFile
    $compatibility = Read-JsonFile $compatibilityPath
    $releaseRepository = [string]$compatibility.release.repositoryUrl
    $stableManifestUrl = [string]$compatibility.release.stableManifestUrl
    $tagPrefix = [string]$compatibility.release.tagPrefix
    if ([string]::IsNullOrWhiteSpace($releaseRepository) -or
        [string]::IsNullOrWhiteSpace($stableManifestUrl) -or
        [string]::IsNullOrWhiteSpace($tagPrefix)) {
        throw "FQGate 兼容信息中缺少正式下载地址。"
    }

    Write-Output "正在读取 FQGate 正式版信息…"
    $release = Invoke-RestMethod -Uri $stableManifestUrl -Method Get -UseBasicParsing
    if ([string]$release.status -ne "published") {
        throw "FQGate 稳定版还没有正式发布，已停止安装。"
    }
    $nativeArchitecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $packageArchitecture = switch ($nativeArchitecture.ToUpperInvariant()) {
        "AMD64" { "x86_64" }
        "ARM64" { "aarch64" }
        default { $nativeArchitecture.ToLowerInvariant() }
    }
    $package = @($release.packages) |
        Where-Object { $_.platform -eq "windows" -and $_.architecture -eq $packageArchitecture } |
        Select-Object -First 1
    if ($null -eq $package) {
        throw "当前正式版没有适合这台 Windows 电脑的 FQGate 文件。"
    }

    $version = [string]$release.version
    Assert-MinimumFqgateVersion $version ([string]$compatibility.fqgate.minimumVersion)
    $fileName = [string]$package.fileName
    $tagName = "$tagPrefix$version"
    $downloadUrl = "$($releaseRepository.TrimEnd('/'))/releases/download/$tagName/$([Uri]::EscapeDataString($fileName))"
    $installDirectory = Join-Path $env:LOCALAPPDATA "FQGate"
    $executablePath = Join-Path $installDirectory "fqgate.exe"
    New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
    $expectedHash = ([string]$package.sha256).ToLowerInvariant()
    $needsReplace = $true
    if (Test-Path -LiteralPath $executablePath -PathType Leaf) {
        $installedHash = (Get-FileHash -LiteralPath $executablePath -Algorithm SHA256).Hash.ToLowerInvariant()
        $needsReplace = $installedHash -ne $expectedHash
    }

    $versionCandidate = $executablePath
    if ($needsReplace) {
        $downloadPath = Join-Path ([IO.Path]::GetTempPath()) "fqgate-$([Guid]::NewGuid().ToString('N')).exe"
        Write-Output "正在下载 FQGate $version…"
        Invoke-WebRequest -Uri $downloadUrl -OutFile $downloadPath -UseBasicParsing
        $downloadFile = Get-Item -LiteralPath $downloadPath
        $expectedSize = [int64]$package.size
        if ($downloadFile.Length -ne $expectedSize) {
            throw "下载文件大小不对，已停止安装。"
        }
        $actualHash = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne $expectedHash) {
            throw "下载文件的 SHA-256 校验没有通过，已停止安装。"
        }
        $versionCandidate = $downloadPath
    }
    else {
        Write-Output "这台电脑已经安装 FQGate $version，直接检查连接。"
    }

    $versionOutput = (& $versionCandidate --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch "(?i)fqgate\s+(\d+\.\d+\.\d+)") {
        throw "FQGate 文件没有返回正确的版本号。"
    }
    Assert-MinimumFqgateVersion $Matches[1] ([string]$compatibility.fqgate.minimumVersion)

    if ($needsReplace) {
        Stop-InstalledFqgate $executablePath
        $stagedPath = Join-Path $installDirectory "fqgate.new.exe"
        Copy-Item -LiteralPath $downloadPath -Destination $stagedPath -Force
        if (Test-Path -LiteralPath $executablePath -PathType Leaf) {
            Copy-Item -LiteralPath $executablePath -Destination (Join-Path $installDirectory "fqgate.previous.exe") -Force
        }
        Copy-Item -LiteralPath $stagedPath -Destination $executablePath -Force
    }
    $programInstalled = $true

    $shortcutPath = New-FqgateShortcut $executablePath
    $running = @(Get-Process -Name "fqgate" -ErrorAction SilentlyContinue | Where-Object {
        try { [string]::Equals([IO.Path]::GetFullPath($_.Path), $executablePath, [StringComparison]::OrdinalIgnoreCase) }
        catch { $false }
    }).Count -gt 0
    if (-not $running) {
        Start-Process -FilePath $executablePath -WorkingDirectory $installDirectory | Out-Null
    }

    Write-Output "FQGate 已启动。第一次使用时，请在打开的窗口完成确认。"
    Wait-FqgateHealth $McpUrl $WaitSeconds

    $configurePath = Join-Path $PSScriptRoot "configure-fqgate.mjs"
    if (-not (Test-Path -LiteralPath $configurePath -PathType Leaf)) {
        throw "安装包不完整：缺少 FQGate 连接配置脚本。"
    }
    $nodePath = Get-NodePath
    & $nodePath $configurePath configure --fqgate-path $executablePath --mcp-url $McpUrl --require-ready --json
    if ($LASTEXITCODE -ne 0) {
        throw "FQGate 连接验收没有通过。"
    }

    Write-Output "安装完成：FQGate $version 已启动，连接和工具列表都已通过检查。"
    Write-Output "桌面快捷方式：$shortcutPath"
}
catch {
    if ($programInstalled) {
        Write-Output "FQGate 主程序已经安装，但连接还没有成功：$($_.Exception.Message)"
    }
    else {
        Write-Output "FQGate 安装没有完成：$($_.Exception.Message)"
    }
    exit 1
}
finally {
    foreach ($temporaryFile in @($downloadPath, $stagedPath)) {
        if (-not [string]::IsNullOrWhiteSpace($temporaryFile) -and
            (Test-Path -LiteralPath $temporaryFile -PathType Leaf)) {
            Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue
        }
    }
}
