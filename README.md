# HaulPool

**Your stuff. Our truck. Half the price.**

Live: **https://haulpool.app.space**

College students moving out on the same day each rent a truck that leaves half empty. HaulPool matches people
moving the same day and the same way, puts them in one truck (and, if they need it, one storage unit), and
splits the cost by the space each person's stuff actually takes, to the cent.

Built on [DeepSpace](https://deep.space) (Cloudflare Workers + Durable Objects, React 19) for the DeepSpace OA.
Nerin Wang designed the product and tested it; Claude wrote the code as the coding agent.
See [VERIFY.md](VERIFY.md) for a round-by-round log of what the agent built and what I checked.

---

## What you can do

- **Plan your move in 3 steps:** date and places (around town, or city to city), then your stuff, then review.
  - Add stuff with one-tap room presets, a grouped item list, or a **photo scan**: Claude suggests items from a photo, and you tick what's right.
  - A **truck picture** fills up as you add items. Fragile things ride in their own zone and count 1.5× their size.
- **Find a truck:** trucks leaving the same day that fit your stuff and are on the way (detour limit), ranked by your share.
  - You can also see who's organizing every truck, and who else is looking.
- **Start a truck and fill it:** share an invite link, invite people who are looking, and get alerts when someone joins.
- **Pay fairly:** a prepaid wallet (test mode).
  - Your share plus an 8% service fee is held when the pool locks, and the organizer is paid after the move.
  - Leaving a locked pool costs $10, which goes to the people left.
  - If the organizer leaves, the next person takes over.
  - Pools lock themselves at the deadline, or close for free if nobody joined.
- **Talk:** profiles, private 1-to-1 chat, a group chat per truck, an in-app notification bell and email.
- **Privacy:** others see only your area until you're in the same truck. Exact address and contact are visible to your pool only.

Owner-only pages: `/admin/funnel` (event funnel with drop-off per step) and `/admin/demo` (load or remove 8 demo students and 3 trucks).

## DeepSpace pieces used

| Piece | Used for |
| --- | --- |
| **Claude** via `createDeepSpaceAI` | Photo scan → suggested item list. The AI only suggests; `src/lib/scan.ts` validates the reply and code computes all volumes and money. Limited to 5 scans per person per day. |
| **`openweathermap/geocoding`** integration | "Any US city" for city-to-city moves (city-level; street addresses return 404, so pickups use a list of places). |
| **`email/send`** integration | Invites, "a truck fits your move", joined / locked / closed / price changed. Each event emails at most once; people can turn email off. |
| **RecordRoom permissions** | `collaborator` per-record access for the members-only pool record, chats and messages; `own` for drafts, wallet and notifications; `writableFields` so you can only flip `read` on your notifications. |
| **`uniqueOn`** | A version lock on each pool's ledger (no overbooking), one active seat per person, idempotent wallet rows and notifications. |
| **Server actions** | All writes go through `src/actions/index.ts`, which is the trust boundary (membership, balance and rules checks). |
| **CronRoom** | Every 15 min, pools past their deadline lock (2+ people) or close (alone). |
| **PresenceRoom** | "N people viewing" on a pool page. |
| **`registerUser`** | Demo students with real names in the app's user list. |

## Main design decisions

1. **Overbooking is impossible, not unlikely.** Two people taking the last space at once is the core race in this product. A naive read-then-write overbooked in 95% of simulated races. Each change to a pool claims the next version number through a `uniqueOn` index, so one change wins and the other retries. That gave 0 overbookings in 20,000 simulated races and 300 random async interleavings in tests.
2. **AI advises, code decides money.** The photo scan only proposes items. Every number a person pays comes from pure functions (`split.ts`, `wallet.ts`) with tests.
3. **Money is conserved.** An end-to-end test runs a real 3-person pool through the server actions and checks that top-ups equal remaining balances plus fees, and that retrying lock, leave or complete never charges twice.
4. **Private by default.** Ranking runs on the server, so other people's addresses never reach your browser. DeepSpace's built-in messaging is public-channel only, so chats use the same per-record permissions as the pool's private record.
5. **Test-mode wallet instead of real cards.** Reviewers can click through every money rule safely. Real top-ups through DeepSpace checkout are the next step.

## Code map

```
src/config.ts            vehicles, items (sizes; fragile), all tunable numbers
src/places.ts            Pittsburgh places, storage units, 16 cities with areas
src/lib/                 pure, tested rules
  volume.ts  route.ts  match.ts  split.ts  wallet.ts  versionLock.ts  scan.ts  events.ts
src/actions/index.ts     server actions (the only way data changes)
src/actions/demo.ts      owner-only demo data, built on the real actions
src/cron.ts              deadline sweep
src/schemas/             collections + permissions
src/pages/               landing, My pool, My move, Find, pool page, Messages, Wallet, profiles, admin
src/components/haul/     TruckLoad, PhotoScan, CityPicker, ItemPicker, NotificationBell, …
```

## Run the tests

```bash
npm install          # npm 11.6+
npx vitest run       # 64 tests
```

| Suite | What it checks |
| --- | --- |
| `lib.test.ts` | Spec examples: splits, detours, matching, presets, fragile; property tests (fast-check) that splits always sum to the total |
| `versionLock.test.ts` | Version lock under 300 random interleavings; lock, leave, hand-over and cancel rules |
| `wallet.test.ts` | Fees, holds, cancellation credits, route-change extras |
| `money.test.ts` | End-to-end money through the real actions; deadline sweep; finished seats released |
| `social.test.ts` | Alerts and email once, invites, chat privacy, email opt-out, destination changes |
| `demo.test.ts` | Every demo step plus cleanup leaves nothing behind |
| `events.test.ts`, `scan.test.ts`, `schemalint.test.ts` | Funnel math and no personal data in events; AI reply validation; schema lint |

## Known limits and next steps

- Wallet top-ups are test mode. Next: DeepSpace checkout for real top-ups, then truck booking through a rental partner.
- City-to-city areas cover 16 cities; other cities match at city level.
- Weather on move day, a vehicle advisor, ±1-day matching, and .edu verification are planned.
