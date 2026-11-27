import { analyzeCommits as analyzeConventionalCommits } from '@semantic-release/commit-analyzer';

// Intentional product-version policy, not a claim that any commit breaks compatibility.
// Once v3.0.0 is the last release, normal Conventional Commit rules resume automatically.
export async function analyzeCommits(config, context) {
  const conventionalType = await analyzeConventionalCommits(config, context);

  if (context.lastRelease?.version?.startsWith('2.') && context.commits.length > 0) {
    context.logger.log('Applying the one-time v2 → v3.0.0 product-version policy');
    return 'major';
  }

  return conventionalType;
}
