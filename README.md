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
--org <org-name>      Scan all repositories in a GitHub organization
--repo <repos...>     Target repositories (default: detect from git remote)
--since <date>        Start date YYYY-MM-DD (default: start of current month)
--until <date>        End date YYYY-MM-DD (default: today)
--format <type>       Output format: table, csv, json, markdown (default: table)
--sort <field>        Sort by: minutes, runs, name (default: minutes)
--csv <path>          Export CSV to file
--markdown-file <path>  Export markdown to file (in addition to primary format)
-V, --version         Show version
-h, --help            Show help
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

### Action inputs

| Input | Default | Description |
|-------|---------|-------------|
| `mode` | `pr-comment` | `pr-comment`, `issue`, or `both` |
| `org` | | GitHub org to scan |
| `repos` | current repo | Comma-separated repo list |
| `since` | start of month | Start date YYYY-MM-DD |
| `until` | today | End date YYYY-MM-DD |
| `sort` | `minutes` | Sort by: minutes, runs, name |
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

**Note:** These are wall-clock durations (from `run_started_at` to `updated_at`), not GitHub billable minutes. Wall-clock includes queue time and approval wait. The billing API does not expose per-run billable minutes for private repositories.

## License

MIT
