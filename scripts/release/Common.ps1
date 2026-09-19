function Read-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "缺少 JSON 文件：$Path"
    }
    try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw "无法读取 JSON 文件：$Path：$($_.Exception.Message)" }
}

function Write-JsonFile([string]$Path, [object]$Value) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($Path, "$(($Value | ConvertTo-Json -Depth 20))`r`n", $utf8)
}

function Copy-DirectoryContents(
    [string]$SourcePath,
    [string]$DestinationPath,
    [string[]]$ExcludeNames = @()
) {
    if (-not (Test-Path -LiteralPath $SourcePath -PathType Container)) {
        throw "缺少源目录：$SourcePath"
    }
    New-Item -ItemType Directory -Path $DestinationPath -Force | Out-Null
    Get-ChildItem -LiteralPath $SourcePath -Force |
        Where-Object { $_.Name -notin $ExcludeNames } |
        Copy-Item -Destination $DestinationPath -Recurse -Force
}

function Copy-CommonPackage(
    [string]$RepositoryRoot,
    [string]$PackageRoot,
    [string]$AdapterPath
) {
    Copy-DirectoryContents (Join-Path $RepositoryRoot "installer\runtime") (Join-Path $PackageRoot "scripts")
    Copy-DirectoryContents (Join-Path $RepositoryRoot "skills") (Join-Path $PackageRoot "skills")
    Copy-DirectoryContents (Join-Path $RepositoryRoot "assets\brand") (Join-Path $PackageRoot "assets\brand")
    Copy-DirectoryContents (Join-Path $RepositoryRoot "docs\legal") (Join-Path $PackageRoot "docs\legal")
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot "fqgate\README.md") -Destination (Join-Path $PackageRoot "docs\FQGate.md") -Force
    New-Item -ItemType Directory -Path (Join-Path $PackageRoot "metadata") -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot "fqgate\compatibility.json") -Destination (Join-Path $PackageRoot "metadata\fqgate-compatibility.json") -Force
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot "LICENSE") -Destination (Join-Path $PackageRoot "LICENSE") -Force

    $adapter = Get-Content -LiteralPath $AdapterPath -Raw -Encoding UTF8
    foreach ($skillDirectory in Get-ChildItem -LiteralPath (Join-Path $PackageRoot "skills") -Directory) {
        $skillPath = Join-Path $skillDirectory.FullName "SKILL.md"
        if (-not (Test-Path -LiteralPath $skillPath -PathType Leaf)) {
            throw "公共技能缺少 SKILL.md：$($skillDirectory.FullName)"
        }
        [IO.File]::AppendAllText(
            $skillPath,
            "`r`n---`r`n`r`n$adapter`r`n",
            [Text.UTF8Encoding]::new($false))
    }
}

function Assert-Package(
    [string]$PackageRoot,
    [string]$Version,
    [string]$ManifestPath
) {
    foreach ($requiredPath in @(
        "scripts\fqgate-config.mjs",
        "scripts\configure-fqgate.mjs",
        "scripts\install-fqgate.ps1",
        "scripts\launch-fqgate-mcp.mjs",
        "skills\fqgate-realtime-stock-analyzer\SKILL.md",
        "skills\trade-execution\SKILL.md",
        "assets\brand\fqgate-app-icon.svg",
        "metadata\fqgate-compatibility.json",
        "docs\legal\PRIVACY.md",
        "LICENSE"
    )) {
        $absolutePath = Join-Path $PackageRoot $requiredPath
        if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
            throw "发行包缺少公共文件：$absolutePath"
        }
    }

    $manifest = Read-JsonFile (Join-Path $PackageRoot $ManifestPath)
    if ([string]$manifest.version -ne $Version) {
        throw "发行包清单版本不一致：$ManifestPath"
    }

    $fqgateReleaseRepository = "https://github.com/zhuyifang/fqgate-releases"
    $agentReleasePage = "https://github.com/zhuyifang/tonghuasun-agent/releases"
    foreach ($documentPath in @("README.md", "docs\FQGate.md")) {
        $absoluteDocumentPath = Join-Path $PackageRoot $documentPath
        $document = Get-Content -LiteralPath $absoluteDocumentPath -Raw -Encoding UTF8
        if ($document.IndexOf($fqgateReleaseRepository, [StringComparison]::Ordinal) -lt 0) {
            throw "发行包文档没有说明 FQGate 主程序仓库：$absoluteDocumentPath"
        }
        if ($document.IndexOf($agentReleasePage, [StringComparison]::Ordinal) -lt 0) {
            throw "发行包文档没有说明 AI 插件仓库：$absoluteDocumentPath"
        }
    }

    $forbiddenFilePatterns = @("ThsPlugin.*", "tonghuasun-mcp-proxy.mjs", "*.pdb", "*.dSYM", "*.dmp", "*.key", "*.pem")
    foreach ($pattern in $forbiddenFilePatterns) {
        $matches = @(Get-ChildItem -LiteralPath $PackageRoot -Recurse -Force -File -Filter $pattern)
        if ($matches.Count -gt 0) {
            throw "发行包包含禁止文件：$($matches[0].FullName)"
        }
    }

    $forbiddenText = @(
        "X-Tonghuasun-Dll-Token",
        "127.0.0.1:17180",
        "ThsPlugin.",
        "\fqgate\src\",
        "/fqgate/src/"
    )
    $textExtensions = @(".json", ".md", ".mjs", ".js", ".ps1", ".yml", ".yaml", ".toml")
    foreach ($file in Get-ChildItem -LiteralPath $PackageRoot -Recurse -Force -File) {
        if ($file.Extension -notin $textExtensions) { continue }
        $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
        foreach ($forbidden in $forbiddenText) {
            if ($text.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                throw "发行包包含 V1 或私有边界引用：$($file.FullName)：$forbidden"
            }
        }
        if ($file.Extension -eq ".md" -and $text -match "(?:github\.com/zhuyifang|gitee\.com/qicuo)/tonghuasun-agent/(?:releases/(?:tag|download)/fqgate-v|raw/main/fqgate/releases)") {
            throw "发行包文档错误地从 AI 插件仓库下载 FQGate：$($file.FullName)"
        }
    }
}

function Write-DeterministicZip(
    [string]$SourceRoot,
    [string]$ArchivePath,
    [string]$EntryRoot = ""
) {
    Add-Type -AssemblyName System.IO.Compression
    $resolvedSourceRoot = [IO.Path]::GetFullPath($SourceRoot).TrimEnd("\", "/")
    $fixedTimestamp = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
    $stream = [IO.File]::Open($archivePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite)
    try {
        $archive = [IO.Compression.ZipArchive]::new(
            $stream,
            [IO.Compression.ZipArchiveMode]::Create,
            $false,
            [Text.Encoding]::UTF8)
        try {
            # 固定条目顺序与时间戳，保证相同源码反复构建得到同一 SHA-256。
            foreach ($file in Get-ChildItem -LiteralPath $resolvedSourceRoot -Recurse -Force -File |
                Sort-Object FullName) {
                $relativePath = $file.FullName.Substring($resolvedSourceRoot.Length).TrimStart("\", "/").Replace("\", "/")
                $entryName = if ([string]::IsNullOrWhiteSpace($EntryRoot)) {
                    $relativePath
                }
                else {
                    "$($EntryRoot.TrimEnd('/', '\'))/$relativePath"
                }
                $entry = $archive.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = $fixedTimestamp
                $input = [IO.File]::OpenRead($file.FullName)
                try {
                    $output = $entry.Open()
                    try { $input.CopyTo($output) }
                    finally { $output.Dispose() }
                }
                finally { $input.Dispose() }
            }
        }
        finally { $archive.Dispose() }
    }
    finally { $stream.Dispose() }
}

function Compress-Package(
    [string]$PackageRoot,
    [string]$ArtifactDirectory,
    [string]$ArchiveName
) {
    $archivePath = Join-Path $ArtifactDirectory $ArchiveName
    if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
        Remove-Item -LiteralPath $archivePath -Force
    }
    $rootName = Split-Path -Leaf ([IO.Path]::GetFullPath($PackageRoot).TrimEnd("\", "/"))
    Write-DeterministicZip $PackageRoot $archivePath $rootName
    return $archivePath
}

function Compress-PackageContents(
    [string]$PackageRoot,
    [string]$ArtifactDirectory,
    [string]$ArchiveName
) {
    $archivePath = Join-Path $ArtifactDirectory $ArchiveName
    if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
        Remove-Item -LiteralPath $archivePath -Force
    }
    Write-DeterministicZip $PackageRoot $archivePath
    return $archivePath
}

function Assert-ArchiveRoot([string]$ArchivePath, [string]$RootName) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
        if (-not @($entries | Where-Object { $_.StartsWith("$RootName/", [StringComparison]::Ordinal) }).Count) {
            throw "ZIP 缺少预期根目录：$RootName"
        }
        if (@($entries | Where-Object { -not $_.StartsWith("$RootName/", [StringComparison]::Ordinal) }).Count -gt 0) {
            throw "ZIP 根目录不唯一：$ArchivePath"
        }
    }
    finally { $archive.Dispose() }
}

function Assert-ArchiveEntries(
    [string]$ArchivePath,
    [string[]]$RequiredEntries,
    [string[]]$AllowedPrefixes
) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
        foreach ($requiredEntry in $RequiredEntries) {
            if ($requiredEntry -notin $entries) {
                throw "ZIP 缺少必要条目：$requiredEntry"
            }
        }
        foreach ($entry in $entries) {
            if (-not @($AllowedPrefixes | Where-Object {
                $entry.StartsWith($_, [StringComparison]::Ordinal)
            }).Count) {
                throw "ZIP 包含不允许的顶层条目：$entry"
            }
        }
    }
    finally { $archive.Dispose() }
}

function Get-FileVersionFromManifest([string]$ManifestPath) {
    $manifest = Read-JsonFile $ManifestPath
    $version = [string]$manifest.version
    if ($version -notmatch "^\d+\.\d+\.\d+$") {
        throw "清单版本必须是严格语义版本：$ManifestPath"
    }
    return $version
}
