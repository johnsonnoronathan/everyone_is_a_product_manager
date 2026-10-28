# Handing your project in for review

For the person who built the app, often a product manager working with an AI coding assistant, when someone else (a reviewer, a consultant, your client's engineers) will review it. It takes about a day with AI help, plus however long it takes others to give you a few numbers and approvals.

You don't need any of this to review **your own** app: just ask Claude Code to *"review this app before launch"*. This guide is for handing it to someone else.

## What you hand in, in one sentence

Your code, with a README that tells a stranger how to run it, and a **review page**: one web page that shows what the app does (with screenshots), how it's built and tested, and which problems you already know about. The reviewer starts from that page instead of from a blank screen.

You don't write the page or its data file (`review/review-pack.json`) by hand. Your AI assistant does.

## How to do it

1. **Open Claude Code in your project folder** ([what Claude Code is and how to install it](https://code.claude.com/docs/en/overview)), with this project's skills installed (see the [README](../README.md#start-here)).
2. **Ask:** *"Prepare my project for review."* That starts the `prepare-review` skill. It reads your code, runs the app, takes the screenshots, writes the README section and the review page, and asks you for what it can't find out itself (next section).
3. **Answer its questions.** Where you don't know an answer, say so. It writes "Not agreed yet", which is far better than a guess: a made-up number becomes a promise the reviewer will test you against.
4. **Look at the screenshots.** They go to people outside your team, so they must show test data only: test accounts, made-up names and addresses, no real customer and no password or key. The check below reads saved text for real email addresses and keys, but nothing reads pictures.
5. **Let it run the check.** Software checks the hand-in is complete and lists exactly what's missing. It's done when the check says `GATE PASSED`.
6. **Send it.** Push the code (with the new `review/` folder) to the repository the reviewer can see, and send them the link. If they can't access your repository, send a zip of the project folder.

If something was missing, the reviewer sends the page back. Its first section lists what to add.

## What only you (or your client) can answer

| What | Example | Who usually knows |
|---|---|---|
| The main things users come to do | "Book a class", "cancel a booking", "see my bookings" | You |
| What must never happen | "A class is overbooked", "a member sees someone else's details" | You and your client |
| Expected traffic | "400 members try to book when Saturday's schedule opens at 8 am" | Your client, marketing |
| How fast pages must be | "Booking confirms within 2 seconds" | You and your client |
| How much data you could afford to lose, and how fast you must be back | "At most 5 minutes of bookings; back within an hour" | Your client, whoever runs hosting |
| Who agreed each of these, and when | "Sam (studio owner), 3 March" | You |
| The acceptance criteria | "A full class shows 'Waiting list', never 'Book'" | You, agreed with your client |
| Known problems | "Emails sometimes go to spam" | You |
| Test logins and test payments | A test card, a test member account | You or your developer |
| Is there a test copy of the site (staging)? | `staging.example.com` | You or your hosting |

## What counts as evidence

The reviewer believes what they can **check themselves**. So:
- Your screenshots and test results don't prove anything on their own, but they show the reviewer **what to check**. When the reviewer runs the same thing and gets the same result, that counts as the strongest evidence (grade A).
- Your description of the code lets the reviewer find it quickly; the reviewer then reads the code itself (grade B).
- A sentence like "it's secure" or "tests pass", from you, a document or an AI summary, never counts on its own (grade C).

Make it easy to check: commands that work on a fresh copy, test accounts, and a staging copy if you have one.

## Words you'll meet

| Word | Meaning |
|---|---|
| Review page / review pack | The page described above, and the data file it's made from. |
| Risk tier | How careful the review must be. **1** low: an internal tool or prototype, no personal data, no money. **2** standard: real users with accounts or personal data, or payments through a hosted checkout. **3** high: the app takes payments itself, holds health, financial or children's data, or launches with a big rush. The higher the tier, the more criteria are mandatory and the fewer problems are allowed at launch. |
| Criteria | The checklist the reviewer works through: 99 in all, of which only those that fit your app apply (an app without payments skips the payment ones). |
| Meets / does not meet / cannot verify / not applicable | The four possible results per criterion. *Cannot verify* means the reviewer didn't have what was needed to check it; it is not a pass, and it says what's needed. |
| Staging | A test copy of the site with test data, separate from the live one. |
| Agent instructions (`AGENTS.md`) | A file your AI coding assistant reads before changing code: how to run and test the app, and rules it must never break. If AI writes your code, you should have one; `prepare-review` can start it for you. |
| GATE PASSED | The software check found everything it needs. |

The full technical definition, for reviewers and AI assistants, is [the review standard](../.claude/skills/launch-review/standard/review-standard.md). A finished example is the [flash-sale demo's review page](../demo/flash-sale/review/).
