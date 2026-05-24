import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  ContextNoteType,
  ContextNotesService,
  FamilyService,
} from 'data-access';

// Weekly context notes editor — see FEATURES.md §4.6.1.
//
// Design guardrails (non-negotiable):
//   1. Ephemeral by design — expires_at REQUIRED, max 30 days, hard delete on expiry.
//   2. User-visible & editable — this screen exists so they can see exactly what's
//      influencing the assistant's tone.
//   3. Tone-layer only — never auto-creates tasks. Just shapes briefings.
//   4. Privacy suppression takes precedence — flagged in UI with a red border.
//   5. 30-day cap is enforced server-side too (CHECK constraint).

interface NoteDraft {
  content: string;
  type: ContextNoteType;
  expiresOn: string;          // YYYY-MM-DD; converted to ISO timestamp on save
  suppressTopics: string;     // comma-separated, parsed on save
}

function defaultExpiryDate(): string {
  // Default to 7 days out — most context notes are weekly.
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function maxExpiryDate(): string {
  // 30 days from today.
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

const EMPTY_DRAFT = (): NoteDraft => ({
  content: '',
  type: 'situational',
  expiresOn: defaultExpiryDate(),
  suppressTopics: '',
});

@Component({
  selector: 'harsh-context-notes',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, TitleCasePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './context-notes.component.html',
  styleUrl: './context-notes.component.scss',
})
export class ContextNotesComponent implements OnInit, OnDestroy {
  protected readonly notes = inject(ContextNotesService);
  private readonly family = inject(FamilyService);
  private readonly router = inject(Router);

  readonly adding = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly loadError = signal<string | null>(null);

  draft: NoteDraft = EMPTY_DRAFT();
  readonly maxExpiry = maxExpiryDate();

  async ngOnInit() {
    try {
      const fam = this.family.family() ?? (await this.family.loadCurrent());
      if (!fam) { await this.router.navigateByUrl('/setup'); return; }
      await this.notes.load(fam.id);
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Could not load context notes');
    }
  }

  ngOnDestroy() { this.notes.unsubscribe(); }

  startAdd() {
    this.draft = EMPTY_DRAFT();
    this.adding.set(true);
    this.error.set(null);
  }

  cancel() {
    this.adding.set(false);
    this.error.set(null);
  }

  async save() {
    const fam = this.family.family();
    if (!fam) return;
    const content = this.draft.content.trim();
    if (!content) {
      this.error.set('Content is required');
      return;
    }
    if (!this.draft.expiresOn) {
      this.error.set('Pick an expiry date');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      // Convert YYYY-MM-DD into end-of-day in local time so "expires Friday" means
      // "good through Friday", not "expires Friday midnight start".
      const [y, m, d] = this.draft.expiresOn.split('-').map(Number);
      const expires = new Date(y, m - 1, d, 23, 59, 59);
      const suppress = this.draft.suppressTopics
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      await this.notes.create({
        familyId: fam.id,
        content,
        type: this.draft.type,
        expiresAt: expires.toISOString(),
        suppressTopics: this.draft.type === 'privacy_restriction' ? suppress : undefined,
        createdByMemberId: this.family.me()?.id ?? undefined,
      });
      this.adding.set(false);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not save');
    } finally {
      this.busy.set(false);
    }
  }

  async remove(id: string) {
    if (!confirm('Delete this context note? The assistant will stop using it immediately.')) return;
    try {
      await this.notes.remove(id);
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Delete failed');
    }
  }

  relativeUntil(iso: string): string {
    const now = new Date();
    const then = new Date(iso);
    const diffMs = then.getTime() - now.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'expired';
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'tomorrow';
    return `in ${diffDays} days`;
  }
}
