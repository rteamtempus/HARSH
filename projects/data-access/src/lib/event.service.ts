import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE } from './supabase.client';
import { Database } from './database.types';

export type EventRow = Database['public']['Tables']['events']['Row'];

@Injectable({ providedIn: 'root' })
export class EventService {
  private readonly supabase = inject(SUPABASE);

  readonly events = signal<EventRow[]>([]);

  private channel: RealtimeChannel | null = null;
  private currentFamilyId: string | null = null;

  /** Load events from `from` (default now) to `to` (default +60 days) and subscribe. */
  async load(
    familyId: string,
    range?: { from?: Date; to?: Date }
  ): Promise<EventRow[]> {
    const from = (range?.from ?? new Date(Date.now() - 24 * 3600 * 1000)).toISOString();
    const to = (range?.to ?? new Date(Date.now() + 60 * 24 * 3600 * 1000)).toISOString();
    const { data, error } = await this.supabase
      .from('events')
      .select('*')
      .eq('family_id', familyId)
      .gte('starts_at', from)
      .lte('starts_at', to)
      .order('starts_at', { ascending: true });
    if (error) throw error;
    this.events.set(data ?? []);
    this.subscribe(familyId);
    return data ?? [];
  }

  private subscribe(familyId: string): void {
    if (this.currentFamilyId === familyId && this.channel) return;
    this.unsubscribe();
    this.currentFamilyId = familyId;
    this.channel = this.supabase
      .channel(`events:${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'events', filter: `family_id=eq.${familyId}` },
        (payload) => this.apply(payload)
      )
      .subscribe();
  }

  unsubscribe(): void {
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.currentFamilyId = null;
  }

  async create(input: {
    familyId: string;
    title: string;
    startsAt: string;
    endsAt?: string | null;
    allDay?: boolean;
    location?: string | null;
    notes?: string | null;
    ownerMemberId?: string | null;
    assigneeProfileId?: string | null;
    source?: 'manual' | 'voice';
  }): Promise<EventRow> {
    const { data, error } = await this.supabase
      .from('events')
      .insert({
        family_id: input.familyId,
        title: input.title,
        starts_at: input.startsAt,
        ends_at: input.endsAt ?? null,
        all_day: input.allDay ?? false,
        location: input.location ?? null,
        notes: input.notes ?? null,
        owner_member_id: input.ownerMemberId ?? null,
        assignee_profile_id: input.assigneeProfileId ?? null,
        source: input.source ?? 'manual',
      })
      .select('*')
      .single();
    if (error) throw error;
    // Best-effort push to Google. Fire-and-forget — the local row is already
    // there; if the push fails (no google account, token revoked, etc.) the
    // event still works in HARSH. gcal-push no-ops gracefully when there's
    // no google account connected.
    void this.pushToGoogle(data.id);
    return data;
  }

  /**
   * Push a HARSH-native event to the family's connected Google calendar.
   * Called automatically by create(); safe to call again on update for the
   * same event (gcal-push PATCHes when external_id is already set).
   */
  async pushToGoogle(eventId: string): Promise<void> {
    try {
      await this.supabase.functions.invoke('gcal-push', { body: { event_id: eventId } });
    } catch {
      // Swallow — best-effort. The function logs failures in ai_log-style
      // server-side; surfacing here would be noisier than helpful.
    }
  }

  private apply(payload: { eventType: string; new: any; old: any }): void {
    const list = this.events().slice();
    if (payload.eventType === 'INSERT') {
      if (!list.find((e) => e.id === payload.new.id)) list.push(payload.new as EventRow);
    } else if (payload.eventType === 'UPDATE') {
      const i = list.findIndex((e) => e.id === payload.new.id);
      if (i >= 0) list[i] = payload.new as EventRow;
    } else if (payload.eventType === 'DELETE') {
      const i = list.findIndex((e) => e.id === payload.old.id);
      if (i >= 0) list.splice(i, 1);
    }
    list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    this.events.set(list);
  }
}
