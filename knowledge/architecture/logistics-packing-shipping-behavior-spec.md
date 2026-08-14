---
status: active
read-when: Building Phase 3 (Document generation) or Phase 4 (Assembly workspace) of INIT-0026's Logistics rebuild — the exact modal/rule/function-level behavior to replicate from LogisticsCoordinator (LC).
related: [../../Initiatives-Open.md, connectwise-api-integration.md]
updated: 2026-08-14
---

# Logistics rebuild — Packing (Assembly) & Shipping (Documents) behavior spec

Per-interaction behavior specification for LC's Assembly workspace (drag-and-drop
pallet/box packing) and Document generation (Commercial Invoice / Packing List),
read directly from LC's actual source — not the earlier high-level feature
catalog — per direct instruction: "Understand what ALL the code does and why so
it can be replicated and validated exactly." This is the spec `INIT-0026`'s
Phase 3 (Document generation) and Phase 4 (Assembly workspace) get built
against, and the reference for the Playwright parity tests to validate against.

Source read in full: `AssemblyWorkspace.jsx` (2022 lines), `ProductPool.jsx`,
`PalletBlock.jsx`, `BoxBlock.jsx`, `ContainerItem.jsx`, `PackQtyModal.jsx`,
`SplitModal.jsx`, `SerialPickerModal.jsx`, `PackTargetModal.jsx`,
`ConfirmModal.jsx`, `ui/Modal.jsx`, `ShipmentPage.jsx`, `ShipmentDetails.jsx`,
`DocumentPanel.jsx`, `CommercialInvoice.jsx` (1156 lines), `PackingList.jsx`
(896 lines), `PrintCIPage.jsx`, `PrintPLPage.jsx`, `api/client.js`, backend
`documents.py`, `containers.py`, `shipments.py`, `pdf_service.py`, `cw.py`,
relevant slices of `cw_client.py`, `schemas.py`, `database.py`.

`PickingRequiredModal`, `PalletDropModal`, `EmptySpaceDropModal` are **not
separate files** — they are function components defined inline at the bottom
of `AssemblyWorkspace.jsx` (lines 1812–1956). `useDockColumns.jsx` is only
used by `components/receiving/`, not by assembly.

---

## 0. Data model (containers/items) — ground truth

```sql
containers(id, shipment_id, type CHECK(box|pallet), number, parent_pallet_id REFERENCES containers(id) ON DELETE CASCADE, weight, notes, sort_order)
container_items(id, container_id REFERENCES containers(id) ON DELETE CASCADE, cw_product_id, cw_ticket_id, cw_ticket_type,
  quantity REAL, item_weight, price_source CHECK(max_sold|avg_sold|catalog_price|catalog_msrp|manual) DEFAULT 'max_sold',
  manual_price, description_override, serial_numbers (JSON string array), sort_order,
  description, part_number, catalog_item_id, unit_price, msrp, unit_of_measure, source_ticket_id,
  hs_code_override, country_of_origin_override, manufacturer)
documents(id, shipment_id, doc_type CHECK(packing_list|commercial_invoice), pdf_filename, generated_at, cw_document_id, posted_at)
```

`parent_pallet_id` has `ON DELETE CASCADE` — deleting a pallet row in the DB
automatically deletes its boxes at the DB layer (the frontend also does this
explicitly item-by-item before issuing the DELETE, which is partly redundant
but necessary because it needs to know what to snapshot for undo).

---

## 1. Every Assembly modal

### 1.1 `PackQtyModal` (`assembly/PackQtyModal.jsx`)
- **Trigger**: Space-held ("partial pack modifier") drop of a pool item onto a
  box/pallet-item-zone, or an empty-space drop, when `remaining > 1`. Set via
  `setPendingDrop({ product, targetContainerId, remaining[, dropType] })` in
  `handleDragEnd`/`handleDragMove` paths.
- **Fields**: single numeric `<input type=number min=1 max=remaining>` seeded
  to `String(remaining)`.
- **Validation**: `parsed = parseInt(raw,10)`; valid iff
  `1 <= parsed <= remaining`; typed input restricted to digits via regex
  `/^\d+$/` in `handleChange`.
- **Buttons**:
  - `Pack {n}` — disabled unless valid; calls `onConfirm(parsed)`.
  - `Pack All {remaining}` — always enabled; calls `onConfirm(remaining)`.
  - `Cancel` — `onClose()`.
  - Enter key in the input also commits if valid.
- **On confirm** → `handlePackConfirm(qty)` in the parent:
  - if `pendingDrop.dropType === 'empty-space'` → re-opens
    `EmptySpaceDropModal` with the chosen qty (i.e. Space-drop-to-canvas asks
    qty first, then still asks "one box for all / each").
  - if `dropType === 'new-pallet-box'` → creates a **new box on the target
    pallet**, then either opens `SerialPickerModal` (serialized) or calls
    `packOrMerge` (non-serialized) with the chosen qty.
  - otherwise (plain box/pallet-item-zone target) → serialized →
    `SerialPickerModal`; else `packOrMerge`.
- **On cancel**: `setPendingDrop(null)`, no API calls, nothing undone
  (nothing was ever created).

### 1.2 `EmptySpaceDropModal` (inline in `AssemblyWorkspace.jsx`, ~L1812)
- **Trigger**: pool item dropped in the Packing Floor canvas but not over any
  container (`!over && dragData.type==='pool-item'`), and not using the Space
  modifier (or after the modifier's qty was chosen). Also reached from the
  Space-modifier path via `PackQtyModal`.
- **Fields**: none — pure choice buttons.
- **Buttons**:
  - `One box for ALL` (only shown if `qty > 1`) → `handleEmptySpaceDropAll()`.
  - `One box for EACH` (label becomes `Create Box` if `qty === 1`) →
    `handleEmptySpaceDropConfirm()`; `autoFocus`.
  - `Cancel` (footer) → `onClose`.
- **On "EACH"** (`handleEmptySpaceDropConfirm`):
  - Serialized product → `assertAllPicked` gate, then `SerialPickerModal`
    with `targetContainerId: null` (→ one box **per selected serial**).
  - Non-serialized → loop `qty` times creating one new standalone box
    (`number = nextBoxNumber()+i`) each with a single item of `quantity:1`.
    **Has full undo+redo** (`pushUndo` with both fns; redo recomputes a fresh
    `startNum` in case the numbering context changed since undo).
- **On "ALL"** (`handleEmptySpaceDropAll`):
  - Serialized → creates **one** box first, then opens `SerialPickerModal`
    targeting that box (all picked serials land in the single box).
  - Non-serialized → creates one box, one item with `quantity: qty`.
  - **⚠ No `pushUndo` call at all in this function** — this branch is
    silently non-undoable, asymmetric with the "EACH" branch above which
    does support undo/redo. (See §9.)

### 1.3 `PalletDropModal` (inline in `AssemblyWorkspace.jsx`, ~L1844)
- **Trigger**: pool item dropped directly on a `pallet-target`-type droppable
  (the whole pallet card, `containerType==='pallet'`) without the Space
  modifier.
- **Fields**: none.
- **Buttons**:
  - `Unboxed on pallet` → `onConfirm('unboxed')`.
  - `One box for ALL` → `onConfirm('all')`.
  - `One box for EACH` (only if `remaining > 1`) → `onConfirm('each')`.
  - `Cancel` → `onClose`.
- **On confirm** → `handlePalletDrop(mode)`:
  - `'unboxed'`: serialized → serial picker targeting the **pallet id
    itself** (item placed directly on pallet, no box); non-serialized →
    `packOrMerge` directly into the pallet container.
  - `'all'`: creates one new box on the pallet (`nextBoxNumberInPallet`),
    then serial picker or `packOrMerge` into that box.
  - `'each'`: loops creating one box + one 1-qty item per unit on the
    pallet. **⚠ No `pushUndo` call** — this is the second undo-less path in
    the app (see §9). It also does **not** branch for serialized products at
    all — serialized items dropped this way are packed with no
    serial-picker step, silently omitting serial capture (worth flagging).

### 1.4 `PickingRequiredModal` (inline, ~L1880)
- **Trigger**: `assertAllPicked(product, targetContainerId, qty)` returns
  false whenever a **serialized** product's
  `_serial_numbers.length < quantity` (i.e., not all units picked in CW
  yet). This gate runs before every path that would otherwise open
  `SerialPickerModal`.
- **Message**: `"{None of the|Only N of M} \"{desc}\" unit(s) have been
  picked in CW. Please pick all products first."`
- **Fields**: a single checkbox "Show picked inventory for all clients" —
  only rendered if `product.catalogItem?.id` exists (`hasCatalogItem`).
  - Checking it triggers `cwApi.getCatalogPickedSerials(catalogItem.id)`
    (lazy, only fetched once — cached in `allSerials` state) and shows a
    count message: `"{n} of this item available in inventory picked for
    other clients..."` or `"No available picked inventory found..."`.
- **Buttons**:
  - `View All Picked Inventory` (only if checkbox checked and
    `availableCount>0`) → `onProceed(allSerials)`, which re-opens
    `SerialPickerModal` with `preloadedAllSerials` pre-populated (skips its
    own fetch) and `showAll` pre-checked.
  - `OK`/`Cancel` (label depends on whether the "View" button is showing) →
    `onClose()`, aborting the whole pack attempt.
- **On close without proceeding**: nothing happens; the original drag/pack
  action is fully abandoned (no container/item was ever created for this
  path since the gate runs *before* creation).

### 1.5 `SerialPickerModal` (`assembly/SerialPickerModal.jsx`)
- **Trigger**: any pack path for a serialized product, after
  `assertAllPicked` passes (or after `PickingRequiredModal`'s "View All"
  override).
- **Props of note**: `assignedSerials` (Set of serials this product already
  has claimed **for this specific product** across all containers, from
  `assignedSerialsByProduct` memo), `allPackedSerials` (Set across **the
  whole shipment, all products** — `allShipmentPackedSerials` memo),
  `preloadedAllSerials`.
- **List logic**:
  - Default (own list): `ownSet = new Set(product._serial_numbers)`
    filtered to remove any serial already in `assignedSerials`.
  - "Show all" toggle: fetches (or reuses `preloadedAllSerials`)
    `{serial, company, source}[]` via
    `cwApi.getCatalogPickedSerials(catalogItem.id)`; filtered by
    `packedFilter = allPackedSerials ?? assignedSerials` (i.e., in normal
    flow, filtered against **every serial packed anywhere in the
    shipment**, not just this product — prevents double-assigning a serial
    that's already packed under a *different* product line by mistake). In
    split mode (see below) `allPackedSerials` is forced `null` so it falls
    back to per-product `assignedSerials` (which is itself an empty Set —
    see next bullet).
  - Split mode (`splitSourceItem` present): `assignedSerials` is forced to
    `new Set()` by the caller — because the serials being split are already
    "assigned" to the source item and must remain selectable.
- **Selection rule**: `toggleSerial` only allows adding while
  `selected.size < qty`; "Check All"/"Uncheck All" toggles between empty and
  `effectiveSerials.slice(0, qty)`.
- **Buttons**: `Cancel` → `onClose`; `Assign N Serials` (or `Select N` if
  not fully selected) — **disabled unless `selected.size === qty` exactly**
  (`canConfirm`).
- **On confirm** → `onConfirm([...selected])` → `handleSerialPickConfirm`:
  - **Split mode**: removes the selected serials from `splitSourceItem`
    (PATCH `quantity -= splitQty`, `serial_numbers` = remaining JSON), then
    `addItem` a new item on the target with the selected serials.
    Undo-only (no redo).
  - **`targetContainerId === null`** (empty-space per-serial mode): creates
    **one standalone box per serial** (`nextBoxNumber()+i`), each a 1-qty
    item with `serial_numbers: JSON.stringify([serials[i]])`. Undo+redo.
  - Otherwise: `packOrMerge({product, targetContainerId, qty: serials.length, serials})`
    — merges into an existing item for that product in that container
    (appending serials) or creates a new item.

### 1.6 `PackTargetModal` (`assembly/PackTargetModal.jsx`)
- **Trigger**: right-click a pool-row product → "Pack this Item…"
  (`handlePoolPack`), or the batch "Pack N items…" button from a
  multi-select in `ProductPool`. This is the **only** modal that lets you
  pick an *arbitrary existing container* AND choose ALL/EACH in one screen
  (as opposed to drag-and-drop's separate modals per drop-target-type).
- **Fields**:
  - Radio group of target options: `no-container` ("Ship solely in
    manufacturer's packaging" = always one-box-per-unit, forces
    `mode='each'` downstream regardless of the mode state — see
    `effectiveMode` in the handler), `new-box`, `new-pallet-box`, then
    per-existing-pallet: its boxes + a "New box" row, then standalone boxes.
  - `new-box` and `new-pallet-box` and each pallet's implicit "new box" row
    render **ALL/EACH toggle buttons** that appear on hover/selection
    (`buttonRow` helper) — clicking them sets both `selected` and `mode`
    simultaneously via `selectWithMode`.
  - Qty stepper (only when `remaining>0`): `<input type=number min=1
    max=remaining>`, clamped in `onChange`.
- **Buttons**: `Cancel`, `Pack` →
  `onConfirm({ target: selected, mode, qty: clamp(qty,1,remaining) })`.
- **On confirm** → `handlePackTargetConfirm`:
  - `effectiveMode = targetSpec==='no-container' ? 'each' : mode`.
  - **`each` + new-container spec** (`isNewBoxSpec`): batch mode loops one
    box per **line item** (not per unit!) when `batchProducts` is set
    (i.e. multi-select batch pack creates one box per selected product
    line, not one box per unit — a distinct semantic from drag-and-drop's
    "each" which is per-unit); single-item mode loops one box per **unit**.
    Both branches: undo-only (no redo), single `pushUndo` call wrapping the
    whole created-boxes+items batch.
  - **`all` (default)**: resolves/creates the single target container
    first (new box / new pallet+box / new box in existing pallet / an
    existing container id), then either batch-packs each product line into
    it (merge-or-create per line, one combined `pushUndo` with full
    snapshot-based undo+redo) or single-item packs with `packQty =
    modalQty` clamped to `maxRemaining`.
- **On cancel**: `onClose`, no side effects.

### 1.7 `SplitModal` (`assembly/SplitModal.jsx`)
- **Trigger**: context-menu "Split Quantity…" on a packed `ContainerItem`.
- **2-step wizard** (internal `step` state, not two modals):
  - Step 1: qty-to-split-off numeric input, `1 <= qty <= item.quantity-1`
    (Next disabled otherwise). Hint text shows resulting split:
    `"{item.quantity-qty} will remain; {qty} will move..."`.
  - Step 2: radio destination list — same shape as `PackTargetModal`'s
    target list minus the `no-container` option and minus ALL/EACH toggles
    (split is always "move this exact qty as one unit" into one
    destination) — `new-box`, `new-pallet-box`, existing pallet boxes +
    "(New box)" per pallet, standalone boxes. `containers` prop passed in
    already excludes the *source* container (`containers.filter(c =>
    c.id !== splitModal.container.id)` in the parent) so you can't "split
    into the same container."
- **Buttons**: step1 `Cancel`/`Next` (disabled if qty invalid); step2
  `Back`/`Split`.
- **On confirm** → `handleSplitConfirm(item, qty, targetSpec)`:
  resolves/creates target container, then:
  - If the source item has serials → opens `SerialPickerModal` in **split
    mode** (`splitSourceItem: item`) to let the user choose *which* serials
    move.
  - Else → PATCH source item `quantity -= qty`, then `addItem` a new item
    with `quantity: qty` on the target. Full undo+redo.

### 1.8 `ConfirmModal` (`assembly/ConfirmModal.jsx`) — generic yes/no
- Used for: "Clear All" (clearAssembly), pallet/box deletion
  (`requestConfirm` passed down into `BoxBlock`), and (in Documents) the CI
  "Reset overrides" confirmation.
- Single message + `Cancel`/`{confirmLabel}` (danger-styled) button.
  `onConfirm()` then `onClose()` are both invoked on confirm click (in that
  order).

### 1.9 `PalletDeleteModal` (inline in `PalletBlock.jsx`)
- **Trigger**: clicking the trash icon in a pallet header.
- Not a shared `Modal.jsx`-close-on-Escape flow difference — it *is* built
  on `Modal`. Shows counts: `"Pallet N contains X boxes and Y items placed
  directly on the pallet."`
- **Buttons**:
  - `Cancel`.
  - `Retain Boxes as Standalone` (only rendered if `boxCount>0`) →
    `handleDetachBoxes`: deletes pallet-direct items (no undo for those
    specific item deletions — they're gone for good except as part of the
    composite pallet-delete undo below), detaches each box
    (`parent_pallet_id: null`), deletes the pallet row, renumbers remaining
    pallets. Composite undo (one `pushUndo`, undo-only) recreates the
    pallet, reattaches the boxes, and re-adds the direct items.
  - `Delete Pallet [+ All Boxes]` → `handleDeleteAll`: deletes pallet +
    every child box row + their items (relies on cascade at DB layer for
    items, but the frontend also explicitly issues
    `mutations.removeContainer` per box for local state), renumbers
    remaining pallets. Composite undo-only `pushUndo` fully reconstructs
    pallet → boxes → items from a deep snapshot taken before deletion.

---

## 2. Drag-and-drop system

### 2.1 Collision detector precedence (`buildCollisionDetector`, top of `AssemblyWorkspace.jsx`)
```js
function buildCollisionDetector(args) {
  const dragType = args.active?.data?.current?.type
  if (dragType === 'pallet-box') {
    const candidates = args.droppableContainers.filter(c => c.data.current?.type === 'pallet-target')
    return candidates.length ? pointerWithin({ ...args, droppableContainers: candidates }) : []
  }
  const containers = args.droppableContainers.filter(c => c.data.current?.type === 'container')
  const boxHits = pointerWithin({ ...args, droppableContainers: containers.filter(c => c.data.current?.containerType === 'box') })
  if (boxHits.length) return boxHits
  const palletCandidates = containers.filter(c => c.data.current?.containerType === 'pallet')
  return palletCandidates.length ? pointerWithin({ ...args, droppableContainers: palletCandidates }) : []
}
```
- **Dragging a box between pallets** (`dragType === 'pallet-box'`): only
  considers `pallet-target`-typed droppables (the whole pallet card
  outline, id `pallet-target-{palletId}`), using `pointerWithin`. Nothing
  else can catch a box drag — you cannot drop a box "into" another box or
  onto a specific item.
- **Dragging a pool item** (product row): candidates are all
  `type==='container'` droppables. **Boxes always win over pallets** when
  the pointer is physically over a box that lives inside a pallet —
  `boxHits` is checked first and returned immediately if non-empty; the
  pallet's own droppable (which visually spans the whole card, underneath
  its child boxes) is only considered if there is no box hit. This is
  precisely why dropping onto a box nested in a pallet packs into the box,
  not "unboxed on the pallet."
- Both box-droppable (`containerType:'box'`, id = the box's own container
  id) and pallet-body droppable (`containerType:'pallet'`, id = pallet id,
  registered on the pallet's `pallet-direct-zone`/body) use `pointerWithin`
  (pointer position, not full-rect overlap) — a pool item must have its
  pointer literally inside the box/pallet outline.
- **No `over` at all** (pointer outside every droppable but still inside
  the canvas) → treated as an **empty-space drop** (see 2.3).

### 2.2 `handleDragEnd` precedence walk
1. Compute `isInPackingPane` (pointer bounding-box test against
   `packingPaneRef`) **before** any early return, so `DragOverlay`'s
   `dropAnimation` (`null` = snap instantly, `undefined` = animate back to
   source) is set correctly in the same batch dnd-kit clears drag state.
2. Snapshot `snapMod = altRef.current` (the Space-modifier flag) then
   immediately reset it — done *before* branching so a stuck modifier can't
   leak into the next drag (comment explains: an autofocused modal input
   can swallow the Space keyup).
3. **`dragData.type === 'pallet-box'`**: if not dropped in the packing pane
   → no-op (box snaps back). Else: compute `targetPalletId` from
   `over.data.current.palletId` (or `null` = became standalone). No-op if
   same as `origParentPalletId`. New number =
   `max(existing boxes in target scope)+1`. All boxes in the **source**
   scope with a higher original number get decremented by 1 (a direct
   shift, not the shared `computeRenumberOps`). Undo-only.
4. **`!over && dragData.type==='pool-item'`**: if not in packing pane →
   no-op. `remaining = product.quantity - alreadyPlacedQty`; if `<=0` →
   silently returns (no toast). If Space held and `remaining>1` →
   `PackQtyModal` first. Else → `EmptySpaceDropModal`.
5. **`!over` and not a pool-item** (or anything else falling through):
   plain `return` — no-op.
6. **`over` present, `targetContainerId` resolved** from
   `overData.containerId ?? (overData.type==='pallet-box-target' ?
   overData.palletId : null)`:
   - **`dragData.type === 'pool-item'`**: re-checks `isInPackingPane`
     (defensive, dnd-kit can report a stale `over` even if the pointer
     moved outside). `remaining<=0` → toast error "already fully packed",
     abort. If target is a pallet (`containerType==='pallet'`):
     Space+remaining>1 → skip `PalletDropModal`, go straight to
     `PackQtyModal` with `dropType:'new-pallet-box'`; else →
     `PalletDropModal`. If target is a box: Space+remaining>1 →
     `PackQtyModal`; serialized → `assertAllPicked` gate then
     `SerialPickerModal`; else → `packOrMerge` directly (no modal at all —
     plain non-serialized drop into a box is a single silent operation).
   - **`dragData.type === 'container-item'`** and `containerId !==
     targetContainerId`: a re-pack move via `PATCH` on the same item id (no
     delete+recreate) — `updateItem(id, {container_id: targetContainerId})`.
     Undo+redo.

### 2.3 Space "partial-pack" modifier — exact mechanism
```js
useEffect(() => {
  const onKey = (e) => {
    if (tag is INPUT/TEXTAREA/contentEditable) return
    if (e.key === ' ') {
      if (document.body.classList.contains('is-dragging')) e.preventDefault()
      altRef.current = e.type === 'keydown'
      setModActive(e.type === 'keydown')
    }
  }
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey)
}, [])
```
- Tracked via a **ref** (`altRef`) for synchronous read inside
  `handleDragEnd` (state would lag one render), mirrored into `modActive`
  state purely for the `DragOverlay` visual (amber border + "Packing
  partial" vs "Packing all" pill).
- `document.body.classList.add('is-dragging')` is toggled by
  `lockScroll()/unlockScroll()` on `onDragStart`/`onDragEnd`/`onDragCancel`
  — `preventDefault()` on the spacebar is **only** applied while a drag is
  active, so Space still works normally (buttons, checkboxes) when idle.
- Consumed exactly once per drop via `const snapMod = altRef.current`
  immediately followed by resetting `altRef.current = false;
  setModActive(false)` — this reset happens **before** any of the
  branching logic, specifically to prevent the flag bleeding into the
  *next* drag if a modal steals focus and eats the keyup.
- Effect: wherever `snapMod && remaining > 1` is true, the code detours to
  `PackQtyModal` (or, for pallet-target drops, straight to it bypassing
  `PalletDropModal`) to ask the user for an exact partial quantity before
  proceeding to the normal target-resolution / serial-picker logic. If
  `remaining === 1`, the modifier has no effect (nothing to partially
  pack).

### 2.4 Drag preview (`DragOverlay`)
- Positioned via a custom modifier `snapTopCenterToCursor` that pins the
  overlay's top-center 8px below the cursor using the *actual rendered*
  overlay size (`overlayNodeRect`), not the dragged row's size —
  explicitly to avoid a "wide table row" offset bug.
- For `pallet-box` drags: renders a mini box-card labeled with
  `dragging.label` ("Moving…").
- For `pool-item`/`container-item` drags: renders description text +
  (pool-item only) a bottom pill reading "Packing partial" (amber, when
  `modActive`) or "Packing all" (blue).

---

## 3. Undo/redo system

### 3.1 Stack entry shape
```js
{ label: string, undo: async () => void | Promise<undoFn|void>, redo: async () => Promise<undoFn> | null }
```
- `pushUndo(label, undoFn, redoFn = null)` prepends
  `{label, undo: undoFn, redo: redoFn}` to `undoStackRef.current`, slices
  to `MAX_UNDO = 20`, mirrors into React state for render, and **clears the
  redo stack** (any new action invalidates future-redo history — standard
  behavior).
- **ID replay across cycles**: because every undo/redo performs real API
  calls that mint *new* database IDs, each closure captures a small
  **mutable capture object** (commonly named `s`) that both the undo and
  redo closures close over, e.g. `const s = { itemId: newItem.id }; const
  undoPack = async () => { ...delete s.itemId... }; const redoPack = async
  () => { const i = await addItem(...); s.itemId = i.id; return undoPack
  }`. `redo()` always **returns a fresh `undo` function** (or in a couple
  of cases `undoPack` itself, since it closes over the same live `s`), and
  `handleRedo` replaces the stack entry's `undo` with whatever `redo()`
  returned (`newUndoFn ?? top.undo`) — this is how the stack stays correct
  across arbitrarily many undo→redo→undo cycles even though every cycle
  deletes and recreates rows with new IDs.
- Some undo closures defensively re-resolve the live item id if the
  captured id doesn't exist in current state (`handleRemoveItem`'s
  `redoRemove`, `packOrMerge`'s `undoPack`) — they search
  `containersRef.current` for an item matching the same `cw_product_id` in
  the same container as a fallback, because the "restore" step (via
  `addItem`) doesn't necessarily reuse the deleted id.

### 3.2 `MAX_UNDO = 20`
Eviction: `[entry, ...stack].slice(0, MAX_UNDO)` — oldest entries silently
fall off the end (no warning to the user).

### 3.3 Failure handling
`handleUndo`/`handleRedo` catch: on error, **both stacks are wiped
entirely** (`undoStackRef.current=[]`, `redoStackRef.current=[]`) and
`mutations.refresh()` (a full container re-fetch) is triggered — the app
gives up on maintaining consistent history after any failed undo/redo step
rather than trying to partially recover.

### 3.4 Keyboard shortcuts
`Ctrl/Cmd+Z` = undo, `Ctrl/Cmd+Y` or `Ctrl/Cmd+Shift+Z` = redo — ignored
while focus is in an `INPUT`/`TEXTAREA`/`contentEditable`.

### 3.5 Coverage matrix (what has undo, what has undo+redo, what has **neither**)

| Action | Undo | Redo |
|---|---|---|
| Add Box / Add Pallet | ✅ | ✅ |
| Move item between containers (drag) | ✅ | ✅ |
| Move box between pallets/standalone (drag) | ✅ | ❌ |
| Empty-space drop → EACH (per-unit boxes) | ✅ | ✅ |
| **Empty-space drop → ALL (one box)** | ❌ | ❌ (no `pushUndo` at all) |
| Pallet drop → unboxed / one-box-ALL | ✅ (via packOrMerge) | ✅ |
| **Pallet drop → one-box-EACH** | ❌ | ❌ (no `pushUndo` at all) |
| Serial pick → per-serial boxes (empty space) | ✅ | ✅ |
| Serial pick → normal container (merge/create) | ✅ | ✅ |
| Serial pick → split mode | ✅ | ❌ |
| Split (non-serial) | ✅ | ✅ |
| `packOrMerge` (merge into existing item / new item) | ✅ | ✅ |
| Remove item from container (context menu & ContainerItem's own ✕) | ✅ | ✅ |
| Remove Unused containers | ✅ | ❌ |
| Batch unpack (from pool selection) | ✅ | ❌ |
| Unpack all of one product (pool context menu) | ✅ | ❌ |
| PackTargetModal → "each" mode (single or batch) | ✅ | ❌ |
| PackTargetModal → "all" mode (single or batch) | ✅ | ✅ |
| Add box to pallet (pallet header +) | ✅ | ✅ |
| Delete box | ✅ | ❌ |
| Delete pallet (either delete-all or detach-boxes) | ✅ | ❌ |
| Clear All (`clearAssembly`) | **irreversible** — calls `clearUndoStack()`, no entry pushed | — |

---

## 4. Container/box numbering — renumber algorithm

Shared helper (used only by "Remove Unused"):
```js
function computeRenumberOps(containers) {
  const ops = []
  const seq = (list) => list.sort((a,b)=>a.number-b.number)
    .forEach((c,i) => { const n=i+1; if (c.number!==n) ops.push({id:c.id, oldNum:c.number, newNum:n}) })
  seq(containers.filter(c=>c.type==='pallet'))
  seq(containers.filter(c=>c.type==='box' && !c.parent_pallet_id))
  const palletIds = [...new Set(containers.filter(c=>c.type==='box'&&c.parent_pallet_id).map(c=>c.parent_pallet_id))]
  palletIds.forEach(pid => seq(containers.filter(c=>c.type==='box'&&c.parent_pallet_id===pid)))
  return ops
}
```
**Three independent numbering scopes**, each renumbered 1..N gap-free,
sorted by current number:
1. Pallets — one global sequence for the whole shipment.
2. Standalone boxes (`parent_pallet_id == null`) — one global sequence.
3. Boxes *within* each individual pallet — a separate sequence **per
   `parent_pallet_id`**.

`BoxBlock.deleteBox` and `PalletBlock.handleDeleteAll/handleDetachBoxes`
each **re-implement this same algorithm inline** (not via the shared
helper) scoped to just their own affected group — e.g. box deletion only
recomputes `toRenumber` for boxes sharing the same `parent_pallet_id` (or
same "standalone" group) as the deleted box; pallet deletion only
recomputes the global pallet sequence. This duplication should be
consolidated in the rebuild but must produce identical results.

**Box move between scopes** (drag a box to a different pallet or to
standalone) does **not** use a full resequence — it computes the new
number as `max(target-scope numbers)+1` and decrements-by-1 every box in
the *source* scope whose number was greater than the moved box's original
number (equivalent net effect to a full resequence of the source scope,
computed directly instead of via sort+reindex).

**Numbering on create** (never through `computeRenumberOps`):
- `nextBoxNumber()` = `max(existing standalone box numbers)+1` (0 → 1 if
  none).
- `nextBoxNumberInPallet(palletId)` = `max(existing box numbers in that
  pallet)+1`.
- `addPallet()`: `num = pallets.length + 1` (count-based, not max-based —
  relies on the invariant that pallet numbers are always
  gap-free/sequential, which the delete-path renumbering guarantees).
- New-pallet-via-a-single-item flows (`new-pallet-box` target in
  `PackTargetModal`/`SplitModal`/pallet-drop modifier) hardcode the new
  pallet's first box as `number: 1` since it's brand new.

**Edge case**: mixing count-based (`pallets.length+1`) and max-based
(`Math.max(...)+1`) numbering assumes the "always renumber to stay
gap-free" invariant holds everywhere; if any future code path ever deletes
a pallet without renumbering, `addPallet` could produce a duplicate
number.

---

## 5. Serial number bookkeeping

### 5.1 "Already assigned" tracking — two different Sets, computed as `useMemo` over `containers`

```js
// per-product: productId → Set(serial strings already placed anywhere in this shipment for that product)
assignedSerialsByProduct = { [cw_product_id]: Set<serial> }   // parses container_items.serial_numbers JSON per item

// shipment-wide: every serial packed for ANY product in this shipment
allShipmentPackedSerials = Set<serial>
```
Both are pure derivations over the live `containers` prop (no separate DB
query) — recomputed on every containers change. Deduplication is simply
"have we seen this serial string in any `container_items.serial_numbers`
JSON array yet" — there's no cross-shipment dedupe on the frontend at all
(that's a backend/CW concern, see 5.3).

`SerialPickerModal` uses `assignedSerials` to hide serials already claimed
for **this product** (own-list mode), and `allPackedSerials`
(shipment-wide) to filter the "show all" cross-client list so a serial
packed under a *different* product line in this same shipment can't be
double-selected.

### 5.2 Blocking condition for `PickingRequiredModal`
```js
const assertAllPicked = (product, targetContainerId, qty) => {
  const pickedQty = (product._serial_numbers || []).length
  const totalQty  = product.quantity || 1
  if (pickedQty >= totalQty) return true
  setPickAlert({ message: ..., product, targetContainerId, qty })
  return false
}
```
`_serial_numbers` is populated **server-side**
(`GET /cw/shipment/{id}/products`) by fetching `pickingShippingDetails` for
every product flagged serialized or already carrying `serialNumberIds`,
then flattening each record's `serialNumber` (comma-joined string) into a
flat list. `assertAllPicked` is called at the very top of *every* code
path that would otherwise open `SerialPickerModal` (drag-to-box,
drag-to-pallet-unboxed/all, empty-space-drop-each/all, PackTargetModal,
PackQtyModal confirm) **except** the pallet-drop "each" mode, which has no
serialized branch at all (see §9).

### 5.3 CW-picked-serials fetch (cross-client "show all")
`GET /cw/catalog/{catalog_id}/picked-serials` →
`cw_client.get_picked_serials_for_catalog`:
- Queries `/procurement/products?conditions=catalogItem/id={id}` (all
  product line items across all tickets/clients for that catalog item),
  then per product fetches `pickingShippingDetails`, keeping only records
  where **`pickedQuantity > 0` AND `shippedQuantity == 0`** (picked but
  not yet shipped = available), splitting the comma-joined `serialNumber`
  field.
- Deduplicated **by serial string only**, first-seen order wins
  (`seen: set[str]`) — if the same physical serial somehow appears under
  two different product/company records, only the first is kept and its
  company/source is what's shown.
- Each result: `{serial, company, source}` where `source` = project name
  if the line is on a Project, else the ticket's `summary`.

---

## 6. CI price-source picker — the five options

`getEffectivePrice(item)` (identical logic duplicated in
`CommercialInvoice.jsx` frontend and implicitly relied upon by whatever
consumes the aggregated `line_items` for the PDF, since the PDF is the
*same React component* rendered via Playwright):
```js
function getEffectivePrice(item) {
  if (item.price_source === 'manual')        return item.manual_price
  if (item.price_source === 'catalog_msrp')  return item.msrp
  if (item.price_source === 'catalog_price') return item.catalog_price
  if (item.price_source === 'avg_sold')      return item.avg_unit_price
  return item.max_unit_price ?? item.unit_price   // default = 'max_sold'
}
```
Backend aggregation (`_build_ci_context` in `documents.py`) computes these
fields **once per distinct `cw_product_id`**, aggregating across every
physical `container_items` row for that product across the whole shipment
(i.e. across all boxes/pallets it's split into):
- `max_unit_price` — running `max()` of each row's `unit_price` (the price
  captured at pack time from the CW product's client price).
- `avg_unit_price` — `sum(unit_price of every row with non-null price) /
  count`, rounded to 4 decimals.
- `catalog_price` — looked up from `catalog_item_cache` (keyed by
  `catalog_item_id`), populated by the background
  `POST /documents/{id}/cache-products` call (see §8) which itself gets
  `catalog_price` from the CW product's `_catalog_price`.
- `msrp` — taken **only from the first-seen row** for that product id (not
  max/avg'd like `unit_price`) — if different packed instances of the same
  product somehow carry different `msrp` values, only the first one packed
  determines "CW Catalog MSRP" for the whole aggregated line.
- `manual_price` — user override (see below).
- `price_source` — defaults to `item.get("price_source") or "client_price"`
  at read time (legacy fallback string; see §9 for why this is now
  dead/dangerous code).

**Setting a source via the Unit Value cell's right-click menu**
(`setPriceSource`):
```js
const payload = { price_source: newSource, manual_price: newSource==='manual' ? (getEffectivePrice(item) ?? null) : null }
```
Switching **to** `manual` seeds `manual_price` with whatever the
*currently displayed* effective value was (i.e. it "locks in" the current
computed number as a starting point for editing) rather than opening a
blank field. Switching to any other source always clears `manual_price` to
`null`.

**Typing directly into the Unit Value cell**
(`saveItemField(...,'unit_price')`):
```js
const num = val === '' ? null : parseFloat(val)
const price_source = num != null && !isNaN(num) ? 'manual' : 'max_sold'
const manual_price = price_source === 'manual' ? num : null
```
Any numeric keystroke commit switches to `manual` with that value.
**Clearing the field entirely** resets `price_source` all the way back to
`'max_sold'` — it does *not* restore whatever source was active before
manual was chosen (so choosing `catalog_msrp`, then typing a number, then
clearing the field, lands on `max_sold`, not back on `catalog_msrp`).

**PATCH scope**: `documents.updateLineItem(shipmentId, cwProductId, data)`
→ `PATCH /documents/{shipment_id}/line-item/{cw_product_id}` updates
**every `container_items` row in the shipment sharing that
`cw_product_id`** (`WHERE c.shipment_id=? AND ci.cw_product_id=?`), not
just the specific packed instance the user clicked. This applies
identically to `description_override`, `hs_code_override`,
`country_of_origin_override`, `price_source`, `manual_price` — **an
override is per (shipment, product), not per physical box/pallet
placement**, even though the aggregation UI shows one row per product
regardless of how many boxes it's split across.

**"Re-syncing product data later" interaction**:
`POST /documents/{id}/cache-products` (`cache_products` in
`documents.py`) only ever writes `description`, `part_number`,
`catalog_item_id`, `unit_price`, `msrp`, `unit_of_measure`,
`source_ticket_id`, `manufacturer` into rows **where `description IS
NULL`** (i.e., only first-time enrichment of freshly-packed items), plus
two narrower backfill passes for `unit_price`/`msrp` and `manufacturer` on
rows that have a description but are missing those specific fields. It
**never touches** `description_override`, `hs_code_override`,
`country_of_origin_override`, `price_source`, or `manual_price` — so a
manual price override, once set, survives every subsequent "Refresh from
CW" / re-sync indefinitely; the only way to clear it is the explicit
"Reset" (per-field right-click, or the CI toolbar's full-reset button).

---

## 7. Modified-field / reset-to-original pattern

- Every overridable field has a nullable `*_override` column (or, for
  price, the `price_source !== default` check). `null`/default = "derived
  value", non-null/non-default = "user-modified".
- `EditInput`/`DescriptionCell` accept a `modified` boolean prop that
  switches text color to `#7c3aed` (purple, `MODIFIED_COLOR`) and, while
  focused, tints the background/underline purple instead of the default
  blue-on-focus.
- **Only `price_source === 'manual'`** is treated as "modified" for
  styling purposes (`priceModified = item.price_source === 'manual'`) —
  choosing `catalog_price`/`catalog_msrp`/`avg_sold` (all deviations from
  the `max_sold` default) render with **no** purple indicator, only
  `manual` does.
- **Right-click reset**: every editable cell wires
  `onContextMenu={e => openResetMenu(e, resetItemField(cwProductId,
  field))}` (or `resetShipmentField(field)` for header-card fields), which
  opens a tiny one-item context menu ("Reset Field") that sets the
  underlying value to `null` via the same PATCH endpoints used for saves.
  This is a per-field, per-click affordance — there is no "which fields
  are dirty" summary view.
- **Global reset** (`DocumentPanel`'s "Reset" toolbar button, CI-only):
  `docsApi.resetCIOverrides(shipmentId)` →
  `POST /documents/{id}/reset-ci-overrides` — a single non-scoped SQL sweep
  that nulls **all** override columns on **every** `container_items` row
  for the shipment (`description_override`, `hs_code_override`,
  `country_of_origin_override`) **and** resets `price_source` to the
  string `'client_price'` (see §9 — this is broken), **and** wipes an
  entire block of shipment-level CI fields to `NULL`/defaults:
  `consignee_name`, `consignee_address`, `ship_to_same_as_consignee →
  1(true)`, `ship_to_name`, `ship_to_address`, `export_statement`,
  `ci_date`, `shipper_tax_field`, `consignee_tax_field`,
  `consignee_ein/vat/eori`, `incoterm`, `carrier`, `currency`,
  `awb_number`, `weight`. This is genuinely a full nuke of the whole CI
  configuration for the shipment, not just "line-item overrides" as the
  confirm-dialog copy states.

---

## 8. PDF render pipeline — "Generate"/"Export PDF"/"Post to CW"

### 8.1 Frontend trigger (`DocumentPanel.jsx`)
- **Export PDF** (`exportPdf`): calls `docsApi.generatePL`/`generateCI` →
  `POST /documents/{id}/packing-list` or `/commercial-invoice` → returns a
  `DocumentOut` row (id, filename, generated_at, ...). Then constructs a
  `<a download>` pointing at `docsApi.downloadUrl(doc.id)` =
  `GET /documents/download/{document_id}` and programmatically clicks it.
  **Filename is computed client-side purely for the download attribute**
  (`{shipment.id}{_pdfCode}_{CI|PL}.pdf`, using underscores) — this is
  *independent* of the server's own filename (see 8.4, which uses hyphens)
  and is **not** what actually gets saved to the `documents` table.
- **Post to CW** (`postToCW`): same generate call, then
  `docsApi.postToCW(doc.id)` → `POST /documents/{doc_id}/post-to-cw`. On
  success stamps `lastPosted[docType] = now` locally (purely optimistic UI
  — the real `posted_at` is fetched fresh only on next `DocumentPanel`
  mount via the `useEffect` that calls `docsApi.list(shipment.id)`).

### 8.2 Backend generate endpoint (`generate_packing_list`/`generate_commercial_invoice` in `documents.py`)
1. Builds the context (`_build_ci_context`, shared by both CI and PL
   despite the name — PL just discards most fields) purely to derive
   display strings needed for the **PDF footer** (`co_name`, `doc_ref`) —
   it does **not** feed this context into the actual page render.
2. Calls `pdf_service.render_commercial_invoice_via_react` /
   `render_packing_list_via_react` in a thread (`asyncio.to_thread`, since
   Playwright's sync API blocks).
3. Inserts a new row into `documents` (`doc_type`, `pdf_filename`,
   `generated_at`) — **note: the PDF bytes themselves are never persisted
   to disk or DB.** Every subsequent download or "Post to CW" call
   **regenerates the PDF from scratch** by re-running the whole Playwright
   pipeline again (`download_document` and `post_to_connectwise` both call
   `_build_ci_pdf`/`_build_pl_pdf` fresh rather than reading back stored
   bytes). This means the "generated_at" timestamp on a `documents` row
   can go stale relative to the actual bytes a user later downloads if
   shipment data changed in between — there is no snapshot/versioning,
   only a ledger of "a generate action happened at time T."

### 8.3 Playwright navigate-and-wait-for-`PRINT_READY` mechanism (exact)
```python
def render_commercial_invoice_via_react(shipment_id, footer_template):
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox', '--disable-dev-shm-usage'])
        page = browser.new_page()
        page.goto(f'http://nginx:8080/print/ci/{shipment_id}', wait_until='networkidle', timeout=30000)
        page.wait_for_function('() => window.PRINT_READY === true', timeout=15000)
        pdf = page.pdf(format='Letter', landscape=True, print_background=True,
                        margin={'top':'0.35in','right':'0.35in','bottom':'0.35in','left':'0.35in'},
                        display_header_footer=True, header_template='<span></span>', footer_template=footer_template)
        browser.close()
    return pdf
```
- Navigates to the **live React app itself** through the internal
  `nginx:8080` container hostname (not localhost — this only works inside
  the Docker network), to the routes `/print/ci/:id` / `/print/pl/:id`
  (`PrintCIPage.jsx`/`PrintPLPage.jsx`).
- Those pages independently fetch `/api/documents/{id}/invoice-data` (or
  `packing-list-data`) + `/api/cw/ticket/{id}` via plain `fetch`, then set
  `window.PRINT_READY = true` in a `useEffect` once `ctx !== null || error
  !== null` (i.e. ready on either success **or** failure — an error state
  also flips the flag so Playwright never hangs indefinitely on a bad
  shipment id; it instead captures whatever the error `<div>` renders as
  the "PDF").
- `page.wait_for_function('() => window.PRINT_READY === true', timeout=15000)`
  — polls for that global; 15s hard timeout (separate from the 30s
  `networkidle` navigation timeout).
- Both CI and PL PDFs render **landscape**, Letter size, `0.35in` margins
  on every side, with an **empty header** (`<span></span>`) and a
  **custom HTML footer** built server-side per-request containing company
  name, doc type, doc ref, and Playwright page-number placeholders
  `<span class="pageNumber">`/`<span class="totalPages">`.
- `print/ci` and `print/pl` render the *exact same* `CommercialInvoice`/
  `PackingList` React components used in the interactive `DocumentPanel`,
  just with `printMode={true}` (which swaps every `EditInput`/
  `SelectInput` to plain read-only `<span>`s reading `displayValue`/
  `value`, and swaps the page-background wrapper to plain white/no-
  shadow/no-zoom) and empty `companies`/`incoterms`/`carriers`/
  `currencies`/`presets` arrays (they're not needed in print mode since
  nothing is editable). **This is the critical architectural point for the
  rebuild**: the PDF is not a separate template — it is the live editable
  component itself, rendered headlessly and screenshotted-to-PDF by
  Playwright, so any visual change made to `CommercialInvoice.jsx`/
  `PackingList.jsx` automatically applies to the PDF with zero extra work,
  at the cost of PDF generation requiring a full browser + your whole
  frontend build to be network-reachable from the backend container.
- There is a **legacy/unused Jinja2 path** still present
  (`render_packing_list`/`render_commercial_invoice` in `pdf_service.py`,
  and `_build_shipment_context`/`preview_packing_list`/
  `preview_commercial_invoice` in `documents.py`, plus `_get_jinja_env`/
  `documents.css`/`packing_list.html`/`commercial_invoice.html` templates)
  that produces portrait-vs-different-margin PDFs from server-rendered
  Jinja HTML — these `/preview` endpoints and template-based renderers are
  **not called anywhere in the current frontend flow** (only `*_via_react`
  is used by the generate/download/post-to-cw endpoints). Worth explicitly
  deciding in the rebuild whether to carry this dead code forward or drop
  it (recommend: drop — no live caller).

### 8.4 Filename / document-ledger bookkeeping
- `pdf_service.make_filename(shipment_id, doc_type, pdf_code)` →
  `"{shipment_id}[-{pdf_code}]-{PL|CI}.pdf"` (hyphens) — this is what's
  stored in `documents.pdf_filename` and used as the `Content-Disposition`
  attachment filename on download. It is **different** from the
  client-side `exportPdf` download filename
  (`{id}{_pdfCode}_{CI|PL}.pdf`, underscore-joined) — cosmetic
  inconsistency, not a functional bug, but worth normalizing in the
  rebuild.
- `documents` table is purely a ledger of generate/post events (id,
  doc_type, filename-at-time-of-generation, generated_at, cw_document_id,
  posted_at) — **no blob storage**. `DocumentPanel`'s "Last posted to CW
  {date}" chip is sourced from `docsApi.list(shipment.id)`, taking the max
  `posted_at` per `doc_type` across all historical rows (`docs.reduce`
  finding latest `posted_at` per type) — every prior post attempt remains
  in the ledger; nothing is ever deleted or superseded explicitly, "latest
  wins" is computed at read time.
- `post_to_connectwise`: re-derives `cw_ticket_id` from the shipment row,
  falling back to `int(shipment_id)` if unset; calls
  `cw_client.upload_document(ticket_id, pdf_bytes, filename,
  title=Path(filename).stem, cfg)`; on success updates that specific
  `documents` row's `cw_document_id`/`posted_at` (the row created by the
  *generate* call in the same user action — `postToCW` in
  `DocumentPanel.jsx` always calls generate immediately before post, so
  every "Post to CW" click creates a brand-new `documents` row even if an
  identical one already exists from a prior generate).

---

## 9. Subtle business rules / non-obvious findings — and two live bugs

1. **Cross-client contamination warning** (`ProductPool.jsx`): a small
   orange triangle flag icon appears per pool row when `mainCompany &&
   product._company_name && product._company_name !== mainCompany`.
   `mainCompany` = `ticketData.company.name` for the *shipment's own
   ticket* (passed down as `ticketCompany` prop from `ShipmentPage`);
   `product._company_name` = the CW company on that specific product
   line item's own source ticket/project (set server-side in `cw.py`:
   `p["_company_name"] = (p.get("company") or {}).get("name","")`).
   Tooltip: `"This item is for a different client ({company}) than the
   Shipping Request is assigned to."` — purely a display warning; it does
   not block packing or gate any action.

2. **Removed-from-CW product detection**: `removedProductIds` (memo in
   `AssemblyWorkspace.jsx`) = the set of `cw_product_id`s that exist in
   **packed containers** but are absent from the **current** `products`
   fetch (`currentProductIds`, derived from the latest `cw.getProducts`
   call). `ContainerItem` renders a distinct "removed" visual (warning
   icon, "No longer on this shipment in ConnectWise", red "Remove" button
   that just calls the normal `removeItem`/undo path) instead of the
   normal draggable chip — and that item becomes **non-draggable**
   (`useDraggable({ disabled: isRemoved })`). This only re-syncs on the
   next `Refresh from CW` click (`cw.getProducts` refetch) — it is not
   live/websocket-driven.

3. **Two undo-less write paths** (already detailed in §3.5):
   `handleEmptySpaceDropAll` ("One box for ALL" from an empty-space drop)
   and the `'each'` branch of `handlePalletDrop` ("One box for EACH" on a
   pallet drop) contain **zero `pushUndo` calls** — any use of these two
   specific menu options is permanently non-undoable, unlike every
   structurally similar sibling option. This looks like an oversight
   (asymmetric with `handleEmptySpaceDropConfirm`'s "EACH" branch, which
   does have full undo+redo) rather than an intentional design choice —
   **recommend fixing in the rebuild, not replicating**, since nothing
   about the surrounding UI signals to a user that these two specific
   options are permanently irreversible while their visually-identical
   siblings aren't.

4. **Pallet-drop "each" never checks serialization**: unlike literally
   every other pack path, `handlePalletDrop`'s `'each'` branch has no
   `isSerializedProduct`/`assertAllPicked`/`SerialPickerModal` branch at
   all — it always calls `containersApi.addItem({...itemBase,
   quantity: 1})` with no `serial_numbers` field, even for a
   fully-serialized product. Packing a serialized item via "Pallet → One
   box for EACH" silently drops serial number tracking for that batch.
   **Recommend fixing in the rebuild** — this is a data-integrity gap, not
   an intentional simplification.

5. **LIVE BUG — "Reset Field" on the CI Unit Value cell sends an invalid
   enum value.** `CommercialInvoice.jsx` (~L1106-1120): the top "Reset
   Field" row of the value context menu calls
   `setPriceSource(cellMenu.cwProductId, 'max')` — but `'max'` is **not**
   one of the five valid `price_source` literals
   (`max_sold|avg_sold|catalog_price|catalog_msrp|manual`, enforced both
   by the Pydantic `LineItemOverrideUpdate` schema and the SQLite `CHECK`
   constraint). Clicking this specific menu item sends an invalid enum
   value in the PATCH body, which FastAPI/Pydantic rejects with a 422
   before it ever reaches the DB — the reset silently fails (the `fetch`
   wrapper swallows the error with `.catch(()=>{})`), so the user sees no
   error and the field appears unchanged. Every other "Reset Field" menu
   item on other cells works correctly. **Do not replicate — fix in the
   rebuild** (correct target value is `'max_sold'`, matching the column's
   own `DEFAULT`).

6. **LIVE BUG — the CI toolbar's "Reset" button throws a SQLite
   `IntegrityError` on any shipment with packed items.**
   `reset_ci_overrides` in `documents.py` runs `UPDATE container_items SET
   ... price_source = 'client_price' ...`. The **current**
   `container_items` schema constrains `price_source` to `CHECK
   (price_source IN ('max_sold','avg_sold','catalog_price',
   'catalog_msrp','manual'))` — `'client_price'` is a **legacy** value
   from an older schema generation that LC's own startup migration
   explicitly converts *away from* (`CASE price_source WHEN
   'client_price' THEN 'max_sold' ...`) precisely because it's no longer
   valid. **This means clicking "Reset" in the CI toolbar on any shipment
   that has at least one packed item currently raises a live,
   reproducible `IntegrityError`**, failing the whole reset request —
   visible to the user only as a generic `toast.error('Reset failed')`.
   **Do not replicate — fix in the rebuild** (target value `'max_sold'`).
   The stray `item.get("price_source") or "client_price"` fallback in
   `_build_ci_context`'s aggregation is dead/defensive code from the same
   legacy era; simplify to `or "max_sold"` or remove.

7. **Overrides are scoped to `(shipment, cw_product_id)`, not to
   individual packed instances** (detailed in §6) — critical for the
   rebuild's data model: if a product is split across 3 boxes, editing
   its description/HS code/country/price on *any one* row in the CI table
   updates *all three* underlying `container_items` rows identically via
   the shared PATCH endpoint. The aggregated CI "line item" the user
   edits is a read-time merge of potentially-many DB rows, but a write
   always fans out to all of them — so there is never actually a
   divergence in practice (unless a partial-failure mid-fan-out leaves
   rows inconsistent, in which case the read-side aggregation in
   `_build_ci_context` only ever consults the **first-seen row**'s
   override columns for `description_override`/`hs_code_override`/
   `country_of_origin_override`, silently ignoring any others).

8. **`msrp` and box-assignment labels are per-row, not merged
   consistently**: `box_assignments` on each aggregated CI line item is a
   list of `{label, qty}` per physical container placement,
   **range-collapsed** by `_collapse_box_ranges` (e.g. consecutive box
   numbers within the same pallet get merged into `P:1 | B:1-25` style
   ranges, with quantities summed) — this collapsing only triggers for
   `P:N | B:M` and `B:M` shaped labels (regex-matched); bare `P:N`
   (unboxed-on-pallet placement) labels pass through unmerged, just
   summed by exact label match.

9. **Auto-company-assignment on load**: `ShipmentPage.jsx` has a
   `useEffect` that, whenever a loaded shipment has `company_id == null`
   and the companies list has loaded, silently auto-PATCHes the shipment
   to the org's `is_default` company — this happens with no user action
   and no toast, purely as a side effect of viewing a fresh/never-
   configured shipment. Worth replicating exactly since it affects which
   "Shipper" branding appears by default on both documents.

10. **Batch pack from ProductPool checkboxes skips serialized lines
    entirely** (`handleBatchPack`): if any checked rows are serialized,
    they're filtered out of the batch (`nonSerialized`) with a toast
    noting how many were skipped ("serialized skipped)"); if **all**
    checked rows are serialized, the whole batch pack is refused outright
    with `toast.error('Selected items are serialized — pack them
    individually via drag or right-click.')` and no modal opens at all.

11. **Shift-click range-select in `ProductPool`** operates purely on the
    currently sorted+filtered `sorted[]` array positions
    (`lastCheckedIndexRef`), and its "direction" (check vs uncheck the
    whole range) is derived from the *clicked* row's new post-toggle state
    (`willCheck = !prev.has(productId)`), not from the anchor row's state
    — i.e. shift-clicking an already-checked row unchecks the whole
    range, shift-clicking an unchecked row checks the whole range.

12. **`_serialized` flag source**: a product is treated as serialized for
    all packing-UI purposes if the **catalog item's `serializedFlag`** is
    true (`_serialized`) **or** it already has `serialNumberIds`
    populated on the raw CW product payload — checked with
    `isSerializedProduct = p => p?._serialized || (p?.serialNumberIds?.length > 0)`.
    This means a product whose catalog item is *not* flagged serialized
    but which already happens to carry assigned serial IDs (e.g. data
    inconsistency, or catalog flag changed after serials were assigned)
    is still routed through the full serial-picker flow.

13. **Weight fields exist on `containers` and `container_items` (`weight`,
    `item_weight`) and on `shipments` (`weight`, `show_weight_per_item`)**
    but are **never read or written anywhere in the Packing (Assembly) or
    Documents UI code that was read** — `ShipmentDetails.jsx` (not
    currently wired into `ShipmentPage`'s tabs) is the only place
    `weight`/`show_weight_per_item` are edited, via a form that doesn't
    appear reachable from the current tab bar. The CI/PL documents
    display `shipment.weight` as a single manually-typed total, not
    computed from per-container/per-item weights — those columns appear
    to be vestigial/future-use, not currently exercised by any live code
    path in these two feature areas.

14. **`sort_order` on both `containers` and `container_items`** defaults
    to `0` everywhere and is never explicitly set by any Assembly code
    path read (`containersApi.create`/`addItem` calls never pass a
    `sort_order`) — the backend's `ORDER BY sort_order, id` clauses are
    therefore effectively just `ORDER BY id` (creation order) in current
    practice, since every row ties on `sort_order=0`.

---

## 10. Summary — fix vs. faithfully replicate

Per the rebuild plan's principle ("port faithfully first, prove parity,
improve only after"): the two **undo-less paths** (§9.3, §9.4's missing
serial gate) and the two **live bugs** (§9.5, §9.6) are unintended defects,
not business rules — recommend building the CAST-native version *without*
them from the start, rather than replicating known-broken behavior for the
sake of pixel-parity. Everything else in this document — every modal's
exact trigger/validation/button behavior, the collision detector, the
undo/redo ID-replay mechanism, the three numbering scopes, the serial
dedup logic, the price-source picker's five options, the PDF pipeline's
`PRINT_READY` handshake — is real, intentional business logic and should
be replicated exactly.
