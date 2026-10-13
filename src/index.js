import { readFileSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildPlayground, loadRepositoryBlueprint, publishComment, resolveIssueNumber } from './playground.js';

const input = name => (process.env[`INPUT_${name.toUpperCase()}`] || '').trim();
const escapeCommand = message => String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
try {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const issueNumber = resolveIssueNumber(event, input('issue-number'));
  if (!issueNumber) {
    console.log('Skipping: this event is not an open issue.');
  } else {
    if (process.env.GITHUB_SERVER_URL !== 'https://github.com') throw new Error('Only github.com repositories are supported by Playground GitHub export.');
    const token = input('github-token');
    if (!token) throw new Error('github-token is required.');
    const api = async (path, method = 'GET', data) => {
      const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        body: data ? JSON.stringify(data) : undefined,
      });
      if (!response.ok) {
        const error = new Error(`GitHub API ${method} failed (${response.status}). Check workflow permissions.`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    };
    const repoPath = process.env.GITHUB_REPOSITORY;
    const repository = await api(`/repos/${repoPath}`);
    const issue = await api(`/repos/${repoPath}/issues/${issueNumber}`);
    if (issue.state === 'open' && !issue.pull_request) {
      const ref = input('ref') || repository.default_branch;
      const repositoryBlueprint = await loadRepositoryBlueprint(api, repoPath, ref);
      const result = buildPlayground({ repository, issue, pluginPath: input('plugin-path'), themePath: input('theme-path'), ref, baseBranch: input('base-branch'), repositoryBlueprint, host: input('playground-host') || undefined });
      const commentId = await publishComment(api, repoPath, issue.number, result.body);
      for (const [key, value] of Object.entries({ 'playground-url': result.playgroundUrl, 'blueprint-json': JSON.stringify(result.blueprint), 'comment-id': commentId })) {
        const delimiter = randomUUID();
        appendFileSync(process.env.GITHUB_OUTPUT, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
      }
      console.log(`Updated Playground comment ${commentId} on issue #${issue.number}.`);
    }
  }
} catch (error) {
  console.log(`::error::${escapeCommand(error.message)}`);
  process.exitCode = 1;
}
