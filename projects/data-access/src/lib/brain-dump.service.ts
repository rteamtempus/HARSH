// Brain-dump primary capture flow — see FEATURES.md §2.1.1.
//
// Flow:
//   1. parse(transcript, ctx) → asks LLM to classify (capture / query / follow_up)
//      and, for capture, extract structured items per data type.
//   2. UI shows per-item review cards. User confirms / edits / skips each.
//      Prominent "Confirm All" path for trusted parses.
//   3. execute(decisions) → routes confirmed items to the right service.
//
// Multi-turn within a single dump is supported via the optional `prior` context —
// the previous transcript and the LLM's follow-up question travel back in.
// Context is cleared by the caller on commit / app background.

import { Injectable, inject } from '@angular/core';
import {
  LLM_ADAPTER,
  type LlmAdapter,
} from './adapters/llm.adapter';
import { ListService } from './list.service';
import { EventService } from './event.service';
import { RoutineService } from './routine.service';
import { HouseholdFactsService } from './household-facts.service';
import { ContextNotesService } from './context-notes.service';
import { InventoryService } from './inventory.service';
import { WasteService } from './waste.service';

// ===== Domain types =====

export type BrainDumpMode = 'capture' | 'query' | 'follow_up';

export type BrainDumpItem =
  | {
      type: 'list_item';
      list_name: string;          // best match against an existing list, OR a brand-new list name
      text: string;
      notes?: string;
      category?: string;          // free-text; for grocery items, matches inventory category
      deadline?: string;          // ISO timestamp
      reasoning?: string;
    }
  | {
      type: 'event';
      title: string;
      starts_at: string;          // ISO timestamp
      ends_at?: string;
      all_day?: boolean;
      location?: string;
      notes?: string;
      reasoning?: string;
    }
  | {
      type: 'routine';
      name: string;
      category?: string;
      cadence_type: 'interval' | 'calendar';
      interval_days?: number;     // when cadence_type=interval
      cadence_rrule?: string;     // when cadence_type=calendar
      notes?: string;
      reasoning?: string;
    }
  | {
      type: 'household_fact';
      key: string;
      value: string;
      category?: string;
      reasoning?: string;
    }
  | {
      type: 'context_note';
      content: string;
      note_type: 'emotional' | 'situational' | 'privacy_restriction' | 'celebration';
      expires_at: string;         // ISO timestamp, max 30d
      suppress_topics?: string[];
      reasoning?: string;
    }
  | {
      type: 'waste_event';
      name: string;
      reason: 'spoiled' | 'disliked' | 'leftover_not_eaten' | 'accident' | 'not_worth_it' | 'other';
      percentage_wasted?: number;          // 0-100; defaults to 100
      quantity_text?: string;              // "half a loaf", "two slices"
      estimated_value_cents?: number;      // when set, used as the value
      reasoning?: string;
    };

export interface BrainDumpResult {
  mode: BrainDumpMode;
  reply: string;
  items: BrainDumpItem[];
}

export interface BrainDumpContext {
  familyId: string;
  familyName?: string;
  timezone?: string;
  memberId?: string | null;
  lists: { id: string; name: string }[];
  members: { id: string; display_name: string }[];
  profiles: { id: string; name: string; kind: string }[];
  /** Optional snapshot used for query mode. */
  snapshot?: {
    items?: { list_name: string; text: string; checked: boolean }[];
    upcomingEvents?: { title: string; starts_at: string }[];
    facts?: { key: string; value: string }[];
  };
  /** Optional prior turn for multi-turn. */
  prior?: { transcript: string; reply: string };
}

export type ItemDecision =
  | { action: 'skip' }
  | { action: 'confirm'; edited?: BrainDumpItem };

export interface ExecutionSummary {
  applied: number;
  skipped: number;
  errors: { index: number; message: string }[];
}

// ===== JSON schema given to Gemini =====

// NOTE: `label` is a single REQUIRED field that carries the primary text for
// every item type. Gemini reliably populates required fields; it was dropping
// the old per-type optional fields (text / title / name / content), producing
// "undefined" items. `value` is only used by household_fact (label = the key).
// normalizeWireItem() maps this flat shape back into the typed BrainDumpItem.
const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['list_item', 'event', 'routine', 'household_fact', 'context_note', 'waste_event'],
    },
    label: {
      type: 'string',
      description:
        'The primary text. ALWAYS fill this. list_item: the item text. event: the title. ' +
        'routine: the routine name. household_fact: the fact key/name. context_note: the note content.',
    },
    value: { type: 'string', description: 'household_fact only: the fact value.' },
    list_name: { type: 'string', description: 'list_item only: best-match existing list, or a new list name.' },
    notes: { type: 'string' },
    deadline: { type: 'string', description: 'list_item only: ISO 8601 timestamp' },
    starts_at: { type: 'string', description: 'event only: ISO 8601 timestamp; resolve relative dates' },
    ends_at: { type: 'string', description: 'event only: ISO 8601 timestamp' },
    all_day: { type: 'boolean' },
    location: { type: 'string' },
    category: { type: 'string' },
    cadence_type: { type: 'string', enum: ['interval', 'calendar'], description: 'routine only' },
    interval_days: { type: 'integer', description: 'routine, cadence_type=interval' },
    cadence_rrule: { type: 'string', description: 'routine, cadence_type=calendar: RFC5545 rrule' },
    note_type: {
      type: 'string',
      enum: ['emotional', 'situational', 'privacy_restriction', 'celebration'],
      description: 'context_note only',
    },
    expires_at: { type: 'string', description: 'context_note only: ISO 8601, max 30d from now' },
    suppress_topics: { type: 'array', items: { type: 'string' } },
    reason: {
      type: 'string',
      enum: ['spoiled', 'disliked', 'leftover_not_eaten', 'accident', 'not_worth_it', 'other'],
      description: 'waste_event only',
    },
    percentage_wasted: {
      type: 'integer',
      description: 'waste_event only: 0-100; 100 = whole item, 50 = half used',
    },
    quantity_text: {
      type: 'string',
      description: 'waste_event only: "half a loaf", "two slices", etc.',
    },
    estimated_value_cents: {
      type: 'integer',
      description: 'waste_event only: when known. Otherwise leave blank and the executor estimates.',
    },
    reasoning: { type: 'string', description: 'Short quote from the dump that prompted this item' },
  },
  required: ['type', 'label'],
  propertyOrdering: [
    'type', 'label', 'value', 'list_name', 'starts_at', 'ends_at', 'all_day',
    'location', 'category', 'cadence_type', 'interval_days', 'cadence_rrule',
    'note_type', 'expires_at', 'suppress_topics', 'deadline', 'notes', 'reasoning',
  ],
};

/**
 * Map the flat wire item (with a single `label`) into the typed BrainDumpItem
 * the executor + describe() expect. Returns null for an item missing its
 * required primary text so the caller can drop it rather than create
 * "undefined" rows.
 */
export function normalizeWireItem(raw: any): BrainDumpItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const label = (raw.label ?? '').toString().trim();
  if (!label && raw.type !== 'household_fact') return null;
  const reasoning = raw.reasoning;
  switch (raw.type) {
    case 'list_item':
      return { type: 'list_item', list_name: raw.list_name || 'To Do', text: label, notes: raw.notes, category: raw.category, deadline: raw.deadline, reasoning };
    case 'event':
      if (!raw.starts_at) return null;
      return { type: 'event', title: label, starts_at: raw.starts_at, ends_at: raw.ends_at, all_day: raw.all_day, location: raw.location, notes: raw.notes, reasoning };
    case 'routine': {
      const cadence_type = raw.cadence_type === 'calendar' ? 'calendar' : 'interval';
      return { type: 'routine', name: label, category: raw.category, cadence_type, interval_days: raw.interval_days, cadence_rrule: raw.cadence_rrule, notes: raw.notes, reasoning };
    }
    case 'household_fact':
      if (!raw.value) return null;
      return { type: 'household_fact', key: label, value: raw.value, category: raw.category, reasoning };
    case 'context_note':
      if (!raw.expires_at) return null;
      return { type: 'context_note', content: label, note_type: raw.note_type ?? 'situational', expires_at: raw.expires_at, suppress_topics: raw.suppress_topics, reasoning };
    case 'waste_event':
      return {
        type: 'waste_event',
        name: label,
        reason: raw.reason ?? 'other',
        percentage_wasted: raw.percentage_wasted,
        quantity_text: raw.quantity_text,
        estimated_value_cents: raw.estimated_value_cents,
        reasoning,
      };
    default:
      return null;
  }
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['capture', 'query', 'follow_up'] },
    reply: {
      type: 'string',
      description:
        'For query: the answer. For follow_up: the clarifying question. For capture: a short confirmation summary.',
    },
    items: { type: 'array', items: ITEM_SCHEMA },
  },
  required: ['mode', 'reply'],
};

// ===== Service =====

@Injectable({ providedIn: 'root' })
export class BrainDumpService {
  private readonly llm = inject<LlmAdapter>(LLM_ADAPTER);
  private readonly lists = inject(ListService);
  private readonly events = inject(EventService);
  private readonly routines = inject(RoutineService);
  private readonly facts = inject(HouseholdFactsService);
  private readonly contextNotes = inject(ContextNotesService);
  private readonly inventory = inject(InventoryService);
  private readonly waste = inject(WasteService);

  async parse(transcript: string, ctx: BrainDumpContext): Promise<BrainDumpResult> {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const tz = ctx.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

    const system = [
      'You are the capture assistant for a family household-management app.',
      'You parse free-form text ("brain dumps") into structured items, OR you answer questions about the household.',
      'You always speak in the calm, warm partner voice — no exclamation points, no pep, no participation-trophy phrases.',
      '',
      'Modes:',
      '- "capture": user is stating things to remember (to-dos, events, routines, facts, situational context). Extract items.',
      '- "query": user is asking a question. Answer it conversationally using the snapshot provided.',
      '- "follow_up": the dump is ambiguous and you need ONE clarifying question to proceed. Set reply to your question and leave items empty.',
      '',
      'EVERY item MUST have a non-empty "label" — it is the primary text of the item. Never leave it blank.',
      '',
      'When extracting (set "label" to the bracketed thing):',
      '- list_item: label = [the item, e.g. "milk"]. Set list_name to an existing list (match case-insensitively) or a new one.',
      '  Optional `category` field (text): use it especially on grocery items when an inventory category matches (e.g. "Pantry", "Fridge", "Alcohol").',
      '  Optional `notes` field: any context the user added ("the brand she likes", "make sure unsweetened").',
      '- event: label = [the title]. starts_at must be a real ISO timestamp; resolve relative dates against today + timezone.',
      '- routine: label = [the routine name, e.g. "Mow lawn"]. A recurring obligation without a specific time.',
      '  Prefer cadence_type=interval + interval_days for "every N days". Use cadence_type=calendar + cadence_rrule for weekday/monthly patterns.',
      '- household_fact: label = [the fact key/name, e.g. "pediatrician"], value = [the detail, e.g. "Dr. X, (555) 123-4567"].',
      '- context_note: label = [the note content]. Time-bounded situational/emotional context; expires_at MUST be within 30 days.',
      '- waste_event: ONLY when the user explicitly says something was thrown out, discarded, expired, spoiled, didn\'t get eaten, etc.',
      '  label = [the thing wasted, e.g. "moldy bread", "the chicken curry leftovers"].',
      '  reason: spoiled / disliked / leftover_not_eaten / accident / not_worth_it / other (pick the closest fit).',
      '  percentage_wasted: 0-100. Default 100. Use lower when user says "half-used", "almost empty", etc.',
      '  Do NOT confuse this with list_items — "we need bread" is a list_item, "we threw out the moldy bread" is a waste_event.',
      '',
      'Never extract emotional-processing chatter, jokes, or filler as actionable items.',
      'For each extracted item, set "reasoning" to a short quote from the user that prompted the item.',
    ].join('\n');

    const userParts: string[] = [
      `Today is ${today}. Family timezone: ${tz}.`,
      `Current lists: ${ctx.lists.map((l) => l.name).join(', ') || '(none yet)'}`,
      `Family members: ${ctx.members.map((m) => m.display_name).join(', ') || '(none)'}`,
      `Profiles: ${ctx.profiles.map((p) => `${p.name} (${p.kind})`).join(', ') || '(none)'}`,
    ];

    if (ctx.snapshot) {
      const s = ctx.snapshot;
      if (s.items?.length) {
        userParts.push(
          `Open list items (sample): ${s.items
            .filter((i) => !i.checked)
            .slice(0, 30)
            .map((i) => `[${i.list_name}] ${i.text}`)
            .join('; ')}`,
        );
      }
      if (s.upcomingEvents?.length) {
        userParts.push(
          `Upcoming events: ${s.upcomingEvents
            .slice(0, 10)
            .map((e) => `${e.title} @ ${e.starts_at}`)
            .join('; ')}`,
        );
      }
      if (s.facts?.length) {
        userParts.push(
          `Household facts: ${s.facts
            .slice(0, 30)
            .map((f) => `${f.key}=${f.value}`)
            .join('; ')}`,
        );
      }
    }

    if (ctx.prior) {
      userParts.push(`\nPrior turn — you asked: "${ctx.prior.reply}"`);
      userParts.push(`User originally said: "${ctx.prior.transcript}"`);
      userParts.push('Now they said:');
    } else {
      userParts.push('\nUser said:');
    }
    userParts.push(transcript);

    const prompt = userParts.join('\n');

    const result = await this.llm.generateStructured<{ mode: BrainDumpMode; reply: string; items?: any[] }>(prompt, {
      tier: 'fast',
      system,
      schema: RESPONSE_SCHEMA,
      intentLabel: 'brain_dump',
      maxOutputTokens: 2048,
    });

    const parsed = result.data;
    // Normalize the flat wire items into typed BrainDumpItems; drop any that
    // are missing their required primary text.
    const items = (parsed.items ?? [])
      .map(normalizeWireItem)
      .filter((i): i is BrainDumpItem => i !== null);
    return {
      mode: parsed.mode,
      reply: parsed.reply,
      items,
    };
  }

  /**
   * Execute confirmed items against their respective services.
   * Decisions[i] applies to items[i]. Returns a summary; per-item errors are
   * captured so a partial failure doesn't abort the whole batch.
   */
  async execute(
    items: BrainDumpItem[],
    decisions: ItemDecision[],
    ctx: { familyId: string; memberId?: string | null },
  ): Promise<ExecutionSummary> {
    const summary: ExecutionSummary = { applied: 0, skipped: 0, errors: [] };

    for (let i = 0; i < items.length; i++) {
      const decision = decisions[i] ?? { action: 'skip' };
      if (decision.action === 'skip') {
        summary.skipped++;
        continue;
      }
      const item = decision.edited ?? items[i];
      try {
        await this.applyOne(item, ctx);
        summary.applied++;
      } catch (e: unknown) {
        summary.errors.push({
          index: i,
          message: (e as Error)?.message ?? String(e),
        });
      }
    }

    return summary;
  }

  private async applyOne(
    item: BrainDumpItem,
    ctx: { familyId: string; memberId?: string | null },
  ): Promise<void> {
    switch (item.type) {
      case 'list_item': {
        let list = this.lists.findByName(item.list_name);
        if (!list) {
          list = await this.lists.createList(ctx.familyId, item.list_name);
        }
        await this.lists.addItem(list.id, item.text, ctx.familyId, ctx.memberId ?? null, {
          notes: item.notes,
          category: item.category,
        });
        return;
      }
      case 'event': {
        await this.events.create({
          familyId: ctx.familyId,
          title: item.title,
          startsAt: item.starts_at,
          endsAt: item.ends_at ?? null,
          allDay: item.all_day ?? false,
          location: item.location ?? null,
          notes: item.notes ?? null,
          ownerMemberId: ctx.memberId ?? null,
          source: 'voice',
        });
        return;
      }
      case 'routine': {
        const insert: any = {
          family_id: ctx.familyId,
          name: item.name,
          category: item.category ?? null,
          cadence_type: item.cadence_type,
          notes: item.notes ?? null,
        };
        if (item.cadence_type === 'interval') {
          if (!item.interval_days) throw new Error('routine missing interval_days');
          insert.interval_days = item.interval_days;
        } else {
          if (!item.cadence_rrule) throw new Error('routine missing cadence_rrule');
          insert.cadence_rrule = item.cadence_rrule;
        }
        await this.routines.create(insert);
        return;
      }
      case 'household_fact': {
        await this.facts.set(ctx.familyId, item.key, item.value, {
          category: item.category,
          source: 'voice',
        });
        return;
      }
      case 'context_note': {
        await this.contextNotes.create({
          familyId: ctx.familyId,
          content: item.content,
          type: item.note_type,
          expiresAt: item.expires_at,
          suppressTopics: item.suppress_topics,
          createdByMemberId: ctx.memberId ?? undefined,
        });
        return;
      }
      case 'waste_event': {
        // Best-effort inventory match for cost. If unmatched and no LLM-
        // provided value, the row gets null estimated value — the report
        // tolerates missing costs.
        const resolution = this.inventory.resolveForVoice(item.name);
        let itemId: string | null = null;
        let estimatedValue: number | null = item.estimated_value_cents ?? null;
        if (resolution.kind === 'item') {
          itemId = resolution.item.id;
          if (estimatedValue == null && resolution.item.typical_price_cents) {
            const pct = item.percentage_wasted ?? 100;
            estimatedValue = Math.round((pct / 100) * resolution.item.typical_price_cents);
          }
        }
        await this.waste.log({
          familyId: ctx.familyId,
          itemId,
          freeTextName: itemId ? null : item.name,
          reason: item.reason,
          percentage: item.percentage_wasted ?? 100,
          estimatedValueCents: estimatedValue,
          quantityText: item.quantity_text ?? null,
          source: 'brain_dump',
          memberId: ctx.memberId ?? null,
          note: item.reasoning ?? null,
        });
        return;
      }
    }
  }

  /**
   * Friendly one-liner summary of an item — for confirmation cards.
   * Caller can override per-type if it wants richer rendering.
   */
  static describe(item: BrainDumpItem): string {
    switch (item.type) {
      case 'list_item':
        return `Add “${item.text}” to ${item.list_name}`;
      case 'event': {
        const when = formatWhen(item.starts_at);
        return `Schedule “${item.title}” ${when}${item.location ? ' at ' + item.location : ''}`;
      }
      case 'routine':
        return item.cadence_type === 'interval'
          ? `Routine: ${item.name} every ${item.interval_days} day${item.interval_days === 1 ? '' : 's'}`
          : `Routine: ${item.name} (${item.cadence_rrule})`;
      case 'household_fact':
        return `Remember: ${item.key} → ${item.value}`;
      case 'context_note': {
        const exp = formatWhen(item.expires_at);
        return `Context note (${item.note_type}): ${item.content} — until ${exp}`;
      }
      case 'waste_event': {
        const pct = item.percentage_wasted ?? 100;
        const value = item.estimated_value_cents != null
          ? ` (~$${(item.estimated_value_cents / 100).toFixed(2)})`
          : '';
        const pctTag = pct < 100 ? ` (${pct}%)` : '';
        return `Wasted: ${item.name}${pctTag} · ${item.reason.replace(/_/g, ' ')}${value}`;
      }
    }
  }
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
