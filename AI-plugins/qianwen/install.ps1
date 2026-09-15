[CmdletBinding()]
param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$pluginVersion = "1.0.0"
$skillNames = @("fqgate-realtime-stock-analyzer", "trade-execution")
$retiredSkillNames = @("market-data", "configure-fqgate", "account-query")

function ConvertTo-Hashtable([object]$Value) {
    if ($null -eq $Value) { return $null }
    if ($Value -is [System.Collections.IDictionary]) {
        $result = @{}
        foreach ($key in $Value.Keys) { $result[[string]$key] = ConvertTo-Hashtable $Value[$key] }
        return $result
    }
    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $result = @{}
        foreach ($property in $Value.PSObject.Properties) {
            $result[$property.Name] = ConvertTo-Hashtable $property.Value
        }
        return $result
    }
    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        return @($Value | ForEach-Object { ConvertTo-Hashtable $_ })
    }
    return $Value
}

function Read-JsonHashtable([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @{} }
    try {
        return ConvertTo-Hashtable (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
    }
    catch {
        throw "无法读取千问配置：$Path。请先修复该 JSON 文件后重试。"
    }
}

function Write-JsonUtf8IfChanged([string]$Path, [object]$Value) {
    $json = $Value | ConvertTo-Json -Depth 30
    $content = "$json`r`n"
    if ((Test-Path -LiteralPath $Path -PathType Leaf) -and
        (Get-Content -LiteralPath $Path -Raw -Encoding UTF8) -ceq $content) {
        return $false
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    $temporaryPath = "$Path.$PID.tmp"
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($temporaryPath, $content, $utf8)
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    return $true
}

function Get-FileSha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Copy-FileIfChanged([string]$SourcePath, [string]$DestinationPath) {
    if ((Test-Path -LiteralPath $DestinationPath -PathType Leaf) -and
        (Get-FileSha256 $SourcePath) -eq (Get-FileSha256 $DestinationPath)) {
        return $false
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $DestinationPath) -Force | Out-Null
    Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
    return $true
}

function Get-QianwenAccountRoots([string]$AgentRoot) {
    if (-not (Test-Path -LiteralPath $AgentRoot -PathType Container)) {
        throw "没有找到千问本机数据目录。请先打开千问并进入一次工作任务，然后重试。"
    }
    $reservedNames = @("cache", "observability", "resources", "resources_workspaces", "state")
    $roots = @(Get-ChildItem -LiteralPath $AgentRoot -Directory -Force | Where-Object {
        $_.Name -notin $reservedNames -and
        ((Test-Path -LiteralPath (Join-Path $_.FullName "skills") -PathType Container) -or
         (Test-Path -LiteralPath (Join-Path $_.FullName "projects.json") -PathType Leaf))
    })
    if ($roots.Count -eq 0) {
        throw "千问尚未创建工作任务数据。请先在千问中进入一次工作任务，然后重试。"
    }
    return $roots
}

function Test-PathWithin([string]$Path, [string]$ExpectedParent) {
    $resolvedPath = [IO.Path]::GetFullPath($Path)
    $resolvedParent = [IO.Path]::GetFullPath($ExpectedParent).TrimEnd("\")
    return $resolvedPath.StartsWith("$resolvedParent\", [StringComparison]::OrdinalIgnoreCase)
}

function Test-ManagedSkill([string]$DestinationPath) {
    $markerPath = Join-Path $DestinationPath ".fqgate-agent-managed.json"
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { return $false }
    $marker = Read-JsonHashtable $markerPath
    return [int]$marker["schemaVersion"] -eq 1 -and [string]$marker["owner"] -eq "fqgate-agent"
}

function Test-SameSkill([string]$SourcePath, [string]$DestinationPath) {
    if (-not (Test-Path -LiteralPath $DestinationPath -PathType Container)) { return $false }
    $sourceRoot = [IO.Path]::GetFullPath($SourcePath).TrimEnd("\", "/")
    $destinationRoot = [IO.Path]::GetFullPath($DestinationPath).TrimEnd("\", "/")
    $sourceFiles = @(Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Force)
    $destinationFiles = @(Get-ChildItem -LiteralPath $DestinationPath -Recurse -File -Force |
        Where-Object { $_.Name -ne ".fqgate-agent-managed.json" })
    if ($sourceFiles.Count -ne $destinationFiles.Count) { return $false }

    # 技能包含元数据等子文件，必须按相对路径和内容校验完整目录，避免重复覆盖安装。
    foreach ($sourceFile in $sourceFiles) {
        $relativePath = $sourceFile.FullName.Substring($sourceRoot.Length).TrimStart("\", "/")
        $destinationFile = Join-Path $destinationRoot $relativePath
        if (-not (Test-Path -LiteralPath $destinationFile -PathType Leaf)) { return $false }
        if ((Get-FileSha256 $sourceFile.FullName) -ne (Get-FileSha256 $destinationFile)) {
            return $false
        }
    }
    return $true
}

function Install-Skill([string]$SourcePath, [string]$DestinationPath, [string]$SkillName) {
    if ((Test-Path -LiteralPath $DestinationPath -PathType Container) -and
        (Test-ManagedSkill $DestinationPath) -and
        (Test-SameSkill $SourcePath $DestinationPath)) {
        return $false
    }
    if (Test-Path -LiteralPath $DestinationPath -PathType Container) {
        if (-not (Test-ManagedSkill $DestinationPath)) {
            if (-not (Test-SameSkill $SourcePath $DestinationPath)) {
                throw "千问中已有同名技能且不属于本安装包，未覆盖：$DestinationPath"
            }
        }
        Remove-Item -LiteralPath $DestinationPath -Recurse -Force
    }
    Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Recurse -Force
    [void](Write-JsonUtf8IfChanged (Join-Path $DestinationPath ".fqgate-agent-managed.json") ([ordered]@{
        schemaVersion = 1
        owner = "fqgate-agent"
        skill = $SkillName
        version = $pluginVersion
    }))
    return $true
}

function Test-ManagedMcpEntry([object]$Entry, [string]$ExpectedLauncherPath) {
    if ($Entry -isnot [System.Collections.IDictionary]) { return $false }
    $args = @($Entry["args"])
    return $args.Count -eq 1 -and [string]$args[0] -eq $ExpectedLauncherPath
}

function Test-LegacyManagedMcpEntry([object]$Entry, [string]$LegacyRoot) {
    if ($Entry -isnot [System.Collections.IDictionary]) { return $false }
    $args = @($Entry["args"])
    if ($args.Count -ne 1) { return $false }
    $argumentPath = [IO.Path]::GetFullPath([string]$args[0])
    $expectedRoot = [IO.Path]::GetFullPath($LegacyRoot).TrimEnd("\")
    return $argumentPath.StartsWith("$expectedRoot\", [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($argumentPath) -eq "tonghuasun-mcp-proxy.mjs"
}

if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA 不可用，无法定位千问配置。" }

$qianwenAgentRoot = Join-Path $env:LOCALAPPDATA "Qianwen\User Data\qwen-agent"
$accountRoots = @(Get-QianwenAccountRoots $qianwenAgentRoot)
$adapterInstallRoot = Join-Path $env:LOCALAPPDATA "fqgate\agents\qianwen"
$legacyInstallRoot = Join-Path $env:LOCALAPPDATA "TonghuasunCodex\agents\qianwen"
$installedLauncherPath = Join-Path $adapterInstallRoot "scripts\launch-fqgate-mcp.mjs"

if ($Uninstall) {
    foreach ($accountRoot in $accountRoots) {
        $mcpPath = Join-Path $accountRoot.FullName "mcp.json"
        $config = Read-JsonHashtable $mcpPath
        if ($config["mcpServers"] -is [System.Collections.IDictionary] -and
            $config["mcpServers"].ContainsKey("fqgate") -and
            (Test-ManagedMcpEntry $config["mcpServers"]["fqgate"] $installedLauncherPath)) {
            $config["mcpServers"].Remove("fqgate")
            [void](Write-JsonUtf8IfChanged $mcpPath $config)
        }
        foreach ($skillName in @($skillNames + $retiredSkillNames)) {
            $skillPath = Join-Path $accountRoot.FullName "skills\$skillName"
            if ((Test-Path -LiteralPath $skillPath -PathType Container) -and (Test-ManagedSkill $skillPath)) {
                Remove-Item -LiteralPath $skillPath -Recurse -Force
            }
        }
    }
    if (Test-Path -LiteralPath $adapterInstallRoot -PathType Container) {
        $expectedParent = Join-Path $env:LOCALAPPDATA "fqgate\agents"
        if (-not (Test-PathWithin $adapterInstallRoot $expectedParent)) {
            throw "拒绝删除预期目录之外的文件：$adapterInstallRoot"
        }
        Remove-Item -LiteralPath $adapterInstallRoot -Recurse -Force
    }
    Write-Output "千问中的同花顺免费开源AI插件FQGate已卸载；共享 FQGate 配置和程序均已保留。"
    exit 0
}

$runtimeFiles = @("fqgate-config.mjs", "configure-fqgate.mjs", "launch-fqgate-mcp.mjs")
$sourceSkillsRoot = Join-Path $PSScriptRoot "skills"
$sourceScriptsRoot = Join-Path $PSScriptRoot "scripts"
$sourceManifestPath = Join-Path $PSScriptRoot "plugin.json"
$sourceCompatibilityPath = Join-Path $PSScriptRoot "metadata\fqgate-compatibility.json"
foreach ($fileName in $runtimeFiles) {
    $requiredPath = Join-Path $sourceScriptsRoot $fileName
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "安装包不完整，缺少：$requiredPath" }
}
foreach ($skillName in $skillNames) {
    $requiredPath = Join-Path $sourceSkillsRoot "$skillName\SKILL.md"
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "安装包不完整，缺少：$requiredPath" }
}
if (-not (Test-Path -LiteralPath $sourceCompatibilityPath -PathType Leaf)) {
    throw "安装包不完整，缺少：$sourceCompatibilityPath"
}

$qianwenNodePath = Join-Path $qianwenAgentRoot "resources\bins\node.exe"
if (-not (Test-Path -LiteralPath $qianwenNodePath -PathType Leaf)) {
    throw "没有找到千问自带的 Node.js。请升级或修复千问客户端后重试。"
}

$adapterChanged = $false
foreach ($fileName in $runtimeFiles) {
    $adapterChanged = (Copy-FileIfChanged (Join-Path $sourceScriptsRoot $fileName) (Join-Path $adapterInstallRoot "scripts\$fileName")) -or $adapterChanged
}
$adapterChanged = (Copy-FileIfChanged $sourceManifestPath (Join-Path $adapterInstallRoot "plugin.json")) -or $adapterChanged
$adapterChanged = (Copy-FileIfChanged $sourceCompatibilityPath (Join-Path $adapterInstallRoot "metadata\fqgate-compatibility.json")) -or $adapterChanged
$configurationChanged = $false

foreach ($accountRoot in $accountRoots) {
    $legacySkillPath = Join-Path $accountRoot.FullName "skills\tonghuasun-agent"
    if (Test-Path -LiteralPath (Join-Path $legacySkillPath ".tonghuasun-agent-managed.json") -PathType Leaf) {
        Remove-Item -LiteralPath $legacySkillPath -Recurse -Force
        $configurationChanged = $true
    }
    foreach ($skillName in $retiredSkillNames) {
        $retiredSkillPath = Join-Path $accountRoot.FullName "skills\$skillName"
        if ((Test-Path -LiteralPath $retiredSkillPath -PathType Container) -and
            (Test-ManagedSkill $retiredSkillPath)) {
            Remove-Item -LiteralPath $retiredSkillPath -Recurse -Force
            $configurationChanged = $true
        }
    }
    foreach ($skillName in $skillNames) {
        $sourcePath = Join-Path $sourceSkillsRoot $skillName
        $destinationPath = Join-Path $accountRoot.FullName "skills\$skillName"
        if (-not (Test-PathWithin $destinationPath (Join-Path $accountRoot.FullName "skills"))) {
            throw "拒绝写入预期目录之外的文件：$destinationPath"
        }
        if (Install-Skill $sourcePath $destinationPath $skillName) {
            $configurationChanged = $true
        }
    }

    $mcpPath = Join-Path $accountRoot.FullName "mcp.json"
    $config = Read-JsonHashtable $mcpPath
    if ($config["mcpServers"] -isnot [System.Collections.IDictionary]) { $config["mcpServers"] = @{} }
    if ($config["mcpServers"].ContainsKey("fqgate") -and
        -not (Test-ManagedMcpEntry $config["mcpServers"]["fqgate"] $installedLauncherPath)) {
        throw "千问中已有同名 fqgate MCP 且不属于本安装包，未覆盖：$mcpPath"
    }
    if ($config["mcpServers"].ContainsKey("tonghuasun-agent") -and
        (Test-LegacyManagedMcpEntry $config["mcpServers"]["tonghuasun-agent"] $legacyInstallRoot)) {
        $config["mcpServers"].Remove("tonghuasun-agent")
    }
    $config["mcpServers"]["fqgate"] = @{
        type = "stdio"
        command = $qianwenNodePath
        args = @($installedLauncherPath)
        env = @{ FQGATE_MCP_TEXT_COMPATIBILITY = "true" }
    }
    $configurationChanged = (Write-JsonUtf8IfChanged $mcpPath $config) -or $configurationChanged
}

Write-Output "同花顺免费开源AI插件FQGate已安装到 $($accountRoots.Count) 个千问本机用户配置。"
if ($configurationChanged -or $adapterChanged) {
    Write-Output "千问正在重新加载工具；完成后请新建工作任务再验证 FQGate。"
}
else {
    Write-Output "千问入口已经是当前版本。"
}
