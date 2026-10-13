# Branch protection on `main`

Applied on 2026-10-13 (SUP-35) through the GitHub API, with the repo owner's approval. GitHub
settings aren't stored in the repo, so this page records them. If they're ever lost or changed,
restore them from here.

## What GitHub enforces

| Rule | Setting | Why |
|---|---|---|
| Require a pull request | on, **0 approvals** | A solo owner can't approve their own PR. The two-tool review below is the review. |
| Required status check | `Vercel` (the Vercel GitHub app's commit status for the preview deployment) | A merge needs a preview that builds and deploys. |
| Require branches to be up to date | **off** | The owner chose not to require it, to avoid re-building every open PR after each merge. As a result, two PRs that each passed Vercel can merge in either order without a build of the combination. |
| Require conversation resolution | **on** | A PR can't merge while any review thread is unresolved. |
| Include administrators | **on** | The owner is bound too: there are no direct pushes and no merging past a failed check. |
| Force-pushes, deletion | blocked | |

## What is required by convention, not enforced

GitHub doesn't run these; the PR template (`.github/pull_request_template.md`) asks for them:
- **The full Playwright suite.** There's no CI runner, and the suite needs real test accounts and
  API keys, so it runs locally before each commit.
- **The two-tool review:** `/code-review --comment <PR>` and the `ai-code-reviewer` subagent
  (`docs/reviews/README.md`). GitHub enforces only that their threads are resolved.
- **The rest of the template's checklist**, including the UI section for redesigns.

## Restoring it

```bash
gh api -X PUT repos/Sweta0519/support-triage-app/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["Vercel"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0, "dismiss_stale_reviews": false, "require_code_owner_reviews": false },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false,
  "required_conversation_resolution": true
}
JSON
```

Check it with `gh api repos/Sweta0519/support-triage-app/branches/main/protection`.

## If a PR can't merge because "Vercel" never reports

Vercel has reported the `Vercel` status on every PR so far, docs-only ones included (#45, #46).
If it stops reporting, for example after an "Ignored Build Step" is added in the Vercel dashboard
or during a Vercel outage, a PR waits forever, and administrators are bound too. To recover, the
owner turns off **Include administrators** under Settings → Branches → `main` for that one merge,
then turns it back on. Or fix the Vercel project so it reports again. Never solve it by merging
outside a PR.
