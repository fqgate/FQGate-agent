import hashlib
import json
import tempfile
import unittest
from unittest.mock import Mock
from pathlib import Path

from publish_agent_release import collect_artifacts, read_release_manifest, publish_release, stage_release


class PublishAgentReleaseTests(unittest.TestCase):
    def test_draft_update_preserves_release_tag(self):
        api = Mock()
        api.request.side_effect = [[], {"id": 1, "assets": [], "upload_url": "https://uploads.github.test"}, {}]
        stage_release(api, "owner/repo", {"version": "1.0.0", "releaseNotes": ["更新"]}, [], "a" * 40)
        self.assertEqual(api.request.call_args.args[2]["tag_name"], "v1.0.0")
        self.assertEqual(api.request.call_args.args[2]["target_commitish"], "a" * 40)

    def test_publish_preserves_release_tag(self):
        api = Mock()
        api.request.side_effect = [
            [{"id": 1, "tag_name": "v1.0.0", "draft": True}],
            {"tag_name": "v1.0.0", "draft": False, "published_at": "2026-09-15T00:00:00Z"},
        ]
        publish_release(api, "owner/repo", "1.0.0")
        self.assertEqual(api.request.call_args.args[2]["tag_name"], "v1.0.0")

    def create_fixture(self, root: Path):
        version = "1.2.3"
        packages = []
        checksum = []
        for adapter, extension in (("codex", "zip"), ("claude-code", "zip"), ("deepseek-harness", "tgz"), ("doubao", "zip"), ("openclaw", "zip"), ("qianwen", "zip"), ("workbuddy", "zip"), ("zcode", "zip"), ("zcode-marketplace", "zip")):
            file_name = f"fqgate-agent-{adapter}-{version}.{extension}"
            content = file_name.encode()
            (root / file_name).write_bytes(content)
            digest = hashlib.sha256(content).hexdigest()
            packages.append({"adapter": adapter, "fileName": file_name, "size": len(content), "sha256": digest})
            checksum.append(f"{digest}  {file_name}")
        (root / f"fqgate-agent-{version}-SHA256SUMS.txt").write_text("\n".join(sorted(checksum)) + "\n")
        manifest = {
            "schemaVersion": 1,
            "component": "fqgate-agent",
            "status": "unpublished",
            "version": version,
            "publishedAtUtc": None,
            "releaseUrls": {"github": "https://example.test"},
            "releaseNotes": ["修复问题"],
            "packages": packages,
        }
        manifest_path = root / "manifest.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        return version, manifest_path

    def test_collects_manifest_artifacts_and_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            version, manifest_path = self.create_fixture(root)
            manifest = read_release_manifest(manifest_path, version)
            manifest_path.unlink()
            self.assertEqual(len(collect_artifacts(root, manifest)), 10)

    def test_rejects_changed_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            version, manifest_path = self.create_fixture(root)
            manifest = read_release_manifest(manifest_path, version)
            manifest_path.unlink()
            (root / manifest["packages"][0]["fileName"]).write_text("changed")
            with self.assertRaisesRegex(ValueError, "不一致"):
                collect_artifacts(root, manifest)


if __name__ == "__main__":
    unittest.main()
