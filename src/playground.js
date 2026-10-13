export const marker = '<!-- action-wp-playground-issues:v1 -->';

function validateRepositoryBlueprint(blueprint) {
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint) || (blueprint.steps !== undefined && !Array.isArray(blueprint.steps))) {
    throw new Error('blueprint.json must contain a Blueprint object with an optional steps array.');
  }
}

export async function loadRepositoryBlueprint(api, repoPath, ref) {
  let file;
  try {
    file = await api(`/repos/${repoPath}/contents/blueprint.json?ref=${encodeURIComponent(ref)}`);
  } catch (error) {
    if (error.status === 404) return undefined;
    throw error;
  }
  if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string') {
    throw new Error('Could not read blueprint.json as a JSON file from the repository.');
  }
  let blueprint;
  try {
    blueprint = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  } catch {
    throw new Error('blueprint.json must contain valid JSON.');
  }
  validateRepositoryBlueprint(blueprint);
  return blueprint;
}

export function buildPlayground({ repository, issue, pluginPath = '', themePath = '', ref, baseBranch, repositoryBlueprint, host = 'https://playground.wordpress.net/' }) {
  if (repositoryBlueprint !== undefined) validateRepositoryBlueprint(repositoryBlueprint);
  if (Boolean(pluginPath) === Boolean(themePath)) throw new Error('Set exactly one of plugin-path or theme-path (use . for the repository root).');
  const type = pluginPath ? 'plugin' : 'theme';
  const rawPath = (pluginPath || themePath).trim().replace(/^\.\//, '').replace(/\/$/, '');
  const path = rawPath === '.' ? '' : rawPath;
  if (!rawPath || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '..' || part === '.' || (!part && path))) throw new Error('The installation path must be relative to the repository.');
  const slug = (path.split('/').pop() || repository.name).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const branch = ref || repository.default_branch;
  if (!branch) throw new Error('A repository default branch or ref is required.');
  const targetBranch = baseBranch || branch;
  const repoUrl = `https://github.com/${repository.full_name}`;
  const root = `/wordpress/wp-content/${type}s/${slug}`;
  const issueUrl = issue.html_url || `${repoUrl}/issues/${issue.number}`;
  const context = `# Issue #${issue.number}: ${issue.title}\n\n${issueUrl}\n\n${issue.body || ''}\n\n---\nRepository: ${repoUrl}\nInstalled branch: ${branch}\nBase branch: ${targetBranch}\nWorking directory: ${root}\nRepository directory: ${path || '.'}\n\nImplement this issue in the working directory and verify the changes. Review and test them before exporting. If your connected client exposes playground_export_to_github, call it with {} to use the launch settings and create a pull request; otherwise use Playground's Export to GitHub. Export only when the contributor asks you to submit a PR. Include Fixes #${issue.number} in the PR description.\n`;
  const baseBlueprint = repositoryBlueprint ?? {
    $schema: 'https://playground.wordpress.net/blueprint-schema.json',
    login: true,
    landingPage: '/wp-admin/',
    features: { networking: true },
    steps: [
      { step: `install${type === 'plugin' ? 'Plugin' : 'Theme'}`, [`${type}Data`]: { resource: 'git:directory', url: repoUrl, ref: branch, refType: 'branch', path: path || '/' }, options: { activate: true, targetFolderName: slug } },
    ],
  };
  const blueprint = {
    ...baseBlueprint,
    steps: [...(baseBlueprint.steps || []), { step: 'writeFile', path: '/wordpress/PLAYGROUND-ISSUE.md', data: context }],
  };
  const url = new URL(host);
  if (url.protocol !== 'https:') throw new Error('playground-host must be an HTTPS URL.');
  url.hash = '';
  const params = {
    'gh-ensure-auth': 'yes',
    'ghexport-repo-url': `${repoUrl}/tree/${branch}${path ? '/' + path : ''}`,
    'ghexport-base-branch': targetBranch,
    'ghexport-content-type': 'custom-paths',
    'ghexport-path': '.',
    [`ghexport-${type}`]: slug,
    'ghexport-playground-root': root,
    'ghexport-repo-root': path || '/',
    'ghexport-pr-action': 'create',
    'ghexport-allow-include-zip': 'no',
    'ghexport-commit-message': `Fixes #${issue.number}`,
    'blueprint-url': `data:application/json,${encodeURIComponent(JSON.stringify(blueprint))}`,
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const playgroundUrl = url.toString();
  const setup = repositoryBlueprint === undefined ? `This workspace installs the ${type} directory from the repository` : 'This workspace boots using the repository’s blueprint.json';
  const body = `${marker}\n[Implement this issue in WordPress Playground](${playgroundUrl})\n\nSign in to GitHub when prompted. PR export is configured. With an AI client connected to Playground, ask it to read /wordpress/PLAYGROUND-ISSUE.md and implement the issue. Review and test your changes, then ask your connected client to submit a PR using \`playground_export_to_github\`, or use **Export to GitHub**.\n\nInclude **Fixes #${issue.number}** in the PR description. ${setup}; an AI client is not installed by this action.`;
  if (body.length > 65000) throw new Error('Blueprint and issue context make the comment too large for GitHub. Shorten the issue body or blueprint.json.');
  return { playgroundUrl, blueprint, body };
}

export async function publishComment(api, repoPath, number, body) {
  let existing;
  for (let page = 1; ; page++) {
    const comments = await api(`/repos/${repoPath}/issues/${number}/comments?per_page=100&page=${page}`);
    existing = comments.find(comment => comment.user?.type === 'Bot' && comment.body?.startsWith(marker));
    if (existing || comments.length < 100) break;
  }
  if (existing) {
    if (existing.body === body) return existing.id;
    return (await api(`/repos/${repoPath}/issues/comments/${existing.id}`, 'PATCH', { body })).id;
  }
  return (await api(`/repos/${repoPath}/issues/${number}/comments`, 'POST', { body })).id;
}

export function resolveIssueNumber(event, explicitNumber = '') {
  if (explicitNumber) {
    if (!/^[1-9][0-9]*$/.test(explicitNumber) || !Number.isSafeInteger(Number(explicitNumber))) throw new Error('issue-number must be a positive integer.');
    return Number(explicitNumber);
  }
  if (!event.issue || event.issue.pull_request || event.issue.state !== 'open') return null;
  return event.issue.number;
}
