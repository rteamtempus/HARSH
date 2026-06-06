# HARSH — Household Expansion

> Companion to [FEATURES.md](FEATURES.md). Four interlocked features: recipe + meal capture, household inventory with extensible categories, waste tracking as a first-class signal, and lightweight finance tracking.
>
> **Status:** spec revised. Recipes v1 is live; Inventory + Waste + Finances + Meals all still need a few owner answers (see §9) before building.

---

## 1. Vision

This is a tool for two ADHD adults with **complementary, opposite blind spots**:

- **Owner** struggles to track to-dos. Solved by FEATURES.md (brain dump + briefing + display ambient memory).
- **Spouse** runs the household after the owner was out for a stretch; she struggles to track spending and waste. Heavy cook, lots of specialty ingredients, multiple variants of pantry staples, frequent buy-taste-discard pattern with new items. Different financial upbringing — money isn't a thing she instinctively considers.

This expansion is **for her** the way the briefing surface is for him: passive, glanceable awareness that lives in front of her every day. Not reports she has to seek; not nags. The display gains a "where money is going and why" surface alongside the family briefing.

### The non-obvious insight

**Waste is its own signal.** "Spent $400 on groceries" tells half the story. "Spent $400, threw out $80 in moldy produce + things she didn't like" is the actionable feedback. Same dollar amount on a budget chart; very different lever to pull. So waste gets a first-class table and its own weekly view — not just an aggregate column on the spending report.

### Four pain points

1. **Specialty pantry ambiguity.** "Do we have soy sauce?" — we have four. Inventory needs categories with multiple item variants under each, queryable at either level.
2. **Buy-and-bin pattern.** Wife buys something, tastes it, doesn't like it, throws it away. We need a waste log that captures the why so the data shapes future purchases.
3. **Invisible category drift.** Wine + Zyns + specialty ingredients each individually fine, in aggregate a story neither of us was tracking. Need the report to surface category-level spend trends without judgment.
4. **Recipe-as-financial-unit.** Wife makes a meal; half goes uneaten; gets binned 3 days later. The "real cost" of that meal is ingredients × % wasted. Without that linkage, recipe choice and budget conversations don't connect.

---

## 2. Design Principles

Inherits FEATURES.md §1. Plus:

1. **Capture must be effortless** or it won't happen. Photo > voice > typing for receipts. Voice > typing for "we're out of X" or "we threw out the bread." Manual entry is the fallback, never the primary.
2. **Visibility, not nagging.** The display surfaces "this week so far" passively. No alerts, no commanding tone. Same restraint as the family briefing.
3. **Waste is data, not judgment.** When she logs a discarded item, the system records and helps her see patterns. The system never moralizes. Tone matters here.
4. **Granularity she can act on.** Categories like "soy sauce" with variants underneath, not flat names. Voice query at either level. Receipts populate variants by name when they match.
5. **No surveillance.** Receipts and inventory and waste live family-scoped. Per-person attribution is optional; opt-in.

---

## 3. Recipes & Meals  *(Recipes v1 live; Meals planned)*

Recipes v1 (capture + display) shipped. Two structural additions for v2:

### Recipes v2 — cost + ingredients

```sql
recipes  (extend existing)
  + estimated_cost_cents int,                      -- computed when ingredients map to inventory
  + servings int,
  + last_made_at timestamptz

recipe_ingredients
  id, recipe_id, family_id,
  inventory_item_id uuid nullable,                  -- mapped when match exists
  free_text_name text,                              -- for unmatched ("a pinch of saffron")
  quantity_text text,                               -- "2 cups", "1 can", "to taste"
  estimated_unit_cost_cents int,
  estimated_line_cost_cents int
```

Cost is **opt-in** and **auto-computed where possible** (when an ingredient matches an inventory item with a known typical price). Wife should never have to type a price into a recipe.

### Meal events — recipe as financial unit

```sql
meal_events
  id, family_id, recipe_id,
  occurred_at timestamptz,
  servings_made int,
  servings_eaten int,                               -- captured at end of meal / day-after
  servings_wasted int,                              -- derived (made - eaten)
  estimated_total_cost_cents int,                   -- snapshot from recipe at time of make
  estimated_value_wasted_cents int,                 -- derived
  member_id, notes
```

Capture flow:

- **At cook time** (voice): "I'm making the chicken curry" → meal_event created with servings_made (asked or defaulted from recipe.servings)
- **Day after / when binning** (voice): "we tossed the rest of the curry" → mark servings_wasted; waste_event auto-created and linked
- **End of week summary**: "$X spent on meals this week, $Y wasted across N meals — your three highest-waste meals were…"

### Open question

See §9. Q1, Q5, Q9.

---

## 4. Inventory  *(redesigned: categories + variants)*

### Structural pivot from the original spec

Items live **inside categories**. A category like "soy sauce" can contain multiple variants ("low sodium Kikkoman", "tamari", "premium dark"). Voice queries work at either level: "do we have soy sauce?" lists every variant with stock status; "we're out of low sodium soy sauce" updates that specific variant.

### Data model

```sql
inventory_categories (per family)
  id, family_id, name text,                         -- "soy sauce", "bread", "wine"
  description text,
  color, sort_order,
  default_grocery_list_id,                          -- which list new items in this category go to
  created_at

inventory_items (per family)
  id, family_id, category_id nullable,
  name text,                                        -- "low sodium Kikkoman" / "sourdough loaf"
  brand text,                                       -- "Kikkoman"
  size_text text,                                   -- "16oz"
  variant_notes text,                               -- "gluten-free", "from Costco"
  in_stock boolean default true,                    -- simple presence flag (primary signal)
  quantity_count int,                               -- optional precise count (toilet paper, soda cans)
  unit text default 'count',
  last_purchased_at timestamptz,
  last_purchased_price_cents int,
  typical_price_cents int,                          -- rolling avg from receipts
  is_category_default boolean default false,        -- "we're out of soy sauce" defaults to this when set
  archived boolean default false

inventory_events (audit log)
  id, family_id, item_id,
  kind ('added' | 'removed' | 'price_changed' | 'manual_edit' | 'wasted'),
  source ('voice' | 'grocery_check' | 'receipt_ocr' | 'manual'),
  quantity_delta int, price_cents int, member_id, occurred_at, note
```

### Voice patterns the model handles

| Voice | Behavior |
|---|---|
| "do we have soy sauce?" | List all soy sauce variants + stock |
| "do we have low sodium soy sauce?" | Specific variant lookup |
| "we're out of bread" (category, multiple) | Ask: "Which one — sourdough or whole wheat?" OR add generic "bread" to grocery if no `is_category_default` set |
| "we're out of low sodium soy sauce" | Mark that variant out, add to grocery with the category tag |
| "we just bought 4 sourdough loaves" | quantity increment |
| "we threw out the moldy bread" | Waste log + remove from inventory (see §5) |

### Grocery list integration

When an item goes out-of-stock from voice, it gets added to its **category's default grocery list**. The list-item text includes the variant ("low sodium soy sauce"), and a hidden category tag travels with it. When that item is checked off the list, the inventory item flips back to in_stock — and if the matched-inventory-item has no `last_purchased_price`, the executor prompts "what did you pay?" so we capture cost.

### Pre-seeded categories

I'd start with these for the household and let her edit / extend:

- Pantry (dry goods, oils, sauces, baking)
- Fridge (dairy, produce, leftovers)
- Freezer
- Spices
- Bread & baked
- Drinks (incl. coffee, tea, soda)
- Alcohol (wine, beer, liquor)
- Cleaning
- Bathroom
- Pet
- Tobacco / nicotine
- Misc / household goods

### Open questions

See §9. Q2, Q3, Q4.

---

## 5. Waste  *(new — first-class)*

The most-important new thing in this revision. Captures **specifically what was thrown away, why, and what it cost**. Powers the weekly "where did your money actually go" story without conflating spend with waste.

### Data model

```sql
waste_events
  id, family_id, member_id,
  item_id uuid nullable,                            -- the inventory item if known
  meal_event_id uuid nullable,                      -- if the waste was leftovers from a meal
  free_text_name text,                              -- when no inventory match
  reason text,                                      -- enum below
  quantity_text text,                               -- "half a loaf", "two slices"
  estimated_value_cents int,                        -- derived from inventory typical_price OR meal cost
  occurred_at timestamptz default now(),
  note text

reasons enum:
  'expired' | 'disliked' | 'spoiled' | 'forgot' | 'leftover_not_eaten'
  | 'broken' | 'lost' | 'overcooked' | 'other'
```

### Capture flow — passive first, deliberate as fallback

The single most-important UX decision in this whole expansion: **brain-dump captures waste implicitly**. When she says "I tossed the moldy bread" in the brain dump, the executor recognizes this as a waste event, not a list_item. Same with "we didn't end up eating the chicken curry" → meal_event leftover_not_eaten.

Explicit voice path also exists: "log a waste event" → asks for item + reason. But the goal is for 80%+ of waste to be captured without her thinking she's "logging waste."

### Weekly waste report

End-of-week (Sunday 19:00 cron — same as spending report):

- Total estimated value wasted
- Top 5 items by waste value
- Breakdown by reason ("most of your waste this week was leftover not eaten — the chicken curry batch in particular")
- Recipe waste: which recipes had highest waste %, are there patterns (too many servings? Don't make again?)
- Trend vs prior week (no judgment, just the number)

### Open questions

See §9. Q5, Q6.

---

## 6. Finances  *(refined — category trends + per-person attribution)*

### Data model

Largely unchanged from v1 spec, with two additions: attribution and rollover categories.

```sql
budgets (per family)
  id, family_id, category text,                     -- 'groceries', 'dining_out', 'alcohol', 'tobacco', 'household_goods', ...
  weekly_cents int,
  active boolean default true

expenses (per family)
  id, family_id, member_id,                         -- who recorded / who paid
  occurred_at, vendor text, category text,
  total_cents int, notes text,
  source ('receipt_ocr' | 'manual' | 'voice'),
  receipt_path text

expense_items
  id, expense_id, family_id,
  name text, quantity int, unit_cents int, total_cents int,
  matched_inventory_item_id uuid nullable,
  category text                                     -- inherited from parent or per-item override
```

### Receipt OCR flow

1. Portal `/receipts/new` → camera → upload
2. `receipt-ocr` Edge Function (Gemini Vision): vendor, date, total, line items, currency
3. **Auto-categorization at the LINE ITEM level** — wine bottle on a Target receipt goes to `alcohol`, even if the receipt total goes to `household_goods`. This makes category trends meaningful.
4. Review card per row: confirm/edit each line item OR (for long receipts) batch-confirm with a "fix anything wrong?" pass
5. On commit: insert expense + items, cascade matched items to inventory (mark in_stock + update typical_price_cents)
6. Generate one waste_event row for items already known to be replacing wasted ones (optional, based on inventory state)

### Spending report — for her specifically

End-of-week (Sunday 19:00):

- Vs each weekly budget category — over/under in $$, not %
- **Trend section:** alcohol, tobacco, specialty ingredients — categories where small recurring spend adds up. Surface 4-week rolling averages. Non-judgmental.
- **Top 5 vendors**
- **Top 5 line items by total spend this week**
- **Cross-link with waste**: "you spent $X on Y; of that, $Z was thrown away"
- Comparison to prior 4-week average

Surfaces on the display all week (passive ledger view, see §7) AND a deeper portal page Sunday night.

### Open questions

See §9. Q7, Q8, Q10, Q11.

---

## 7. Display Surface — Ambient Money Awareness

This is the load-bearing UX shift from the original spec. The display gets a new view alongside the briefing:

**"This week" view** — passive ledger of spend + waste. Always available via voice ("show me the money", "show me this week"). Surfaces:

- Big number: "$X spent so far, $Y over/under target"
- Category bars (groceries / dining / alcohol / etc.) with weekly progress
- Waste line: "$Z thrown away this week"
- Latest receipt thumbnails / latest waste items

Briefing also gains a finance line in `heads_up`: "halfway through the week, halfway through the grocery budget" etc.

This is what makes the expansion useful for her specifically: it's in her line of sight every day, not buried in a portal she has to navigate to.

---

## 8. Cross-Cutting Notes

Same as before plus:

- **Gemini Vision** for both receipt OCR and (eventually) recipe text extraction
- **Storage buckets:** `recipe-photos` (live), `receipt-photos` (new)
- **Voice intents** to add to `ai-intent`:
  - `inventory.out_of` { item, category? }
  - `inventory.have` { item, quantity?, price_cents? }
  - `inventory.query` { item OR category }
  - `waste.log` { item, reason, quantity? } — but also recognized implicitly by brain dump
  - `meal.cooked` { recipe_name, servings_made? }
  - `meal.discarded` { recipe_name, servings_wasted }
  - `expense.add_voice` { category?, amount_cents?, vendor? }
  - `report.show_money` (display: switch to This Week view)
- **Cron:** weekly spending + waste report Sunday 19:00 (extends `tick-spending-report`)

---

## 9. Open Questions — Slim List

Marked **Q:** for easy scanning. Pruned to the ones that block v1 build.

1. **Q1: Recipe cost — auto only, or manual entry option?** I'd auto-compute from matched inventory items + receipt data; she never has to enter prices. OK to skip manual entry for v1? *(Affects: recipes v2 build complexity.)*

2. **Q2: "We're out of [category]" ambiguity resolution** — pick one:
   - (a) Voice asks back: "Which one — Kikkoman or tamari?"
   - (b) Default to the `is_category_default` variant if set, else (a)
   - (c) Add generic "[category]" to grocery list and let her sort it on shopping day
   - I lean (b) — it's the calmest UX. *(Affects: voice intent prompts.)*

3. **Q3: Pre-seeded categories** — does the list in §4 (Pantry / Fridge / Freezer / Spices / Bread / Drinks / Alcohol / Cleaning / Bathroom / Pet / Tobacco / Misc) match her mental model? Add/remove anything?

4. **Q4: Quantity counts** — boolean in_stock by default; opt-in counts for things like toilet paper, dish soap, soda cans? Or counts everywhere? *(I still recommend boolean default — counts on demand. Worth confirming for her workflow.)*

5. **Q5: Passive waste capture intensity** — brain dump should recognize phrases like "I tossed the moldy bread" as waste events instead of list items. But should it ALSO occasionally prompt — e.g. when the grocery list is checked off and a previous-version item exists, ask "what happened to the old [item]"? Or never prompt, only capture what she volunteers? *(I lean never prompt; prompts feel like nagging.)*

6. **Q6: Waste reasons list** — does this cover her patterns: expired / disliked / spoiled / forgot / leftover_not_eaten / broken / lost / overcooked / other? Anything specific to your household?

7. **Q7: Per-person attribution for expenses** — every expense has a `member_id`. When voice or receipt OCR doesn't know, it picks the signed-in user. Do you want to see per-person breakdowns in the weekly report (e.g. "Holly bought $X of wine, Rory bought $Y of Zyns")? Or only category-level, never attributed? *(Affects: how confronting the report feels. I'd default to category-level only; per-person opt-in.)*

8. **Q8: Budget reset day** — Monday morning or Sunday morning? Affects when the weekly report fires (the day BEFORE reset so you have a clean read of the prior week).

9. **Q9: Meal capture friction** — three options:
   - (a) She voice-logs at cook time ("I'm making chicken curry") and at discard time ("we tossed the rest of the curry")
   - (b) She voice-logs only at discard ("we threw out the leftover curry") and HARSH infers backwards
   - (c) End of week, HARSH asks "what meals did you make this week?" and she reels them off
   - I lean (b) — least-friction; (c) as a fallback. *(Affects: voice intent design and what the display nudges, if anything.)*

10. **Q10: Receipt review UX** — for receipts with 30+ line items, do you want per-item review cards (slow but precise) OR a batched "did we get it right? quick scroll to fix" pass? I'd default batched.

11. **Q11: Spending report tone** — confronting ("you went $80 over groceries; alcohol was up 40%") or neutral ("groceries: $X / target $Y; alcohol category 4-week avg up from $A to $B")? Spouse-specific tone matters here. *(I'd default neutral with no editorializing.)*

---

## 10. Phasing — Revised

**H1 — Recipes v1** ✅ landed

**H2 — Inventory + Waste foundation**
- Categories table + items + extended events
- waste_events table
- Voice intents: out_of / have / query / waste.log
- Brain dump recognizes implicit waste lines
- Portal `/inventory` page (categorized grid)
- Portal `/waste` log view
- Display briefing surfacing low-stock + this-week's waste callout

**H3 — Receipts + Finances**
- expenses + expense_items + budgets tables
- `receipt-ocr` Edge Function
- Receipt review UX (batched)
- Budgets editor in Settings
- Receipt → inventory cascade
- Weekly spending + waste report (Sunday 19:00 cron)
- Display "This Week" view

**H4 — Meals as financial units**
- recipe_ingredients + meal_events tables
- Recipe v2: auto-cost from matched ingredients
- Voice: meal.cooked / meal.discarded
- Weekly meal-waste section of the report

**H5 — Polish**
- Recipe Vision text extraction
- Trend charts (4-week rolling, monthly)
- Bank connection (Plaid) — only if receipt OCR proves laborious
