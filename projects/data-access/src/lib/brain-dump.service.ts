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

// ===== Domain types =====

export type BrainDumpMode = 'capture' | 'query' | 'follow_up';

export type BrainDumpItem =
  | {
      type: 'list_item';
      list_name: string;          // best match against an existing list, OR a brand-new list name
      text: string;
      notes?: string;
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

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['list_item', 'event', 'routine', 'household_fact', 'context_note'],
    },
    list_name: { type: 'string', description: 'Best-match list name, or new list to propose.' },
    text: { type: 'string' },
    title: { type: 'string' },
    name: { type: 'string' },
    key: { type: 'string' },
    value: { type: 'string' },
    content: { type: 'string' },
    notes: { type: 'string' },
    deadline: { type: 'string', description: 'ISO 8601 timestamp' },
    starts_at: { type: 'string', description: 'ISO 8601 timestamp; resolve relative dates' },
    ends_at: { type: 'string', description: 'ISO 8601 timestamp' },
    all_day: { type: 'boolean' },
    location: { type: 'string' },
    category: { type: 'string' },
    cadence_type: { type: 'string', enum: ['interval', 'calendar'] },
    interval_days: { type: 'integer' },
    cadence_rrule: { type: 'string', description: 'RFC5545 rrule string' },
    note_type: {
      type: 'string',
      enum: ['emotional', 'situational', 'privacy_restriction', 'celebration'],
    },
    expires_at: { type: 'string', description: 'ISO 8601 timestamp, max 30d from now' },
    suppress_topics: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string', description: 'Quote or paraphrase from the dump that prompted this item' },
  },
  required: ['type'],
};

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
      'When extracting:',
      '- list_item: route to an existing list by name when possible. Match case-insensitively.',
      '  Only invent a new list name when nothing fits.',
      '- event: a specific scheduled time/place. starts_at must be a real ISO timestamp.',
      '  Resolve relative dates ("next Tuesday at 10am") against today + timezone.',
      '- routine: a recurring obligation without a specific time ("trash on Fridays", "mow every 7 days").',
      '  Prefer cadence_type=interval with interval_days for "every N days".',
      '  Use cadence_type=calendar with a cadence_rrule for weekday/monthly patterns.',
      '- household_fact: a durable fact ("our pediatrician is Dr. X", "trash bin is the green one").',
      '- context_note: time-bounded situational/emotional context that should influence briefing tone.',
      '  expires_at MUST be within 30 days of now.',
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

    const result = await this.llm.generateStructured<BrainDumpResult>(prompt, {
      tier: 'fast',
      system,
      schema: RESPONSE_SCHEMA,
      intentLabel: 'brain_dump',
      maxOutputTokens: 2048,
    });

    const parsed = result.data;
    return {
      mode: parsed.mode,
      reply: parsed.reply,
      items: parsed.items ?? [],
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
        await this.lists.addItem(list.id, item.text, ctx.familyId, ctx.memberId ?? null);
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
