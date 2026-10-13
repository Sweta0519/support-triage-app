# Code reviews: how they're done and where the evidence is

Every PR is reviewed before merge by two independent passes over its diff (`git diff main...HEAD`).
Findings are fixed or answered before merging. This page says which tools produced which review, so
that another reviewer can re-run them or check them.

## The two tools

| Tool | What it is | Where it lives | How to run it |
|---|---|---|---|
| `ai-code-reviewer` subagent | A read-only Claude Code subagent that reviews the current diff against this repo's rules: dead code, duplication, silent behaviour changes and `CLAUDE.md` violations. These include service-role key isolation, RLS, Server Actions, profile-based roles and advisory-only triage. | **In this repo:** [`.claude/agents/ai-code-reviewer.md`](../../.claude/agents/ai-code-reviewer.md), added 2026-09-14 (`d2b4f34`). | In Claude Code, ask for the `ai-code-reviewer` agent on the branch, e.g. "review `git diff main...HEAD` with ai-code-reviewer". The prompt names the PR's risky areas. |
| `/code-review` skill | Anthropic's `code-review` plugin, which runs several specialised finder agents and verifies each candidate before reporting it. | **User level, not in this repo:** the `claude-plugins-official` marketplace, plugin `code-review` (installed with `/plugin`). | `/code-review --comment <PR number>` posts each finding as an inline PR comment. Earlier PRs used `/code-review main high`, which reports in the terminal. |

Other review tooling in the repo, used for specific PRs:
- [`.claude/commands/security-scan.md`](../../.claude/commands/security-scan.md): the `/security-scan` report for SUP-11 (PR #17), in `docs/security/`.
- [`.claude/agents/gdpr-compliance.md`](../../.claude/agents/gdpr-compliance.md): the GDPR auditor, added in PR #9.
- [`.claude/agents/eu-ai-act-compliance.md`](../../.claude/agents/eu-ai-act-compliance.md): the EU AI Act auditor (PR #11).

## Where the evidence is

**Since PR #12 (2026-10-09), the evidence is the PR itself.** Each finding is an inline review
comment on the file and line it concerns, with a tag saying which tool found it:
- `/code-review`'s comments are posted by the skill;
- `ai-code-reviewer` findings are tagged in the comment, as `**[ai-code-reviewer · medium] …**` on
  earlier PRs and `**(ai-code-reviewer) …**` on later ones.

Every thread has a reply: "Fixed in `<sha>`" with what changed, or why it was deliberately not fixed.
Then the thread is resolved. No report files are written to this folder any more.

A few representative PRs:

| PR | What to look at |
|---|---|
| [#12](https://github.com/Sweta0519/support-triage-app/pull/12) | The first PR reviewed this way: staff confirm or correct AI triage. |
| [#17](https://github.com/Sweta0519/support-triage-app/pull/17) | The security-scan follow-up. A finding outside the diff is posted as a conversation comment and answered. |
| [#39](https://github.com/Sweta0519/support-triage-app/pull/39) | The AI core: the reply-drafting call no longer sees other customers' tickets. |
| [#42](https://github.com/Sweta0519/support-triage-app/pull/42) | Database findings (trigger, grants, cascade) fixed in a follow-up migration. |
| [#44](https://github.com/Sweta0519/support-triage-app/pull/44) | The retry policy. Fixed findings sit alongside two answered as deliberate. |

**Before PR #12**, review results were written up as files here:

| PR | File | Mechanism |
|---|---|---|
| #1 (2026-09-03) | [`pr-1-ai-code-reviewer.md`](pr-1-ai-code-reviewer.md) | `ai-code-reviewer` subagent. |
| #3 (2026-09-04) | [`pr-3-ai-code-reviewer.md`](pr-3-ai-code-reviewer.md) | `ai-code-reviewer` subagent, plus a separate security audit in [`docs/security/audit-share-feature.md`](../security/audit-share-feature.md). |
| #5 (2026-09-06) | [`pr-5-code-review.md`](pr-5-code-review.md) | `/code-review main high`. The subagent wasn't in this repo yet. |

PRs #1 and #3 predate the subagent's definition in this repo (added 2026-09-14). The commit that
added it says the definition existed only in the separate `notes-collections` repo until then, so
those two reviews ran from that copy. Their findings and the commits that fixed them are in the
reports. The exact prompt used then was not recorded.

PRs #9 and #10 (the privacy policy, data export and account deletion) have inline review comments,
6 and 4 respectively. Those comments don't name the tool that produced them.

**No review evidence is recorded** for these PRs:
- #2, the usage and cost indicator;
- #4, the Sage chat (PR #5's report says `/code-review` was used for it, but nothing was kept);
- #6, #7 and #8, small navigation changes;
- #11, adding the EU AI Act auditor;
- #14, the submission mirror workflow.

## Reproducing a review

On the PR's branch, run both tools on the same diff:
1. `/code-review --comment <PR number>`;
2. the `ai-code-reviewer` subagent on `git diff main...HEAD`.

Results won't match word for word, since both use a model. But the issues are concrete and
checkable: each one names a file, a line and a failure scenario. Each finding's thread shows how it
was settled.
