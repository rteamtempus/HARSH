import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import {
  Briefing,
  BriefingService,
  BriefingType,
  FamilyService,
} from 'data-access';

// Briefing view — see FEATURES.md §4.5.
// Pre-computed + cached; Refresh kicks the generator edge function. Realtime
// keeps the signal in sync if a scheduled job writes a new row.

@Component({
  selector: 'harsh-briefing',
  standalone: true,
  imports: [DatePipe, HeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './briefing.component.html',
  styleUrl: './briefing.component.scss',
})
export class BriefingComponent implements OnInit, OnDestroy {
  protected readonly briefings = inject(BriefingService);
  private readonly family = inject(FamilyService);
  private readonly router = inject(Router);

  readonly type = signal<BriefingType>('daily');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly playing = signal(false);
  readonly audioBusy = signal(false);
  private audioEl: HTMLAudioElement | null = null;

  readonly current = computed<Briefing | null>(() => this.briefings.latest(this.type()));

  async ngOnInit() {
    try {
      const fam = this.family.family() ?? (await this.family.loadCurrent());
      if (!fam) { await this.router.navigateByUrl('/setup'); return; }
      await this.briefings.load(fam.id);
      // Auto-generate a daily briefing on first visit if there isn't one yet.
      if (!this.briefings.latest('daily')) {
        await this.refresh();
      }
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not load briefing');
    }
  }

  ngOnDestroy() {
    this.stopAudio();
    this.briefings.unsubscribe();
  }

  async togglePlay() {
    if (this.playing()) { this.stopAudio(); return; }
    const b = this.current();
    if (!b) return;
    this.audioBusy.set(true);
    try {
      const url = await this.briefings.audioUrl(b);
      if (!url) {
        this.error.set('No audio available — TTS may not be configured yet.');
        return;
      }
      this.audioEl = new Audio(url);
      this.audioEl.addEventListener('ended', () => this.playing.set(false));
      this.audioEl.addEventListener('error', () => {
        this.playing.set(false);
        this.error.set('Could not play audio');
      });
      await this.audioEl.play();
      this.playing.set(true);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Playback failed');
    } finally {
      this.audioBusy.set(false);
    }
  }

  private stopAudio() {
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl = null;
    }
    this.playing.set(false);
  }

  setType(t: BriefingType) { this.type.set(t); }

  async refresh() {
    const fam = this.family.family();
    if (!fam) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.briefings.generate(fam.id, this.type());
    } catch (e: any) {
      const msg = e?.message ?? 'Could not generate';
      if (msg.includes('GEMINI_API_KEY') || msg.includes('missing_gemini_api_key')) {
        this.error.set('Briefing generator not configured — deploy the generate-briefing edge function and ensure GEMINI_API_KEY is set.');
      } else {
        this.error.set(msg);
      }
    } finally {
      this.busy.set(false);
    }
  }
}
