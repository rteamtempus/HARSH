import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE } from './supabase.client';
import { Database } from './database.types';

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

/**
 * Family-scoped profiles — non-auth entities (kids, pets, dependents).
 * §7.3: polymorphic assignee references either family_members.id or profiles.id.
 */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly supabase = inject(SUPABASE);

  readonly profiles = signal<ProfileRow[]>([]);

  private channel: RealtimeChannel | null = null;
  private currentFamilyId: string | null = null;

  async load(familyId: string): Promise<ProfileRow[]> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    this.profiles.set(data ?? []);
    this.subscribe(familyId);
    return data ?? [];
  }

  async create(input: ProfileInsert): Promise<ProfileRow> {
    const { data, error } = await this.supabase
      .from('profiles').insert(input).select('*').single();
    if (error) throw error;
    return data;
  }

  async update(id: string, patch: ProfileUpdate): Promise<ProfileRow> {
    const { data, error } = await this.supabase
      .from('profiles').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    return data;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.from('profiles').delete().eq('id', id);
    if (error) throw error;
  }

  private subscribe(familyId: string) {
    if (this.currentFamilyId === familyId && this.channel) return;
    this.unsubscribe();
    this.currentFamilyId = familyId;
    this.channel = this.supabase
      .channel(`profiles:${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `family_id=eq.${familyId}` },
        () => this.reload(familyId),
      )
      .subscribe();
  }

  private async reload(familyId: string) {
    const { data } = await this.supabase
      .from('profiles').select('*').eq('family_id', familyId).order('created_at');
    if (data) this.profiles.set(data);
  }

  unsubscribe() {
    if (this.channel) { this.supabase.removeChannel(this.channel); this.channel = null; }
    this.currentFamilyId = null;
  }
}
