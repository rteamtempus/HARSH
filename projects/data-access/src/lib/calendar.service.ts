import { Injectable, inject, signal } from '@angular/core';
import { SUPABASE } from './supabase.client';
import { Database } from './database.types';

export type CalendarAccountRow = Database['public']['Tables']['calendar_accounts']['Row'];
export type CalendarAccountKind = Database['public']['Enums']['calendar_account_kind'];

export interface NewCalendarAccount {
  family_id: string;
  member_id?: string | null;
  kind: CalendarAccountKind;
  name: string;
  color?: string;
  ics_url?: string | null;
}

@Injectable({ providedIn: 'root' })
export class CalendarService {
  private readonly supabase = inject(SUPABASE);

  readonly accounts = signal<CalendarAccountRow[]>([]);

  async loadAccounts(familyId: string): Promise<CalendarAccountRow[]> {
    const { data, error } = await this.supabase
      .from('calendar_accounts')
      .select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    this.accounts.set(data ?? []);
    return data ?? [];
  }

  async addAccount(input: NewCalendarAccount): Promise<CalendarAccountRow> {
    const { data, error } = await this.supabase
      .from('calendar_accounts')
      .insert({
        family_id: input.family_id,
        member_id: input.member_id ?? null,
        kind: input.kind,
        name: input.name.trim(),
        color: input.color ?? '#717744',
        ics_url: input.ics_url?.trim() || null,
      })
      .select('*')
      .single();
    if (error) throw error;
    this.accounts.update((list) => [...list, data]);
    return data;
  }

  async updateAccount(
    id: string,
    patch: Partial<Pick<CalendarAccountRow, 'name' | 'color' | 'ics_url' | 'member_id'>>
  ): Promise<void> {
    const { error } = await this.supabase.from('calendar_accounts').update(patch).eq('id', id);
    if (error) throw error;
    this.accounts.update((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  async removeAccount(id: string): Promise<void> {
    const { error } = await this.supabase.from('calendar_accounts').delete().eq('id', id);
    if (error) throw error;
    this.accounts.update((list) => list.filter((a) => a.id !== id));
  }

  /** Fires the sync edge function for one account. Returns the function's response. */
  async syncAccount(id: string): Promise<{ inserted: number; updated: number; deleted: number }> {
    const { data, error } = await this.supabase.functions.invoke('sync-ics', {
      body: { calendar_account_id: id },
    });
    if (error) throw error;
    return data as any;
  }

  /**
   * Refresh every calendar in the family. Used by the display's voice command
   * ("sync my calendars") and any "Sync now" button that wants to hit all
   * accounts at once. The edge function uses the caller's JWT, so RLS still
   * limits the loop to accounts this user can see.
   */
  async syncAll(familyId: string): Promise<{ synced: number; errors: Array<{ account_id: string; error: string }> }> {
    const { data, error } = await this.supabase.functions.invoke('tick-calendar-sync', {
      body: { family_id: familyId },
    });
    if (error) throw error;
    return data as any;
  }
}
