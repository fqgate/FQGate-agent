"""把已经公开的 Agent GitHub Release 原样同步到 Gitee。"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import mimetypes
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from publish_agent_release import collect_artifacts, release_body, sha256_file


SEMVER_PATTERN = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


class GiteeNotFoundError(RuntimeError):
    """Gitee API 明确返回资源不存在。"""


class GiteeApi:
    def __init__(self, token: str, api_root="https://gitee.com/api/v5"):
        self.token = token
        self.api_root = api_root.rstrip("/")

    def request(self, method: str, path: str, form: dict | None = None, accept="application/json"):
        url = path if path.startswith("https://") else self.api_root + path
        body = None if form is None else urllib.parse.urlencode(form).encode("utf-8")
        headers = {
            "Accept": accept,
            "Authorization": f"Bearer {self.token}",
            "User-Agent": "fqgate-agent-gitee-sync",
        }
        if body is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = response.read()
                content_type = response.headers.get("Content-Type", "")
        except urllib.error.HTTPError as error:
            detail = error.read(4096).decode("utf-8", errors="replace")
            if error.code == 404:
                raise GiteeNotFoundError(f"Gitee API 未找到资源：{url}") from error
            raise RuntimeError(f"Gitee API {method} {url} 返回 {error.code}：{detail}") from error
        return json.loads(payload) if "json" in content_type and payload else payload

    def upload_file(self, repository: str, release_id: int, path: Path):
        boundary = f"----fqgate-{uuid.uuid4().hex}"
        prefix = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
            f"Content-Type: {mimetypes.guess_type(path.name)[0] or 'application/octet-stream'}\r\n\r\n"
        ).encode("utf-8")
        suffix = f"\r\n--{boundary}--\r\n".encode("ascii")
        parsed = urllib.parse.urlsplit(
            f"{self.api_root}/repos/{repository}/releases/{release_id}/attach_files"
        )
        connection = http.client.HTTPSConnection(parsed.hostname, parsed.port, timeout=120)
        connection.putrequest("POST", parsed.path)
        connection.putheader("Accept", "application/json")
        connection.putheader("Authorization", f"Bearer {self.token}")
        connection.putheader("User-Agent", "fqgate-agent-gitee-sync")
        connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
        connection.putheader("Content-Length", str(len(prefix) + path.stat().st_size + len(suffix)))
        connection.endheaders()
        connection.send(prefix)
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                connection.send(chunk)
        connection.send(suffix)
        response = connection.getresponse()
        payload = response.read()
        connection.close()
        if response.status >= 400:
            raise RuntimeError(f"Gitee 资产上传返回 {response.status}：{payload[:4096].decode(errors='replace')}")
        return json.loads(payload)

    def download_asset(self, remote: dict) -> bytes:
        url = remote.get("browser_download_url")
        if not isinstance(url, str) or urllib.parse.urlsplit(url).hostname != "gitee.com":
            raise ValueError("Gitee 资产缺少可信下载地址")
        request = urllib.request.Request(url, headers={"User-Agent": "fqgate-agent-gitee-sync"})
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()


def read_published_manifest(path: Path, version: str) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schemaVersion") != 1 or value.get("component") != "fqgate-agent":
        raise ValueError("Agent 发行清单组件无效")
    if value.get("version") != version or value.get("status") != "published":
        raise ValueError("只能同步已经公开的 Agent 发行清单")
    urls = value.get("releaseUrls")
    packages = value.get("packages")
    notes = value.get("releaseNotes")
    if not isinstance(urls, dict) or not urls.get("github") or not urls.get("gitee"):
        raise ValueError("Agent 发行清单缺少 GitHub 或 Gitee 地址")
    if not isinstance(packages, list) or len(packages) != 9 or not isinstance(notes, list) or not notes:
        raise ValueError("Agent 发行清单必须包含更新说明和九个插件包")
    return value


def find_release(api, repository: str, tag: str):
    try:
        return api.request("GET", f"/repos/{repository}/releases/tags/{tag}")
    except GiteeNotFoundError:
        return None


def verify_asset(api, repository: str, release_id: int, remote: dict, local: Path) -> None:
    content = api.download_asset(remote)
    if len(content) != local.stat().st_size or hashlib.sha256(content).hexdigest() != sha256_file(local):
        raise ValueError(f"Gitee 已有资产内容与 GitHub 发行资产不一致：{local.name}")


def synchronize_release(api, repository: str, manifest: dict, paths: list[Path], target_commit: str) -> dict:
    version = manifest["version"]
    return synchronize_assets_release(
        api, repository, f"v{version}", f"同花顺免费开源 AI 插件 FQGate {version}",
        release_body(manifest), paths, target_commit,
    )


def synchronize_assets_release(api, repository: str, tag: str, expected_name: str,
                               expected_body: str, paths: list[Path], target_commit: str) -> dict:
    """两类公开发行共用资产同步规则，不覆盖内容不同的已上传文件。"""
    release = find_release(api, repository, tag)
    if not release:
        release = api.request(
            "POST",
            f"/repos/{repository}/releases",
            {
                "tag_name": tag,
                "target_commitish": target_commit,
                "name": expected_name,
                "body": expected_body,
                "prerelease": "false",
            },
        )
    elif release.get("target_commitish") not in {target_commit, tag}:
        raise ValueError(f"Gitee Release {tag} 指向了不同提交")

    current_body = str(release.get("body") or "").replace("\r\n", "\n")
    if release.get("name") != expected_name or current_body != expected_body or release.get("prerelease"):
        release = api.request(
            "PATCH",
            f"/repos/{repository}/releases/{release['id']}",
            {"name": expected_name, "body": expected_body, "prerelease": "false"},
        )

    remote_assets = api.request(
        "GET", f"/repos/{repository}/releases/{release['id']}/attach_files?per_page=100"
    )
    remote_by_name = {asset["name"]: asset for asset in remote_assets}
    expected_by_name = {path.name: path for path in paths}
    unexpected = sorted(set(remote_by_name) - set(expected_by_name))
    if unexpected:
        raise ValueError(f"Gitee Release 包含未知资产：{unexpected}")

    # 已存在的同名资产必须逐字节一致；只补传缺失资产，避免恢复运行覆盖公开文件。
    for name, path in expected_by_name.items():
        if remote := remote_by_name.get(name):
            verify_asset(api, repository, release["id"], remote, path)
        else:
            api.upload_file(repository, release["id"], path)

    completed = api.request(
        "GET", f"/repos/{repository}/releases/{release['id']}/attach_files?per_page=100"
    )
    if {asset["name"] for asset in completed} != set(expected_by_name):
        raise RuntimeError("Gitee Release 资产上传后仍不完整")
    for asset in completed:
        verify_asset(api, repository, release["id"], asset, expected_by_name[asset["name"]])
    return release


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "publish"))
    parser.add_argument("--repository", default="qicuo/tonghuasun-agent")
    parser.add_argument("--version", required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--target-commit")
    args = parser.parse_args(argv)
    if not SEMVER_PATTERN.fullmatch(args.version):
        raise ValueError(f"版本号无效：{args.version}")
    manifest = read_published_manifest(args.manifest, args.version)
    paths = collect_artifacts(args.artifacts, manifest)
    if args.command == "verify":
        print(json.dumps({"version": args.version, "assets": len(paths)}, ensure_ascii=False))
        return 0
    if not args.target_commit or not re.fullmatch(r"[0-9a-f]{40}", args.target_commit):
        raise ValueError("发布到 Gitee 时必须提供完整的目标提交 SHA")
    token = os.environ.get("GITEE_TOKEN")
    if not token:
        raise RuntimeError("同步 Gitee Release 需要 GITEE_TOKEN")
    api = GiteeApi(token, os.environ.get("GITEE_API_URL", "https://gitee.com/api/v5"))
    release = synchronize_release(api, args.repository, manifest, paths, args.target_commit)
    print(json.dumps({"tag": release.get("tag_name"), "releaseId": release.get("id")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"Agent Gitee Release 同步失败：{error}", file=os.sys.stderr)
        raise SystemExit(1)
