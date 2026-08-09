# Economy balance sheet

Every figure here is in `src/economy/PriceCatalog.ts` and is asserted by
`tests/economy.test.ts`. This document is the argument for the numbers; the
catalogue is the numbers.

**Currency is whole dollars.** No cents anywhere. Prices a player can add up in
their head stay understandable, and integer arithmetic cannot drift the way
repeated float addition does — a balance reading 19.999999 after twenty
transactions is a bug report, not a rounding artefact.

---

## 1. The shape of a day

The unit the whole table is balanced against is **one shift ≈ one day of
comfortable living, with something left over.**

| | Amount |
| --- | --- |
| A grocery shift | **$45** |
| Eating well that day (meal + coffee + bread) | $16 |
| A week's rent, per day | $26 |
| **Left over** | **$3** |

That is deliberately tight *at difficulty 1 with one job*. Doing the recovery
call instead ($70) or a courier run ($55) turns the same day comfortably
positive, which is what makes choosing the harder job feel like a decision
rather than a formality.

Nothing is fatal. A player who earns nothing is inconvenienced — needs drift
down, rent goes overdue — and never blocked or killed. See "Failure states"
below.

## 2. Income

| Source | Base | At difficulty 5 | Notes |
| --- | --- | --- | --- |
| Grocery shift | $45 | $81 | +20% per step. No timer |
| Parcel round | $30 | $60 | +25% per step. No timer |
| City courier | $55 | $99 | +20% per step. 4 min, −12% per step |
| Taxi shift | $12 | $26 | +30% per step. 5 min, −10% per step |
| Recovery call | $70 | $112 | +15% per step. No timer |
| Fishing | $0 | $0 | Pays in fish, not wages |

Difficulty is a function of **completions**, not attempts: every fourth
completed run moves the step up. Failing does not make a job harder, which
would be the wrong way round.

Selling a catch is the only income that is not a wage: a large fish is $14, a
small one $6, and the grocery and the cafe both take them.

## 3. Outgoings

| Item | Price | Sells back for |
| --- | --- | --- |
| Apple | $2 | $1 |
| Bread | $3 | $1 |
| Tea | $3 | $1 |
| Coffee | $4 | $1 |
| Soap | $3 | $1 |
| Hot meal | $9 | $3 |
| Shirt | $18–22 | $6–7 |
| Trousers | $24–28 | $8–9 |
| Hat | $14–16 | $5 |
| Pistol round | $2 | $1 |
| Repair kit | $45 | $18 |
| Potted plant | $34 | $12 |
| Bookshelf | $58 | $20 |
| Side table | $72 | $25 |

| Service | Price |
| --- | --- |
| Clinic treatment | $45 |
| Fine (placeholder) | $60 |
| Respray | $120 |
| Vehicle recovery | $85 |
| Repair, from wrecked | $335 (call-out $15 + up to $320) |
| Rent, per 7 days | $180 |

| Vehicle | Price |
| --- | --- |
| Bicycle | $180 |
| Scooter | $950 |
| Hatchback | $4,200 |
| Van | $6,800 |

The patrol car is **not for sale** and has no entry in `VEHICLE_PRICES`.
`priceCatalog.test.ts` asserts that; a police vehicle the player can buy is a
police vehicle they drive through Phase 9's missions.

## 4. Why sell is always below buy

`ITEM_PRICES` is checked entry by entry:

```
for (const p of ITEM_PRICES) expect(p.sell).toBeLessThan(p.buy);
```

**One inverted pair is an infinite money loop** — buy from the shop, sell back
to the same shop, repeat — and it is the classic way a game economy dies. The
test is cheap; finding it by hand after release is not.

Margins are wide on cheap goods and narrow on expensive ones, which is both how
retail actually works and what stops a player grinding a 5% spread on bread.
Clothing resells at roughly a third: worn is worn.

A second test farms the loop twenty times and asserts the player ends poorer:

```
for (let i = 0; i < 20; i++) { buy apple; sell apple; }
expect(cash).toBeLessThan(start);
```

## 5. Time to afford

At difficulty 1, doing the best-paying job available:

| Target | Shifts | Roughly |
| --- | --- | --- |
| A meal | 1 (partial) | minutes |
| A full outfit (~$60) | 1 | one shift |
| Bicycle ($180) | 3 recovery calls | an evening |
| Scooter ($950) | 14 recovery calls | several sessions |
| Hatchback ($4,200) | 60 recovery calls | a long-term goal |

The hatchback is deliberately out of reach of casual play. It is the thing you
save for, and at difficulty 5 the same 60 calls become 38 — which is the point
of difficulty scaling paying more.

## 6. Rent

$180 every 7 in-game days, charged when you sleep in the apartment.

**Rent is a function of the day, not a timer.** `Economy.rentDue(day, period)`
counts how many whole periods have elapsed since the last payment, so:

- a player who was away for three periods owes three, not one;
- a reload owes exactly what it owed before, because the answer is computed
  rather than remembered as a countdown;
- charging is all-or-nothing. Partial rent would leave a fractional period on
  the clock with no way to describe it, so an unaffordable charge is refused
  and reported as overdue.

There is no eviction, no lockout and no penalty beyond the notice. Rent exists
to give money a reason to keep moving, not to punish.

## 7. Failure states, and what is deliberately absent

| Situation | What happens |
| --- | --- |
| No cash at a counter | The offer is listed, greyed, with "Not enough cash" |
| Bag full at a counter | "Bag is full", and no money moves |
| Coffee at the counter with a full bag | **Served.** `consumeHere` never touches the bag |
| Rent unaffordable | Overdue notice. No eviction |
| Job failed or abandoned | Pays nothing. Retry available under a new key |
| Shop closed | Door names the opening time. No entry, nothing half-built |
| Vehicle cannot be delivered after payment | **Refunded**, and the refund is in the ledger |

Not in this game, and not to be added quietly: real-money purchases, ads,
crypto, loot boxes, a backend economy, or any transaction that leaves the
device. The economy is a local integer ledger and nothing else.

## 8. Rollback

`Economy.snapshot()` captures the wallet, the inventory stacks, the ledger
sequence and the set of paid award keys. `restore()` puts all four back.

The failure it guards is narrow and real: a purchase applied in memory, then a
save that throws on quota. Without the rollback the run carries goods the next
load will not have paid for. `Game.saveWithRollback` takes the snapshot before
the write and restores it if the write fails.

The award keys are part of the snapshot on purpose. Rolling back a job payment
without releasing its key would leave a completed job that can never be paid.

## 9. Idempotency

Every reward goes through `Economy.award(key, ...)`, and the key identifies the
**completion**, not the job: `job_grocery_shift#3` is the third attempt at that
shift. So:

- the same completion reported twice pays once;
- a second run of the same job pays again;
- a reload cannot re-pay a spent key, because the key set is in the save.

`taskSystem.test.ts` and `economy.test.ts` both assert this, from the task side
and the money side.
