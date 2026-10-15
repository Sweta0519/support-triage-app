# Homepage design plan (SUP-46 / SUP-48)

Written before building, following Anthropic's `frontend-design` skill (the
"anti AI slop" guidance the owner asked for): plan, review against the brief,
then build and critique with screenshots.

## Brief

- **Subject:** a help desk where an AI reads every incoming ticket and suggests
  how to handle it, while people make every decision.
- **Audience:** support leads and founders of small teams who answer customer
  email themselves today.
- **Primary job:** in one screen, show what happens to a ticket, then get the
  visitor to sign up (or sign in).

## Direction

The most characteristic thing in this product's world is the moment a raw,
messy customer message turns into a sorted, explained ticket. The hero shows
that moment as real interface, with the real demo ticket and the AI's real
output, not a screenshot or an illustration. That is the one bold element;
everything else stays quiet, like the app itself (calm, Linear-style).

## Tokens

| Name | Hex | Use |
|---|---|---|
| Paper | `#FBFBFC` | page background (cool, not cream) |
| Ink | `#15171C` | headings and body |
| Graphite | `#5B606B` | secondary text |
| Rule | `#E3E5EA` | the few borders and the sequence line |
| Indigo | `#4F46E5` | the app's own primary: buttons and links only |
| Band | `#2A2170` to `#0B0A1A` | the screenshots section only: the video's deep indigo, a radial gradient over solid `#14112F` (SUP-60) |
| On-band copy | `#C4C0E8` | secondary text on the band (about 9:1 at its lightest point) |
| Signal red / amber / green | `#E5484D` / `#F5A524` / `#30A46C` | the logo's three priority dots, used only as dots |

**Type:**
- **Geist** is the product's voice: headings, UI and body. The root layout already loads it, though the app's `body` still falls back to Arial in `globals.css`; switching the app over is a separate decision. The homepage sets it explicitly.
- **Source Serif 4** is used only for the customer's own words, so the hero contrasts a person writing with the system reading.
- **Scale:** 56/36/20/17/15 px, headline tracking -0.02em, body line length under 70 characters.

**Layout:** left-aligned throughout.

```
[logo] Support Triage                         Sign in  [Request access]

Every new ticket, read and sorted       ┌ customer's message (serif) ┐
before anyone opens it.                 │ "Hi, I just noticed two…"  │
one-paragraph explanation               ├ the AI's read (sans) ──────┤
[Request access]  Sign in             │ Billing · High (why…) ·…   │
                                        └ drafted reply ─────────────┘

How a ticket moves through Support Triage      (a real sequence: 1–4)
 │ A customer writes in
 │ The AI reads it in seconds
 │ An agent decides
 │ The next ticket gets it right

Also included                        (two-column list, not cards)
 Sage ……………… one line       Incident detection …… one line
 …

Use it with your team.  [Request access]
footer: Privacy policy   Sign in
```

**Motion:** one orchestrated moment. The AI's read fills in line by line once,
on load. It's off under `prefers-reduced-motion`. No section fade-ins, and no
hover effects on everything.

## Revisions after the first build

- **SUP-60:** the screenshots section became a dark band, the page's one dark moment, so the devices sit on a stage. The hero stays the bold *idea*, and the band is the bold *surface*. Everything else is unchanged and quiet. The device frames gained a light hairline and a deep shadow so they read on the band.

## Review against the generic defaults (what changed and why)

- **Hero:** the first instinct was a big headline over a centred screenshot with a gradient glow, which is the default SaaS hero. I swapped it for the live triage moment, which only this product has.
- **Features:** the first instinct was a grid of identical rounded cards with icons, which is the "SaaS-card kit". I swapped it for an ordered sequence, because a ticket's life really is a sequence, plus a plain two-column list.
- **Labels:** no all-caps eyebrows above headings, no middle-dot meta strings, no "→" on buttons, no single-word headline accents.
- **Palette:** I kept the app's indigo for actions (brand continuity) and the logo's three dots. I rejected a purple gradient background.
- **Copy:** plain and specific, taken from what the app really does (README). No "revolutionize", "seamless" or "supercharge".

## Copy

- **H1:** Every new ticket, read and sorted before anyone opens it.
- **Lede:** Support Triage is a help desk with an AI that reads each ticket as it arrives. It suggests a category, a priority with its reason, the right team and a first reply. Your team confirms or corrects it, and a person always sends the reply.
- The sequence and the "also included" lines are in `app/welcome/page.tsx`. Each one matches a shipped feature.
