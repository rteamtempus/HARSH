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

  /**
   * Fires the sync edge function for one account. Routes by kind so the same
   * call works for ICS, Google, etc.
   */
  async syncAccount(account: { id: string; kind: string }): Promise<unknown> {
    const fn = account.kind === 'google' ? 'gcal-sync' : 'sync-ics';
    const { data, error } = await this.supabase.functions.invoke(fn, {
      body: { calendar_account_id: account.id },
    });
    if (error) throw error;
    return data;
  }

  /**
   * Build the Google OAuth authorization URL. Caller redirects to it; Google
   * redirects back to `redirectUri` with `?code=...` which the callback route
   * passes to `exchangeGoogleCode`.
   */
  googleOauthUrl(input: { clientId: string; redirectUri: string; state?: string }): string {
    const params = new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email',
      // offline + consent guarantees a refresh_token even on repeat grants.
      access_type: 'offline',
      prompt: 'consent',
      state: input.state ?? '',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Hand the authorization code to the edge function. The function exchanges
   * it server-side (so the client secret never reaches the browser), creates
   * a calendar_accounts row, and returns the new id.
   */
  async exchangeGoogleCode(input: { code: string; redirectUri: string; name?: string; color?: string }) {
    const { data, error } = await this.supabase.functions.invoke<{
      calendar_account_id: string;
      external_calendar_id: string;
      email: string;
    }>('gcal-oauth-exchange', {
      body: {
        code: input.code,
        redirect_uri: input.redirectUri,
        name: input.name,
        color: input.color,
      },
    });
    if (error) throw error;
    if (!data) throw new Error('empty response');
    return data;
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
