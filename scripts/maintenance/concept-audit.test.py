import contextlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


SCRIPT = Path(__file__).resolve().with_name("concept-audit.fsx")
REVISION = "0123456789012345678901234567890123456789"
GUIDE = "docs/homepage/guide.md"
RANGE_GUIDE = "docs/homepage/guide-ranges.md"
CODE = "packages/ragents/src/example.ts"
TEST = "apps/server/tests/example.test.ts"
PRIVATE = "plugins/private.fixture/server/private.ts"
SYMLINK = "plugins/ragents.fixture/server/linked.ts"


def tool_value(message):
    value = message["content"]
    if isinstance(value, list):
        value = "\n".join(part["text"] for part in value if part.get("type") == "text")
    for _ in range(3):
        if not isinstance(value, str):
            break
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            break
    return value


class MockAudit:
    def __init__(self, output, mode="success"):
        self.output = output
        self.mode = mode
        self.requests = []
        self.errors = []
        self.catalogs = {}
        self.guide_denial = None
        self.synthesis_results = 0
        self.barrier = threading.Barrier(3, timeout=10)
        self.lock = threading.Lock()

    def role(self, request):
        instruction = " ".join(str(message["content"]) for message in request["messages"] if message["role"] in ("system", "developer"))
        for fragment, role in [("merge three independent", "synthesis"), ("host UI", "ui-reader"), ("server and runtime", "runtime-reader"), ("plugin boundaries", "plugin-reader"), ("new user", "guide-reader"), ("architecture", "code-reader"), ("transitions and failure cases", "boundary-reader")]:
            if fragment in instruction:
                return role
        raise AssertionError("Unknown role: " + instruction)

    def call(self, request, name, arguments):
        definition = next(tool["function"] for tool in request["tools"] if tool["function"]["name"] == name)
        schema = definition["parameters"]
        assert set(schema.get("required", [])) <= set(arguments), schema
        assert set(arguments) <= set(schema["properties"]), schema
        for key, value in arguments.items():
            kind = schema["properties"][key].get("type")
            assert kind not in ("integer", "string") or isinstance(value, int if kind == "integer" else str), (key, kind)
        return {"role": "assistant", "content": None, "tool_calls": [{"id": f"call-{name}-{len(request['messages'])}", "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}]}

    def reply(self, request):
        role = self.role(request)
        with self.lock:
            self.requests.append((role, request))
        messages = request["messages"]
        tool_messages = [message for message in messages if message["role"] == "tool"]
        if role == "synthesis" and self.mode == "empty-result" and self.synthesis_results == 0:
            self.synthesis_results += 1
            return {"role": "assistant", "content": json.dumps({"findings": [], "openQuestions": []})}
        if not tool_messages:
            if role != "synthesis":
                self.barrier.wait()
            if self.mode == "timeout":
                time.sleep(3)
            if self.mode == "heartbeat" and role == "guide-reader":
                time.sleep(21)
            return self.call(request, "list_sources", {"query": ""})
        catalog = tool_value(tool_messages[0])
        assert isinstance(catalog, dict) and "files" in catalog, catalog
        self.catalogs[role] = catalog
        if role == "guide-reader" and len(tool_messages) == 1:
            manifest = json.loads((self.output / "manifest.json").read_text())
            code_ref = next(source["fileRef"] for source in manifest["sources"] if source["path"] == CODE)
            return self.call(request, "read_source", {"fileRef": code_ref, "startLine": 1, "lineCount": 2})
        if role == "guide-reader" and len(tool_messages) == 2:
            self.guide_denial = tool_value(tool_messages[-1])
            assert not isinstance(self.guide_denial, dict) or "content" not in self.guide_denial, self.guide_denial
        split_reading = role == "synthesis" and self.mode in ("adjacent-ranges", "gapped-ranges")
        if split_reading and len(tool_messages) < 3:
            selected = next(source for source in catalog["files"] if source["path"] == RANGE_GUIDE)
            start = (2 if self.mode == "adjacent-ranges" else 3) if len(tool_messages) == 1 else 1
            return self.call(request, "read_source", {"fileRef": selected["fileRef"], "startLine": start, "lineCount": 1})
        has_read = len(tool_messages) >= (3 if role == "guide-reader" else 2)
        if not has_read:
            wanted = CODE if self.mode == "duplicates" and role in ("ui-reader", "runtime-reader", "synthesis") else TEST if self.mode == "duplicates" else GUIDE if role in ("guide-reader", "synthesis") else CODE if role == "code-reader" else TEST
            selected = next(source for source in catalog["files"] if source["path"] == wanted)
            return self.call(request, "read_source", {"fileRef": selected["fileRef"], "startLine": 1, "lineCount": 2})
        reading = tool_value(tool_messages[-1])
        assert isinstance(reading, dict) and reading["startLine"] == 1 and reading["endLine"] == (1 if split_reading else 2), reading
        assert reading["content"].startswith("1: "), reading
        if role != "synthesis":
            return {"role": "assistant", "content": f"Review {role}: file reference {reading['fileRef']}, lines 1-2 show an open concept question."}
        self.synthesis_results += 1
        if self.mode == "schema-instead-of-report" and self.synthesis_results == 1:
            return {"role": "assistant", "content": json.dumps({"type": "array", "items": {"type": "object", "properties": {"topic": {"type": "string"}}}})}
        if self.mode == "missing-findings":
            return {"role": "assistant", "content": json.dumps({"assessment": "The review is still incomplete.", "openQuestions": ["The findings are still missing."]})}
        line = 4 if self.mode == "invalid-citation" else 1
        if self.mode == "duplicates":
            second_ref = next(source["fileRef"] for source in self.catalogs["plugin-reader"]["files"] if source["path"] == TEST)
            result = {"assessment": "Both read completion paths perform the same step; the duplicate hint stands.", "findings": [{"topic": "Duplicate completion", "question": "Two paths?", "answer": "Both perform the same completion.", "impact": "Diverging fixes possible.", "replacement": "Shared completion helper.", "priority": "medium", "evidence": [{"fileRef": reading["fileRef"], "startLine": 1, "endLine": 1}, {"fileRef": second_ref, "startLine": 1, "endLine": 1}]}], "openQuestions": ["Further modules not examined."]}
            return {"role": "assistant", "content": json.dumps(result, ensure_ascii=False)}
        code_ref = next(source["fileRef"] for source in self.catalogs["code-reader"]["files"] if source["path"] == CODE)
        result = {"assessment": "The comparison confirms the question about lifetime; the explanation of the restart remains open.", "findings": [{"topic": "Lifetime", "question": "When does the flow end?", "answer": "A completion is described explicitly.", "guideGap": "The relation to the restart is missing.", "suggestedChapter": "Runtime", "priority": "medium", "evidence": [{"fileRef": reading["fileRef"], "startLine": line, "endLine": line}, {"fileRef": code_ref, "startLine": 1, "endLine": 1}]}], "openQuestions": ["Is resuming planned for later?"]}
        if split_reading:
            result["findings"][0]["evidence"][0]["endLine"] = 2 if self.mode == "adjacent-ranges" else 3
        return {"role": "assistant", "content": json.dumps(result, ensure_ascii=False)}


@contextlib.contextmanager
def mock_endpoint(mock):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            try:
                assert self.path == "/v1/chat/completions", self.path
                assert self.headers.get("Authorization") == "Bearer test-only"
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                assert request["model"] == "fixture-audit", request
                if mock.mode == "duplicates":
                    assert request.get("reasoning") == {"effort": "high"}, request.get("reasoning")
                message = mock.reply(request)
                body = json.dumps({"id": "fixture-completion", "object": "chat.completion", "created": 1, "model": "fixture-audit", "choices": [{"index": 0, "message": message, "finish_reason": "tool_calls" if "tool_calls" in message else "stop"}], "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20}}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as error:
                mock.errors.append(repr(error))
                self.send_error(500, "Fixture failure")

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


class ConceptAuditTests(unittest.TestCase):
    def setUp(self):
        self.scratch = Path(tempfile.mkdtemp(prefix="ragents-concept-audit-tests-", dir="/private/tmp"))
        self.addCleanup(shutil.rmtree, self.scratch)
        self.repo = self.scratch / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "--quiet", str(self.repo)], check=True, capture_output=True)
        (self.repo / ".git/HEAD").write_text(REVISION + "\n")
        for filename, content in {
            GUIDE: "# Public guide\nAn actor processes inputs.\nA turn delivers a result.\nUnread fourth line.\n",
            CODE: "export const finish = () => 'done';\nexport const restart = () => finish();\n",
            TEST: "import assert from 'node:assert/strict';\nassert.equal('done', 'done');\n",
            PRIVATE: "private fixture content must remain excluded\n",
        }.items():
            file = self.repo / filename
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(content)
        linked = self.repo / SYMLINK
        linked.parent.mkdir(parents=True)
        linked.symlink_to(self.repo / PRIVATE)
        self.output = self.scratch / "audit"

    def run_audit(self, endpoint="http://127.0.0.1:1/v1", extra=(), with_key=True):
        environment = {**os.environ, "DOTNET_CLI_TELEMETRY_OPTOUT": "1"}
        environment.pop("OPENROUTER_API_KEY", None)
        environment.pop("PRIVATE_MODEL_API_KEY", None)
        if with_key:
            environment["OPENROUTER_API_KEY"] = "test-only"
        result = subprocess.run(["dotnet", "fsi", str(SCRIPT), "--", "--repo", str(self.repo), "--output", str(self.output), "--model", "fixture-audit", "--endpoint", endpoint, "--max-calls", "8", "--timeout-seconds", "20", *extra], env=environment, capture_output=True, text=True, timeout=120)
        self.command_output = result.stdout + result.stderr
        return result

    def assert_failed(self, result):
        self.assertNotEqual(result.returncode, 0, self.command_output)
        self.assertFalse((self.output / "report.md").exists(), self.command_output)
        self.assertEqual(json.loads((self.output / "status.json").read_text())["status"], "failed")

    def test_dry_run_needs_no_key_or_model_and_excludes_private_sources(self):
        result = self.run_audit(extra=("--dry-run",), with_key=False)
        self.assertEqual(result.returncode, 0, self.command_output)
        manifest = json.loads((self.output / "manifest.json").read_text())
        self.assertEqual(manifest["revision"], REVISION)
        self.assertEqual({source["path"] for source in manifest["sources"]}, {GUIDE, CODE, TEST})
        self.assertEqual(manifest["skippedSymlinks"], [SYMLINK])
        self.assertFalse((self.output / "report.md").exists())
        self.assertEqual(list(self.output.glob("*.txt")), [])
        self.assertEqual(json.loads((self.output / "status.json").read_text())["status"], "dry-run")

    def test_parallel_reviewers_and_synthesis_publish_only_read_evidence(self):
        mock = MockAudit(self.output)
        with mock_endpoint(mock) as endpoint:
            result = self.run_audit(endpoint)
        self.assertEqual(mock.errors, [], self.command_output)
        self.assertEqual(result.returncode, 0, self.command_output)
        self.assertEqual(json.loads((self.output / "status.json").read_text())["status"], "completed")
        self.assertEqual({role for role, _ in mock.requests[:3]}, {"guide-reader", "code-reader", "boundary-reader"})
        self.assertEqual({entry["path"] for entry in mock.catalogs["guide-reader"]["files"]}, {GUIDE})
        self.assertEqual({entry["path"] for entry in mock.catalogs["code-reader"]["files"]}, {CODE, TEST})
        self.assertIsNotNone(mock.guide_denial)
        manifest = json.loads((self.output / "manifest.json").read_text())
        sources = {source["fileRef"]: source["path"] for source in manifest["sources"]}
        coverage = json.loads((self.output / "coverage.json").read_text())
        self.assertEqual({reading["role"] for reading in coverage}, {"guide-reader", "code-reader", "boundary-reader", "synthesis"})
        for reading in coverage:
            self.assertEqual((reading["startLine"], reading["endLine"]), (1, 2))
            if reading["role"] == "guide-reader":
                self.assertEqual(sources[reading["fileRef"]], GUIDE)
        report = (self.output / "report.md").read_text()
        self.assertIn("## Lifetime", report)
        self.assertIn(GUIDE + ":1-1", report)
        self.assertIn("```\n# Public guide\n```", report)
        self.assertIn(CODE + ":1-1", report)
        self.assertIn("export const finish = () => 'done';", report)
        self.assertNotIn("private fixture content", report)
        for role in ("guide-reader", "code-reader", "boundary-reader", "synthesis"):
            self.assertTrue((self.output / (role + ".txt")).read_text().strip())
            self.assertGreaterEqual(json.loads((self.output / (role + "-usage.json")).read_text())["calls"], 3)

    def test_duplicate_scan_reads_css_and_all_plugins_without_needing_guide(self):
        (self.repo / GUIDE).unlink()
        css = self.repo / "apps/web/src/example.css"
        css.parent.mkdir(parents=True)
        css.write_text(".example { padding: 8px; }\n")
        mock = MockAudit(self.output, "duplicates")
        with mock_endpoint(mock) as endpoint:
            result = self.run_audit(endpoint, extra=("--duplicates", "--reasoning-high", "--max-calls", "3"))
        self.assertEqual(mock.errors, [], self.command_output)
        self.assertEqual(result.returncode, 0, self.command_output)
        manifest = json.loads((self.output / "manifest.json").read_text())
        self.assertEqual({source["path"] for source in manifest["sources"]}, {CODE, TEST, PRIVATE, "apps/web/src/example.css"})
        self.assertEqual({role for role, _ in mock.requests[:3]}, {"ui-reader", "runtime-reader", "plugin-reader"})
        for role in ("ui-reader", "runtime-reader", "plugin-reader", "synthesis"):
            requests = [request for current, request in mock.requests if current == role]
            self.assertEqual(len(requests), 3)
            self.assertEqual(requests[-1]["tool_choice"], "none")
        report = (self.output / "report.md").read_text()
        self.assertIn("# Duplicate implementation audit", report)
        self.assertIn("Concrete impact: Diverging fixes possible.", report)
        self.assertIn("Shared replacement: Shared completion helper.", report)
        self.assertNotIn("Gap in the guide", report)

    def test_unread_citation_fails_without_publishing_a_report(self):
        mock = MockAudit(self.output, "invalid-citation")
        with mock_endpoint(mock) as endpoint:
            result = self.run_audit(endpoint)
        self.assertEqual(mock.errors, [], self.command_output)
        self.assert_failed(result)
        self.assertIn("Unverified source range", self.command_output)
        self.assertTrue((self.output / "synthesis.txt").exists())
        self.assertTrue((self.output / "coverage.json").exists())
        self.assertEqual(mock.synthesis_results, 3)
        self.assertRegex(self.command_output, r"[Cc]orrection")

    def test_schema_response_is_corrected_without_repeating_the_reviewers(self):
        mock = MockAudit(self.output, "schema-instead-of-report")
        with mock_endpoint(mock) as endpoint:
            result = self.run_audit(endpoint)
        self.assertEqual(mock.errors, [], self.command_output)
        self.assertEqual(result.returncode, 0, self.command_output)
        self.assertEqual(mock.synthesis_results, 2)
        self.assertRegex(result.stdout, r"[Cc]orrection")
        self.assertEqual(json.loads((self.output / "status.json").read_text())["status"], "completed")
        self.assertIn("## Lifetime", (self.output / "report.md").read_text())
        for role, count in [("guide-reader", 4), ("code-reader", 3), ("boundary-reader", 3)]:
            self.assertEqual(sum(actual == role for actual, _ in mock.requests), count, role)
        synthesis_requests = [request for role, request in mock.requests if role == "synthesis"]
        usage = json.loads((self.output / "synthesis-usage.json").read_text())
        self.assertEqual(usage["usage"]["TotalTokenCount"], len(synthesis_requests) * 20)
        for request in synthesis_requests:
            response_format = request["response_format"]
            self.assertEqual(response_format["type"], "json_schema")
            schema = response_format["json_schema"]["schema"]
            self.assertEqual(schema["type"], "object")
            self.assertEqual(set(schema["required"]), {"assessment", "findings", "openQuestions"})
        self.assertTrue(any("findings" in json.dumps(request["messages"], ensure_ascii=False) for request in synthesis_requests[3:]))

    def test_adjacent_reads_cover_a_single_combined_citation(self):
        (self.repo / RANGE_GUIDE).write_text("First supported line.\nSecond supported line.\nThird line.\n")
        mock = MockAudit(self.output, "adjacent-ranges")
        with mock_endpoint(mock) as endpoint:
            result = self.run_audit(endpoint)
        self.assertEqual(mock.errors, [], self.command_output)
        self.assertEqual(result.returncode, 0, self.command_output)
        self.assertEqual(json.loads((self.output / "status.json").read_text())["status"], "completed")
        coverage = json.loads((self.output / "coverage.json").read_text())
        reads = [reading for reading in coverage if reading["role"] == "synthesis"]
        self.assertEqual([(reading["startLine"], reading["endLine"]) for reading in reads], [(2, 2), (1, 1)])
        report = (self.output / "report.md").read_text()
        self.assertIn(RANGE_GUIDE + ":1-2", report)
        self.assertIn("```\nFirst supported line.\nSecond supported line.\n```", report)

    def test_empty_result_requires_an_assessment_and_source_reading_before_completion(self):
        mock = MockAudit(self.output, "empty-result")
        with mock_endpoint(mock) as endpoint:
            result = self.run_audit(endpoint)
        self.assertEqual(mock.errors, [], self.command_output)
        self.assertEqual(result.returncode, 0, self.command_output)
        self.assertEqual(mock.synthesis_results, 2)
        self.assertRegex(result.stdout, r"[Cc]orrection")
        self.assertEqual(json.loads((self.output / "synthesis-attempt-1.txt").read_text()), {"findings": [], "openQuestions": []})
        self.assertEqual(json.loads((self.output / "status.json").read_text())["status"], "completed")
        report = (self.output / "report.md").read_text()
        self.assertIn("Assessment of the reviewer reports: The comparison confirms", report)
        self.assertIn("## Lifetime", report)
        coverage = json.loads((self.output / "coverage.json").read_text())
        self.assertTrue(any(reading["role"] == "synthesis" for reading in coverage))

    def test_combined_citation_rejects_a_gap_between_read_ranges(self):
        (self.repo / RANGE_GUIDE).write_text("First supported line.\nUnread gap.\nThird supported line.\n")
        mock = MockAudit(self.output, "gapped-ranges")
        with mock_endpoint(mock) as endpoint:
            result = self.run_audit(endpoint)
        self.assertEqual(mock.errors, [], self.command_output)
        self.assert_failed(result)
        self.assertEqual(mock.synthesis_results, 3)
        self.assertIn("Unverified source range", self.command_output)
        coverage = json.loads((self.output / "coverage.json").read_text())
        reads = [reading for reading in coverage if reading["role"] == "synthesis"]
        self.assertEqual([(reading["startLine"], reading["endLine"]) for reading in reads], [(3, 3), (1, 1)])

    def test_permanently_missing_findings_fails_with_a_named_validation_error(self):
        mock = MockAudit(self.output, "missing-findings")
        with mock_endpoint(mock) as endpoint:
            result = self.run_audit(endpoint)
        self.assertEqual(mock.errors, [], self.command_output)
        self.assert_failed(result)
        self.assertEqual(mock.synthesis_results, 3)
        error = json.loads((self.output / "status.json").read_text())["error"]
        self.assertIn("findings", error)
        self.assertNotRegex(error.lower(), r"dictionary|given key|keynotfound")
        self.assertRegex(self.command_output, r"[Cc]orrection")

    def test_resume_reuses_reviewers_and_read_evidence_for_a_new_synthesis(self):
        initial = MockAudit(self.output, "invalid-citation")
        with mock_endpoint(initial) as endpoint:
            result = self.run_audit(endpoint)
        self.assertEqual(initial.errors, [], self.command_output)
        self.assert_failed(result)
        previous = self.output
        previous_files = {file.name: file.read_bytes() for file in previous.iterdir()}
        manifest = json.loads(previous_files["manifest.json"])
        previous_coverage = json.loads(previous_files["coverage.json"])
        self.output = self.scratch / "resumed-audit"
        resumed = MockAudit(self.output)
        resumed.catalogs["code-reader"] = {"files": manifest["sources"]}
        with mock_endpoint(resumed) as endpoint:
            result = self.run_audit(endpoint, extra=("--resume", str(previous)))
        self.assertEqual(resumed.errors, [], self.command_output)
        self.assertEqual(result.returncode, 0, self.command_output)
        self.assertEqual({role for role, _ in resumed.requests}, {"synthesis"})
        self.assertEqual(resumed.synthesis_results, 1)
        self.assertEqual(json.loads((self.output / "status.json").read_text())["status"], "completed")
        self.assertIn("## Lifetime", (self.output / "report.md").read_text())
        for role in ("guide-reader", "code-reader", "boundary-reader"):
            self.assertEqual((self.output / (role + ".txt")).read_bytes(), previous_files[role + ".txt"])
        coverage = json.loads((self.output / "coverage.json").read_text())
        self.assertEqual(coverage[:len(previous_coverage)], previous_coverage)
        self.assertEqual({file.name: file.read_bytes() for file in previous.iterdir()}, previous_files)

    def test_resume_rejects_changed_sources_before_any_model_request(self):
        initial = MockAudit(self.output, "invalid-citation")
        with mock_endpoint(initial) as endpoint:
            result = self.run_audit(endpoint)
        self.assertEqual(initial.errors, [], self.command_output)
        self.assert_failed(result)
        previous = self.output
        (self.repo / CODE).write_text("export const finish = () => 'changed';\n")
        self.output = self.scratch / "resumed-changed-audit"
        resumed = MockAudit(self.output)
        with mock_endpoint(resumed) as endpoint:
            result = self.run_audit(endpoint, extra=("--resume", str(previous)))
        self.assertEqual(resumed.errors, [])
        self.assertEqual(resumed.requests, [])
        self.assertNotEqual(result.returncode, 0, self.command_output)
        self.assertIn("source state", self.command_output)
        self.assertFalse((self.output / "report.md").exists())
        self.assertEqual(json.loads((previous / "status.json").read_text())["status"], "failed")

    def test_model_call_limit_leaves_a_failed_audit(self):
        mock = MockAudit(self.output)
        with mock_endpoint(mock) as endpoint:
            result = self.run_audit(endpoint, extra=("--max-calls", "1"))
        self.assertEqual(mock.errors, [], self.command_output)
        self.assert_failed(result)
        self.assertIn("call limit", self.command_output)
        self.assertEqual(len(mock.requests), 3)
        self.assertNotIn("synthesis", {role for role, _ in mock.requests})

    def test_timeout_never_marks_the_audit_completed(self):
        mock = MockAudit(self.output, "timeout")
        with mock_endpoint(mock) as endpoint:
            result = self.run_audit(endpoint, extra=("--timeout-seconds", "1"))
        self.assertEqual(mock.errors, [], self.command_output)
        self.assert_failed(result)
        self.assertNotIn("synthesis", {role for role, _ in mock.requests})

    def test_slow_model_reports_human_readable_progress_and_completes(self):
        mock = MockAudit(self.output, "heartbeat")
        with mock_endpoint(mock) as endpoint:
            result = self.run_audit(endpoint, extra=("--timeout-seconds", "45"))
        self.assertEqual(mock.errors, [], self.command_output)
        self.assertEqual(result.returncode, 0, self.command_output)
        self.assertIn("Guide reviewer: still working", result.stdout)
        self.assertIn("Audit: Done. Report:", result.stdout)
        self.assertEqual(json.loads((self.output / "status.json").read_text())["status"], "completed")
        self.assertTrue((self.output / "report.md").exists())

    def test_existing_output_remains_untouched(self):
        self.output.mkdir()
        sentinel = b"existing audit must remain unchanged\n"
        (self.output / "report.md").write_bytes(sentinel)
        result = self.run_audit(extra=("--dry-run",), with_key=False)
        self.assertNotEqual(result.returncode, 0, self.command_output)
        self.assertIn("already exists", self.command_output)
        self.assertEqual(list(self.output.iterdir()), [self.output / "report.md"])
        self.assertEqual((self.output / "report.md").read_bytes(), sentinel)


if __name__ == "__main__":
    unittest.main(verbosity=2)
