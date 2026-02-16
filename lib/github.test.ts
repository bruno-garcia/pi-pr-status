import { describe, it, expect } from "vitest";
import { parseChecks, countUnresolvedThreads, formatStatus, parsePrUrl, type PrInfo } from "./github.ts";

describe("parsePrUrl", () => {
	it("extracts repo and number from a PR URL", () => {
		expect(parsePrUrl("https://github.com/owner/repo/pull/42")).toEqual({
			url: "https://github.com/owner/repo/pull/42",
			repo: "owner/repo",
			number: 42,
		});
	});

	it("extracts from a PR URL embedded in text", () => {
		expect(parsePrUrl("lets continue this PR: https://github.com/bruno-garcia/code-review-trends/pull/22")).toEqual({
			url: "https://github.com/bruno-garcia/code-review-trends/pull/22",
			repo: "bruno-garcia/code-review-trends",
			number: 22,
		});
	});

	it("returns null for non-PR URLs", () => {
		expect(parsePrUrl("https://github.com/owner/repo/issues/42")).toBeNull();
	});

	it("returns null for text without URLs", () => {
		expect(parsePrUrl("just some text")).toBeNull();
	});

	it("handles URL with trailing text", () => {
		const result = parsePrUrl("check https://github.com/a/b/pull/1 please");
		expect(result).toEqual({ url: "https://github.com/a/b/pull/1", repo: "a/b", number: 1 });
	});
});

describe("parseChecks", () => {
	it("returns zeros for empty array", () => {
		expect(parseChecks([])).toEqual({ total: 0, pass: 0, fail: 0, pending: 0 });
	});

	it("counts successful checks", () => {
		const checks = [
			{ conclusion: "SUCCESS", status: "COMPLETED" },
			{ conclusion: "SUCCESS", status: "COMPLETED" },
		];
		expect(parseChecks(checks)).toEqual({ total: 2, pass: 2, fail: 0, pending: 0 });
	});

	it("counts neutral and skipped as pass", () => {
		const checks = [
			{ conclusion: "NEUTRAL", status: "COMPLETED" },
			{ conclusion: "SKIPPED", status: "COMPLETED" },
		];
		expect(parseChecks(checks)).toEqual({ total: 2, pass: 2, fail: 0, pending: 0 });
	});

	it("counts failed checks", () => {
		const checks = [
			{ conclusion: "FAILURE", status: "COMPLETED" },
			{ conclusion: "TIMED_OUT", status: "COMPLETED" },
			{ conclusion: "CANCELLED", status: "COMPLETED" },
			{ conclusion: "ACTION_REQUIRED", status: "COMPLETED" },
		];
		expect(parseChecks(checks)).toEqual({ total: 4, pass: 0, fail: 4, pending: 0 });
	});

	it("counts pending checks by status", () => {
		const checks = [
			{ conclusion: "", status: "IN_PROGRESS" },
			{ conclusion: "", status: "QUEUED" },
			{ conclusion: "", status: "PENDING" },
			{ conclusion: "", status: "WAITING" },
		];
		expect(parseChecks(checks)).toEqual({ total: 4, pass: 0, fail: 0, pending: 4 });
	});

	it("treats completed with missing conclusion as pass", () => {
		const checks = [{ name: "deploy", status: "COMPLETED" }];
		expect(parseChecks(checks)).toEqual({ total: 1, pass: 1, fail: 0, pending: 0 });
	});

	it("skips ghost checks with all null fields", () => {
		const checks = [
			{ conclusion: "SUCCESS", name: "ci", status: "COMPLETED" },
			{ conclusion: null, name: null, status: null },
		];
		expect(parseChecks(checks)).toEqual({ total: 1, pass: 1, fail: 0, pending: 0 });
	});

	it("skips ghost checks with empty strings", () => {
		const checks = [
			{ conclusion: "SUCCESS", name: "ci", status: "COMPLETED" },
			{ conclusion: "", name: "", status: "" },
		];
		expect(parseChecks(checks)).toEqual({ total: 1, pass: 1, fail: 0, pending: 0 });
	});

	it("handles mixed statuses", () => {
		const checks = [
			{ conclusion: "SUCCESS", status: "COMPLETED" },
			{ conclusion: "FAILURE", status: "COMPLETED" },
			{ conclusion: "", status: "IN_PROGRESS" },
		];
		expect(parseChecks(checks)).toEqual({ total: 3, pass: 1, fail: 1, pending: 1 });
	});

	it("is case-insensitive", () => {
		const checks = [
			{ conclusion: "success", status: "completed" },
			{ conclusion: "failure", status: "completed" },
		];
		expect(parseChecks(checks)).toEqual({ total: 2, pass: 1, fail: 1, pending: 0 });
	});
});

describe("countUnresolvedThreads", () => {
	it("returns 0 for empty array", () => {
		expect(countUnresolvedThreads([])).toBe(0);
	});

	it("returns 0 when all resolved", () => {
		expect(countUnresolvedThreads([{ isResolved: true }, { isResolved: true }])).toBe(0);
	});

	it("counts unresolved threads", () => {
		expect(
			countUnresolvedThreads([{ isResolved: false }, { isResolved: true }, { isResolved: false }]),
		).toBe(2);
	});
});

describe("formatStatus", () => {
	const basePr: PrInfo = {
		number: 42,
		title: "Test PR",
		url: "https://github.com/owner/repo/pull/42",
		state: "OPEN",
		checks: { total: 0, pass: 0, fail: 0, pending: 0 },
		unresolvedThreads: 0,
	};

	it("shows open state icon", () => {
		expect(formatStatus(basePr)).toContain("🟢");
	});

	it("shows merged state icon", () => {
		expect(formatStatus({ ...basePr, state: "MERGED" })).toContain("🟣");
	});

	it("shows closed state icon", () => {
		expect(formatStatus({ ...basePr, state: "CLOSED" })).toContain("🔴");
	});

	it("shows PR number", () => {
		expect(formatStatus(basePr)).toContain("PR #42");
	});

	it("shows URL", () => {
		expect(formatStatus(basePr)).toContain("https://github.com/owner/repo/pull/42");
	});

	it("omits checks when none exist", () => {
		const status = formatStatus(basePr);
		expect(status).not.toContain("✅");
		expect(status).not.toContain("❌");
		expect(status).not.toContain("⏳");
	});

	it("shows failed checks count", () => {
		const pr = { ...basePr, checks: { total: 5, pass: 3, fail: 2, pending: 0 } };
		expect(formatStatus(pr)).toContain("❌ 2/5 checks failed");
	});

	it("shows pending checks when no failures", () => {
		const pr = { ...basePr, checks: { total: 3, pass: 1, fail: 0, pending: 2 } };
		expect(formatStatus(pr)).toContain("⏳ 2/3 checks pending");
	});

	it("shows all passed", () => {
		const pr = { ...basePr, checks: { total: 4, pass: 4, fail: 0, pending: 0 } };
		expect(formatStatus(pr)).toContain("✅ 4 checks passed");
	});

	it("prioritizes failures over pending", () => {
		const pr = { ...basePr, checks: { total: 5, pass: 1, fail: 2, pending: 2 } };
		expect(formatStatus(pr)).toContain("❌ 2/5 checks failed");
		expect(formatStatus(pr)).not.toContain("⏳");
	});

	it("omits unresolved when zero", () => {
		expect(formatStatus(basePr)).not.toContain("💬");
	});

	it("shows unresolved thread count", () => {
		const pr = { ...basePr, unresolvedThreads: 3 };
		expect(formatStatus(pr)).toContain("💬 3 unresolved");
	});

	it("shows all parts together", () => {
		const pr: PrInfo = {
			number: 7,
			title: "Big PR",
			url: "https://github.com/o/r/pull/7",
			state: "OPEN",
			checks: { total: 10, pass: 8, fail: 2, pending: 0 },
			unresolvedThreads: 5,
		};
		const status = formatStatus(pr);
		expect(status).toBe("🟢 PR #7 · ❌ 2/10 checks failed · 💬 5 unresolved · https://github.com/o/r/pull/7");
	});

	it("joins parts with separator", () => {
		const status = formatStatus(basePr);
		expect(status).toBe("🟢 PR #42 · https://github.com/owner/repo/pull/42");
	});
});
