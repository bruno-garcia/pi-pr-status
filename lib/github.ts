/**
 * Pure logic for querying GitHub PR status via the `gh` CLI.
 * Separated from the pi extension API for testability.
 */

import { execSync } from "node:child_process";

export interface CheckStatus {
	total: number;
	pass: number;
	fail: number;
	pending: number;
}

export interface PrInfo {
	number: number;
	title: string;
	url: string;
	state: string;
	checks: CheckStatus;
	unresolvedThreads: number;
}

export interface RepoInfo {
	owner: string;
	name: string;
}

export function getBranch(cwd: string): string | undefined {
	try {
		return execSync("git rev-parse --abbrev-ref HEAD", {
			cwd,
			encoding: "utf-8",
			timeout: 3000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return undefined;
	}
}

export function getRepoInfo(cwd: string): RepoInfo | undefined {
	try {
		const json = execSync("gh repo view --json owner,name", {
			cwd,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		const repo = JSON.parse(json);
		return repo.owner?.login && repo.name ? { owner: repo.owner.login, name: repo.name } : undefined;
	} catch {
		return undefined;
	}
}

export function parseChecks(statusCheckRollup: unknown[]): CheckStatus {
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

export function countUnresolvedThreads(threads: { isResolved: boolean }[]): number {
	return threads.filter((t) => !t.isResolved).length;
}

export function getPrForBranch(cwd: string, repo?: RepoInfo): PrInfo | undefined {
	try {
		const json = execSync("gh pr view --json number,title,url,state,statusCheckRollup", {
			cwd,
			encoding: "utf-8",
			timeout: 10_000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (!json) return undefined;
		const pr = JSON.parse(json);
		if (!pr.number || !pr.url) return undefined;

		const checks = Array.isArray(pr.statusCheckRollup) ? parseChecks(pr.statusCheckRollup) : { total: 0, pass: 0, fail: 0, pending: 0 };

		let unresolvedThreads = 0;
		if (repo) {
			try {
				const gql = execSync(
					`gh api graphql -f query='{ repository(owner: "${repo.owner}", name: "${repo.name}") { pullRequest(number: ${pr.number}) { reviewThreads(first: 100) { nodes { isResolved } } } } }'`,
					{
						cwd,
						encoding: "utf-8",
						timeout: 10_000,
						stdio: ["pipe", "pipe", "pipe"],
					},
				).trim();
				const data = JSON.parse(gql);
				const threads = data?.data?.repository?.pullRequest?.reviewThreads?.nodes;
				if (Array.isArray(threads)) {
					unresolvedThreads = countUnresolvedThreads(threads);
				}
			} catch {
				// GraphQL failed — show PR without thread count
			}
		}

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

export function formatStatus(pr: PrInfo): string {
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
