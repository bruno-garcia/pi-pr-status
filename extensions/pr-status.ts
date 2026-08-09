/**
 * PR Status Extension
 *
 * Shows PR status in the pi footer status bar. Polls every 30 seconds.
 *
 * Detects PRs from two sources:
 * 1. The current git branch (via `gh pr view`)
 * 2. GitHub PR URLs in user input (e.g. "lets continue this PR: https://github.com/owner/repo/pull/123")
 *
 * URL detection fires on the `input` event, so the status appears immediately
 * — even before the agent starts processing or checks out a branch.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// --- GitHub helpers (inlined for pi extension compatibility) ---

interface CheckStatus {
	total: number;
	pass: number;
	fail: number;
	pending: number;
}

interface PrInfo {
	number: number;
	title: string;
	url: string;
	state: string;
	checks: CheckStatus;
	unresolvedThreads: number;
}

interface RepoInfo {
	owner: string;
	name: string;
}

async function getBranch(pi: ExtensionAPI, cwd: string): Promise<string | undefined> {
	try {
		const result = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
			cwd,
			timeout: 3000,
		});
		return result.code === 0 ? result.stdout.trim() : undefined;
	} catch {
		return undefined;
	}
}

async function getRepoInfo(pi: ExtensionAPI, cwd: string): Promise<RepoInfo | undefined> {
	try {
		const result = await pi.exec("gh", ["repo", "view", "--json", "owner,name"], {
			cwd,
			timeout: 5000,
		});
		if (result.code !== 0) return undefined;
		const repo = JSON.parse(result.stdout.trim());
		return repo.owner?.login && repo.name ? { owner: repo.owner.login, name: repo.name } : undefined;
	} catch {
		return undefined;
	}
}

function parseChecks(statusCheckRollup: unknown[]): CheckStatus {
	const checks: CheckStatus = { total: 0, pass: 0, fail: 0, pending: 0 };
	for (const check of statusCheckRollup) {
		const c = check as Record<string, string>;
		const conclusion = (c.conclusion || "").toUpperCase();
		const status = (c.status || "").toUpperCase();
		const name = c.name || "";

		// Skip ghost checks with no meaningful data (e.g. Vercel deployment statuses)
		if (!name && !conclusion && !status) continue;

		checks.total++;
		if (conclusion === "SUCCESS" || conclusion === "NEUTRAL" || conclusion === "SKIPPED") {
			checks.pass++;
		} else if (
			conclusion === "FAILURE" ||
			conclusion === "TIMED_OUT" ||
			conclusion === "CANCELLED" ||
			conclusion === "ACTION_REQUIRED"
		) {
			checks.fail++;
		} else if (
			status === "IN_PROGRESS" ||
			status === "QUEUED" ||
			status === "PENDING" ||
			status === "WAITING"
		) {
			checks.pending++;
		} else if (status === "COMPLETED") {
			// Completed but no recognized conclusion — treat as passed
			checks.pass++;
		} else {
			// Unknown state — treat as pending
			checks.pending++;
		}
	}
	return checks;
}

const PR_URL_RE = /https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/;

function parsePrUrl(text: string): { url: string; repo: string; number: number } | null {
	const match = text.match(PR_URL_RE);
	if (!match) return null;
	return { url: match[0], repo: match[1], number: parseInt(match[2], 10) };
}

function reviewThreadsQuery(owner: string, name: string, number: number): string {
	return `query { repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${number}) { reviewThreads(first: 100) { nodes { isResolved } } } } }`;
}

async function getUnresolvedThreads(
	pi: ExtensionAPI,
	owner: string,
	name: string,
	number: number,
	cwd?: string,
): Promise<number> {
	try {
		const result = await pi.exec(
			"gh",
			["api", "graphql", "-f", `query=${reviewThreadsQuery(owner, name, number)}`],
			{ cwd, timeout: 10_000 },
		);
		if (result.code !== 0) return 0;
		const data = JSON.parse(result.stdout.trim());
		const threads = data?.data?.repository?.pullRequest?.reviewThreads?.nodes;
		return Array.isArray(threads)
			? threads.filter((t: { isResolved: boolean }) => !t.isResolved).length
			: 0;
	} catch {
		// GraphQL failed — show PR without thread count.
		return 0;
	}
}

async function getPrByNumber(
	pi: ExtensionAPI,
	repo: string,
	prNumber: number,
): Promise<PrInfo | undefined> {
	try {
		const result = await pi.exec(
			"gh",
			[
				"pr",
				"view",
				String(prNumber),
				"--repo",
				repo,
				"--json",
				"number,title,url,state,statusCheckRollup",
			],
			{ timeout: 10_000 },
		);
		if (result.code !== 0 || !result.stdout.trim()) return undefined;
		const pr = JSON.parse(result.stdout.trim());
		if (!pr.number || !pr.url) return undefined;

		const checks = Array.isArray(pr.statusCheckRollup)
			? parseChecks(pr.statusCheckRollup)
			: { total: 0, pass: 0, fail: 0, pending: 0 };

		const [owner, name] = repo.split("/");
		const unresolvedThreads = owner && name
			? await getUnresolvedThreads(pi, owner, name, pr.number)
			: 0;

		return {
			number: pr.number,
			title: pr.title,
			url: pr.url,
			state: pr.state,
			checks,
			unresolvedThreads,
		};
	} catch {
		return undefined;
	}
}

async function getPrForBranch(
	pi: ExtensionAPI,
	cwd: string,
	repo?: RepoInfo,
): Promise<PrInfo | undefined> {
	try {
		const result = await pi.exec(
			"gh",
			["pr", "view", "--json", "number,title,url,state,statusCheckRollup"],
			{ cwd, timeout: 10_000 },
		);
		if (result.code !== 0 || !result.stdout.trim()) return undefined;
		const pr = JSON.parse(result.stdout.trim());
		if (!pr.number || !pr.url) return undefined;

		const checks = Array.isArray(pr.statusCheckRollup)
			? parseChecks(pr.statusCheckRollup)
			: { total: 0, pass: 0, fail: 0, pending: 0 };
		const unresolvedThreads = repo
			? await getUnresolvedThreads(pi, repo.owner, repo.name, pr.number, cwd)
			: 0;

		return {
			number: pr.number,
			title: pr.title,
			url: pr.url,
			state: pr.state,
			checks,
			unresolvedThreads,
		};
	} catch {
		return undefined;
	}
}

function formatStatus(pr: PrInfo): string {
	const stateIcon = pr.state === "MERGED" ? "🟣" : pr.state === "CLOSED" ? "🔴" : "🟢";
	const parts: string[] = [`${stateIcon} PR #${pr.number}`];

	if (pr.checks.total > 0) {
		if (pr.checks.fail > 0) {
			parts.push(`❌ ${pr.checks.fail}/${pr.checks.total} checks failed`);
		} else if (pr.checks.pending > 0) {
			parts.push(`⏳ ${pr.checks.pending}/${pr.checks.total} checks pending`);
		} else {
			parts.push(`✅ ${pr.checks.total} checks passed`);
		}
	}

	if (pr.unresolvedThreads > 0) {
		parts.push(`💬 ${pr.unresolvedThreads} unresolved`);
	}

	parts.push(pr.url);
	return parts.join(" · ");
}

// --- Extension ---

const POLL_INTERVAL = 30_000;
const STATUS_KEY = "pr-status";

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let lastBranch: string | undefined;
	let lastPr: PrInfo | undefined;
	let cachedRepo: RepoInfo | undefined;

	// Track a PR pinned by URL (takes priority over branch-based detection).
	// Only set when the current branch has no active (open) PR of its own.
	let pinnedPr: { repo: string; number: number } | null = null;
	let latestCtx: ExtensionContext | null = null;
	let updateInFlight = false;

	/** Returns true when the current branch has an open PR. */
	function hasActiveBranchPr(): boolean {
		return !!lastPr && lastPr.state === "OPEN";
	}

	function showStatus(pr: PrInfo | undefined, ui: { setStatus: (key: string, value: string | undefined) => void }) {
		lastPr = pr ?? undefined;
		ui.setStatus(STATUS_KEY, lastPr ? formatStatus(lastPr) : undefined);
	}

	async function update(cwd: string, ui: { setStatus: (key: string, value: string | undefined) => void }) {
		// If a PR is pinned by URL, use that instead of branch detection
		if (pinnedPr) {
			const pr = await getPrByNumber(pi, pinnedPr.repo, pinnedPr.number);
			showStatus(pr, ui);

			// If the branch now has its own open PR, drop the pin and let
			// branch-based detection take over from the next cycle.
			if (pr) {
				const branch = await getBranch(pi, cwd);
				if (branch && branch !== "HEAD" && branch !== lastBranch) {
					lastBranch = branch;
				}
				if (branch && branch !== "HEAD") {
					if (!cachedRepo) cachedRepo = await getRepoInfo(pi, cwd);
					const branchPr = await getPrForBranch(pi, cwd, cachedRepo);
					if (branchPr && branchPr.state === "OPEN") {
						pinnedPr = null;
						showStatus(branchPr, ui);
					}
				}
			}
			return;
		}

		const branch = await getBranch(pi, cwd);

		if (branch !== lastBranch) {
			lastBranch = branch;
			lastPr = undefined;
		}

		if (!branch || branch === "HEAD") {
			showStatus(undefined, ui);
			return;
		}

		if (!cachedRepo) {
			cachedRepo = await getRepoInfo(pi, cwd);
		}

		const pr = await getPrForBranch(pi, cwd, cachedRepo);
		showStatus(pr, ui);
	}

	async function refreshStatus(
		cwd: string,
		ui: { setStatus: (key: string, value: string | undefined) => void },
	): Promise<void> {
		if (updateInFlight) return;
		updateInFlight = true;
		try {
			await update(cwd, ui);
		} finally {
			updateInFlight = false;
		}
	}

	async function tryPinFromUrl(text: string, ctx: ExtensionContext) {
		const parsed = parsePrUrl(text);
		if (!parsed) return;

		// Don't re-pin the same PR
		if (pinnedPr?.repo === parsed.repo && pinnedPr?.number === parsed.number) return;

		// Only pin when the current branch has no active (open) PR.
		// This avoids hijacking the status when casually referencing another PR.
		if (hasActiveBranchPr()) return;

		pinnedPr = { repo: parsed.repo, number: parsed.number };
		latestCtx = ctx;

		// Fetch and show immediately
		const pr = await getPrByNumber(pi, parsed.repo, parsed.number);
		showStatus(pr, ctx.ui);
	}

	// Detect PR URLs in user input — fires before the agent starts
	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" as const };

		latestCtx = ctx;
		void tryPinFromUrl(event.text, ctx);

		return { action: "continue" as const };
	});

	// Also check in before_agent_start for skill/template-expanded text
	pi.on("before_agent_start", async (event, ctx) => {
		latestCtx = ctx;
		void tryPinFromUrl(event.prompt, ctx);
	});

	pi.on("session_start", async (_event, ctx) => {
		latestCtx = ctx;
		void refreshStatus(ctx.cwd, ctx.ui);
		timer = setInterval(() => {
			if (latestCtx) void refreshStatus(latestCtx.cwd, latestCtx.ui);
		}, POLL_INTERVAL);
	});

	pi.on("session_switch", async (_event, ctx) => {
		lastBranch = undefined;
		lastPr = undefined;
		cachedRepo = undefined;
		pinnedPr = null;
		latestCtx = ctx;
		void refreshStatus(ctx.cwd, ctx.ui);
	});

	pi.on("session_shutdown", async () => {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
	});
}
