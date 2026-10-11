import { test, expect } from "@playwright/test";

import {
  computeAnalytics,
  computeCsat,
  computeSentiment,
  computeTeamPerformance,
  formatCsat,
  formatRate,
  type AnalyticsTicketRow,
} from "../app/lib/analytics";
import { login, requireEnv } from "./helpers";

// The admin analytics page. The numbers come from a pure function, tested
// here on fixed rows; the browser tests only check access and that the page
// renders, since the shared database's totals change with every test run.

const NOW = new Date("2026-10-09T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();

function row(overrides: Partial<AnalyticsTicketRow> = {}): AnalyticsTicketRow {
  return {
    status: "new",
    created_at: hoursAgo(1),
    first_response_at: null,
    assignee_id: null,
    latest_triage: null,
    triage_state: null,
    ...overrides,
  };
}

const AI = { priority: "high", category: "billing", team: "billing" };

function reviewed(staff: typeof AI, ai: typeof AI | null): AnalyticsTicketRow {
  return row({
    status: "resolved",
    first_response_at: hoursAgo(0.5),
    triage_state: { ...staff, reviewed_at: hoursAgo(0.5), reviewed_result: ai },
  });
}

test.describe("computeAnalytics", () => {
  test("volume has one bucket per UTC day for the last 14 days, empty days included", () => {
    const a = computeAnalytics(
      [
        row({ created_at: "2026-10-09T01:00:00Z" }),
        row({ created_at: "2026-10-09T23:00:00Z" }),
        row({ created_at: "2026-09-26T00:00:00Z" }),
        row({ created_at: "2026-09-25T23:59:59Z" }), // 15 days back: outside the window
        row({ created_at: "2026-10-08T21:30:00-05:00" }), // 2026-10-09 02:30 UTC
      ],
      NOW
    );
    expect(a.volume).toHaveLength(14);
    expect(a.volume[0]).toEqual({ day: "2026-09-26", count: 1 });
    expect(a.volume[13]).toEqual({ day: "2026-10-09", count: 3 });
    expect(a.volume.reduce((sum, d) => sum + d.count, 0)).toBe(4);
    expect(a.ticketCount).toBe(5);
  });

  test("SLA groups answered and waiting tickets by the priority the target used", () => {
    const a = computeAnalytics(
      [
        // urgent (1h): answered in 30m -> met; answered in 2h -> missed
        row({ created_at: hoursAgo(5), first_response_at: hoursAgo(4.5), triage_state: { ...AI, priority: "urgent", reviewed_at: null, reviewed_result: null } }),
        row({ created_at: hoursAgo(5), first_response_at: hoursAgo(3), triage_state: { ...AI, priority: "urgent", reviewed_at: null, reviewed_result: null } }),
        // no priority -> normal (8h): waiting 9h -> overdue; waiting 7h -> at risk
        row({ created_at: hoursAgo(9) }),
        row({ created_at: hoursAgo(7) }),
        // closed without a reply: no SLA at all
        row({ status: "closed", created_at: hoursAgo(30) }),
      ],
      NOW
    );
    const urgent = a.sla.byPriority.find((r) => r.priority === "urgent");
    const normal = a.sla.byPriority.find((r) => r.priority === "normal");
    expect(urgent).toMatchObject({ answered: 2, met: 1, openBreached: 0 });
    expect(normal).toMatchObject({ answered: 0, openAtRisk: 1, openBreached: 1 });
    expect(a.sla).toMatchObject({ answered: 2, met: 1 });
  });

  test("open at-risk and overdue counts come from the open set, not the recent sample", () => {
    // An old unanswered ticket that fell outside the recent sample still counts.
    const oldWaiting = row({ created_at: hoursAgo(200) });
    const a = computeAnalytics([row({ created_at: hoursAgo(1) })], NOW, [oldWaiting]);
    expect(a.sla.byPriority.find((r) => r.priority === "normal")).toMatchObject({ openBreached: 1, openAtRisk: 0 });
  });

  test("triage quality compares the reviewer's values with the AI run they saw", () => {
    const a = computeAnalytics(
      [
        reviewed(AI, AI), // confirmed
        reviewed({ ...AI, priority: "urgent" }, AI), // corrected: AI high -> staff urgent
        reviewed({ ...AI, team: "support" }, AI), // corrected: team only
        reviewed(AI, null), // reviewed with no AI run
        reviewed(AI, { priority: null, category: null, team: null } as unknown as typeof AI), // nothing to compare
        row({ triage_state: { ...AI, reviewed_at: null, reviewed_result: null } }), // not reviewed
      ],
      NOW
    );
    expect(a.triage).toMatchObject({ reviewed: 5, confirmed: 1, corrected: 2, manual: 2 });
    expect(a.triage.fieldAgreement).toEqual([
      { field: "priority", agreed: 2, compared: 3 },
      { field: "category", agreed: 3, compared: 3 },
      { field: "team", agreed: 2, compared: 3 },
    ]);
    expect(a.triage.priorityMatrix.high).toEqual({ low: 0, normal: 0, high: 2, urgent: 1 });
  });

  test("team performance: workload, recent output and CSAT per person, unassigned last", () => {
    const staff = [
      { id: "a", label: "alice@x.test" },
      { id: "b", label: "bob@x.test" },
      { id: "c", label: "carol@x.test" },
    ];
    const rating = (agent_id: string | null, score: number) => ({
      ticket_id: `${agent_id}-${score}-${Math.random()}`,
      score,
      comment: null,
      agent_id,
      created_at: hoursAgo(1),
      ticket: null,
    });
    const rows = computeTeamPerformance({
      open: [
        row({ assignee_id: "a", created_at: hoursAgo(9) }), // normal 8h: overdue
        row({ assignee_id: "a", created_at: hoursAgo(7) }), // 1h left: at risk
        row({ assignee_id: "a", created_at: hoursAgo(1), first_response_at: hoursAgo(0.5), status: "in_progress" }),
        row({ assignee_id: "b", created_at: hoursAgo(1) }),
        row({ assignee_id: "gone", created_at: hoursAgo(1) }), // no longer staff
        row({ assignee_id: null, created_at: hoursAgo(30) }),
      ],
      recent: [
        // a: two answered (one in time, one late), one resolved
        row({ assignee_id: "a", status: "resolved", created_at: hoursAgo(20), first_response_at: hoursAgo(19) }),
        row({ assignee_id: "a", created_at: hoursAgo(20), first_response_at: hoursAgo(5) }),
        row({ assignee_id: "b", status: "closed", created_at: hoursAgo(3) }),
        row({ assignee_id: null, status: "resolved" }), // unassigned output isn't credited
      ],
      ratings: [rating("a", 5), rating("a", 4), rating("a", 3), rating("b", 1), rating(null, 2)],
      staff,
      now: NOW,
    });
    const a = rows.find((r) => r.assigneeId === "a")!;
    expect(a).toMatchObject({ open: 3, atRisk: 1, overdue: 1, resolved: 1, repliesOnTime: 1, repliesAnswered: 2, csatSum: 12, csatCount: 3 });
    expect(rows.find((r) => r.assigneeId === "b")).toMatchObject({ open: 1, resolved: 1, csatSum: 1, csatCount: 1 });
    expect(rows.find((r) => r.assigneeId === "gone")?.label).toBe("Former staff member (gone)");
    expect(rows.find((r) => r.assigneeId === "c")).toMatchObject({ open: 0, csatCount: 0 });
    expect(rows.at(-1)).toMatchObject({ assigneeId: null, label: "Unassigned", open: 1, overdue: 1, resolved: 0 });
    // CSAT shows only from the minimum number of ratings.
    expect(formatCsat(a.csatSum, a.csatCount, 3)).toBe("4.0");
    expect(formatCsat(1, 1, 3)).toBeNull();
  });

  test("CSAT summary: team average and the latest low ratings", () => {
    const r = (score: number, created_at: string) => ({ ticket_id: created_at, score, comment: null, agent_id: "a", created_at, ticket: null });
    const csat = computeCsat([r(5, "2026-10-01"), r(1, "2026-10-03"), r(2, "2026-10-05"), r(4, "2026-10-06")]);
    expect(csat).toMatchObject({ average: "3.0", count: 4 });
    expect(csat.recentLow.map((x) => x.score)).toEqual([2, 1]);
    expect(computeCsat([])).toMatchObject({ average: null, count: 0, recentLow: [] });
  });

  test("sentiment buckets the AI frustration score of open tickets and counts what needs action", () => {
    const ai = (frustration: number | null, is_escalation_risk = false) => ({ frustration, is_escalation_risk });
    const open = [
      row({ latest_triage: ai(1) }),
      row({ latest_triage: ai(2) }),
      row({ latest_triage: ai(3) }),
      row({ latest_triage: ai(4), first_response_at: hoursAgo(0.5) }), // frustrated but answered
      row({ latest_triage: ai(5, true) }), // frustrated, waiting, escalation risk
      row({ latest_triage: ai(null) }), // run without a score
      row(), // not triaged
      row({ latest_triage: ai(5, true), status: "resolved" }), // not open: ignored
    ];
    expect(computeSentiment(open)).toEqual({
      calm: 2,
      neutral: 1,
      frustrated: 2,
      unscored: 2,
      frustratedWaiting: 1,
      escalationRisk: 1,
    });
  });

  test("rates show a dash, not 0%, when there is nothing to divide by", () => {
    expect(formatRate(0, 0)).toBe("-");
    expect(formatRate(1, 3)).toBe("33%");
    expect(formatRate(199, 200)).toBe(">99%");
    expect(formatRate(1, 300)).toBe("<1%");
    expect(formatRate(5, 5)).toBe("100%");
  });
});

test("only admins can open /analytics", async ({ page, browser }) => {
  // Customer A (default storageState).
  await page.goto("/analytics");
  await expect(page).toHaveURL(/\/403$/);

  const agentContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const agentPage = await agentContext.newPage();
  await login(agentPage, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  await expect(agentPage.getByRole("link", { name: "Analytics" })).toHaveCount(0);
  await agentPage.goto("/analytics");
  await expect(agentPage).toHaveURL(/\/403$/);
  await agentContext.close();

  const adminContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const adminPage = await adminContext.newPage();
  await login(adminPage, requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
  await adminPage.getByRole("link", { name: "Analytics" }).click();
  await expect(adminPage.getByRole("heading", { name: "Analytics", level: 1 })).toBeVisible();
  await expect(adminPage.getByRole("heading", { name: "First-response SLA by priority" })).toBeVisible();
  await expect(adminPage.getByRole("heading", { name: "Triage quality" })).toBeVisible();
  await adminContext.close();
});
