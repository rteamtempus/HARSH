import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AiService, AuthService, FamilyService, ListItemRow, ListRow, ListService, ThemeService, VoiceService } from 'data-access';

@Component({
  selector: 'harsh-home',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="wrap">
      <header>
        <div>
          <h1>{{ family.family()?.name ?? 'HARSH' }}</h1>
          <p class="who">{{ auth.user()?.email }}</p>
        </div>
        <div class="header-actions">
          <button class="ghost" (click)="theme.toggleMode()" [attr.aria-label]="'Switch to ' + (theme.state().mode === 'dark' ? 'light' : 'dark') + ' mode'">
            {{ theme.state().mode === 'dark' ? '☀' : '☾' }}
          </button>
          <a routerLink="/calendar" class="ghost">Calendar</a>
          <a routerLink="/settings" class="ghost">Settings</a>
          <button class="ghost" (click)="signOut()">Sign out</button>
        </div>
      </header>

      @if (voice.supported()) {
        <section class="voice" [class.wake-flash]="wakeFlash()">
          <button
            class="mic"
            [class.listening]="voice.listening() || voice.wakeArmed()"
            [disabled]="aiBusy()"
            (click)="toggleMic()"
            [attr.aria-label]="voice.listening() ? 'Stop listening' : 'Start voice command'"
          >
            @if (aiBusy()) { <span class="spinner"></span> }
            @else if (wakeFlash()) { ✨ Heard you! }
            @else if (voice.wakeArmed()) { <span class="rec"></span> Listening for “Hey HARSH” }
            @else if (voice.listening()) { <span class="rec"></span> Listening… }
            @else { 🎤 Tap to speak }
          </button>
          <div class="voice-controls">
            <label class="wake">
              <input type="checkbox" [checked]="voice.wakeArmed()" (change)="toggleWake()" />
              <span>Always listen for “Hey HARSH”</span>
            </label>
            @if (voice.voices().length > 0) {
              <details class="voice-picker">
                <summary>Voice: {{ voice.selectedVoiceName() ?? 'Browser default' }}</summary>
                <div class="picker-body">
                  <select [value]="voice.selectedVoiceName() ?? ''" (change)="pickVoice($event)">
                    <option value="">Browser default</option>
                    @for (v of voice.voices(); track v.name) {
                      <option [value]="v.name">{{ v.name }} ({{ v.lang }})</option>
                    }
                  </select>
                  <button type="button" class="ghost small" (click)="voice.preview()">Preview</button>
                </div>
              </details>
            }
          </div>
          @if ((voice.listening() || voice.wakeArmed()) && voice.transcript()) {
            <p class="transcript">{{ voice.transcript() }}</p>
          }
          @if (lastReply(); as r) { <p class="reply">{{ r }}</p> }
        </section>
      } @else {
        <p class="muted small">Voice input isn't supported in this browser.</p>
      }

      @if (lists.lists().length === 0) {
        <p class="muted empty">No lists yet.</p>
      } @else {
        <nav class="tabs" role="tablist">
          @for (l of lists.lists(); track l.id) {
            <button
              role="tab"
              [class.active]="activeListId() === l.id"
              (click)="selectList(l.id)"
            >{{ l.name }}</button>
          }
        </nav>

        <form class="adder" (submit)="$event.preventDefault(); add()">
          <input
            type="text"
            [(ngModel)]="draft"
            name="draft"
            [placeholder]="addPlaceholder()"
            autocomplete="off"
          />
          <button type="submit" [disabled]="!draft.trim()">Add</button>
        </form>

        <ul class="items">
          @for (item of activeItems(); track item.id) {
            <li [class.checked]="item.checked">
              <button class="check" (click)="toggle(item)" [attr.aria-label]="item.checked ? 'Uncheck' : 'Check'">
                @if (item.checked) { <span>✓</span> }
              </button>
              <span class="text">{{ item.text }}</span>
              <button class="remove" (click)="remove(item)" aria-label="Remove">×</button>
            </li>
          } @empty {
            <li class="muted empty">Nothing here yet. Add the first item above.</li>
          }
        </ul>
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
    .header-actions { display:flex; gap:var(--s-2); }
    .ghost { background:transparent; border:1px solid var(--line-default); padding:var(--s-2) var(--s-3); border-radius:var(--r-md); cursor:pointer; color:var(--text-primary); font-size:var(--fs-small); transition:border-color var(--dur-fast) var(--ease-out); text-decoration:none; display:inline-flex; align-items:center; }
    .ghost:hover { border-color:var(--accent); color:var(--accent); }

    .tabs { display:flex; gap:var(--s-2); margin-bottom:var(--s-4); flex-wrap:wrap; }
    .tabs button { background:var(--bg-surface); border:1px solid var(--line-subtle); color:var(--text-secondary); padding:var(--s-2) var(--s-4); border-radius:var(--r-pill); cursor:pointer; font-size:var(--fs-small); font-weight:500; transition:all var(--dur-fast) var(--ease-out); }
    .tabs button:hover { color:var(--text-primary); border-color:var(--line-default); }
    .tabs button.active { background:var(--accent); color:var(--text-on-accent); border-color:var(--accent); }

    .adder { display:flex; gap:var(--s-2); margin-bottom:var(--s-4); }
    .adder input { flex:1; padding:var(--s-3) var(--s-4); font-size:var(--fs-body); border-radius:var(--r-md); border:1px solid var(--line-default); background:var(--bg-sunken); color:var(--text-primary); }
    .adder input:focus { outline:2px solid var(--accent); outline-offset:1px; border-color:transparent; }
    .adder button { padding:var(--s-3) var(--s-5); font-size:var(--fs-body); border-radius:var(--r-md); border:0; background:var(--accent); color:var(--text-on-accent); font-weight:600; cursor:pointer; transition:background var(--dur-fast) var(--ease-out); }
    .adder button:hover:not(:disabled) { background:var(--accent-hover); }
    .adder button:disabled { opacity:0.5; cursor:default; }

    .items { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:var(--s-2); }
    .items li { display:flex; align-items:center; gap:var(--s-3); background:var(--bg-raised); padding:var(--s-3) var(--s-4); border-radius:var(--r-md); border:1px solid var(--line-subtle); box-shadow:var(--shadow-sm); }
    .items li.checked { opacity:0.55; }
    .items li.checked .text { text-decoration:line-through; }
    .check { width:1.6rem; height:1.6rem; flex:none; border-radius:var(--r-sm); border:1.5px solid var(--line-strong); background:var(--bg-sunken); cursor:pointer; display:grid; place-items:center; color:var(--text-on-accent); font-weight:700; transition:all var(--dur-fast) var(--ease-out); padding:0; }
    .check:hover { border-color:var(--accent); }
    .items li.checked .check { background:var(--success); border-color:var(--success); }
    .text { flex:1; font-size:var(--fs-body); }
    .remove { background:transparent; border:0; color:var(--text-tertiary); font-size:var(--fs-h2); cursor:pointer; padding:0 var(--s-2); line-height:1; }
    .remove:hover { color:var(--danger); }

    .muted.empty { color:var(--text-tertiary); padding:var(--s-5) 0; text-align:center; font-style:italic; }
    .muted.small { color:var(--text-tertiary); font-size:var(--fs-small); margin:var(--s-3) 0; }
    .error { color:var(--danger); margin-top:var(--s-4); font-size:var(--fs-small); }

    .voice { display:flex; flex-direction:column; align-items:center; gap:var(--s-2); margin-bottom:var(--s-5); }
    .mic { width:100%; max-width:18rem; padding:var(--s-4) var(--s-5); font-size:var(--fs-h3); font-weight:600; border:0; border-radius:var(--r-pill); background:var(--accent); color:var(--text-on-accent); cursor:pointer; display:flex; align-items:center; justify-content:center; gap:var(--s-2); transition:background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out); box-shadow:var(--shadow-md); }
    .mic:hover:not(:disabled) { background:var(--accent-hover); }
    .mic:active:not(:disabled) { transform:scale(0.98); }
    .mic.listening { background:var(--danger); animation:pulse 1.4s ease-in-out infinite; }
    .mic:disabled { opacity:0.7; cursor:default; }
    .rec { width:0.8rem; height:0.8rem; background:#fff; border-radius:var(--r-pill); }
    .spinner { width:1.2rem; height:1.2rem; border:2px solid rgba(255,255,255,0.4); border-top-color:#fff; border-radius:50%; animation:spin 0.7s linear infinite; }
    .transcript { color:var(--text-secondary); font-style:italic; max-width:24rem; text-align:center; font-size:var(--fs-small); }
    .reply { color:var(--success); font-size:var(--fs-small); }
    .voice-controls { display:flex; flex-direction:column; align-items:center; gap:var(--s-2); }
    .wake { display:flex; align-items:center; gap:var(--s-2); color:var(--text-tertiary); font-size:var(--fs-small); cursor:pointer; user-select:none; }
    .wake input { accent-color:var(--accent); }
    .voice-picker { color:var(--text-tertiary); font-size:var(--fs-small); }
    .voice-picker summary { cursor:pointer; user-select:none; }
    .picker-body { display:flex; gap:var(--s-2); margin-top:var(--s-2); align-items:center; }
    .voice-picker select { padding:var(--s-1) var(--s-2); border-radius:var(--r-sm); border:1px solid var(--line-default); background:var(--bg-sunken); color:var(--text-primary); font-size:var(--fs-micro); max-width:14rem; }
    .ghost.small { padding:var(--s-1) var(--s-3); font-size:var(--fs-micro); }
    .wake-flash .mic { animation:wakeFlash 0.9s var(--ease-out); background:var(--gold); color:var(--text-on-accent); }
    @keyframes wakeFlash {
      0% { transform:scale(1); box-shadow:var(--shadow-md), 0 0 0 0 var(--gold-soft); }
      40% { transform:scale(1.04); box-shadow:var(--shadow-md), 0 0 0 24px transparent; }
      100% { transform:scale(1); box-shadow:var(--shadow-md), 0 0 0 0 transparent; }
    }
    @keyframes pulse { 0%,100% { box-shadow:var(--shadow-md), 0 0 0 0 var(--accent-soft); } 50% { box-shadow:var(--shadow-md), 0 0 0 16px transparent; } }
    @keyframes spin { to { transform:rotate(360deg); } }
  `],
})
export class HomeComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly family = inject(FamilyService);
  protected readonly lists = inject(ListService);
  protected readonly voice = inject(VoiceService);
  protected readonly theme = inject(ThemeService);
  private readonly ai = inject(AiService);
  private readonly router = inject(Router);

  draft = '';
  readonly activeListId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly aiBusy = signal(false);
  readonly lastReply = signal<string | null>(null);
  readonly wakeFlash = signal(false);
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  readonly activeItems = computed<ListItemRow[]>(() => {
    const id = this.activeListId();
    return id ? this.lists.itemsFor(id) : [];
  });
  readonly addPlaceholder = computed(() => {
    const id = this.activeListId();
    const list = this.lists.lists().find((l) => l.id === id);
    return list ? `Add to ${list.name.toLowerCase()}…` : 'Add an item…';
  });

  constructor() {
    // React to wake-word fires with a chime + visual flash.
    effect(() => {
      const n = this.voice.wakeCount();
      if (n === 0) return;
      this.voice.playChime();
      this.wakeFlash.set(true);
      if (this.flashTimer) clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => this.wakeFlash.set(false), 900);
    });
  }

  pickVoice(ev: Event): void {
    const name = (ev.target as HTMLSelectElement).value || null;
    this.voice.setVoice(name);
  }

  async ngOnInit(): Promise<void> {
    try {
      const fam = this.family.family() ?? (await this.family.loadCurrent());
      if (!fam) {
        await this.router.navigateByUrl('/setup');
        return;
      }
      const lists = await this.lists.loadLists(fam.id);
      if (lists[0]) await this.selectList(lists[0].id);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not load lists');
    }
  }

  ngOnDestroy(): void {
    this.lists.unsubscribe();
    this.voice.stopWakeWord();
  }

  async selectList(id: string): Promise<void> {
    this.activeListId.set(id);
    try {
      await this.lists.loadItems(id);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not load items');
    }
  }

  async add(): Promise<void> {
    const listId = this.activeListId();
    const fam = this.family.family();
    if (!listId || !fam) return;
    const text = this.draft;
    this.draft = '';
    this.error.set(null);
    try {
      await this.lists.addItem(listId, text, fam.id, this.family.me()?.id ?? null);
    } catch (e: any) {
      this.draft = text;
      this.error.set(e?.message ?? 'Could not add item');
    }
  }

  async toggle(item: ListItemRow): Promise<void> {
    try {
      await this.lists.toggleItem(item);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not update');
    }
  }

  async remove(item: ListItemRow): Promise<void> {
    try {
      await this.lists.removeItem(item.id);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not remove');
    }
  }

  async toggleMic(): Promise<void> {
    if (this.voice.listening()) { this.voice.stop(); return; }
    try {
      const transcript = await this.voice.start();
      await this.handleCommand(transcript);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Voice command failed');
    }
  }

  toggleWake(): void {
    if (this.voice.wakeArmed()) { this.voice.stopWakeWord(); return; }
    this.voice.startWakeWord((command) => void this.handleCommand(command));
  }

  private async handleCommand(transcript: string): Promise<void> {
    if (!transcript) return;
    const fam = this.family.family();
    if (!fam) return;
    this.error.set(null);
    this.lastReply.set(null);
    this.aiBusy.set(true);
    try {
      const res = await this.ai.runIntent({
        transcript,
        family_id: fam.id,
        surface: 'portal',
        member_id: this.family.me()?.id ?? null,
      });
      for (const intent of res.intents) {
        if (intent.action === 'view.show_list' && intent.resolved_list_id) {
          await this.selectList(intent.resolved_list_id);
        }
      }
      this.lastReply.set(res.spoken_reply);
      this.voice.speak(res.spoken_reply);
      setTimeout(() => this.lastReply.set(null), 4000);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Voice command failed');
    } finally {
      this.aiBusy.set(false);
    }
  }

  async signOut(): Promise<void> {
    this.lists.unsubscribe();
    await this.auth.signOut();
    await this.router.navigateByUrl('/sign-in');
  }
}
