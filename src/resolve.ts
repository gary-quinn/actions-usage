import {
  fetchOrgRepos,
  detectRepo,
  validateRepoFormat,
} from "./github.js";
import type { OrgFilterOptions } from "./types.js";

export interface ResolveResult {
  readonly repos: readonly string[];
  readonly source: "org" | "org-filtered" | "explicit" | "detected";
  readonly orgTotal?: number;
}

export interface ResolveOptions {
  readonly exclude?: readonly string[];
  readonly includeForks?: boolean;
  readonly includeArchived?: boolean;
}

function looksLikeFullName(repo: string): boolean {
  return /^[^/]+\/[^/]+$/.test(repo);
}

function buildExcludeMatcher(exclude: readonly string[]): (repo: string) => boolean {
  const fullNames = new Set(exclude.filter(looksLikeFullName));
  const shortNames = new Set(exclude.filter((r) => !looksLikeFullName(r)));
  return (repo) => fullNames.has(repo) || shortNames.has(repo.split("/")[1]);
}

export async function resolveRepos(
  org: string | undefined,
  repos: readonly string[],
  options: ResolveOptions = {},
): Promise<ResolveResult> {
  const orgFilter: OrgFilterOptions = {
    includeForks: options.includeForks,
    includeArchived: options.includeArchived,
  };

  if (org) {
    const orgRepos = await fetchOrgRepos(org, orgFilter);

    let result: readonly string[];
    let source: "org" | "org-filtered";

    if (repos.length === 0) {
      result = orgRepos;
      source = "org";
    } else {
      const fullNames = new Set(repos.filter(looksLikeFullName));
      const shortNames = new Set(
        repos.filter((r) => !looksLikeFullName(r)),
      );

      result = orgRepos.filter((r) => {
        if (fullNames.has(r)) return true;
        const repoName = r.split("/")[1];
        return shortNames.has(repoName);
      });
      source = "org-filtered";
    }

    if (options.exclude && options.exclude.length > 0) {
      const isExcluded = buildExcludeMatcher(options.exclude);
      result = result.filter((r) => !isExcluded(r));
      if (source === "org") source = "org-filtered";
    }

    if (result.length === 0) {
      const preview = orgRepos.slice(0, 10).join(", ");
      const remaining = orgRepos.length - 10;
      const suffix = remaining > 0 ? ` (and ${remaining} more)` : "";
      throw new Error(
        `None of the specified repos found in org "${org}". Available: ${preview}${suffix}`,
      );
    }

    return { repos: result, source, orgTotal: orgRepos.length };
  }

  if (repos.length > 0) {
    for (const repo of repos) {
      validateRepoFormat(repo);
    }
    return { repos, source: "explicit" };
  }

  return { repos: [await detectRepo()], source: "detected" };
}

export function formatResolveLog(result: ResolveResult, org?: string): string {
  switch (result.source) {
    case "org":
      return `Fetching repos for org "${org}"...\nFound ${result.repos.length} repos`;
    case "org-filtered":
      return `Fetching repos for org "${org}"...\nFound ${result.repos.length} matching repos (filtered from ${result.orgTotal})`;
    case "detected":
      return "Detecting repo from git remote...";
    default:
      return "";
  }
}
