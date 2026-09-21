import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from sync_gitee_release import read_published_manifest, synchronize_release, synchronize_assets_release


class FakeGiteeApi:
    def __init__(self, release=None, assets=None):
        self.release = release
        self.assets = list(assets or [])
        self.contents = {}
        self.uploaded = []

    def request(self, method, path, form=None, accept="application/json"):
        if "/releases/tags/" in path:
            if not self.release:
                from sync_gitee_release import GiteeNotFoundError

                raise GiteeNotFoundError("missing")
            return self.release
        if method == "POST" and path.endswith("/releases"):
            self.release = {"id": 7, **form, "prerelease": False}
            return self.release
        if method == "PATCH":
            self.release.update(form)
            self.release["prerelease"] = form.get("prerelease") == "true"
            return self.release
        if path.endswith("attach_files?per_page=100"):
            return self.assets
        if path.endswith("/download"):
            asset_id = int(path.split("/")[-2])
            return self.contents[asset_id]
        raise AssertionError((method, path, form, accept))

    def upload_file(self, repository, release_id, path):
        asset = {"id": 100 + len(self.assets), "name": path.name}
        self.assets.append(asset)
        self.contents[asset["id"]] = path.read_bytes()
        self.uploaded.append(path.name)
        return asset

    def download_asset(self, remote):
        return self.contents[remote["id"]]


def create_fixture(root: Path, status="published"):
    version = "1.2.3"
    paths = []
    packages = []
    checksum_lines = []
    adapters = (
        "claude-code",
        "codex",
        "deepseek-harness",
        "doubao",
        "openclaw",
        "qianwen",
        "workbuddy",
        "zcode",
        "zcode-marketplace",
    )
    for adapter in adapters:
        extension = "tgz" if adapter == "deepseek-harness" else "zip"
        path = root / f"fqgate-agent-{adapter}-{version}.{extension}"
        path.write_bytes(path.name.encode("utf-8"))
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        packages.append({"adapter": adapter, "fileName": path.name, "size": path.stat().st_size, "sha256": digest})
        checksum_lines.append(f"{digest}  {path.name}")
        paths.append(path)
    checksum = root / f"fqgate-agent-{version}-SHA256SUMS.txt"
    checksum.write_text("\n".join(sorted(checksum_lines)) + "\n", encoding="ascii")
    paths.append(checksum)
    manifest = {
        "schemaVersion": 1,
        "component": "fqgate-agent",
        "status": status,
        "version": version,
        "releaseUrls": {
            "github": f"https://github.com/fqgate/FQGate-agent/releases/tag/v{version}",
            "gitee": f"https://gitee.com/qicuo/tonghuasun-agent/releases/tag/v{version}",
        },
        "releaseNotes": ["发布测试"],
        "packages": packages,
    }
    manifest_path = root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return version, manifest_path, manifest, sorted(paths, key=lambda path: path.name)


class SyncGiteeReleaseTests(unittest.TestCase):
    def test_fqgate_uses_independent_tag_and_repository(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "FQGate-1.0.0-windows-x64-UNSIGNED.exe"
            path.write_bytes(b"verified-release")
            api = FakeGiteeApi()
            release = synchronize_assets_release(api, "qicuo/fqgate-releases", "fqgate-v1.0.0",
                                                  "FQGate v1.0.0", "行情更新", [path], "a" * 40)
            self.assertEqual(release["tag_name"], "fqgate-v1.0.0")
            self.assertEqual(api.uploaded, [path.name])

    def test_rejects_unpublished_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            version, manifest_path, _, _ = create_fixture(Path(directory), status="unpublished")
            with self.assertRaisesRegex(ValueError, "已经公开"):
                read_published_manifest(manifest_path, version)

    def test_creates_release_and_uploads_all_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            _, _, manifest, paths = create_fixture(Path(directory))
            api = FakeGiteeApi()
            release = synchronize_release(api, "qicuo/tonghuasun-agent", manifest, paths, "a" * 40)
            self.assertEqual(release["tag_name"], "v1.2.3")
            self.assertEqual(set(api.uploaded), {path.name for path in paths})

    def test_rerun_accepts_identical_assets_without_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            _, _, manifest, paths = create_fixture(Path(directory))
            release = {
                "id": 7,
                "tag_name": "v1.2.3",
                "target_commitish": "a" * 40,
                "name": "同花顺免费开源 AI 插件 FQGate 1.2.3",
                "body": "## 本次更新\n\n- 发布测试",
                "prerelease": False,
            }
            assets = [{"id": index, "name": path.name} for index, path in enumerate(paths, start=1)]
            api = FakeGiteeApi(release, assets)
            api.contents = {asset["id"]: path.read_bytes() for asset, path in zip(assets, paths)}
            synchronize_release(api, "qicuo/tonghuasun-agent", manifest, paths, "a" * 40)
            self.assertEqual(api.uploaded, [])

    def test_rejects_changed_remote_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            _, _, manifest, paths = create_fixture(Path(directory))
            release = {"id": 7, "target_commitish": "a" * 40, "name": "", "body": "", "prerelease": False}
            asset = {"id": 1, "name": paths[0].name}
            api = FakeGiteeApi(release, [asset])
            api.contents = {1: b"changed"}
            with self.assertRaisesRegex(ValueError, "不一致"):
                synchronize_release(api, "qicuo/tonghuasun-agent", manifest, paths, "a" * 40)

    def test_rejects_unknown_remote_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            _, _, manifest, paths = create_fixture(Path(directory))
            release = {"id": 7, "target_commitish": "a" * 40, "name": "", "body": "", "prerelease": False}
            api = FakeGiteeApi(release, [{"id": 1, "name": "unknown.zip"}])
            with self.assertRaisesRegex(ValueError, "未知资产"):
                synchronize_release(api, "qicuo/tonghuasun-agent", manifest, paths, "a" * 40)

    def test_rejects_release_pointing_to_another_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            _, _, manifest, paths = create_fixture(Path(directory))
            release = {"id": 7, "target_commitish": "b" * 40, "name": "", "body": "", "prerelease": False}
            api = FakeGiteeApi(release)
            with self.assertRaisesRegex(ValueError, "不同提交"):
                synchronize_release(api, "qicuo/tonghuasun-agent", manifest, paths, "a" * 40)


if __name__ == "__main__":
    unittest.main()
