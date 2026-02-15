# pi-pr-status

A [Pi](https://github.com/badlogic/pi) extension that shows your current PR's status right in the footer — so you always know which PR you're working on, whether CI is green, and if there are review comments to address.

## What it shows

When your current git branch has an open pull request, the footer displays:

```
🟢 PR #42 · ✅ 5 checks passed · https://github.com/owner/repo/pull/42
```

**CI failures?**
```
🟢 PR #42 · ❌ 2/5 checks failed · https://github.com/owner/repo/pull/42
```

**Checks still running?**
```
🟢 PR #42 · ⏳ 3/5 checks pending · https://github.com/owner/repo/pull/42
```

**Unresolved review comments?**
```
🟢 PR #42 · ✅ 5 checks passed · 💬 3 unresolved · https://github.com/owner/repo/pull/42
```

**PR state icons:**

| Icon | State |
|------|-------|
| 🟢 | Open |
| 🟣 | Merged |
| 🔴 | Closed |

When there's no PR for the current branch, nothing is shown.

## Requirements

- [Pi](https://github.com/badlogic/pi) coding agent
- [GitHub CLI](https://cli.github.com/) (`gh`) — authenticated with `gh auth login`

## Install

```bash
pi install npm:pi-pr-status
```

Or try it without installing:

```bash
pi -e npm:pi-pr-status
```

You can also install from git:

```bash
pi install git:github.com/bruno-garcia/pi-pr-status
```

## How it works

1. Detects the current git branch
2. Runs `gh pr view` to find the associated pull request
3. Parses CI status check results (pass / fail / pending)
4. Queries unresolved review threads via the GitHub GraphQL API
5. Displays everything in the pi footer status bar

The extension polls every 30 seconds to pick up CI and review changes. Repo metadata is cached so only two API calls are made per poll (one for PR + checks, one GraphQL query for review threads). When no PR exists for the branch, no API calls are made after the initial check.

## Development

```bash
npm install
npm test
```

## License

MIT
