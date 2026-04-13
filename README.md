# actions-usage

Show GitHub Actions usage metrics per developer for any repository or organization.

Also available as a [GitHub Action](#github-action) for automated PR comments and scheduled reports.

## Prerequisites

- [GitHub CLI (`gh`)](https://cli.github.com) installed and authenticated

## Quick Start

```sh
npx actions-usage --repo owner/repo
```

Or run from within a git repo to auto-detect:

```sh
npx actions-usage
```

## Options

```
--org <org-name>        Scan all repositories in a GitHub organization
--repo <repos...>       Target repositories (default: detect from git remote)
--exclude <repos...>    Exclude specific repos when scanning an org
--group-by <field>      Group results by: actor (merges repos per developer)
--since <date>          Start date YYYY-MM-DD (default: start of current month)
--until <date>          End date YYYY-MM-DD (default: today)
--format <type>         Output format: table, csv, json, markdown (default: table)
--sort <field>          Sort by: minutes, runs, name (default: minutes)
--include-forks         Include forked repos when scanning an org
--include-archived      Include archived repos when scanning an org
--pr <number>           Show CI cost for a specific pull request
--csv <path>            Export CSV to file
--markdown-file <path>  Export markdown to file (in addition to primary format)
-V, --version           Show version
-h, --help              Show help
```

## Examples

Single repo, current month:

```sh
npx actions-usage --repo my-org/my-repo
```

Multiple repos:

```sh
npx actions-usage --repo my-org/api my-org/web my-org/docs
```

Entire organization:

```sh
npx actions-usage --org my-org --since 2026-01-01
```

Organization filtered to specific repos (short names accepted):

```sh
npx actions-usage --org my-org --repo api web
```

Export to CSV:

```sh
npx actions-usage --since 2026-01-01 --csv usage.csv
```

JSON for piping to other tools:

```sh
npx actions-usage --format json | jq '.users[:3]'
```

JSON monthly keys use `YYYY-MM` format (e.g. `"2025-01"`, `"2026-03"`).

Cross-repo aggregation (total per developer across all repos):

```sh
npx actions-usage --org my-org --group-by actor
```

Exclude specific repos from org scan:

```sh
npx actions-usage --org my-org --exclude monorepo-legacy internal-tools
```

Include forks or archived repos:

```sh
npx actions-usage --org my-org --include-forks --include-archived
```

Per-PR CI cost breakdown (billable minutes × GitHub rates):

```sh
npx actions-usage --repo my-org/my-repo --pr 123
npx actions-usage --repo my-org/my-repo --pr 123 --format json
```

## Multi-repo output

When scanning multiple repos, the output includes a **Repo** column with each row representing a developer + repo pair:

```
┌───────────┬──────┬───────────┬───────┬──────┐
│ Developer │ Repo │ Total min │ Hours │ Runs │
├───────────┼──────┼───────────┼───────┼──────┤
│ alice     │ api  │        60 │   1.0 │    5 │
├───────────┼──────┼───────────┼───────┼──────┤
│ alice     │ web  │        30 │   0.5 │    3 │
└───────────┴──────┴───────────┴───────┴──────┘
```

For single-repo usage, the output matches the original format with no Repo column.

## GitHub Action

Use as a GitHub Action to auto-post usage reports on PRs or create scheduled issue reports.

### PR comment on every push

```yaml
on:
  pull_request:

jobs:
  usage:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: gary-quinn/actions-usage@v1
        with:
          mode: pr-comment
```

### Weekly org-wide report as issue

```yaml
on:
  schedule:
    - cron: '0 9 * * 1'

jobs:
  report:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: gary-quinn/actions-usage@v1
        with:
          mode: issue
          org: my-org
          issue-title: 'Weekly Actions Usage Report'
```

### Per-PR CI cost on every push

```yaml
on:
  pull_request:

jobs:
  ci-cost:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: gary-quinn/actions-usage@v1
        with:
          mode: pr-cost
```

Posts a comment showing billable minutes per OS and estimated cost based on GitHub's [published rates](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions) for standard runners.

### Action inputs

| Input | Default | Description |
|-------|---------|-------------|
| `mode` | `pr-comment` | `pr-comment`, `issue`, `both`, or `pr-cost` |
| `org` | | GitHub org to scan |
| `repos` | current repo | Comma-separated repo list |
| `exclude` | | Comma-separated repos to exclude from org scan |
| `group-by` | | Group by: `actor` (merges repos per developer) |
| `since` | start of month | Start date YYYY-MM-DD |
| `until` | today | End date YYYY-MM-DD |
| `sort` | `minutes` | Sort by: minutes, runs, name |
| `pr-number` | auto-detected | PR number for `pr-cost` mode (auto-detected on `pull_request` events) |
| `issue-title` | `GitHub Actions Usage Report` | Title for issue report |
| `issue-labels` | `report,actions-usage` | Comma-separated labels |

### Action outputs

| Output | Description |
|--------|-------------|
| `json` | Raw JSON report data |
| `markdown` | Markdown report content |
| `issue-url` | URL of created/updated issue |
| `comment-url` | URL of PR comment |

## How It Works

Queries the GitHub Actions API via `gh api` to fetch all completed workflow runs in the specified period, then calculates wall-clock duration per developer by measuring the time between `run_started_at` and `updated_at`.

For organizations, repos are fetched concurrently (5 at a time). Archived, disabled, and forked repos are excluded by default.

**Note:** The usage report shows wall-clock durations (from `run_started_at` to `updated_at`), not GitHub billable minutes. Wall-clock includes queue time and approval wait.

The `--pr` / `pr-cost` mode uses the [workflow run timing API](https://docs.github.com/en/rest/actions/workflow-runs#get-workflow-run-usage) to fetch actual billable minutes per OS and applies GitHub's published per-minute rates for standard runners (Linux $0.008, macOS $0.08, Windows $0.016 as of 2025-04). Public repos are free; the rates apply to private repos only.

## License

MIT
