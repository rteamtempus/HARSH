import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE } from './supabase.client';
import { Database } from './database.types';
import { initialNextDue } from './routine-occurrences';

export type RoutineRow = Database['public']['Tables']['routines']['Row'];
export type RoutineInsert = Database['public']['Tables']['routines']['Insert'];
export type RoutineUpdate = Database['public']['Tables']['routines']['Update'];
export type RoutineHistoryRow = Database['public']['Tables']['routine_history']['Row'];

/**
 * Family-scoped routines + history. Mirrors the shape of ListService:
 * caller invokes load(familyId) once, then realtime keeps signals in sync.
 *
 * Complete / skip / snooze / pause / resume go through Postgres RPCs that
 * mutate routines AND log routine_history atomically — see
 * supabase/migrations/20260524020000_routine_actions_and_events_assignee.sql.
 */
@Injectable({ providedIn: 'root' })
export class RoutineService {
  private readonly supabase = inject(SUPABASE);

  readonly routines = signal<RoutineRow[]>([]);
  readonly history = signal<RoutineHistoryRow[]>([]);

  private channel: RealtimeChannel | null = null;
  private currentFamilyId: string | null = null;

  async load(familyId: string): Promise<RoutineRow[]> {
    const { data, error } = await this.supabase
      .from('routines')
      .select('*')
      .eq('family_id', familyId)
      .order('next_due', { ascending: true, nullsFirst: true });
    if (error) throw error;
    this.routines.set(data ?? []);
    this.subscribe(familyId);
    return data ?? [];
  }

  /** Recent history (newest first) — used by "when did we last…" queries + briefing context. */
  async loadHistory(familyId: string, limit = 50): Promise<RoutineHistoryRow[]> {
    const { data, error } = await this.supabase
      .from('routine_history')
      .select('*')
      .eq('family_id', familyId)
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    this.history.set(data ?? []);
    return data ?? [];
  }

  async create(input: RoutineInsert): Promise<RoutineRow> {
    // Compute an initial next_due so the routine surfaces in briefings + the
    // calendar right away, rather than staying invisible until first completion.
    const withDue: RoutineInsert = input.next_due
      ? input
      : {
          ...input,
          next_due: initialNextDue({
            cadence_type: input.cadence_type,
            interval_days: input.interval_days,
            cadence_rrule: input.cadence_rrule,
          }) ?? undefined,
        };
    const { data, error } = await this.supabase
      .from('routines')
      .insert(withDue)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, patch: RoutineUpdate): Promise<RoutineRow> {
    const { data, error } = await this.supabase
      .from('routines')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.from('routines').delete().eq('id', id);
    if (error) throw error;
  }

  // ===== Actions (RPC-backed, atomic with history logging) =====

  /** Mark routine done. Returns new next_due. */
  async complete(routineId: string, opts: { memberId?: string; note?: string; nextDue?: string } = {}) {
    const { data, error } = await this.supabase.rpc('routine_complete', {
      p_routine_id: routineId,
      p_member_id: opts.memberId ?? undefined,
      p_note: opts.note ?? undefined,
      p_next_due: opts.nextDue ?? undefined,
    });
    if (error) throw error;
    return data as string;
  }

  /** Skip this instance — still advances cadence, logged as 'skipped'. */
  async skip(routineId: string, opts: { memberId?: string; note?: string; nextDue?: string } = {}) {
    const { data, error } = await this.supabase.rpc('routine_skip', {
      p_routine_id: routineId,
      p_member_id: opts.memberId ?? undefined,
      p_note: opts.note ?? undefined,
      p_next_due: opts.nextDue ?? undefined,
    });
    if (error) throw error;
    return data as string;
  }

  /** Push next_due forward N days without skipping. */
  async snooze(routineId: string, days = 1, opts: { memberId?: string; note?: string } = {}) {
    const { data, error } = await this.supabase.rpc('routine_snooze', {
      p_routine_id: routineId,
      p_days: days,
      p_member_id: opts.memberId ?? undefined,
      p_note: opts.note ?? undefined,
    });
    if (error) throw error;
    return data as string;
  }

  /** Suspend routine until `until` (YYYY-MM-DD). */
  async pause(routineId: string, until: string, reason?: string) {
    const { error } = await this.supabase.rpc('routine_pause', {
      p_routine_id: routineId,
      p_until: until,
      p_reason: reason ?? undefined,
    });
    if (error) throw error;
  }

  async resume(routineId: string) {
    const { error } = await this.supabase.rpc('routine_resume', { p_routine_id: routineId });
    if (error) throw error;
  }

  // ===== Realtime =====

  private subscribe(familyId: string) {
    if (this.currentFamilyId === familyId && this.channel) return;
    this.unsubscribe();
    this.currentFamilyId = familyId;

    this.channel = this.supabase
      .channel(`routines:${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'routines', filter: `family_id=eq.${familyId}` },
        () => this.reloadRoutines(familyId),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'routine_history', filter: `family_id=eq.${familyId}` },
        () => this.loadHistory(familyId),
      )
      .subscribe();
  }

  private async reloadRoutines(familyId: string) {
    const { data } = await this.supabase
      .from('routines')
      .select('*')
      .eq('family_id', familyId)
      .order('next_due', { ascending: true, nullsFirst: true });
    if (data) this.routines.set(data);
  }

  unsubscribe() {
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.currentFamilyId = null;
  }
}
