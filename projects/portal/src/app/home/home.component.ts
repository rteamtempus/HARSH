import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  AuthService,
  BrainDumpContext,
  BrainDumpItem,
  BrainDumpResult,
  BrainDumpService,
  ContextNotesService,
  EventService,
  FamilyService,
  HouseholdFactsService,
  ListService,
  ProfileService,
  RoutineService,
  ThemeService,
  VoiceService,
} from 'data-access';

// Brain-dump primary surface — see FEATURES.md §2.1.1.
//
// One textarea, one mic. LLM classifies the input as capture / query / follow-up
// and returns either an answer or proposed items. User confirms (per item or all)
// before anything writes. Context clears on commit / answered query / app blur.

type Stage = 'idle' | 'parsing' | 'review' | 'committing';

@Component({
  selector: 'harsh-home',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly family = inject(FamilyService);
  protected readonly lists = inject(ListService);
  protected readonly voice = inject(VoiceService);
  protected readonly theme = inject(ThemeService);
  private readonly events = inject(EventService);
  private readonly routines = inject(RoutineService);
  private readonly profiles = inject(ProfileService);
  private readonly facts = inject(HouseholdFactsService);
  private readonly contextNotes = inject(ContextNotesService);
  private readonly brainDump = inject(BrainDumpService);
  private readonly router = inject(Router);

  private readonly dumpInput = viewChild<ElementRef<HTMLTextAreaElement>>('dumpInput');

  draft = '';
  readonly stage = signal<Stage>('idle');
  readonly result = signal<BrainDumpResult | null>(null);
  readonly skipped = signal<Set<number>>(new Set());
  readonly error = signal<string | null>(null);
  readonly menuOpen = signal(false);
  readonly lastSummary = signal<{ applied: number; errors: { index: number; message: string }[] } | null>(null);

  // Multi-turn: remember the prior turn so a follow-up answer keeps context.
  private prior: { transcript: string; reply: string } | null = null;

  placeholder(): string {
    if (this.result()?.mode === 'follow_up') return 'Type your answer…';
    return 'What\'s on your mind? Type or speak — to-dos, events, things to remember…';
  }

  activeCount(): number {
    const total = this.result()?.items.length ?? 0;
    return total - this.skipped().size;
  }

  describe(item: BrainDumpItem): string {
    return BrainDumpService.describe(item);
  }

  async ngOnInit() {
    try {
      const fam = this.family.family() ?? (await this.family.loadCurrent());
      if (!fam) { await this.router.navigateByUrl('/setup'); return; }
      await Promise.all([
        this.lists.loadLists(fam.id),
        this.profiles.load(fam.id),
      ]);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not load household');
    }
  }

  ngOnDestroy() {
    this.lists.unsubscribe();
    this.profiles.unsubscribe();
  }

  toggleMenu() { this.menuOpen.update((v) => !v); }

  async toggleMic() {
    if (this.voice.listening()) { this.voice.stop(); return; }
    try {
      const transcript = await this.voice.start();
      if (transcript) {
        this.draft = this.draft ? `${this.draft.trimEnd()} ${transcript}` : transcript;
      }
    } catch (e: any) {
      this.error.set(e?.message ?? 'Voice failed');
    }
  }

  async submit() {
    const transcript = this.draft.trim();
    if (!transcript) return;
    const fam = this.family.family();
    if (!fam) return;

    this.error.set(null);
    this.lastSummary.set(null);
    this.stage.set('parsing');

    try {
      const ctx: BrainDumpContext = {
        familyId: fam.id,
        familyName: fam.name,
        timezone: (fam as any).timezone ?? undefined,
        memberId: this.family.me()?.id ?? null,
        lists: this.lists.lists().map((l) => ({ id: l.id, name: l.name })),
        members: this.family.members().map((m) => ({ id: m.id, display_name: m.display_name })),
        profiles: this.profiles.profiles().map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
        snapshot: {
          items: this.lists
            .items()
            .map((it) => ({
              list_name: this.lists.lists().find((l) => l.id === it.list_id)?.name ?? '',
              text: it.text,
              checked: it.checked,
            })),
        },
        prior: this.prior ?? undefined,
      };

      const parsed = await this.brainDump.parse(transcript, ctx);
      this.result.set(parsed);
      this.skipped.set(new Set());

      if (parsed.mode === 'follow_up') {
        this.prior = { transcript, reply: parsed.reply };
      } else {
        this.prior = null;
      }

      this.draft = '';
      this.stage.set(parsed.mode === 'capture' ? 'review' : 'idle');
      queueMicrotask(() => this.dumpInput()?.nativeElement.focus());
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not parse');
      this.stage.set('idle');
    }
  }

  skip(i: number) {
    this.skipped.update((set) => {
      const next = new Set(set);
      next.add(i);
      return next;
    });
  }

  unskip(i: number) {
    this.skipped.update((set) => {
      const next = new Set(set);
      next.delete(i);
      return next;
    });
  }

  confirmAll() { void this.commit(); }

  async commit() {
    const result = this.result();
    const fam = this.family.family();
    if (!result || !fam) return;

    this.stage.set('committing');
    this.error.set(null);

    const decisions = result.items.map((_item, i) =>
      this.skipped().has(i) ? { action: 'skip' as const } : { action: 'confirm' as const },
    );

    try {
      const summary = await this.brainDump.execute(result.items, decisions, {
        familyId: fam.id,
        memberId: this.family.me()?.id ?? null,
      });
      this.lastSummary.set({ applied: summary.applied, errors: summary.errors });
      if (summary.errors.length) {
        this.error.set(`${summary.errors.length} item(s) failed: ${summary.errors[0].message}`);
      }
      this.reset();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not save');
    } finally {
      this.stage.set('idle');
    }
  }

  reset() {
    this.result.set(null);
    this.skipped.set(new Set());
    this.prior = null;
    this.stage.set('idle');
  }

  async signOut() {
    this.menuOpen.set(false);
    this.lists.unsubscribe();
    this.profiles.unsubscribe();
    await this.auth.signOut();
    await this.router.navigateByUrl('/sign-in');
  }
}
