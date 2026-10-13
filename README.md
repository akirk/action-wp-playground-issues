# WordPress Playground Issues

A companion to `action-wp-playground-pr-preview`: post a link on an issue to install the repository in WordPress Playground, prompt the contributor to authenticate with GitHub, and configure export to a new pull request.

With an AI client connected to Playground, the contributor can implement the issue, test it, and submit a PR. The action writes the issue title, body, source URL, and working directory to `/wordpress/PLAYGROUND-ISSUE.md` for the client to read. Connecting an AI client is a separate step; this action does not install one.

## Install

Add `.github/workflows/playground-issues.yml` to your plugin or theme repository:

```yaml
name: Implement issues in Playground
on:
  issues:
    types: [opened, edited, reopened]
  workflow_dispatch:
    inputs:
      issue-number:
        description: Issue number to add or refresh the Playground comment
        required: true
        type: string
permissions:
  contents: read
  issues: write
concurrency:
  group: playground-issue-${{ inputs.issue-number || github.event.issue.number }}
  cancel-in-progress: false
jobs:
  playground:
    runs-on: ubuntu-latest
    steps:
      - uses: akirk/action-wp-playground-issues@main
        with:
          plugin-path: .
          issue-number: ${{ inputs.issue-number }}
```

The example follows `main`; you can pin a published release tag or commit SHA instead. No checkout is needed. For themes, replace `plugin-path` with `theme-path`. For a monorepo, use a directory such as `plugins/my-plugin`. Configure exactly one installation path.

The action creates one managed bot comment and updates it when the issue changes. It skips closed issues and pull requests. The concurrency setting prevents overlapping runs from creating duplicate comments.

## Add a comment to an existing issue

Once the workflow is on the repository's default branch, open **Actions → Implement issues in Playground → Run workflow**, enter the issue number, and run it. This adds the managed comment, or refreshes it if one already exists. Closed issues and PR numbers are skipped.

You can also run it with GitHub CLI:

```sh
gh workflow run playground-issues.yml --repo OWNER/REPO -f issue-number=123
```

New issues still get the comment automatically. Manual runs let you add it to older issues without editing or reopening them.

## Inputs and outputs

| Input | Default | Purpose |
| --- | --- | --- |
| `issue-number` | event issue | Explicit issue number for manual runs. |
| `plugin-path` | unset | Plugin directory; `.` means repository root. |
| `theme-path` | unset | Theme directory; mutually exclusive with plugin path. |
| `ref` | default branch | Branch installed in Playground and targeted by export. |
| `playground-host` | `https://playground.wordpress.net/` | HTTPS Playground host supporting GitHub export. |
| `github-token` | `${{ github.token }}` | Token for managing the issue comment. |

Outputs: `playground-url`, `blueprint-json`, and `comment-id`.

## Contributor workflow

1. Open the issue's Playground link and complete GitHub sign-in.
2. Connect your AI client and ask it to read `/wordpress/PLAYGROUND-ISSUE.md`, or make changes manually.
3. Review and test changes inside the installed plugin or theme directory.
4. Use Playground's **Export to GitHub** to create a PR. The destination branch and repository directory are preconfigured. Include `Fixes #123` (your issue number) in the PR description.

This uses the native blueprint equivalent of the step library's `gitPlugin` / `gitTheme` steps with `prs: true`. It also sets the export destination directory explicitly for monorepos. GitHub authentication belongs to the contributor's browser session; the workflow token is never included in the link or blueprint.

The link contains the issue body, so it should only be shared with people allowed to read the issue. Playground must be able to fetch the repository through its GitHub integration. Only github.com is supported. Very large issue bodies fail with a clear error when the generated comment would exceed GitHub's limit. The editable workspace contains the configured plugin or theme directory, rather than unrelated files elsewhere in the repository. Export remains an explicit contributor action.

Query parameters follow the [Playground Query API](https://wordpress.github.io/wordpress-playground/developers/apis/query-api/).

## Development

Requires Node.js 24 for the action runtime. No dependencies or build step; GitHub runs `src/index.js` directly.

```sh
npm test
```
