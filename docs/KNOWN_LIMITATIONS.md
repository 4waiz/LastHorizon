# Known limitations

Things that are deliberately unfinished, deliberately weaker than they look,
or blocked on something outside this repository. Written down so they are
limitations rather than surprises.

*A Kanban Studios game — kanbanstudios.ae. Game Developer: Awaiz Ahmed.*

---

## Content Security Policy

The policy is delivered by a `<meta http-equiv>` element in `index.html`
because the game ships as static files with no server of its own. That is a
real constraint, not a preference, and it has three consequences.

### `frame-ancestors` cannot be set from the page

The spec requires a `<meta>`-delivered policy to ignore `frame-ancestors`,
`report-uri` and `sandbox`. Browsers ignore it *and* log a warning, which is a
console message in normal play — not allowed here, and caught by
`tests/e2e/smoke.spec.ts` on the first run after the policy landed. It has
been removed from the meta tag.

**The game is therefore embeddable in a frame by anyone.** Fixing it needs one
of these on the response, from whatever serves `dist/`:

```
Content-Security-Policy: frame-ancestors 'none'
X-Frame-Options: DENY
```

Neither can be added from inside the repository. Not done, not claimed.

### `style-src 'unsafe-inline'` is still required

Several panels build markup containing `style="..."` attributes. Assigning
`element.style` from script is CSSOM and needs no permission; a style
*attribute* in parsed markup does. Removing the last of these would let the
directive go, and is worth doing.

### `script-src 'wasm-unsafe-eval'`

Needed by Rapier and recast-navigation, both of which compile WebAssembly.
This is *not* `'unsafe-eval'` — `eval` and `new Function` stay blocked, and
neither appears in `src/`.

## Flight

### The aerial streaming policy does not currently save anything

`AERIAL_POLICY` fades the chunk load radius from two rings to one between
45 m and 160 m AGL, which is what the Phase 10 brief asks for. It has no
effect on the world as it stands, for two independent reasons:

1. Every district is 4x3 chunks over 192x144 m. One ring is 48 m and the
   hysteresis is 14, so a chunk is kept to 62 m — and the furthest chunk's
   near edge is 53.7 m from the centre of a district. Nothing is ever
   released at any altitude.
2. The aeroplane lives at `hill_airstrip`, which is an authored zone and does
   not stream at all. Flying does not change the active zone, so a player in
   the air is never inside a streamed zone in the first place.

`tests/aerialStreaming.test.ts` asserts both of these rather than pretending
otherwise, and proves the policy does bite on a district four times the size.
It is a guard against a zone that outgrows the keep distance, not a
present-day optimisation.

### The boat is a model, not a vehicle

`aircraft.glb` contains `Boat`, `Boat_LOD1`, `Boat_LOD2` and `Boat_Col`. There
is no buoyancy, no dock, no wake and no way to board one. The Phase 10 brief
made the boat conditional — *"only if feasible"* — and it was not.

## Rendering

### The interior is the worst case

The window portal re-renders the outdoor world, taking triangles from ~482 k
to ~780 k. Budget against the interior, never the village. Enforced in
`tests/e2e/interiorBudget.spec.ts`.

## Licensing

### GSAP is not open source

The standard GSAP licence is free for most uses but is not an OSI
open-source licence, and its terms differ for paid products. Confirm the
current terms against the intended commercial model before release. Flagged
in `docs/ASSET_LICENSES.md`, not resolved.
