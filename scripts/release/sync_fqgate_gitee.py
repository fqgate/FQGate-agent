"""从 FQGate 官方发行仓库校验并同步主程序，绝不访问私有源码仓库。"""

import argparse
import json
import os
import sys
from pathlib import Path

from sync_gitee_release import GiteeApi, SEMVER_PATTERN, synchronize_assets_release


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--target-commit", required=True)
    args = parser.parse_args()
    if not SEMVER_PATTERN.fullmatch(args.version):
        raise ValueError("主程序版本号无效")
    import re
    if not re.fullmatch(r"[0-9a-f]{40}", args.target_commit):
        raise ValueError("目标提交必须是完整 SHA")
    sys.path.insert(0, str(args.source.resolve() / "scripts"))
    from finalize_release import GitHubApi, build_candidate

    args.artifacts.mkdir(parents=True, exist_ok=True)

    class CachedGitHubApi(GitHubApi):
        def download_asset(self, asset):
            name = asset["name"]
            if Path(name).name != name or "/" in name or "\\" in name:
                raise ValueError("非法资产文件名")
            path = args.artifacts / name
            if not path.exists():
                path.write_bytes(super().download_asset(asset))
            return path.read_bytes()

    # 复用官方的三平台、构建编号、SHA-256 和资产集合校验；下载只做一次。
    github = CachedGitHubApi(os.environ["GITHUB_TOKEN"])
    candidate = build_candidate(github, "zhuyifang/fqgate-releases", args.version)
    manifest = candidate["manifest"]
    committed = json.loads((args.source / "releases" / f"{args.version}.json").read_text(encoding="utf-8"))
    if manifest["status"] != "published" or not manifest["publishedAt"] or manifest != committed:
        raise ValueError("只允许同步与 GitHub 已公开发行一致的正式清单")
    paths = sorted(path for path in args.artifacts.iterdir() if path.is_file())
    body = "## 本次更新\n\n" + "\n".join(f"- {note}" for note in manifest["releaseNotes"])
    release = synchronize_assets_release(
        GiteeApi(os.environ["GITEE_TOKEN"]), "qicuo/fqgate-releases", candidate["tag"],
        f"FQGate v{args.version}", body, paths, args.target_commit,
    )
    print(json.dumps({"tag": release["tag_name"], "assets": len(paths)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print(f"FQGate Gitee 同步失败：{error}", file=sys.stderr)
        raise SystemExit(1)
