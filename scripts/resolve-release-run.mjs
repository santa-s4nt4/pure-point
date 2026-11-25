import { appendFileSync } from 'node:fs';

const {
  GITHUB_API_URL,
  GITHUB_REPOSITORY,
  GITHUB_REPOSITORY_ID,
  GITHUB_OUTPUT,
  GH_TOKEN,
} = process.env;
const [runId] = process.argv.slice(2);
if (!/^[1-9]\d*$/.test(runId))
  throw new Error('Enter a numeric Actions run ID.');

// The Actions API can briefly fail while GitHub Releases is recovering.
async function get(path) {
  const url = `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/${path}`;
  const headers = {
    'User-Agent': 'pure-point-release',
    Accept: 'application/vnd.github+json',
  };
  if (GH_TOKEN) headers.Authorization = `Bearer ${GH_TOKEN}`;
  let problem,
    retryAfter = 0;
  for (const delay of [0, 3, 8, 20]) {
    if (delay)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(delay, retryAfter) * 1000)
      );
    let response;
    try {
      response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(20000),
      });
      if (response.ok) return await response.json();
    } catch (error) {
      problem = error;
      continue;
    }
    problem = new Error(`GitHub returned ${response.status} for ${path}`);
    const rateLimited =
      response.status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
        response.headers.has('retry-after'));
    if (response.status < 500 && response.status !== 429 && !rateLimited)
      throw problem;
    retryAfter = Math.min(60, Number(response.headers.get('retry-after')) || 0);
    await response.body?.cancel();
  }
  throw problem;
}

const source = `actions/runs/${runId}`;
const [workflow, run, jobs, artifacts] = await Promise.all([
  get('actions/workflows/macos.yml'),
  get(source),
  get(`${source}/jobs?per_page=100`),
  get(`${source}/artifacts?name=pure-point-macOS&per_page=2`),
]);
const repoId = Number(GITHUB_REPOSITORY_ID);
if (
  run.repository.id !== repoId ||
  run.head_repository?.id !== repoId ||
  run.workflow_id !== workflow.id ||
  run.path !== '.github/workflows/macos.yml' ||
  !['push', 'workflow_dispatch'].includes(run.event) ||
  run.status !== 'completed'
) {
  throw new Error(
    'Choose a completed tag run from this repository’s macOS release workflow.'
  );
}

// The version check runs exclusively on refs/tags/ and validates v + package.json.version.
// This distinguishes a tag dispatch from a branch with exactly the same short name.
const tag = run.head_branch;
const taggedBuild = jobs.jobs.some(
  (job) =>
    job.name === 'build' &&
    job.conclusion === 'success' &&
    job.steps.some(
      (step) =>
        step.name === 'Check release version' && step.conclusion === 'success'
    )
);
if (!tag?.startsWith('v') || !taggedBuild)
  throw new Error('The tag build and version check must have succeeded.');

const candidates = artifacts.artifacts.filter(
  (a) =>
    !a.expired &&
    a.name === 'pure-point-macOS' &&
    a.workflow_run?.id === run.id &&
    a.workflow_run.repository_id === repoId &&
    a.workflow_run.head_repository_id === repoId &&
    a.workflow_run.head_sha === run.head_sha
);
if (candidates.length !== 1)
  throw new Error(
    'Expected one unexpired macOS artifact for the source commit.'
  );

console.log(
  `Recovering ${tag} at ${run.head_sha} from run ${runId}, artifact ${candidates[0].id}.`
);
appendFileSync(
  GITHUB_OUTPUT,
  `tag=${tag}\ncommit=${run.head_sha}\nartifact_id=${candidates[0].id}\n`
);
