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
  template: `
    <main class="wrap">
      <header>
        <div class="brand">
          <h1>{{ family.family()?.name ?? 'HARSH' }}</h1>
          <p class="who">{{ auth.user()?.email }}</p>
        </div>
        <button class="hamburger" (click)="toggleMenu()" aria-label="Menu">☰</button>
      </header>

      @if (menuOpen()) {
        <div class="menu-backdrop" (click)="menuOpen.set(false)"></div>
        <nav class="menu" aria-label="Main menu">
          <a routerLink="/lists" (click)="menuOpen.set(false)">Lists</a>
          <a routerLink="/calendar" (click)="menuOpen.set(false)">Calendar</a>
          <a routerLink="/settings" (click)="menuOpen.set(false)">Settings</a>
          <a routerLink="/help" (click)="menuOpen.set(false)">How to use</a>
          <a routerLink="/release-notes" (click)="menuOpen.set(false)">What's new</a>
          <button class="theme-toggle" (click)="theme.toggleMode()">
            {{ theme.state().mode === 'dark' ? '☀ Light mode' : '☾ Dark mode' }}
          </button>
          <button class="sign-out" (click)="signOut()">Sign out</button>
        </nav>
      }

      <section class="dump-card">
        <textarea
          #dumpInput
          class="dump-input"
          [(ngModel)]="draft"
          name="draft"
          [placeholder]="placeholder()"
          rows="5"
          autocomplete="off"
          [disabled]="stage() === 'parsing' || stage() === 'committing'"
          (keydown.meta.enter)="$event.preventDefault(); submit()"
          (keydown.control.enter)="$event.preventDefault(); submit()"
        ></textarea>

        <div class="dump-actions">
          @if (voice.supported()) {
            <button
              type="button"
              class="mic"
              [class.listening]="voice.listening()"
              (click)="toggleMic()"
              [attr.aria-label]="voice.listening() ? 'Stop transcribing' : 'Start transcribing'"
            >
              @if (voice.listening()) { <span class="rec"></span> Listening… }
              @else { 🎤 Speak }
            </button>
          }
          <button
            type="button"
            class="submit"
            (click)="submit()"
            [disabled]="!draft.trim() || stage() === 'parsing' || stage() === 'committing'"
          >
            @if (stage() === 'parsing') { <span class="spinner"></span> Parsing… }
            @else { Send }
          </button>
        </div>

        @if (voice.listening() && voice.transcript()) {
          <p class="transcript">{{ voice.transcript() }}</p>
        }
      </section>

      @if (result(); as r) {
        @switch (r.mode) {
          @case ('query') {
            <section class="reply">
              <p>{{ r.reply }}</p>
              <button class="ghost small" (click)="reset()">Ask another</button>
            </section>
          }
          @case ('follow_up') {
            <section class="reply follow-up">
              <p class="q">{{ r.reply }}</p>
              <p class="hint">Type your answer above and send again.</p>
            </section>
          }
          @case ('capture') {
            <section class="review">
              <header class="review-header">
                <p class="summary">{{ r.reply }}</p>
                @if (r.items.length > 0) {
                  <button class="confirm-all" (click)="confirmAll()" [disabled]="stage() === 'committing'">
                    Confirm all ({{ activeCount() }})
                  </button>
                }
              </header>

              @if (r.items.length === 0) {
                <p class="muted small">Nothing actionable found in that. Try again or ask a question instead.</p>
              }

              <ul class="cards">
                @for (item of r.items; track $index; let i = $index) {
                  <li class="card" [class.skipped]="skipped().has(i)">
                    <div class="card-body">
                      <p class="describe">{{ describe(item) }}</p>
                      @if (item.reasoning) {
                        <p class="reason">“{{ item.reasoning }}”</p>
                      }
                    </div>
                    <div class="card-actions">
                      @if (skipped().has(i)) {
                        <button class="ghost small" (click)="unskip(i)">Bring back</button>
                      } @else {
                        <button class="ghost small" (click)="skip(i)">Skip</button>
                      }
                    </div>
                  </li>
                }
              </ul>

              @if (r.items.length > 0) {
                <button
                  class="commit-btn"
                  (click)="commit()"
                  [disabled]="activeCount() === 0 || stage() === 'committing'"
                >
                  @if (stage() === 'committing') { <span class="spinner"></span> Saving… }
                  @else { Save {{ activeCount() }} {{ activeCount() === 1 ? 'item' : 'items' }} }
                </button>
              }
            </section>
          }
        }
      }

      @if (lastSummary(); as s) {
        <p class="commit-result">
          Saved {{ s.applied }} {{ s.applied === 1 ? 'item' : 'items' }}.
          @if (s.errors.length) { <span class="err"> {{ s.errors.length }} failed.</span> }
        </p>
      }

      @if (error(); as e) { <p class="error">{{ e }}</p> }
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; background:var(--bg-canvas); color:var(--text-primary); }
    .wrap { max-width:36rem; margin:0 auto; padding:var(--s-6) var(--s-5) var(--s-8); }

    header { display:flex; align-items:flex-start; justify-content:space-between; gap:var(--s-4); margin-bottom:var(--s-6); }
    h1 { margin:0; font-family:var(--font-display); font-size:var(--fs-h1); }
    .who { color:var(--text-tertiary); margin:var(--s-1) 0 0; font-size:var(--fs-small); }
    .hamburger { background:transparent; border:1px solid var(--line-default); border-radius:var(--r-md); padding:var(--s-2) var(--s-3); color:var(--text-primary); cursor:pointer; font-size:var(--fs-h2); line-height:1; }
    .hamburger:hover { border-color:var(--accent); color:var(--accent); }

    .menu-backdrop { position:fixed; inset:0; background:rgba(0,0,0,0.25); z-index:50; }
    .menu { position:fixed; top:0; right:0; bottom:0; width:min(18rem, 80vw); background:var(--bg-raised); border-left:1px solid var(--line-default); box-shadow:var(--shadow-lg); padding:var(--s-6) var(--s-5); display:flex; flex-direction:column; gap:var(--s-2); z-index:51; }
    .menu a, .menu button { background:transparent; border:0; color:var(--text-primary); text-decoration:none; text-align:left; padding:var(--s-3) var(--s-2); font-size:var(--fs-body); border-radius:var(--r-md); cursor:pointer; }
    .menu a:hover, .menu button:hover { background:var(--bg-surface); color:var(--accent); }
    .menu .sign-out { color:var(--danger); margin-top:auto; border-top:1px solid var(--line-subtle); border-radius:0; }
    .menu .theme-toggle { color:var(--text-secondary); }

    .dump-card { background:var(--bg-raised); border:1px solid var(--line-subtle); border-radius:var(--r-lg); padding:var(--s-4); box-shadow:var(--shadow-sm); margin-bottom:var(--s-5); }
    .dump-input { width:100%; box-sizing:border-box; padding:var(--s-3) var(--s-4); font-size:var(--fs-body); line-height:1.5; border-radius:var(--r-md); border:1px solid var(--line-default); background:var(--bg-sunken); color:var(--text-primary); resize:vertical; font-family:inherit; }
    .dump-input:focus { outline:2px solid var(--accent); outline-offset:1px; border-color:transparent; }
    .dump-input:disabled { opacity:0.7; }
    .dump-actions { display:flex; gap:var(--s-2); margin-top:var(--s-3); }
    .mic, .submit { padding:var(--s-3) var(--s-5); font-size:var(--fs-body); font-weight:600; border-radius:var(--r-md); border:0; cursor:pointer; display:inline-flex; align-items:center; gap:var(--s-2); }
    .mic { background:transparent; border:1px solid var(--line-default); color:var(--text-primary); }
    .mic:hover { border-color:var(--accent); color:var(--accent); }
    .mic.listening { background:var(--danger); color:var(--text-on-accent); border-color:transparent; animation:pulse 1.4s ease-in-out infinite; }
    .submit { background:var(--accent); color:var(--text-on-accent); flex:1; justify-content:center; }
    .submit:hover:not(:disabled) { background:var(--accent-hover); }
    .submit:disabled { opacity:0.5; cursor:default; }
    .rec { width:0.7rem; height:0.7rem; background:#fff; border-radius:var(--r-pill); }
    .spinner { width:1rem; height:1rem; border:2px solid rgba(255,255,255,0.4); border-top-color:currentColor; border-radius:50%; animation:spin 0.7s linear infinite; }
    .transcript { color:var(--text-secondary); font-style:italic; font-size:var(--fs-small); margin:var(--s-3) 0 0; }

    .reply { background:var(--bg-surface); border:1px solid var(--line-subtle); border-radius:var(--r-lg); padding:var(--s-4); margin-bottom:var(--s-4); }
    .reply p { margin:0 0 var(--s-3); line-height:1.5; }
    .reply.follow-up .q { font-weight:600; }
    .reply.follow-up .hint { color:var(--text-tertiary); font-size:var(--fs-small); margin:0; }

    .review { display:flex; flex-direction:column; gap:var(--s-3); }
    .review-header { display:flex; align-items:center; justify-content:space-between; gap:var(--s-3); flex-wrap:wrap; }
    .summary { margin:0; color:var(--text-secondary); font-style:italic; flex:1; min-width:14rem; }
    .confirm-all { background:transparent; border:1px solid var(--accent); color:var(--accent); padding:var(--s-2) var(--s-3); font-size:var(--fs-small); border-radius:var(--r-md); cursor:pointer; font-weight:600; }
    .confirm-all:hover:not(:disabled) { background:var(--accent); color:var(--text-on-accent); }
    .confirm-all:disabled { opacity:0.5; cursor:default; }

    .cards { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:var(--s-2); }
    .card { display:flex; gap:var(--s-3); align-items:flex-start; background:var(--bg-raised); border:1px solid var(--line-subtle); border-radius:var(--r-md); padding:var(--s-3) var(--s-4); box-shadow:var(--shadow-sm); transition:opacity var(--dur-fast) var(--ease-out); }
    .card.skipped { opacity:0.4; }
    .card.skipped .describe { text-decoration:line-through; }
    .card-body { flex:1; min-width:0; }
    .describe { margin:0; font-size:var(--fs-body); }
    .reason { margin:var(--s-1) 0 0; color:var(--text-tertiary); font-size:var(--fs-small); font-style:italic; }
    .card-actions { display:flex; gap:var(--s-2); align-items:center; }
    .ghost.small { background:transparent; border:1px solid var(--line-default); color:var(--text-secondary); padding:var(--s-1) var(--s-3); font-size:var(--fs-small); border-radius:var(--r-md); cursor:pointer; }
    .ghost.small:hover { border-color:var(--accent); color:var(--accent); }

    .commit-btn { background:var(--accent); color:var(--text-on-accent); border:0; padding:var(--s-3) var(--s-5); font-size:var(--fs-body); font-weight:600; border-radius:var(--r-md); cursor:pointer; display:inline-flex; align-items:center; gap:var(--s-2); justify-content:center; }
    .commit-btn:hover:not(:disabled) { background:var(--accent-hover); }
    .commit-btn:disabled { opacity:0.5; cursor:default; }

    .commit-result { color:var(--success); margin-top:var(--s-3); font-size:var(--fs-small); }
    .commit-result .err { color:var(--danger); }
    .error { color:var(--danger); margin-top:var(--s-3); font-size:var(--fs-small); }
    .muted.small { color:var(--text-tertiary); font-size:var(--fs-small); }

    @keyframes pulse { 0%,100% { box-shadow:0 0 0 0 var(--accent-soft); } 50% { box-shadow:0 0 0 10px transparent; } }
    @keyframes spin { to { transform:rotate(360deg); } }
  `],
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
      // Preload context so the first brain-dump call has a real lists+members+profiles set.
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

      // For follow-up, remember THIS turn; for query/capture, the dialog ends after commit/answer.
      if (parsed.mode === 'follow_up') {
        this.prior = { transcript, reply: parsed.reply };
      } else {
        this.prior = null;
      }

      this.draft = '';
      this.stage.set(parsed.mode === 'capture' ? 'review' : 'idle');
      // Refocus the input for fast follow-on capture.
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
      // Clear conversational state — capture flow is one-and-done per §2.1.1.
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
