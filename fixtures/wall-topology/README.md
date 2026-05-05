# Wall topology fixtures

JSON projects for manual or scripted checks of **auto-rooms** (closed wall cycles). **T-junctions** are handled only inside face detection (virtual graph subdivisions); plan `wallSegments` stay one row per physical wall unless the user draws them that way.

## Generate

From the repo root:

```bash
npx tsx scripts/gen-wall-fixtures.ts
```

## Validate (same pipeline as app load)

```bash
npx tsx scripts/validate-wall-fixtures.ts
```

This runs `normalizeProject` → `reconcileAllFloorsWallTopology` (face detection with virtual T-vertices + wall sheets) → `syncAllPlanWallSheetLabels`, then asserts expected auto-room counts.

## Open in the app

Use **File → Open** (or your usual import path) and pick a file under `fixtures/wall-topology/`.

| File | Intent |
|------|--------|
| `simple-square.json` | Single 4×3 m rectangle → **1** auto-room. |
| `corner-pocket-unsplit.json` | Bottom-right closet: interior **T** on long bottom/right edges. Virtual split during face walk → **2** auto-rooms (pocket + main) without mutating segment ids. |
| `corner-pocket-presplit.json` | Same geometry with right wall already split at the horizontal interior — **2** auto-rooms (one extra segment in the file). |
| `two-rooms-shared-partition.json` | Two rectangles sharing one interior wall — **2** auto-rooms, shared segment has two wall faces / sheets. |

## Notes

- Fixtures use `createInitialProject()`-shaped data; `normalizeProject` fills defaults.
- After load, wall labels look like `L0_n_<room-slug>` and doors/windows on a shared physical wall stay in sync across both faces.
