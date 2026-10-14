# Support Triage: demo video script (every feature)

Target length: about 2:45. The headline features get full scenes with narration; every
other feature appears in a fast captioned montage (scene 11), so nothing is left out.
Narration ~330 words. Voice: macOS text-to-speech. Music: soft, low under the voice,
louder in the montage.

| # | Time | On screen | Narration |
|---|------|-----------|-----------|
| 1 | 0:00–0:08 | Title card: **Support Triage**, "Every ticket, understood in seconds." | Support teams lose the first minutes of every ticket just working out what it is: how urgent it is, who should take it, and whether it's already been reported. |
| 2 | 0:08–0:20 | Customer signs in, files a ticket, sees it listed. | A customer files a ticket, the usual way. |
| 3 | 0:20–0:45 | Staff view of that ticket: the AI triage panel fills in. Zoom on each part: category, priority and its reason, team, related/duplicate tickets, frustration and escalation risk, "Still needed from the customer", draft reply. Model, prompt version and cost in the footer. | Support Triage reads every new ticket the moment it arrives. In seconds, the AI suggests a category, a priority with its reason, the right team, related and duplicate tickets, how frustrated the customer is, and whether it might escalate. It drafts a first reply, and lists what's still needed from the customer. Every run shows its model, prompt version and cost. |
| 4 | 0:45–0:58 | Agent corrects the priority and confirms; claims the ticket; edits and sends the draft reply. | It never acts on its own. An agent confirms or corrects it in one click, and nothing reaches the customer until a person sends it. |
| 5 | 0:58–1:10 | Queue: SLA stat cards, "at risk" and "overdue" badges, urgent first, tabs and filters, search. | The queue puts what's urgent first, with live response-time targets, so nothing quietly goes overdue. |
| 6 | 1:10–1:20 | Board: drag a card from New to In progress. Card menu (⋯), follow-up flag, team label picker with the L key. | Prefer a board? Drag tickets between columns, flag them for follow-up, and label them right on the card. |
| 7 | 1:20–1:37 | Ticket #4190: "✦ Used 2 past corrections as examples" expands to #4188 and #4189, who corrected them; admin's "Don't learn from this". | And it learns. When the team corrects the AI, those corrections become examples for the next similar ticket. The panel shows exactly which ones it used, and an admin can exclude a bad one. |
| 8 | 1:37–1:55 | Incident banner → /incidents → INC-30: three tickets, two customers, AI note and draft update → "Post update to all tickets". | When several customers report the same problem at once, it spots the incident, groups the tickets, and drafts one update for all of them, sent only when the team says so. |
| 9 | 1:55–2:10 | Admin writes a "Refund policy" note, then asks Sage on the demo ticket; the answer cites the note. | Every agent also has Sage, a private assistant that answers from their own notes and says which note it used. |
| 10 | 2:10–2:22 | Analytics: SLA, triage acceptance, "Is the AI learning?", agent workload, sentiment, CSAT per staff member. | Analytics show SLA performance, how often the team accepts the AI, whether that's improving, and how customers rate the help they got. |
| 11 | 2:22–2:40 | **Montage, ~1.5 s each, caption on screen** (music up, one line of narration over it). See list below. | And everything a real help desk needs is already here. |
| 12 | 2:40–2:48 | Closing card: **Support Triage**, "AI does the reading. Your team does the helping." | Support Triage. The AI does the reading, so your team can do the helping. |

## Scene 11 montage (caption per shot)

1. "Staff file tickets for customers": staff New ticket on a customer's behalf
2. "Customers rate resolved tickets": the customer rates the demo ticket 5 stars
3. "A shareable status page": the public read-only status page
4. "Team labels": /labels page
5. "Re-run the AI on any ticket": the card menu's "Re-run AI triage"
6. "Admin overview, roles and people": /admin (not /admin/users, which lists real emails)
7. "Your settings, your theme": account settings, dark theme (put back afterwards)
8. "Secure by default: RLS, CSRF, rate limits": the sign-in page
9. "Tested end to end, live on Vercel": the Playwright HTML report

Not shown: the "AI triage is off/failing" banner (it needs a real outage or seeded
failures across the team) and a stalled run (needs a crashed run).

## Before recording

- Run `node --env-file=.env.local scripts/backdate-demo.mjs --apply` so the SLA badges show a mix.
- Remove or hide the leftover test tickets (#4406–#4409) so the queue looks clean.
- Every scene is recorded by a scripted browser on `localhost:3000` with the project's test accounts.
- Scene 3 uses a fresh ticket so the AI panel fills in live (real model call).
