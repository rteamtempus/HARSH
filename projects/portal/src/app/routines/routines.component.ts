import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  FamilyService,
  RoutineInsert,
  RoutineRow,
  RoutineService,
} from 'data-access';

// Routines CRUD + actions — see FEATURES.md §4.3.
// Complete/Skip/Snooze/Pause/Resume hit Postgres RPCs that update next_due AND
// log to routine_history atomically. See RoutineService for the call signatures.

interface RoutineDraft {
  name: string;
  category: string;
  cadence_type: 'interval' | 'calendar';
  interval_days: number;
  cadence_rrule: string;
  notes: string;
}

const EMPTY_DRAFT: RoutineDraft = {
  name: '',
  category: '',
  cadence_type: 'interval',
  interval_days: 7,
  cadence_rrule: '',
  notes: '',
};

@Component({
  selector: 'harsh-routines',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './routines.component.html',
  styleUrl: './routines.component.scss',
})
export class RoutinesComponent implements OnInit, OnDestroy {
  protected readonly routines = inject(RoutineService);
  private readonly family = inject(FamilyService);
  private readonly router = inject(Router);

  readonly adding = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly actionBusy = signal<string | null>(null);

  draft: RoutineDraft = { ...EMPTY_DRAFT };

  async ngOnInit() {
    try {
      const fam = this.family.family() ?? (await this.family.loadCurrent());
      if (!fam) { await this.router.navigateByUrl('/setup'); return; }
      await this.routines.load(fam.id);
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Could not load routines');
    }
  }

  ngOnDestroy() {
    this.routines.unsubscribe();
  }

  startAdd() {
    this.draft = { ...EMPTY_DRAFT };
    this.adding.set(true);
    this.error.set(null);
  }

  cancelAdd() {
    this.adding.set(false);
    this.error.set(null);
  }

  async saveNew() {
    const fam = this.family.family();
    if (!fam) return;
    if (!this.draft.name.trim()) {
      this.error.set('Name is required');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const insert: RoutineInsert = {
        family_id: fam.id,
        name: this.draft.name.trim(),
        category: this.draft.category.trim() || null,
        cadence_type: this.draft.cadence_type,
        notes: this.draft.notes.trim() || null,
      };
      if (this.draft.cadence_type === 'interval') {
        if (!this.draft.interval_days || this.draft.interval_days < 1) {
          throw new Error('Interval days must be at least 1');
        }
        insert.interval_days = this.draft.interval_days;
      } else {
        if (!this.draft.cadence_rrule.trim()) {
          throw new Error('RRULE is required for calendar cadence');
        }
        insert.cadence_rrule = this.draft.cadence_rrule.trim();
      }
      await this.routines.create(insert);
      this.adding.set(false);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not save');
    } finally {
      this.busy.set(false);
    }
  }

  async complete(r: RoutineRow) {
    await this.runAction(r.id, () =>
      this.routines.complete(r.id, { memberId: this.family.me()?.id ?? undefined }),
    );
  }

  async skip(r: RoutineRow) {
    await this.runAction(r.id, () =>
      this.routines.skip(r.id, { memberId: this.family.me()?.id ?? undefined }),
    );
  }

  async snooze(r: RoutineRow, days: number) {
    await this.runAction(r.id, () =>
      this.routines.snooze(r.id, days, { memberId: this.family.me()?.id ?? undefined }),
    );
  }

  async promptPause(r: RoutineRow) {
    // Quick-and-dirty: ask via prompt(). Replace with a real dialog when there's time.
    const dateStr = prompt('Pause until (YYYY-MM-DD):');
    if (!dateStr) return;
    const reason = prompt('Reason (optional):') ?? undefined;
    await this.runAction(r.id, () => this.routines.pause(r.id, dateStr, reason));
  }

  async resume(r: RoutineRow) {
    await this.runAction(r.id, () => this.routines.resume(r.id));
  }

  async remove(r: RoutineRow) {
    if (!confirm(`Delete routine "${r.name}"? History will also be removed.`)) return;
    await this.runAction(r.id, () => this.routines.remove(r.id));
  }

  isPaused(r: RoutineRow): boolean {
    if (!r.pause_until) return false;
    return new Date(r.pause_until) > new Date();
  }

  relativeWhen(iso: string): string {
    const now = new Date();
    const then = new Date(iso);
    const diffDays = Math.round((then.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'tomorrow';
    if (diffDays === -1) return 'yesterday';
    if (diffDays > 0) return `in ${diffDays} days`;
    return `${-diffDays} days overdue`;
  }

  private async runAction(id: string, op: () => Promise<unknown>) {
    this.actionBusy.set(id);
    this.loadError.set(null);
    try {
      await op();
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Action failed');
    } finally {
      this.actionBusy.set(null);
    }
  }
}
