import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE } from './supabase.client';
import { Database } from './database.types';
import type { BrainDumpItem } from './brain-dump.service';

export type MeetingRow = Database['public']['Tables']['meeting_notes']['Row'];
export type MeetingStatus = Database['public']['Enums']['meeting_status'];

export interface MeetingMarker {
  at_seconds: number;
  label: string;
}

/**
 * Meeting scribe service — see FEATURES.md §4.6.
 *
 * State machine (see meeting_status enum):
 *   uploaded → transcribing → transcribed → extracting → ready_for_review → committed
 *                                  ↘ failed (at any step)
 *
 * Audio lifecycle: client uploads to `meeting-audio/<family>/<meeting>.webm`
 * during finishRecording(). extract-meeting nulls audio_path + deletes the
 * storage object once proposals are persisted. Transcript stays indefinitely.
 */
@Injectable({ providedIn: 'root' })
export class MeetingService {
  private readonly supabase = inject(SUPABASE);

  readonly meetings = signal<MeetingRow[]>([]);
  readonly current = signal<MeetingRow | null>(null);

  private channel: RealtimeChannel | null = null;
  private currentFamilyId: string | null = null;

  async load(familyId: string): Promise<MeetingRow[]> {
    const { data, error } = await this.supabase
      .from('meeting_notes')
      .select('*')
      .eq('family_id', familyId)
      .order('recorded_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    this.meetings.set(data ?? []);
    this.subscribe(familyId);
    return data ?? [];
  }

  async loadOne(id: string): Promise<MeetingRow | null> {
    const { data, error } = await this.supabase
      .from('meeting_notes')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    this.current.set(data);
    return data;
  }

  /**
   * Upload the recorded blob to storage and create the meeting_notes row.
   * Returns the new meeting id; caller can then trigger transcribe().
   */
  async finishRecording(input: {
    familyId: string;
    blob: Blob;
    durationSeconds: number;
    markers: MeetingMarker[];
    memberId?: string | null;
  }): Promise<string> {
    // Pre-allocate the meeting row so we have an id for the storage path.
    const inserted = await this.supabase
      .from('meeting_notes')
      .insert({
        family_id: input.familyId,
        duration_seconds: input.durationSeconds,
        markers: input.markers as any,
        status: 'uploaded',
        created_by_member_id: input.memberId ?? null,
      })
      .select('*')
      .single();
    if (inserted.error || !inserted.data) throw inserted.error ?? new Error('insert failed');

    const meetingId = inserted.data.id;
    const ext = blobExtension(input.blob.type);
    const path = `${input.familyId}/${meetingId}.${ext}`;

    const upload = await this.supabase.storage
      .from('meeting-audio')
      .upload(path, input.blob, { contentType: input.blob.type, upsert: false });
    if (upload.error) {
      // Best-effort cleanup of the row if the audio upload failed.
      await this.supabase.from('meeting_notes').delete().eq('id', meetingId);
      throw upload.error;
    }

    const { data: updated, error: updErr } = await this.supabase
      .from('meeting_notes')
      .update({ audio_path: path })
      .eq('id', meetingId)
      .select('*')
      .single();
    if (updErr) throw updErr;
    return updated.id;
  }

  /** Kick the transcribe edge function. State moves to transcribing → transcribed. */
  async transcribe(meetingId: string): Promise<void> {
    const { error } = await this.supabase.functions.invoke('transcribe-meeting', {
      body: { meeting_id: meetingId },
    });
    if (error) throw error;
  }

  /** Kick the extract edge function. State moves to extracting → ready_for_review. */
  async extract(meetingId: string): Promise<void> {
    const { error } = await this.supabase.functions.invoke('extract-meeting', {
      body: { meeting_id: meetingId },
    });
    if (error) throw error;
  }

  /** Mark a meeting committed once the proposals are applied (caller uses BrainDumpService.execute). */
  async markCommitted(meetingId: string): Promise<void> {
    const { error } = await this.supabase
      .from('meeting_notes')
      .update({ status: 'committed', committed_at: new Date().toISOString() })
      .eq('id', meetingId);
    if (error) throw error;
  }

  /** Read the proposals as typed BrainDumpItem[]. */
  proposals(meeting: MeetingRow): BrainDumpItem[] {
    return (meeting.proposals as any as BrainDumpItem[] | null) ?? [];
  }

  async delete(meetingId: string): Promise<void> {
    const meeting = this.meetings().find((m) => m.id === meetingId);
    if (meeting?.audio_path) {
      // Best-effort: storage cleanup before row delete.
      await this.supabase.storage.from('meeting-audio').remove([meeting.audio_path]);
    }
    const { error } = await this.supabase.from('meeting_notes').delete().eq('id', meetingId);
    if (error) throw error;
  }

  private subscribe(familyId: string): void {
    if (this.currentFamilyId === familyId && this.channel) return;
    this.unsubscribe();
    this.currentFamilyId = familyId;
    this.channel = this.supabase
      .channel(`meetings:${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meeting_notes', filter: `family_id=eq.${familyId}` },
        () => this.reload(familyId),
      )
      .subscribe();
  }

  private async reload(familyId: string): Promise<void> {
    const { data } = await this.supabase
      .from('meeting_notes')
      .select('*')
      .eq('family_id', familyId)
      .order('recorded_at', { ascending: false })
      .limit(20);
    if (data) {
      this.meetings.set(data);
      // Keep `current` in sync if it's in this set.
      const cur = this.current();
      if (cur) {
        const fresh = data.find((m) => m.id === cur.id);
        if (fresh) this.current.set(fresh);
      }
    }
  }

  unsubscribe(): void {
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.currentFamilyId = null;
  }
}

function blobExtension(mime: string): string {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}
