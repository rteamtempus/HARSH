import { InjectionToken, inject } from '@angular/core';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { Database } from './database.types';

export interface HarshSupabaseConfig {
  url: string;
  anonKey: string;
}

export const HARSH_SUPABASE_CONFIG = new InjectionToken<HarshSupabaseConfig>(
  'HARSH_SUPABASE_CONFIG'
);

export const SUPABASE = new InjectionToken<SupabaseClient<Database>>('SUPABASE', {
  providedIn: 'root',
  factory: () => {
    const cfg = inject(HARSH_SUPABASE_CONFIG);
    return createClient<Database>(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  },
});
