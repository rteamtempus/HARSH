import { Injectable, inject } from '@angular/core';
import { SUPABASE } from './supabase.client';
import { Database } from './database.types';
import { FamilyService } from './family.service';

export type MemberRow = Database['public']['Tables']['family_members']['Row'];
export type MemberRole = Database['public']['Enums']['family_member_role'];

export interface NewMember {
  display_name: string;
  color: string;
  role?: MemberRole;
  invited_email?: string | null;
}

@Injectable({ providedIn: 'root' })
export class MemberService {
  private readonly supabase = inject(SUPABASE);
  private readonly family = inject(FamilyService);

  async addMember(input: NewMember): Promise<void> {
    const fam = this.family.family();
    if (!fam) throw new Error('No family loaded');
    const { error } = await this.supabase.from('family_members').insert({
      family_id: fam.id,
      display_name: input.display_name.trim(),
      color: input.color,
      role: input.role ?? 'adult',
      invited_email: input.invited_email?.trim().toLowerCase() || null,
    });
    if (error) throw error;
    await this.family.refreshMembers(fam.id);
  }

  async updateMember(id: string, patch: Partial<NewMember>): Promise<void> {
    const fam = this.family.family();
    if (!fam) throw new Error('No family loaded');
    const update: Partial<MemberRow> = {};
    if (patch.display_name !== undefined) update.display_name = patch.display_name.trim();
    if (patch.color !== undefined) update.color = patch.color;
    if (patch.role !== undefined) update.role = patch.role;
    if (patch.invited_email !== undefined) {
      update.invited_email = patch.invited_email?.trim().toLowerCase() || null;
    }
    const { error } = await this.supabase
      .from('family_members')
      .update(update)
      .eq('id', id);
    if (error) throw error;
    await this.family.refreshMembers(fam.id);
  }

  async removeMember(id: string): Promise<void> {
    const fam = this.family.family();
    if (!fam) throw new Error('No family loaded');
    const { error } = await this.supabase.from('family_members').delete().eq('id', id);
    if (error) throw error;
    await this.family.refreshMembers(fam.id);
  }
}
