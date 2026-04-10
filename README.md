# actions-usage

Show GitHub Actions usage metrics per developer for any repository.

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
--repo <owner/repo>   Target repository (default: detect from git remote)
--since <date>        Start date YYYY-MM-DD (default: start of current month)
--until <date>        End date YYYY-MM-DD (default: today)
--format <type>       Output format: table, csv, json (default: table)
--sort <field>        Sort by: minutes, runs, name (default: minutes)
--csv <path>          Export CSV to file
-V, --version         Show version
-h, --help            Show help
```

## Examples

Current month usage:

```sh
npx actions-usage --repo my-org/my-repo
```

Year-to-date:

```sh
npx actions-usage --since 2026-01-01
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

## How It Works

Queries the GitHub Actions API via `gh api` to fetch all completed workflow runs in the specified period, then calculates wall-clock duration per developer by measuring the time between `run_started_at` and `updated_at`.

**Note:** These are wall-clock durations (from `run_started_at` to `updated_at`), not GitHub billable minutes. Wall-clock includes queue time and approval wait. The billing API does not expose per-run billable minutes for private repositories.

## License

MIT
