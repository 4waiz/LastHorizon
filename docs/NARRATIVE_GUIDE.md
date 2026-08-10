# Narrative guide

*A Kanban Studios game — kanbanstudios.ae. Game Developer: Awaiz Ahmed.*

**This document is in two halves and the second half spoils the whole story.**

Part 1 is safe for anyone: the premise, the cast, the shape of a run, and how
the systems express it. Part 2 is behind a clear marker and gives away every
branch and every ending.

For the graph — dependencies, thresholds, which mission tests which mechanic —
see [QUEST_MAP.md](QUEST_MAP.md), which is structure without plot.

---

# Part 1 — Spoiler-free

## The premise

You are fifteen, in a coastal village with one road through it. The road goes
somewhere. Over about ten to fourteen hours of play — one active hour is one
in-game year — you find out where, and what it costs to follow it.

The story runs ages 15 to 25 across seven chapters. After the credits you keep
playing, with ageing on, slowed, or stopped.

## What kind of story it is

A small one, told through work and errands rather than through set pieces.
Nobody in this village makes a speech. The largest events are a job, a
bicycle, a bus, a lease, and a letter about a field.

It is **not** a crime story with a redemption arc bolted on, and it is not a
morality play. Crime is available from eighteen, it is never required, and the
game does not editorialise about it — the ending reads what you did and
describes the life that followed.

Three things are true of every route:

1. **You can finish it without ever committing a crime**, and one of the two
   automated end-to-end runs proves that on every commit.
2. **You can finish it having taken every shortcut**, and the other run proves
   that.
3. **Free Roam is never gated behind any of it.** The story chunk is not even
   downloaded in that mode.

## The cast

Eight named residents in the village, twelve in the city. All twenty were
written in Phase 6 with `questRoles` already declared, so the people were
there before the story that uses them.

**The village.** Maryam runs the grocery and has had somebody ask her for work
every year since she opened. Her daughter Noor is your age. Tomás fixes things
and has opinions about buying versus mending. Bashir farms the only flat land
between the road and the water. Eleni keeps the school register and everything
else. Hamid has watched this road for forty years. Gita sends you on errands.
Liya has the parcel round and does it faster than you will.

**The city.** Yusuf came in from the coast nineteen years ago and pretends he
did not. Priya runs the garage. Dawit has the leases and no small talk. Sana
works the cafe and hears everything. George remembers the square when it was
not a square. Amina is a police officer. Kenji works nights at the clinic.
Rosa organises. Omar knows a faster way. Hana, Marcel and Inês fill out the
rest.

## The shape of a run

| Chapter | Age | Title | About |
| --- | --- | --- | --- |
| 1 | 15 | Five Things Left Behind | The village, and the idea of leaving it |
| 2 | 16 | First Pay | Work, money, and the first thing you own |
| 3 | 17 | The Road Test | Driving, advice, and something wrong in a field |
| 4 | 18 | City Lights | Leaving, a rented room, and a job |
| 5 | 19–21 | A Name of Your Own | Standing, and how you got it |
| 6 | 22–24 | What the Road Costs | The city's success reaches back to the village |
| 7 | 25 | The Last Horizon | Where do you live now? |

## How the systems carry it

Nothing in the story is a cutscene explaining a feeling. The chapters are made
of the things the game already does.

- **Ageing gates the plot.** Chapter 4 needs eighteen because the city gate
  does. Chapter 3 needs seventeen because driving does. The story does not
  have its own age rules; it uses `src/core/Gates.ts`.
- **Money is the economy's money.** A chapter reward goes through the same
  idempotent `Economy.award` a job shift does.
- **Work is the job system.** "Work a shift" is a real `TaskSystem` run with
  real difficulty scaling, not a story-shaped imitation of one.
- **Relationships are the five axes from Phase 6**, and residents start where
  the catalogue puts them: Maryam already half-trusts you at sixteen, because
  you grew up in her shop.
- **Two reputation numbers** are added by this phase — `community` (0, earned
  upward) and `law` (starts at 1, clean). Both are read by the ending.

## What you keep

A **Life Reel**: a timeline of what you chose, what you did, who was there,
what the record says and what you kept, ending on a card answering *what did
you become by 25?*

You can save it as an image. It is drawn locally on a canvas and downloaded to
your device. **There is no upload service in this game**, and the browser test
for the reel asserts that nothing but a `GET` ever leaves the page while it is
produced.

## Accessibility and tone

- Every cutscene is skippable, always, from any shot.
- Every scene carries a text caption, so it reads with sound off.
- Dialogue choices are real `<button>` elements, so keyboard, touch and screen
  readers get them without a special path. **A gamepad does not yet drive
  them** — the pad moves the character and takes interactions, but nothing
  navigates the DOM with it. Phase 11 owns that.
- A locked choice is shown, disabled, with the reason **in words** — "You do
  not know them well enough for that", never "requires trust 0.3".
- Violence is optional, stylised and non-graphic. No child is ever a target or
  a participant; `validateNpcCatalogue` has enforced that since Phase 6.

---
---

# Part 2 — Spoilers

> **Everything below gives away the whole story, every branch and every
> ending.** Stop here if you have not played it.

<br><br><br>

## Chapter 1 — Five Things Left Behind (15)

Eleni has a box your mother left with her. Five things were in it; two are
left. A paper plane, a toy boat, a wind chime, a camera that has never worked,
and a star off a tree from before you were born. You find the other three
around the village, put the box back together on the shore bench, and the
camera pans off north up the road.

Then an errand: bread from Maryam to Gita, and a ride out to the bend, far
enough to see the road keeps going.

**The point:** establish that the village is small and known, and that leaving
is a thing that occurs to you rather than a thing forced on you.

## Chapter 2 — First Pay (16)

Maryam hires you. A grocery shift, forty-five dollars, and the money is not
real until you have spent some of it. Then Liya's parcel round, which she does
in forty minutes and everyone else does in ninety — beating her time changes
how she treats you.

Then the fork that sticks: **buy** the new bicycle, or **fix** the dead one
behind Tomás's shed.

- **Buy** costs money and you ride today.
- **Fix** costs an afternoon and a favour, and gives Tomás trust and respect
  that make chapter 3's mentor route cheaper.

Both end with a bicycle, because a chapter that can leave you without one
breaks chapter 3.

## Chapter 3 — The Road Test (17)

Tomás teaches you in a van older than you are. Two rules: stop properly at the
junction, and put it back where you found it. Both are objectives; the junction
one is optional.

Then the **mentor fork**. Three people think they know what you should do:

- **Tomás — the trade.** Four years and you can fix anything on this coast.
- **Eleni — school.** Two more years of books; it buys doors and costs the two
  years.
- **Liya — the road.** Go now, learn it fast, and some of what you learn you
  would rather not have.

Nothing is closed off by it. It shifts which side tasks are offered and which
chapter 6 route is cheapest.

Then the thing the whole story is built toward: **somebody has been surveying
Bashir's field.** City plates, a tripod, three days, and nobody knocked. It is
the only flat ground between the road and the water. Hamid confirms what that
means. You find a survey peg. That is all chapter 3 does with it — the offer
does not exist yet, which is what makes chapter 6 land rather than arrive.

## Chapter 4 — City Lights (18)

Eighteen. The bus is at six. You say the goodbyes you mean to say — Eleni is
required, Noor and Hamid are optional, and you will think about that. You
sleep one more night at home. This is the quest that completes
`village_departure`, the chapter id the city gate has been checking since
Phase 3.

In the Old Market: Dawit's lease, one room, third floor, window faces the
wrong way, a hundred and eighty every seven days. Yusuf hires you. A courier
run with the clock going. Then the police desk, because everyone working the
district is on a list somewhere.

## Chapter 5 — A Name of Your Own (19–21)

Omar has noticed you are working very hard for very little. He offers two
drops, no questions, an hour at the dock, four times the depot rate — and he
says out loud that if it goes wrong it goes on your record and not his. That
is deliberate: a branch whose cost is hidden is not a choice, and the ending
that reads `law` two chapters later would be a surprise you never agreed to.

- **Straight:** two recovery calls and a scooter you saved for.
  `community +0.18`.
- **Shortcut:** $220 and `law −0.30`. Failing it drops you back to the
  checkpoint with "somebody was watching the dock".

Both arrive at the same place — people know the name now. Then evenings start
mattering: **Sana**, **Hana**, **Noor**, or **nobody**. Sana and Hana need
familiarity you have to have built; Noor needs affection, and the line for her
is "It was always going to be Noor."

## Chapter 6 — What the Road Costs (22–24)

A letter on your desk, with your name on it, about somebody else's field. They
knew you would know who to ask. You go back to the village and tell Bashir,
who has not heard yet.

He says the offer is a good one, and that is what makes it hard — if it were a
bad one he would have thrown it in the stove.

**Five routes. Four are legal.**

| Route | What you do | Costs / gains |
| --- | --- | --- |
| **Protect** | Signatures at the hall, and your own money in the fund | community +0.30, Bashir trust +0.40 |
| **Law** | Amina, an objection filed twice, and a wait for the ruling | law +0.20, community +0.15 |
| **Expose** | Three documents, George on the record, and print it | community +0.25, law +0.10 |
| **Exploit** | Broker it through Dawit and take the commission | **$900**, community −0.35, Bashir trust −0.50 |
| **Crime** | Pull the survey pegs at night and get clear | law −0.45, community +0.10 |

The crime route is trespass and theft, not violence — there is no combat
objective anywhere in the main story, and the validator fails the build if one
appears. It is the only route that can fail into being seen, and it is never
the cheapest.

Whatever you did, you go back and tell Bashir yourself.

## Chapter 7 — The Last Horizon (25)

Eleni has written you eleven letters and you have answered nine, which is
better than most. She asks where you live now. You go up the hill, where you
can see both, and that is the problem.

Three answers: **come home**, **stay**, or **keep both**.

## The endings

The answer picks the family. Everything you never announced picks the variant.

### Return and Build — you went home

| Variant | When |
| --- | --- |
| **The Field** | You protected it, trusted, clean record |
| **On the Record** | You exposed it, and the village trusts you |
| **The Long Way Back** | Your record is marked |
| **Owed** | The village does not want you |
| **Quiet** | Everything else |

### Stay and Rise — you stayed

| Variant | When |
| --- | --- |
| **Watched** | Your record is marked — ranked first, because in this family the money and the record are the same story |
| **The Office** | Rich and resented |
| **Built Properly** | Trusted, clean, and comfortable |
| **Your Own Hours** | You chose nobody in chapter 5 |
| **Still Going** | Everything else |

### Live Between Both — you kept both

| Variant | When |
| --- | --- |
| **The Bridge** | Trusted and clean |
| **The Route** | Comfortable and clean; you run the road for a living |
| **Restless** | Everything else — "you tell people you have not decided, and ten years on it has started to sound like a decision" |

## The one thing worth knowing about the tuning

The legal spine alone earns roughly `community 0.18` by chapter 3, which is
above the `RESENTED` threshold of 0.15. So a player who does the main story
honestly and no side tasks at all does **not** get the "Owed" ending. You have
to have actively spent that standing — by exploiting the field — to land there.

That was checked rather than hoped: the numbers are in `src/story/Endings.ts`
and the walk is in `tests/storyContent.test.ts`.
