# HARSH — Household Expansion

> Companion to [FEATURES.md](FEATURES.md). Three new family-scoped features: recipe capture, household inventory tied to the grocery loop, and lightweight finance tracking. All three lean heavily on Gemini Vision for OCR (receipts, handwritten recipes) so capture stays low-friction.
>
> **Status:** spec in progress. Recipes v1 is buildable today; Inventory + Finances need owner answers on the questions in §6 + §7.

---

## 1. Vision

Three pain points the family has been hitting:

1. **Recipes get lost.** Spouse jots recipes on paper, then they vanish. Wants a place to capture and find them.
2. **We don't know what's in the house.** Double-buy bread, run out of staples mid-cook, no shared awareness of stock.
3. **Money disappears into groceries + eating out.** Want lightweight tracking with weekly budget visibility and specific feedback ("you spent $X on Y this week" not just "you spent too much").

The tying insight: **the grocery list ↔ inventory loop**. Checking something off the grocery list adds it to inventory. Saying "we're out of bread" decrements inventory + adds to grocery. Snapping a receipt updates both inventory and finance ledger. One photo or one voice line moves data through three systems.

---

## 2. Design Principles

Inherits FEATURES.md §1. Plus:

1. **Capture must be effortless** or it won't happen. Photo > typing > voice for receipts. Voice > typing for "we're out of X." Manual entry is the fallback, never the primary.
2. **Track at the line-item level when free, aggregate level when not.** Receipt OCR gives us line items for free; manual entry uses category-level rough numbers.
3. **No surveillance.** Receipts and inventory live family-scoped; we don't ship them anywhere or train on them.
4. **Display surfaces only what's actionable.** "Right now: low on bread, eggs, coffee" is useful. The full pantry view is not.

---

## 3. Recipes  *(v1: capture + display)*

The MVP is intentionally tiny: take a photo, save it, see it in a list.

### Data model

```sql
recipes (
  id uuid pk,
  family_id uuid not null,
  title text not null,
  notes text,
  photo_path text,                     -- storage object key (recipe-photos bucket)
  source text,                         -- 'photo' | 'handwritten' | 'web' | 'manual'
  source_url text,                     -- if pasted from a website
  tags text[],                         -- 'breakfast', 'quick', 'kid-friendly', user-defined
  created_by_member_id uuid,
  created_at timestamptz,
  last_used_at timestamptz
)
```

Plus a private `recipe-photos` Supabase Storage bucket with family-scoped read.

### v1 UX

- New route `/recipes` from hamburger
- Big "+" → camera (mobile) / file picker (desktop) → name it → save
- Grid of recipe thumbnails, tap to expand the photo
- Search by title + tags
- Voice command: "add a recipe" → opens camera

### v2+ ideas (not now)

- Gemini Vision extracts text from photo → structured ingredients + steps
- "What can I make for dinner?" given pantry + recipes
- Meal-planning surface (weekly view) that auto-builds grocery list
- Share a recipe by link (read-only public URL)

### Implementation notes

- Reuse the meeting-audio storage pattern (private bucket, family-scoped RLS)
- Mobile camera input: `<input type="file" accept="image/*" capture="environment">`
- Image compression client-side before upload (typical phone photo is 4MB; we don't need full res)

---

## 4. Inventory + Grocery Loop  *(needs owner answers — see §6)*

The most-valuable feature in this doc IF we nail the UX. The pitfall: inventory apps fail because they're too much work to maintain. The grocery↔inventory loop is the antidote — every existing action (checking off a list item, snapping a receipt, saying "we're out of X") maintains inventory as a side effect, not as work.

### Data model

```sql
inventory_categories (per family)
  id, family_id, name, color, sort_order

inventory_items (per family)
  id, family_id, name, normalized_name,           -- "bread", "sourdough loaf", "milk"
  category_id, default_grocery_list_id,
  in_stock boolean default true,                   -- simple presence flag
  quantity_count int,                              -- optional precise count
  unit text,                                       -- 'count' | 'oz' | 'lb' | 'gallon' | 'pack'
  last_purchased_at timestamptz,
  last_purchased_price_cents int,
  typical_price_cents int,                         -- rolling avg from receipts
  notes text,
  archived boolean default false                   -- soft delete (keep history)

inventory_events (audit log)
  id, family_id, item_id, kind ('added'|'removed'|'price_changed'|'manual_edit'),
  source ('voice'|'grocery_check'|'receipt_ocr'|'manual'),
  quantity_delta int, price_cents int,
  member_id, created_at, note
```

### The loop in detail

```
Voice: "we're out of bread"
  → Display ai-intent classifies → marks bread.in_stock = false
  → Adds "bread" to default grocery list (if not already there)
  → spoken reply: "Bread added to groceries."

Grocery list: user checks off "bread"
  → ListService.toggleItem → trigger fires
  → Update inventory item: in_stock = true, last_purchased_at = now()
  → If list item has a price_cents (manually set), persist it

Receipt: snap photo at /receipts/new
  → receipt-ocr edge function (Gemini Vision)
  → extracts vendor, total, line items with prices
  → user reviews + confirms (like brain-dump cards)
  → For each line item: match to inventory_items.normalized_name (fuzzy);
    set in_stock = true, update typical_price_cents (rolling avg), append inventory_event
  → Expense row created (see Finances §5)
```

### Display interaction

- New voice intents:
  - `inventory.out_of`: "we're out of X" → remove + add to grocery
  - `inventory.have`: "we have X" / "we just bought Y" → mark in_stock
  - `inventory.query`: "do we have eggs?" → read inventory
- Display "Right now" section in briefing could surface low-stock items
- No dedicated inventory panel on display (too noisy)

### Portal `/inventory`

- Grouped-by-category list with in-stock badges
- Quick toggle (in/out) per item
- Add item manually (name + category)
- Tap an item to see purchase history + price chart

### Open questions

See §6.

---

## 5. Finances  *(needs owner answers — see §7)*

Two layers:

**Budget layer:** weekly target per category, plus a master weekly target. Visualized as a progress bar or remaining-budget number. Refreshes Monday.

**Ledger layer:** every expense is a row. Receipts add many rows at once (one per line item). Manual entry adds rough rows ("eating out, $40"). Reports roll up.

### Data model

```sql
budgets (per family)
  id, family_id, category text,                    -- 'groceries', 'dining', 'household', etc.
  weekly_cents int,
  active boolean default true,
  created_at

expenses (per family)
  id, family_id, member_id,
  occurred_at,                                     -- when the spending happened (not when entered)
  vendor text,                                     -- "Target", "Cookie's Diner"
  category text,                                   -- one of budgets.category
  total_cents int,
  notes text,
  source ('receipt_ocr' | 'manual' | 'voice'),
  receipt_path text,                               -- storage key when from a photo

expense_items (per family)
  id, expense_id, family_id,
  name text,                                       -- "bread"
  quantity int,
  unit_cents int,
  total_cents int,
  matched_inventory_item_id uuid,                  -- when receipt parser confidently mapped
  category text                                    -- inherited from parent expense by default
```

### Receipt OCR flow

1. Portal `/receipts/new` → camera → upload
2. `receipt-ocr` Edge Function (Gemini Vision):
   - extract vendor, date, total, currency
   - line items: name + quantity + unit price + total
   - guess category from vendor (Target → "household", grocery store → "groceries")
3. User reviews on a card grid (similar to brain-dump): confirm/edit each row
4. On commit: insert expense row + expense_items rows + cascade to inventory (matched items)

### Spending report

End-of-week (Sunday evening) cron generates a one-shot briefing-style report:
- Total by category vs budget (over/under)
- Top 5 vendors by spend
- Top 5 line items by spend (calls out "bread $24/wk" if it's outsized)
- Comparison vs prior week
- Surfaces on the briefing page + optional notification

### Bank connection?

The owner asked about this. Honest assessment:

- **Plaid** is the standard. Personal use: $50-300/yr depending on volume. Real complexity to integrate (OAuth-like flow, item refresh handling, categorization mapping).
- For a household: receipt OCR gets you 90% of the value (the granular line items) without the cost or complexity.
- Recommendation: skip bank connection in v1. Revisit only if receipt capture proves too laborious in practice.

### Open questions

See §7.

---

## 6. Open Questions — Inventory

Marked **Q:** for easy scanning.

1. **Q: How granular?** Two extremes:
   - (a) Boolean: "do we have bread? yes/no" — minimal maintenance, voice-friendly.
   - (b) Counted: "we have 3 loaves" — useful for "are we running low" but harder to keep current.
   - Recommend: default to (a), opt-in to (b) per item for things that matter (toilet paper, dish soap, where quantity drives reordering).
2. **Q: Normalization granularity?** "Bread" or "Sourdough loaf from Trader Joe's"? I'd default to coarse names ("bread", "milk") with optional brand/variant as notes. Coarse is easier to match against voice + receipts.
3. **Q: Expiry tracking?** Could be a column (`expires_at`). Adds friction (capture date) but enables "you have milk expiring tomorrow" alerts. Defer, IMO.
4. **Q: Categories** — pre-seed (Pantry, Fridge, Freezer, Cleaning, Bathroom, Pets) or fully user-defined? I'd pre-seed with sensible defaults you can edit.
5. **Q: Which lists feed the loop?** Just the "Grocery" list, or any list (Hardware Store, Bathroom, etc.)? Per-category default seems right: cleaning items go to a "Target" list, food to "Grocery".
6. **Q: What about non-consumables?** ("we have the green vacuum", "the kitchen scale lives in the second drawer") — facts already covers this. Inventory is for restock-able items only?
7. **Q: Display surfacing intensity** — daily briefing should mention low-stock, but should an "Out of bread" voice line ALSO trigger a spoken confirmation on the display, or just silent update?

---

## 7. Open Questions — Finances

1. **Q: Categories** — what do you want to track? Suggested starter: groceries, dining out, household goods, personal, other. Wife's input here matters.
2. **Q: Manual or photo-only?** If we make photo-only the primary path, you don't have to type anything. But sometimes you'll spend money without a receipt (vending machine, kid's lemonade stand). I'd suggest: photo first, voice-add as fallback ("spent $20 on lunch").
3. **Q: Joint or per-person?** Each adult records their own expenses, or one shared family pool? Joint is simpler; per-person adds attribution but more setup.
4. **Q: Budget scope** — weekly only, or weekly + monthly + annual? Weekly is what you described; let's start there.
5. **Q: Reset day** — Monday morning, Sunday morning, or first-of-month? Affects the report cadence.
6. **Q: Currency** — USD only? (Easy to add others later but every input grows by a select if multi-currency.)
7. **Q: Report destination** — display briefing only? Email digest too?

---

## 8. Cross-Cutting Notes

### Gemini Vision

Used for both receipt OCR and (eventually) recipe extraction. Gemini 2.5 Flash supports image input via base64 inline (up to 20MB) or via the Files API for larger. A typical receipt photo is < 2MB. Cost: roughly $0.0001 per receipt — negligible.

### Storage buckets

- `recipe-photos` (new)
- `receipt-photos` (new)

Both family-scoped via RLS, same pattern as `meeting-audio`.

### Voice intents to add to `ai-intent`

- `inventory.out_of` { item: string }
- `inventory.have` { item: string }
- `inventory.query` { item: string }
- `expense.add` { category?, amount_cents?, note? }
- `recipe.add` (just opens camera)

### Cron / scheduling

- Weekly spending report: pg_cron Sunday 19:00 → new `tick-spending-report` edge function (similar pattern to `tick-briefings`)
- Optional daily inventory low-stock surfacing in briefing — wire into `generate-briefing` context

### Briefing integration

Update the briefing generator to include:
- Low-stock items (in `right_now` if assertive enough)
- Weekly spend vs budget (in `heads_up` mid-week, `needs_attention` if over)

---

## 9. Phasing Recommendation

**H1 — Recipes**
- Schema + storage bucket + photo capture + grid view + voice trigger
- ~1 small session

**H2 — Inventory MVP**
- Schema + service + portal `/inventory` page
- Grocery loop hooks (check-off → in_stock=true)
- New voice intents for out_of / have / query
- Briefing surfacing for low-stock

**H3 — Receipts + Finances**
- Schema for budgets + expenses + expense_items
- `receipt-ocr` Edge Function + review UI
- Budgets editor in Settings
- Receipt → inventory cascade
- Spending report (briefing-style)

**H4 — Polish**
- Recipe Vision extraction (v2 recipes)
- Expense category auto-learning
- Weekly trend charts
