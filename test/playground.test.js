import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayground, loadRepositoryBlueprint, publishComment, marker, resolveIssueNumber } from '../src/playground.js';
const repository = { name: 'my-plugin', full_name: 'owner/my-plugin', default_branch: 'trunk' };
const issue = { number: 42, title: 'Fix café & links', body: 'Text with `code` and <markup> 👋', html_url: 'https://github.com/owner/my-plugin/issues/42' };
const build = extra => buildPlayground({ repository, issue, pluginPath: '.', ...extra });

test('repository blueprint owns boot settings and steps while retaining issue context and export', () => {
  const repositoryBlueprint = {
    landingPage: '/demo/', login: false,
    preferredVersions: { php: '8.3', wp: 'latest' },
    features: { networking: false }, plugins: ['gutenberg'],
    steps: [{ step: 'runPHP', code: '<?php echo "café";' }],
  };
  const original = structuredClone(repositoryBlueprint);
  const result = build({ repositoryBlueprint, ref: 'dist/main' });
  assert.deepEqual(result.blueprint, {
    ...repositoryBlueprint,
    steps: [...repositoryBlueprint.steps, { step: 'writeFile', path: '/wordpress/PLAYGROUND-ISSUE.md', data: result.blueprint.steps.at(-1).data }],
  });
  assert.deepEqual(repositoryBlueprint, original);
  assert.ok(result.blueprint.steps.at(-1).data.includes('Base branch: dist/main\n'));
  const query = new URL(result.playgroundUrl).searchParams;
  assert.equal(query.get('ghexport-repo-url'), 'https://github.com/owner/my-plugin/tree/dist/main');
  assert.equal(query.get('ghexport-playground-root'), '/wordpress/wp-content/plugins/my-plugin');
  assert.deepEqual(JSON.parse(decodeURIComponent(query.get('blueprint-url').slice('data:application/json,'.length))), result.blueprint);
  assert.ok(result.body.includes('boots using the repository’s blueprint.json'));
  assert.equal(build({ repositoryBlueprint: { plugins: ['gutenberg'] } }).blueprint.steps.length, 1);
});

test('loads root blueprint.json from the selected branch, preserving UTF-8 content', async () => {
  const blueprint = { steps: [{ step: 'runPHP', code: '<?php echo "café 👋";' }] };
  const loaded = await loadRepositoryBlueprint(async path => {
    assert.equal(path, '/repos/owner/my-plugin/contents/blueprint.json?ref=dist%2Fmain');
    return { type: 'file', encoding: 'base64', content: Buffer.from(JSON.stringify(blueprint)).toString('base64') };
  }, 'owner/my-plugin', 'dist/main');
  assert.deepEqual(loaded, blueprint);
});

test('only a missing blueprint falls back; API and invalid file errors fail the action', async () => {
  const missing = Object.assign(new Error('Missing'), { status: 404 });
  assert.equal(await loadRepositoryBlueprint(async () => { throw missing; }, 'owner/repo', 'main'), undefined);
  for (const status of [403, 500]) {
    const error = Object.assign(new Error('API failed'), { status });
    await assert.rejects(loadRepositoryBlueprint(async () => { throw error; }, 'owner/repo', 'main'), error);
  }
  for (const content of ['{', 'null', '[]', '{"steps":{}}']) {
    await assert.rejects(loadRepositoryBlueprint(async () => ({ type: 'file', encoding: 'base64', content: Buffer.from(content).toString('base64') }), 'owner/repo', 'main'), /blueprint.json/);
  }
  await assert.rejects(loadRepositoryBlueprint(async () => [], 'owner/repo', 'main'), /Could not read/);
  assert.throws(() => build({ repositoryBlueprint: { steps: {} } }), /blueprint.json/);
  assert.throws(() => build({ repositoryBlueprint: { steps: [{ step: 'runPHP', code: 'a'.repeat(70000) }] } }), /too large/);
});

test('link round-trips the blueprint and configures authentication without tokens', () => {
  const result = build();
  const query = new URL(result.playgroundUrl).searchParams;
  assert.deepEqual(JSON.parse(decodeURIComponent(query.get('blueprint-url').slice('data:application/json,'.length))), result.blueprint);
  assert.equal(query.get('gh-ensure-auth'), 'yes');
  assert.equal(query.get('ghexport-repo-url'), 'https://github.com/owner/my-plugin/tree/trunk');
  assert.equal(query.get('ghexport-pr-action'), 'create');
  assert.equal(query.get('ghexport-repo-root'), '/');
  assert.equal(query.get('ghexport-commit-message'), 'Fixes #42');
  assert.equal(result.blueprint.steps[0].pluginData.path, '/');
  assert.equal(result.blueprint.steps[0].options.targetFolderName, 'my-plugin');
  assert.ok(result.blueprint.steps[1].data.includes(issue.body));
  assert.equal(result.blueprint.steps[1].path, '/wordpress/PLAYGROUND-ISSUE.md');
});

test('a specific distribution branch is used for installation, export, and issue context', () => {
  const result = build({ ref: 'dist/main' });
  const query = new URL(result.playgroundUrl).searchParams;
  assert.equal(result.blueprint.steps[0].pluginData.ref, 'dist/main');
  assert.equal(result.blueprint.steps[0].pluginData.refType, 'branch');
  assert.equal(result.blueprint.steps[0].pluginData.path, '/');
  assert.equal(query.get('ghexport-repo-url'), 'https://github.com/owner/my-plugin/tree/dist/main');
  assert.equal(query.get('ghexport-repo-root'), '/');
  assert.ok(result.blueprint.steps[1].data.includes('Base branch: dist/main\n'));
});

test('monorepo themes map the installed directory to the original repository directory', () => {
  const result = build({ pluginPath: '', themePath: 'themes/custom-theme', ref: 'feature/design' });
  const query = new URL(result.playgroundUrl).searchParams;
  assert.equal(query.get('ghexport-theme'), 'custom-theme');
  assert.equal(query.get('ghexport-content-type'), 'custom-paths');
  assert.equal(query.get('ghexport-path'), '.');
  assert.equal(query.get('ghexport-repo-url'), 'https://github.com/owner/my-plugin/tree/feature/design/themes/custom-theme');
  assert.equal(query.get('ghexport-playground-root'), '/wordpress/wp-content/themes/custom-theme');
  assert.equal(query.get('ghexport-repo-root'), 'themes/custom-theme');
  assert.equal(result.blueprint.steps[0].themeData.ref, 'feature/design');
  assert.equal(result.blueprint.steps[0].themeData.refType, 'branch');
  assert.equal(result.blueprint.steps[0].themeData.path, 'themes/custom-theme');
});

test('rejects ambiguous and unsafe input, and oversized issue comments', () => {
  for (const extra of [{ pluginPath: '' }, { themePath: '.' }, { pluginPath: '../plugin' }, { pluginPath: '/plugin' }, { pluginPath: 'a/../b' }, { host: 'http://example.org' }]) {
    assert.throws(() => build(extra));
  }
  assert.throws(() => build({ issue: { ...issue, body: 'a'.repeat(70000) } }), /too large/);
});

test('finds managed bot comments across pages and ignores user copies', async () => {
  const calls = [];
  const api = async (path, method, data) => {
    calls.push({ path, method, data });
    if (method === 'PATCH') return { id: 9 };
    if (path.endsWith('&page=1')) return Array.from({ length: 100 }, () => ({ id: 7, user: { type: 'User' }, body: marker }));
    return [{ id: 9, user: { type: 'Bot' }, body: marker + '\nold' }];
  };
  assert.equal(await publishComment(api, 'owner/repo', 42, marker + '\nnew'), 9);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].method, 'PATCH');
  assert.equal(calls[2].path, '/repos/owner/repo/issues/comments/9');
});

test('creates a new comment and avoids rewriting unchanged comments', async () => {
  const calls = [];
  assert.equal(await publishComment(async (path, method, data) => {
    calls.push({ path, method, data });
    return method === 'POST' ? { id: 10 } : [];
  }, 'owner/repo', 42, marker), 10);
  assert.equal(calls[1].method, 'POST');
  assert.equal(await publishComment(async (path, method) => {
    assert.equal(method, undefined);
    return [{ id: 10, user: { type: 'Bot' }, body: marker }];
  }, 'owner/repo', 42, marker), 10);
});

test('manual runs accept an explicit issue number and validate it before API calls', () => {
  assert.equal(resolveIssueNumber({}, '123'), 123);
  assert.equal(resolveIssueNumber({ issue: { ...issue, state: 'open' } }), 42);
  assert.equal(resolveIssueNumber({ issue: { ...issue, state: 'closed' } }), null);
  assert.equal(resolveIssueNumber({ issue: { ...issue, state: 'open', pull_request: {} } }), null);
  assert.equal(resolveIssueNumber({}), null);
  for (const value of ['0', '-1', '1.5', 'abc', '9007199254740992']) assert.throws(() => resolveIssueNumber({}, value), /positive integer/);
});
