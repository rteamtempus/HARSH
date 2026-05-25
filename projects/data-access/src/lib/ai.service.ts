import { Injectable, inject } from '@angular/core';
import { SUPABASE } from './supabase.client';

export type Intent =
  | { action: 'list.add_item'; list: string; text: string; confidence?: number }
  | { action: 'list.check_item'; list: string; text: string; confidence?: number }
  | { action: 'list.remove_item'; list: string; text: string; confidence?: number }
  | {
      action: 'view.show_list';
      list: string;
      resolved_list_id?: string;
      resolved_list_name?: string;
      confidence?: number;
    }
  | {
      action: 'calendar.show';
      view: 'day' | 'week' | 'month';
      anchor_date: string;
      confidence?: number;
    }
  | { action: 'calendar.sync_all'; confidence?: number }
  | { action: 'unknown'; reason: string };

export interface IntentResult { intent: Intent; ok: boolean; error?: string }
export interface AiResponse {
  intents: Intent[];
  results: IntentResult[];
  spoken_reply: string;
}

@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly supabase = inject(SUPABASE);

  async runIntent(input: {
    transcript: string;
    family_id: string;
    surface: 'portal' | 'display';
    member_id?: string | null;
  }): Promise<AiResponse> {
    const { data, error } = await this.supabase.functions.invoke<AiResponse>('ai-intent', {
      body: input,
    });
    if (error) throw error;
    if (!data) throw new Error('empty response');
    return data;
  }
}
