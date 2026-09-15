[CmdletBinding()]
param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$pluginVersion = "1.0.0"
$skillNames = @("fqgate-realtime-stock-analyzer", "trade-execution")
$retiredSkillNames = @("market-data", "configure-fqgate", "account-query")

trap {
    Write-Output $_.Exception.Message
    exit 1
}

function Read-Json([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw "无法读取同花顺免费开源AI插件FQGate安装标记：$Path" }
}

function Write-JsonUtf8([string]$Path, [object]$Value) {
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($Path, "$(($Value | ConvertTo-Json -Depth 10))`r`n", $utf8)
}

function Get-DoubaoWorkspaces([string]$UserDataRoot) {
    if (-not (Test-Path -LiteralPath $UserDataRoot -PathType Container)) {
        throw "没有找到豆包本机数据。请先打开豆包并进入一次工作任务，然后重试。"
    }
    $workspaces = @()
    foreach ($profile in Get-ChildItem -LiteralPath $UserDataRoot -Directory -Force) {
        $workspacePath = Join-Path $profile.FullName ".doubao\agent_mode\workspace"
        if (Test-Path -LiteralPath $workspacePath -PathType Container) {
            $workspaces += [pscustomobject]@{ ProfileName = $profile.Name; Path = $workspacePath }
        }
    }
    if ($workspaces.Count -eq 0) {
        throw "豆包尚未创建工作任务数据。请先在豆包中进入一次工作任务，然后重试。"
    }
    return $workspaces
}

function Test-PathWithin([string]$Path, [string]$ExpectedParent) {
    $resolvedPath = [IO.Path]::GetFullPath($Path)
    $resolvedParent = [IO.Path]::GetFullPath($ExpectedParent).TrimEnd("\")
    return $resolvedPath.StartsWith("$resolvedParent\", [StringComparison]::OrdinalIgnoreCase)
}

function Test-ManagedSkill([string]$DestinationPath) {
    $marker = Read-Json (Join-Path $DestinationPath ".fqgate-agent-managed.json")
    return $null -ne $marker -and [int]$marker.schemaVersion -eq 1 -and [string]$marker.owner -eq "fqgate-agent"
}

function Test-LegacySkill([string]$DestinationPath) {
    if (-not (Test-Path -LiteralPath $DestinationPath -PathType Container)) { return $false }
    $files = @(Get-ChildItem -LiteralPath $DestinationPath -Recurse -File -Force)
    if ($files.Count -ne 1 -or $files[0].Name -ne "SKILL.md") { return $false }
    $text = Get-Content -LiteralPath $files[0].FullName -Raw -Encoding UTF8
    return $text -match "(?m)^name:\s*tonghuasun-agent\s*$" -and $text -match "ths_order_flow"
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
        if ((Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash -ne
            (Get-FileHash -LiteralPath $destinationFile -Algorithm SHA256).Hash) {
            return $false
        }
    }
    return $true
}

function Install-Skill([string]$SourcePath, [string]$DestinationPath, [string]$SkillName) {
    if ((Test-Path -LiteralPath $DestinationPath -PathType Container) -and
        (Test-SameSkill $SourcePath $DestinationPath) -and
        (Test-ManagedSkill $DestinationPath)) {
        return $false
    }
    if (Test-Path -LiteralPath $DestinationPath -PathType Container) {
        if (-not (Test-ManagedSkill $DestinationPath) -and -not (Test-SameSkill $SourcePath $DestinationPath)) {
            throw "豆包中已有同名技能且不属于本安装包，未覆盖：$DestinationPath"
        }
        Remove-Item -LiteralPath $DestinationPath -Recurse -Force
    }
    Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Recurse -Force
    Write-JsonUtf8 (Join-Path $DestinationPath ".fqgate-agent-managed.json") ([ordered]@{
        schemaVersion = 1
        owner = "fqgate-agent"
        skill = $SkillName
        version = $pluginVersion
    })
    return $true
}

if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA 不可用，无法定位豆包配置。" }

$doubaoUserDataRoot = Join-Path $env:LOCALAPPDATA "Doubao\User Data"
$workspaces = @(Get-DoubaoWorkspaces $doubaoUserDataRoot)
$changedCount = 0

foreach ($workspace in $workspaces) {
    $skillsRoot = Join-Path $workspace.Path ".user_skills"
    foreach ($skillName in @($skillNames + $retiredSkillNames)) {
        $destinationPath = Join-Path $skillsRoot $skillName
        if (-not (Test-PathWithin $destinationPath $skillsRoot)) {
            throw "拒绝修改预期目录之外的文件：$destinationPath"
        }
        if ($Uninstall -or $skillName -in $retiredSkillNames) {
            if ((Test-Path -LiteralPath $destinationPath -PathType Container) -and
                (Test-ManagedSkill $destinationPath)) {
                Remove-Item -LiteralPath $destinationPath -Recurse -Force
                $changedCount++
            }
            continue
        }
        $sourcePath = Join-Path $PSScriptRoot "skills\$skillName"
        if (-not (Test-Path -LiteralPath (Join-Path $sourcePath "SKILL.md") -PathType Leaf)) {
            throw "豆包安装包不完整，缺少：$sourcePath\SKILL.md"
        }
        if (Install-Skill $sourcePath $destinationPath $skillName) { $changedCount++ }
    }

    if (-not $Uninstall) {
        $legacyPath = Join-Path $skillsRoot "tonghuasun-agent"
        if (Test-LegacySkill $legacyPath) {
            Remove-Item -LiteralPath $legacyPath -Recurse -Force
            $changedCount++
        }
    }
}

if ($Uninstall) {
    Write-Output "已移除 $changedCount 个由本安装包管理的豆包技能目录；FQGate 程序和共享配置均已保留。"
    Write-Output "豆包连接器属于账号设置，如不再使用，请在豆包连接器页面中手动删除。"
}
elseif ($changedCount -gt 0) {
    Write-Output "同花顺免费开源AI插件FQGate已安装到 $($workspaces.Count) 个豆包本机用户配置。"
}
else {
    Write-Output "豆包技能已经是当前版本。"
}
