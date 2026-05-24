// Release-notes service. Backed by the `releases` + `user_release_acks` tables.
// See FEATURES.md §9.3 and migration 20260524010000_releases.sql.

import { Injectable, inject } from '@angular/core';
import { SUPABASE } from './supabase.client';

export interface ReleaseNotes {
  new_features: string[];
  improvements: string[];
  fixes: string[];
}

export interface Release {
  id: string;
  version: string;
  released_at: string;
  notes: ReleaseNotes;
}

// `notes` is jsonb in the DB and arrives as `Json` (unstructured). Normalise here
// so consumers get a guaranteed shape even on partially-populated rows.
function toRelease(row: { id: string; version: string; released_at: string; notes: unknown }): Release {
  const n = (row.notes ?? {}) as Partial<ReleaseNotes>;
  return {
    id: row.id,
    version: row.version,
    released_at: row.released_at,
    notes: {
      new_features: n.new_features ?? [],
      improvements: n.improvements ?? [],
      fixes: n.fixes ?? [],
    },
  };
}

@Injectable({ providedIn: 'root' })
export class ReleaseService {
  private readonly supabase = inject(SUPABASE);

  /** True when there's a newer release than this user has seen AND popup hasn't fired today. */
  async shouldShowPopup(): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('should_show_release_popup');
    if (error) throw error;
    return !!data;
  }

  /** All releases newer than the user's last_version_seen, newest first. */
  async unread(): Promise<Release[]> {
    const { data, error } = await this.supabase.rpc('unread_releases');
    if (error) throw error;
    return (data ?? []).map(toRelease);
  }

  /** Full history for the "Release notes" page. */
  async history(): Promise<Release[]> {
    const { data, error } = await this.supabase
      .from('releases')
      .select('*')
      .order('released_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(toRelease);
  }

  /** Mark popup shown today and acknowledge up to `version`. */
  async acknowledge(version: string): Promise<void> {
    const { error } = await this.supabase.rpc('acknowledge_releases', { p_version: version });
    if (error) throw error;
  }
}
