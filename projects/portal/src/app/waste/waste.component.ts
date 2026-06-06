import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  BrainDumpContext,
  BrainDumpItem,
  BrainDumpService,
  FamilyService,
  InventoryService,
  WasteEventRow,
  WasteReason,
  WasteService,
} from 'data-access';
import { HeaderComponent } from '../header/header.component';

interface QuickDraft {
  name: string;
  item_id: string | null;
  reason: WasteReason;
  percentage: number;
  dollars: number | null;
}

// Items we get back from the LLM that are waste_event type. Constrained for type-safety.
type WasteCandidate = Extract<BrainDumpItem, { type: 'waste_event' }>;

@Component({
  selector: 'harsh-waste',
  standalone: true,
  imports: [FormsModule, DatePipe, HeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './waste.component.html',
  styleUrl: './waste.component.scss',
})
export class WasteComponent implements OnInit, OnDestroy {
  protected readonly waste = inject(WasteService);
  protected readonly inventory = inject(InventoryService);
  private readonly family = inject(FamilyService);
  private readonly brainDump = inject(BrainDumpService);
  private readonly router = inject(Router);

  readonly quickAdding = signal(false);
  readonly busy = signal(false);
  readonly loadError = signal<string | null>(null);

  // Waste brain dump
  dumpText = '';
  readonly dumpBusy = signal(false);
  readonly dumpError = signal<string | null>(null);
  readonly dumpResult = signal<WasteCandidate[] | null>(null);
  readonly skipped = signal<Set<number>>(new Set());

  quickDraft: QuickDraft = { name: '', item_id: null, reason: 'spoiled', percentage: 100, dollars: null };

  async ngOnInit() {
    try {
      const fam = this.family.family() ?? (await this.family.loadCurrent());
      if (!fam) { await this.router.navigateByUrl('/setup'); return; }
      await Promise.all([this.waste.load(fam.id), this.inventory.load(fam.id)]);
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Could not load');
    }
  }

  ngOnDestroy() {
    this.waste.unsubscribe();
    this.inventory.unsubscribe();
  }

  // ----- Waste brain dump -----

  async processDump(): Promise<void> {
    const fam = this.family.family();
    if (!fam) return;
    const transcript = this.dumpText.trim();
    if (!transcript) return;
    this.dumpBusy.set(true);
    this.dumpError.set(null);
    this.dumpResult.set(null);
    this.skipped.set(new Set());
    try {
      const ctx: BrainDumpContext = {
        familyId: fam.id,
        familyName: fam.name,
        timezone: (fam as any).timezone ?? undefined,
        memberId: this.family.me()?.id ?? null,
        // Empty lists/members/profiles for waste dump — minimal context, keeps prompt focused.
        lists: [], members: [], profiles: [],
      };
      // Lean on the standard brain-dump parser; the waste-only prefix biases
      // the LLM toward waste_event extraction. Anything that isn't a
      // waste_event gets filtered out below.
      const result = await this.brainDump.parse(
        `[Fridge cleanout / batch waste logging — extract only waste_event items, ignore non-waste content.]\n\n${transcript}`,
        ctx,
      );
      const waste = result.items.filter((i): i is WasteCandidate => i.type === 'waste_event');
      this.dumpResult.set(waste);
    } catch (e: any) {
      this.dumpError.set(e?.message ?? 'Could not parse');
    } finally {
      this.dumpBusy.set(false);
    }
  }

  activeDumpCount(): number {
    const total = this.dumpResult()?.length ?? 0;
    return total - this.skipped().size;
  }

  describe(c: WasteCandidate): string {
    return BrainDumpService.describe(c);
  }

  skip(i: number) { this.skipped.update((s) => { const n = new Set(s); n.add(i); return n; }); }
  unskip(i: number) { this.skipped.update((s) => { const n = new Set(s); n.delete(i); return n; }); }

  async commitDump(): Promise<void> {
    const fam = this.family.family();
    const items = this.dumpResult();
    if (!fam || !items) return;
    this.dumpBusy.set(true);
    this.dumpError.set(null);
    try {
      const decisions = items.map((_, i) =>
        this.skipped().has(i) ? { action: 'skip' as const } : { action: 'confirm' as const },
      );
      const summary = await this.brainDump.execute(items as BrainDumpItem[], decisions, {
        familyId: fam.id,
        memberId: this.family.me()?.id ?? null,
      });
      if (summary.errors.length) {
        this.dumpError.set(`${summary.errors.length} item(s) failed: ${summary.errors[0].message}`);
      } else {
        // Clear inputs after successful commit.
        this.dumpText = '';
        this.dumpResult.set(null);
        this.skipped.set(new Set());
      }
    } catch (e: any) {
      this.dumpError.set(e?.message ?? 'Save failed');
    } finally {
      this.dumpBusy.set(false);
    }
  }

  // ----- Quick add -----

  startQuickAdd() {
    this.quickDraft = { name: '', item_id: null, reason: 'spoiled', percentage: 100, dollars: null };
    this.quickAdding.set(true);
  }

  async saveQuick(): Promise<void> {
    const fam = this.family.family();
    if (!fam) return;
    if (!this.quickDraft.name.trim() && !this.quickDraft.item_id) {
      this.loadError.set('Pick an item or describe one');
      return;
    }
    this.busy.set(true);
    try {
      await this.waste.log({
        familyId: fam.id,
        itemId: this.quickDraft.item_id,
        freeTextName: this.quickDraft.item_id ? null : this.quickDraft.name.trim(),
        reason: this.quickDraft.reason,
        percentage: this.quickDraft.percentage,
        estimatedValueCents: this.quickDraft.dollars != null
          ? Math.round(this.quickDraft.dollars * 100)
          : null,
        source: 'manual',
        memberId: this.family.me()?.id ?? null,
      });
      this.quickAdding.set(false);
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Save failed');
    } finally {
      this.busy.set(false);
    }
  }

  async remove(id: string) {
    if (!confirm('Delete this waste entry?')) return;
    try { await this.waste.remove(id); }
    catch (e: any) { this.loadError.set(e?.message ?? 'Delete failed'); }
  }

  // ----- Display helpers -----

  displayName(w: WasteEventRow): string {
    if (w.item_id) {
      const item = this.inventory.activeItems().find((i) => i.id === w.item_id);
      if (item) return item.name;
    }
    return w.free_text_name ?? '(unnamed)';
  }

  reasonLabel(r: WasteReason): string {
    return r === 'not_worth_it'
      ? 'Not worth dealing with'
      : r.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  formatDollars(cents: number | null | undefined): string {
    if (!cents) return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
  }
}
