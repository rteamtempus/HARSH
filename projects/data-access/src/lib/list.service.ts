import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE } from './supabase.client';
import { Database } from './database.types';

export type ListRow = Database['public']['Tables']['lists']['Row'];
export type ListItemRow = Database['public']['Tables']['list_items']['Row'];

/**
 * Family-scoped list + item state. Caller is responsible for invoking
 * loadLists(familyId) once a family is known; subsequent realtime events
 * keep both signals in sync.
 */
@Injectable({ providedIn: 'root' })
export class ListService {
  private readonly supabase = inject(SUPABASE);

  readonly lists = signal<ListRow[]>([]);
  readonly items = signal<ListItemRow[]>([]);

  private channel: RealtimeChannel | null = null;
  private currentFamilyId: string | null = null;

  async loadLists(familyId: string): Promise<ListRow[]> {
    const { data, error } = await this.supabase
      .from('lists')
      .select('*')
      .eq('family_id', familyId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    this.lists.set(data ?? []);
    this.subscribe(familyId);
    return data ?? [];
  }

  async loadItems(listId: string): Promise<ListItemRow[]> {
    const { data, error } = await this.supabase
      .from('list_items')
      .select('*')
      .eq('list_id', listId)
      .order('checked', { ascending: true })
      .order('added_at', { ascending: false });
    if (error) throw error;
    this.items.set(data ?? []);
    return data ?? [];
  }

  itemsFor(listId: string): ListItemRow[] {
    return this.items().filter((i) => i.list_id === listId);
  }

  async addItem(
    listId: string,
    text: string,
    familyId: string,
    addedByMemberId?: string | null
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    const { error } = await this.supabase.from('list_items').insert({
      list_id: listId,
      family_id: familyId,
      text: trimmed,
      added_by_member_id: addedByMemberId ?? null,
    });
    if (error) throw error;
  }

  async toggleItem(item: ListItemRow): Promise<void> {
    const { error } = await this.supabase
      .from('list_items')
      .update({
        checked: !item.checked,
        checked_at: !item.checked ? new Date().toISOString() : null,
      })
      .eq('id', item.id);
    if (error) throw error;
  }

  async removeItem(id: string): Promise<void> {
    const { error } = await this.supabase.from('list_items').delete().eq('id', id);
    if (error) throw error;
  }

  /** Subscribes to realtime changes for both lists and list_items in this family. */
  private subscribe(familyId: string): void {
    if (this.currentFamilyId === familyId && this.channel) return;
    this.unsubscribe();
    this.currentFamilyId = familyId;
    this.channel = this.supabase
      .channel(`family:${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lists', filter: `family_id=eq.${familyId}` },
        (payload) => this.applyListChange(payload)
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'list_items',
          filter: `family_id=eq.${familyId}`,
        },
        (payload) => this.applyItemChange(payload)
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

  private applyListChange(payload: { eventType: string; new: any; old: any }): void {
    const next = this.lists().slice();
    if (payload.eventType === 'INSERT') {
      if (!next.find((l) => l.id === payload.new.id)) next.push(payload.new as ListRow);
    } else if (payload.eventType === 'UPDATE') {
      const i = next.findIndex((l) => l.id === payload.new.id);
      if (i >= 0) next[i] = payload.new as ListRow;
    } else if (payload.eventType === 'DELETE') {
      const i = next.findIndex((l) => l.id === payload.old.id);
      if (i >= 0) next.splice(i, 1);
    }
    next.sort((a, b) => a.sort_order - b.sort_order);
    this.lists.set(next);
  }

  private applyItemChange(payload: { eventType: string; new: any; old: any }): void {
    const next = this.items().slice();
    if (payload.eventType === 'INSERT') {
      if (!next.find((i) => i.id === payload.new.id)) next.unshift(payload.new as ListItemRow);
    } else if (payload.eventType === 'UPDATE') {
      const i = next.findIndex((it) => it.id === payload.new.id);
      if (i >= 0) next[i] = payload.new as ListItemRow;
    } else if (payload.eventType === 'DELETE') {
      const i = next.findIndex((it) => it.id === payload.old.id);
      if (i >= 0) next.splice(i, 1);
    }
    this.items.set(next);
  }
}
