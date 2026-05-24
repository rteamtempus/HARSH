import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  BrainDumpItem,
  FamilyService,
  MeetingMarker,
  MeetingRow,
  MeetingService,
  MeetingStatus,
} from 'data-access';

// Meeting scribe — see FEATURES.md §4.6.
// Capture surface: MediaRecorder records local audio, uploads when user ends.
// State machine progress comes from the meeting_notes row via realtime sync.

const STATUS_LABELS: Record<MeetingStatus, string> = {
  uploaded: 'audio uploaded, awaiting transcription',
  transcribing: 'transcribing…',
  transcribed: 'transcribed, ready to extract',
  extracting: 'extracting proposals…',
  ready_for_review: 'ready for review',
  committed: 'committed',
  failed: 'failed',
  recording: 'recording', // shouldn't appear in the list
};

@Component({
  selector: 'harsh-meeting',
  standalone: true,
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './meeting.component.html',
  styleUrl: './meeting.component.scss',
})
export class MeetingComponent implements OnInit, OnDestroy {
  protected readonly service = inject(MeetingService);
  private readonly family = inject(FamilyService);
  private readonly router = inject(Router);

  // Recording state — kept in this component (not the service) because it's
  // tied to MediaRecorder lifecycle which is browser-specific.
  readonly recording = signal(false);
  readonly paused = signal(false);
  readonly busy = signal(false);
  readonly recordError = signal<string | null>(null);
  readonly markers = signal<MeetingMarker[]>([]);
  readonly elapsedSeconds = signal(0);

  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private recordStartMs = 0;
  private pausedAccumMs = 0;
  private pausedAtMs = 0;
  private stream: MediaStream | null = null;

  async ngOnInit() {
    try {
      const fam = this.family.family() ?? (await this.family.loadCurrent());
      if (!fam) { await this.router.navigateByUrl('/setup'); return; }
      await this.service.load(fam.id);
    } catch (e: any) {
      this.recordError.set(e?.message ?? 'Could not load meetings');
    }
  }

  ngOnDestroy() {
    this.cleanup();
    this.service.unsubscribe();
  }

  async start() {
    this.recordError.set(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      this.recordError.set('Microphone not available in this browser.');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      this.mediaRecorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      this.chunks = [];
      this.markers.set([]);
      this.mediaRecorder.addEventListener('dataavailable', (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      });
      this.mediaRecorder.start(1000); // gather a chunk every second so a crash loses at most 1s
      this.recordStartMs = Date.now();
      this.pausedAccumMs = 0;
      this.elapsedTimer = setInterval(() => this.tickElapsed(), 250);
      this.recording.set(true);
      this.paused.set(false);
    } catch (e: any) {
      this.recordError.set(e?.message ?? 'Microphone permission denied');
      this.cleanup();
    }
  }

  pause() {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') return;
    this.mediaRecorder.pause();
    this.pausedAtMs = Date.now();
    this.paused.set(true);
  }

  resume() {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'paused') return;
    this.pausedAccumMs += Date.now() - this.pausedAtMs;
    this.mediaRecorder.resume();
    this.paused.set(false);
  }

  dropMarker() {
    const secs = this.currentElapsedSeconds();
    const label = prompt('Marker label (optional):') ?? '';
    this.markers.update((m) => [...m, { at_seconds: Math.round(secs), label }]);
  }

  async end() {
    if (!this.mediaRecorder) return;
    const fam = this.family.family();
    if (!fam) return;
    this.busy.set(true);
    try {
      const stopped = new Promise<void>((resolve) => {
        this.mediaRecorder!.addEventListener('stop', () => resolve(), { once: true });
      });
      // If paused, flush the in-progress chunk too.
      if (this.mediaRecorder.state === 'paused') this.mediaRecorder.resume();
      this.mediaRecorder.stop();
      await stopped;

      const blob = new Blob(this.chunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
      const durationSeconds = Math.max(1, this.currentElapsedSeconds());

      await this.service.finishRecording({
        familyId: fam.id,
        blob,
        durationSeconds: Math.round(durationSeconds),
        markers: this.markers(),
        memberId: this.family.me()?.id ?? null,
      });
    } catch (e: any) {
      this.recordError.set(e?.message ?? 'Could not save meeting');
    } finally {
      this.cleanup();
      this.busy.set(false);
    }
  }

  async transcribe(id: string) {
    try { await this.service.transcribe(id); }
    catch (e: any) { this.recordError.set(e?.message ?? 'Transcription failed to start'); }
  }

  async extract(id: string) {
    try { await this.service.extract(id); }
    catch (e: any) { this.recordError.set(e?.message ?? 'Extraction failed to start'); }
  }

  async remove(id: string) {
    if (!confirm('Delete this meeting? The audio (if still present) and transcript will be removed.')) return;
    try { await this.service.delete(id); }
    catch (e: any) { this.recordError.set(e?.message ?? 'Delete failed'); }
  }

  statusLabel(s: MeetingStatus): string { return STATUS_LABELS[s] ?? s; }

  durationLabel(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  elapsedLabel(): string {
    return this.durationLabel(this.elapsedSeconds());
  }

  asProposals(m: MeetingRow): BrainDumpItem[] {
    return this.service.proposals(m);
  }

  private tickElapsed() {
    this.elapsedSeconds.set(this.currentElapsedSeconds());
  }

  private currentElapsedSeconds(): number {
    if (!this.recordStartMs) return 0;
    const pausedNow = this.paused() ? Date.now() - this.pausedAtMs : 0;
    return Math.floor(((Date.now() - this.recordStartMs) - this.pausedAccumMs - pausedNow) / 1000);
  }

  private cleanup() {
    if (this.elapsedTimer) { clearInterval(this.elapsedTimer); this.elapsedTimer = null; }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch { /* ignore */ }
    }
    this.mediaRecorder = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.chunks = [];
    this.recording.set(false);
    this.paused.set(false);
    this.elapsedSeconds.set(0);
    this.recordStartMs = 0;
    this.pausedAccumMs = 0;
    this.pausedAtMs = 0;
  }
}

/**
 * Pick the best supported audio MIME for MediaRecorder. webm/opus is the most
 * compact for our duration range; mp4 is the iOS Safari fallback.
 */
function pickMime(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg',
  ];
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined;
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return undefined;
}
