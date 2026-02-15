/**
 * PR Status Extension
 *
 * Shows the current branch's PR URL, CI check status, and unresolved
 * review comment count in the pi footer status bar. Polls every 30 seconds.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getBranch, getRepoInfo, getPrForBranch, formatStatus, type PrInfo, type RepoInfo } from "../lib/github.ts";

const POLL_INTERVAL = 30_000;
const STATUS_KEY = "pr-status";

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let lastBranch: string | undefined;
	let lastPr: PrInfo | undefined;
	let cachedRepo: RepoInfo | undefined;

	function update(cwd: string, ui: { setStatus: (key: string, value: string | undefined) => void }) {
		const branch = getBranch(cwd);

		if (branch !== lastBranch) {
			lastBranch = branch;
			lastPr = undefined;
		}

		if (!branch || branch === "HEAD") {
			lastPr = undefined;
			ui.setStatus(STATUS_KEY, undefined);
			return;
		}

		if (!cachedRepo) {
			cachedRepo = getRepoInfo(cwd);
		}

		const pr = getPrForBranch(cwd, cachedRepo);
		lastPr = pr ?? undefined;

		if (lastPr) {
			ui.setStatus(STATUS_KEY, formatStatus(lastPr));
		} else {
			ui.setStatus(STATUS_KEY, undefined);
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		update(ctx.cwd, ctx.ui);
		timer = setInterval(() => update(ctx.cwd, ctx.ui), POLL_INTERVAL);
	});

	pi.on("session_switch", async (_event, ctx) => {
		lastBranch = undefined;
		lastPr = undefined;
		cachedRepo = undefined;
		update(ctx.cwd, ctx.ui);
	});

	pi.on("session_shutdown", async () => {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
	});
}
