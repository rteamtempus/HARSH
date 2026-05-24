import { Injectable, inject, signal } from '@angular/core';
import { SUPABASE } from './supabase.client';
import { Database } from './database.types';

type FamilyRow = Database['public']['Tables']['families']['Row'];
type MemberRow = Database['public']['Tables']['family_members']['Row'];

export interface MemberSeed {
  display_name: string;
  color: string;
  role?: 'owner' | 'adult' | 'kid';
  invited_email?: string;
}

export function detectTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch { return 'UTC'; }
}

@Injectable({ providedIn: 'root' })
export class FamilyService {
  private readonly supabase = inject(SUPABASE);

  readonly family = signal<FamilyRow | null>(null);
  readonly members = signal<MemberRow[]>([]);
  readonly me = signal<MemberRow | null>(null);

  /** Loads the first family the current user belongs to, plus all members. */
  async loadCurrent(): Promise<FamilyRow | null> {
    const { data: families, error } = await this.supabase
      .from('families')
      .select('*')
      .limit(1);
    if (error) throw error;
    const fam = families?.[0] ?? null;
    this.family.set(fam);
    if (!fam) {
      this.members.set([]);
      this.me.set(null);
      return null;
    }
    await this.refreshMembers(fam.id);
    return fam;
  }

  /**
   * Read a voice-settings slice from `families.settings` jsonb.
   * Family-level setting (FEATURES.md §5.4): one assistant voice for the household,
   * used by every device. Returns null when unset (caller picks a default voice).
   */
  voiceSettings(): { provider: string; voiceId: string } | null {
    const settings = (this.family()?.settings ?? {}) as Record<string, unknown>;
    const voice = settings['voice'] as { provider?: string; voice_id?: string } | undefined;
    if (!voice?.provider || !voice?.voice_id) return null;
    return { provider: voice.provider, voiceId: voice.voice_id };
  }

  /** Persist voice settings into `families.settings.voice`. */
  async updateVoiceSettings(provider: string, voiceId: string): Promise<void> {
    const fam = this.family();
    if (!fam) throw new Error('No family loaded');
    const current = (fam.settings ?? {}) as Record<string, unknown>;
    const nextSettings = { ...current, voice: { provider, voice_id: voiceId } };
    const { data, error } = await this.supabase
      .from('families')
      .update({ settings: nextSettings })
      .eq('id', fam.id)
      .select('*')
      .single();
    if (error) throw error;
    this.family.set(data);
  }

  /**
   * Quiet hours (FEATURES.md §7.1): household-level, default 21:00-07:00.
   * Stored in families.settings.quiet_hours = { start: 'HH:MM', end: 'HH:MM' }.
   * Times are interpreted in the family's IANA time zone.
   */
  quietHours(): { start: string; end: string } {
    const settings = (this.family()?.settings ?? {}) as Record<string, unknown>;
    const qh = settings['quiet_hours'] as { start?: string; end?: string } | undefined;
    return { start: qh?.start ?? '21:00', end: qh?.end ?? '07:00' };
  }

  async updateQuietHours(start: string, end: string): Promise<void> {
    const fam = this.family();
    if (!fam) throw new Error('No family loaded');
    const current = (fam.settings ?? {}) as Record<string, unknown>;
    const nextSettings = { ...current, quiet_hours: { start, end } };
    const { data, error } = await this.supabase
      .from('families')
      .update({ settings: nextSettings })
      .eq('id', fam.id)
      .select('*')
      .single();
    if (error) throw error;
    this.family.set(data);
  }

  /**
   * True when current wall-clock time (in the family's tz) is inside the quiet
   * hours window. Handles wraparound (21:00 → 07:00 spans midnight). Used by
   * the display + briefing renderer to suppress non-assertive surfacing.
   */
  isInQuietHours(now: Date = new Date()): boolean {
    const { start, end } = this.quietHours();
    const tz = this.timeZone();
    const local = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
    }).format(now);
    if (start <= end) return local >= start && local < end;
    return local >= start || local < end;
  }

  /** Update the family's IANA time zone. */
  async updateTimeZone(timeZone: string): Promise<void> {
    const fam = this.family();
    if (!fam) throw new Error('No family loaded');
    const { data, error } = await this.supabase
      .from('families')
      .update({ time_zone: timeZone })
      .eq('id', fam.id)
      .select('*')
      .single();
    if (error) throw error;
    this.family.set(data);
  }

  /** Convenience: today's family-tz IANA name, or browser fallback. */
  timeZone(): string {
    return (this.family()?.time_zone as string | undefined) || detectTz();
  }

  async refreshMembers(familyId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('family_members')
      .select('*')
      .eq('family_id', familyId);
    if (error) throw error;
    const members = data ?? [];
    this.members.set(members);
    const userId = (await this.supabase.auth.getUser()).data.user?.id;
    this.me.set(members.find((m) => m.user_id === userId) ?? null);
  }

  /**
   * One-shot: create a family with seeded members, linking the current auth user
   * to the member whose display_name matches `ownerDisplayName` (case-insensitive).
   */
  async createFamily(
    name: string,
    seeds: MemberSeed[],
    ownerDisplayName: string,
    timeZone?: string
  ): Promise<FamilyRow> {
    const { data: newId, error: rpcErr } = await this.supabase.rpc('create_family', {
      family_name: name,
      members: seeds as unknown as Database['public']['Functions']['create_family']['Args']['members'],
      owner_display_name: ownerDisplayName,
      time_zone: timeZone ?? detectTz(),
    });
    if (rpcErr) throw rpcErr;

    const { data: famData, error: famErr } = await this.supabase
      .from('families')
      .select('*')
      .eq('id', newId as unknown as string)
      .single();
    if (famErr) throw famErr;

    this.family.set(famData);
    await this.refreshMembers(famData.id);
    return famData;
  }
}
