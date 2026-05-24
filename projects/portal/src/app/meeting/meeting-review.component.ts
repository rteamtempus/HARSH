import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BrainDumpItem,
  BrainDumpService,
  FamilyService,
  MeetingRow,
  MeetingService,
  MeetingStatus,
} from 'data-access';

// Meeting review — see FEATURES.md §4.6 Stage 4.
// Grouped-by-type with per-item, group, and master actions. Commit reuses the
// brain-dump executor so meeting-extracted items hit the same code path that
// brain-dump's confirm-all uses.

interface GroupEntry { index: number; item: BrainDumpItem }
interface Group { label: string; items: GroupEntry[]; indices: number[] }

const TYPE_LABELS: Record<BrainDumpItem['type'], string> = {
  list_item: 'List items',
  event: 'Events',
  routine: 'Routines',
  household_fact: 'Household facts',
  context_note: 'Context notes',
};

const STATUS_LABELS: Record<MeetingStatus, string> = {
  uploaded: 'audio uploaded',
  transcribing: 'transcribing',
  transcribed: 'transcribed',
  extracting: 'extracting',
  ready_for_review: 'ready for review',
  committed: 'committed',
  failed: 'failed',
  recording: 'recording',
};

@Component({
  selector: 'harsh-meeting-review',
  standalone: true,
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './meeting-review.component.html',
  styleUrl: './meeting-review.component.scss',
})
export class MeetingReviewComponent implements OnInit, OnDestroy {
  private readonly service = inject(MeetingService);
  private readonly brainDump = inject(BrainDumpService);
  private readonly family = inject(FamilyService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly meeting = signal<MeetingRow | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly skipped = signal<Set<number>>(new Set());
  readonly commitBusy = signal(false);
  readonly commitResult = signal<{ applied: number; errors: number } | null>(null);

  readonly proposals = computed<BrainDumpItem[]>(() => {
    const m = this.meeting();
    return m ? this.service.proposals(m) : [];
  });

  readonly grouped = computed<Group[]>(() => {
    const groups = new Map<string, GroupEntry[]>();
    this.proposals().forEach((item, index) => {
      const list = groups.get(item.type) ?? [];
      list.push({ index, item });
      groups.set(item.type, list);
    });
    return Array.from(groups.entries()).map(([type, items]) => ({
      label: TYPE_LABELS[type as BrainDumpItem['type']] ?? type,
      items,
      indices: items.map((e) => e.index),
    }));
  });

  activeCount(): number {
    const total = this.proposals().length;
    return total - this.skipped().size;
  }

  describe(item: BrainDumpItem): string {
    return BrainDumpService.describe(item);
  }

  statusLabel(s: MeetingStatus): string { return STATUS_LABELS[s] ?? s; }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { await this.router.navigateByUrl('/meeting'); return; }
    const fam = this.family.family() ?? (await this.family.loadCurrent());
    if (!fam) { await this.router.navigateByUrl('/setup'); return; }

    try {
      // Subscribe to the family's meetings so realtime keeps this view fresh
      // while transcription/extraction is happening.
      await this.service.load(fam.id);
      const m = await this.service.loadOne(id);
      this.meeting.set(m);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not load meeting');
    } finally {
      this.loading.set(false);
    }

    // React to realtime updates by re-reading `current` from the service when
    // the meetings signal changes. (Service keeps `current` in sync internally.)
  }

  ngOnDestroy() {
    this.service.unsubscribe();
  }

  skip(i: number) {
    this.skipped.update((s) => { const n = new Set(s); n.add(i); return n; });
  }
  unskip(i: number) {
    this.skipped.update((s) => { const n = new Set(s); n.delete(i); return n; });
  }

  skipGroup(indices: number[]) {
    this.skipped.update((s) => { const n = new Set(s); indices.forEach((i) => n.add(i)); return n; });
  }
  confirmGroup(indices: number[]) {
    this.skipped.update((s) => { const n = new Set(s); indices.forEach((i) => n.delete(i)); return n; });
  }
  skipAll() {
    this.skipped.set(new Set(this.proposals().map((_, i) => i)));
  }
  confirmAll() {
    this.skipped.set(new Set());
  }

  async commit() {
    const m = this.meeting();
    const fam = this.family.family();
    if (!m || !fam) return;

    this.commitBusy.set(true);
    this.error.set(null);
    this.commitResult.set(null);

    try {
      const items = this.proposals();
      const decisions = items.map((_, i) =>
        this.skipped().has(i) ? { action: 'skip' as const } : { action: 'confirm' as const },
      );
      const summary = await this.brainDump.execute(items, decisions, {
        familyId: fam.id,
        memberId: this.family.me()?.id ?? null,
      });
      this.commitResult.set({ applied: summary.applied, errors: summary.errors.length });
      if (summary.errors.length === 0) {
        await this.service.markCommitted(m.id);
        const fresh = await this.service.loadOne(m.id);
        this.meeting.set(fresh);
      } else {
        // Surface first error; keep meeting status as ready_for_review so user can retry.
        this.error.set(`${summary.errors.length} item(s) failed: ${summary.errors[0].message}`);
      }
    } catch (e: any) {
      this.error.set(e?.message ?? 'Commit failed');
    } finally {
      this.commitBusy.set(false);
    }
  }
}
