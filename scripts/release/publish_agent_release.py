"""暂存和公开 Agent 插件 GitHub Release。"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


SEMVER_PATTERN = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class GitHubApi:
    def __init__(self, token: str, api_root="https://api.github.com"):
        self.token = token
        self.api_root = api_root.rstrip("/")

    def request(self, method, path, value=None, accept="application/vnd.github+json"):
        url = path if path.startswith("https://") else self.api_root + path
        body = None if value is None else json.dumps(value).encode("utf-8")
        headers = {
            "Accept": accept,
            "Authorization": f"Bearer {self.token}",
            "User-Agent": "fqgate-agent-release",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = response.read()
                content_type = response.headers.get("Content-Type", "")
        except urllib.error.HTTPError as error:
            detail = error.read(4096).decode("utf-8", errors="replace")
            raise RuntimeError(f"GitHub API {method} {url} 返回 {error.code}：{detail}") from error
        return json.loads(payload) if "json" in content_type and payload else payload

    def upload_file(self, url: str, path: Path):
        parsed = urllib.parse.urlsplit(url)
        connection = http.client.HTTPSConnection(parsed.hostname, parsed.port, timeout=120)
        request_path = urllib.parse.urlunsplit(("", "", parsed.path, parsed.query, ""))
        connection.putrequest("POST", request_path)
        connection.putheader("Accept", "application/vnd.github+json")
        connection.putheader("Authorization", f"Bearer {self.token}")
        connection.putheader("User-Agent", "fqgate-agent-release")
        connection.putheader("X-GitHub-Api-Version", "2022-11-28")
        connection.putheader("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        connection.putheader("Content-Length", str(path.stat().st_size))
        connection.endheaders()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                connection.send(chunk)
        response = connection.getresponse()
        payload = response.read()
        connection.close()
        if response.status >= 400:
            raise RuntimeError(f"GitHub 资产上传返回 {response.status}：{payload[:4096].decode(errors='replace')}")
        return json.loads(payload)

    def download_asset(self, asset: dict) -> bytes:
        return self.request("GET", asset["url"], accept="application/octet-stream")


def read_release_manifest(path: Path, version: str) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schemaVersion") != 1 or value.get("component") != "fqgate-agent":
        raise ValueError("Agent 发行清单组件无效")
    if value.get("version") != version or value.get("status") != "unpublished":
        raise ValueError("Agent 发行清单版本或状态无效")
    notes = value.get("releaseNotes")
    packages = value.get("packages")
    if not isinstance(notes, list) or not notes or not isinstance(packages, list) or len(packages) != 9:
        raise ValueError("Agent 发行清单必须包含更新说明和九个插件包")
    return value


def collect_artifacts(directory: Path, manifest: dict) -> list[Path]:
    version = manifest["version"]
    expected = {item["fileName"]: item for item in manifest["packages"]}
    checksum_name = f"fqgate-agent-{version}-SHA256SUMS.txt"
    expected_names = {*expected, checksum_name}
    actual = {path.name: path for path in directory.rglob("*") if path.is_file()}
    if set(actual) != expected_names:
        raise ValueError(
            f"Agent 构建资产集合不一致；多余：{sorted(set(actual) - expected_names)}；缺少：{sorted(expected_names - set(actual))}"
        )
    for name, description in expected.items():
        path = actual[name]
        if path.stat().st_size != description["size"] or sha256_file(path) != description["sha256"]:
            raise ValueError(f"Agent 构建资产与发行清单不一致：{name}")
    checksum_lines = actual[checksum_name].read_text(encoding="ascii").strip().splitlines()
    expected_lines = sorted(f"{item['sha256']}  {item['fileName']}" for item in manifest["packages"])
    if sorted(checksum_lines) != expected_lines:
        raise ValueError("Agent SHA256SUMS 文件与发行清单不一致")
    return [actual[name] for name in sorted(expected_names)]


def find_release(api, repository: str, tag: str):
    releases = api.request("GET", f"/repos/{repository}/releases?per_page=100")
    matches = [release for release in releases if release.get("tag_name") == tag]
    if len(matches) > 1:
        raise RuntimeError(f"发现多个同标签 Release：{tag}")
    return matches[0] if matches else None


def release_body(manifest: dict) -> str:
    return "## 本次更新\n\n" + "\n".join(f"- {note}" for note in manifest["releaseNotes"])


def verify_published_assets(api, release: dict, paths: list[Path]) -> None:
    remote = {asset["name"]: asset for asset in release.get("assets", [])}
    if set(remote) != {path.name for path in paths}:
        raise ValueError("已发布 Release 的资产集合与本次构建不一致")
    for path in paths:
        content = api.download_asset(remote[path.name])
        if len(content) != path.stat().st_size or hashlib.sha256(content).hexdigest() != sha256_file(path):
            raise ValueError(f"已发布 Release 的资产内容与本次构建不一致：{path.name}")


def stage_release(api, repository: str, manifest: dict, paths: list[Path], target_commit: str):
    version = manifest["version"]
    tag = f"v{version}"
    release = find_release(api, repository, tag)
    if release and not release.get("draft"):
        verify_published_assets(api, release, paths)
        return release
    if not release:
        release = api.request(
            "POST",
            f"/repos/{repository}/releases",
            {
                "tag_name": tag,
                "target_commitish": target_commit,
                "name": f"同花顺免费开源 AI 插件 FQGate {version}",
                "body": release_body(manifest),
                "draft": True,
                "prerelease": False,
            },
        )
    expected_names = {path.name for path in paths}
    unexpected = sorted(asset["name"] for asset in release.get("assets", []) if asset["name"] not in expected_names)
    if unexpected:
        raise ValueError(f"Agent Draft Release 包含未知资产：{unexpected}")
    for path in paths:
        existing = next((asset for asset in release.get("assets", []) if asset["name"] == path.name), None)
        if existing:
            api.request("DELETE", f"/repos/{repository}/releases/assets/{existing['id']}")
            release["assets"].remove(existing)
        upload_root = release["upload_url"].split("{", 1)[0]
        uploaded = api.upload_file(f"{upload_root}?{urllib.parse.urlencode({'name': path.name})}", path)
        release.setdefault("assets", []).append(uploaded)
    return api.request(
        "PATCH",
        f"/repos/{repository}/releases/{release['id']}",
        {"tag_name": tag, "target_commitish": target_commit, "name": f"同花顺免费开源 AI 插件 FQGate {version}", "body": release_body(manifest), "draft": True},
    )


def publish_release(api, repository: str, version: str) -> dict:
    release = find_release(api, repository, f"v{version}")
    if not release:
        raise ValueError(f"找不到 Agent v{version} Release")
    if release.get("draft"):
        release = api.request(
            "PATCH",
            f"/repos/{repository}/releases/{release['id']}",
            {"tag_name": f"v{version}", "draft": False, "prerelease": False, "make_latest": "true"},
        )
    if release.get("draft") or not release.get("published_at"):
        raise RuntimeError("Agent GitHub Release 没有成功公开")
    return release


def write_output(name: str, value: str) -> None:
    if path := os.environ.get("GITHUB_OUTPUT"):
        with Path(path).open("a", encoding="utf-8") as output:
            output.write(f"{name}={value}\n")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("stage", "publish"))
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", "fqgate/FQGate-agent"))
    parser.add_argument("--version", required=True)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--artifacts", type=Path)
    parser.add_argument("--target-commit")
    args = parser.parse_args(argv)
    if not SEMVER_PATTERN.fullmatch(args.version):
        raise ValueError(f"版本号无效：{args.version}")
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("发布 Agent Release 需要 GITHUB_TOKEN")
    api = GitHubApi(token, os.environ.get("GITHUB_API_URL", "https://api.github.com"))
    if args.command == "stage":
        if not args.manifest or not args.artifacts or not args.target_commit:
            parser.error("stage 必须提供 --manifest、--artifacts 和 --target-commit")
        if not re.fullmatch(r"[0-9a-f]{40}", args.target_commit):
            raise ValueError("target commit 必须是完整 Git SHA")
        manifest = read_release_manifest(args.manifest, args.version)
        release = stage_release(api, args.repository, manifest, collect_artifacts(args.artifacts, manifest), args.target_commit)
        print(json.dumps({"draftUrl": release.get("html_url"), "draft": release.get("draft")}, ensure_ascii=False))
    else:
        release = publish_release(api, args.repository, args.version)
        write_output("published_at", release["published_at"])
        print(json.dumps({"releaseUrl": release.get("html_url"), "publishedAt": release["published_at"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"Agent GitHub Release 发布失败：{error}", file=sys.stderr)
        raise SystemExit(1)
