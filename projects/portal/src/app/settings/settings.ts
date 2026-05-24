import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  CalendarAccountRow,
  CalendarService,
  FamilyService,
  MemberRole,
  MemberRow,
  MemberService,
  detectTz,
} from 'data-access';

// Pragmatic shortlist — full IANA db is 500+ entries, this covers everywhere a US/CA family is likely to live.
const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Halifax',
  'America/St_Johns',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Australia/Sydney',
  'UTC',
];

const DEFAULT_COLORS = [
  '#c98a8a', '#d9a85a', '#4f7a9a', '#7a9a4f', '#9a7ac0',
  '#b1432a', '#d89220', '#c4452a', '#9ca665', '#6b8e9e',
];

@Component({
  selector: 'harsh-settings',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="wrap">
      <header>
        <a routerLink="/" class="back">← Back</a>
        <h1>Settings</h1>
      </header>

      <!-- Family -->
      <section>
        <h2>Family</h2>
        <div class="row">
          <span class="dot" [style.background]="'#717744'"></span>
          <div class="meta">
            <strong>Time zone</strong>
            <span class="sub">Used for calendar sync and clock display. Detected: {{ detectedTz }}</span>
          </div>
          <select (change)="setTz($event)" [disabled]="tzBusy()">
            @if (!timezones.includes(currentTz())) {
              <option [value]="currentTz()" selected>{{ currentTz() }}</option>
            }
            @for (z of timezones; track z) {
              <option [value]="z" [selected]="z === currentTz()">{{ z }}</option>
            }
          </select>
        </div>
      </section>

      <!-- Members -->
      <section>
        <h2>Family members</h2>
        <p class="hint">Add an email to invite someone — they'll be linked automatically when they sign in with it.</p>

        <ul class="rows">
          @for (m of family.members(); track m.id) {
            <li class="row" [class.is-me]="m.id === family.me()?.id">
              <span class="dot" [style.background]="m.color"></span>
              <div class="meta">
                <strong>{{ m.display_name }}</strong>
                <span class="sub">
                  {{ m.role }}
                  @if (m.user_id) { · signed in }
                  @else if (m.invited_email) { · invited {{ m.invited_email }} }
                  @else { · no email yet }
                </span>
              </div>
              <button class="ghost" (click)="startEdit(m)">Edit</button>
            </li>
          }
        </ul>

        @if (editing(); as e) {
          <form class="editor" (submit)="$event.preventDefault(); saveEdit()">
            <h3>{{ e.id ? 'Edit member' : 'Add member' }}</h3>
            <label>
              Name
              <input type="text" [(ngModel)]="e.display_name" name="display_name" required />
            </label>
            <label>
              Email <span class="hint inline">(optional — used to link their sign-in)</span>
              <input type="email" [(ngModel)]="e.invited_email" name="invited_email" autocomplete="email" />
            </label>
            <label>
              Role
              <select [(ngModel)]="e.role" name="role">
                <option value="owner">Owner</option>
                <option value="adult">Adult</option>
                <option value="kid">Kid</option>
              </select>
            </label>
            <label>
              Color
              <div class="swatches">
                @for (c of colors; track c) {
                  <button type="button" class="swatch" [class.picked]="e.color === c" [style.background]="c" (click)="e.color = c" [attr.aria-label]="c"></button>
                }
                <input type="color" [(ngModel)]="e.color" name="color" />
              </div>
            </label>
            <div class="row-actions">
              @if (e.id) {
                <button type="button" class="danger" (click)="removeMember(e.id)">Remove</button>
              }
              <button type="button" class="ghost" (click)="editing.set(null)">Cancel</button>
              <button type="submit" class="primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save' }}</button>
            </div>
            @if (memberError(); as err) { <p class="error">{{ err }}</p> }
          </form>
        } @else {
          <button class="add" (click)="startNew()">+ Add member</button>
        }
      </section>

      <!-- Calendars -->
      <section>
        <h2>Calendars</h2>
        <p class="hint">
          Connect calendars by pasting their public iCal (.ics) URL. This works for Google Calendar,
          Apple iCloud (with calendar sharing on), Outlook, and most others. Two-way Google + Apple
          sync via OAuth is coming next.
        </p>

        <ul class="rows">
          @for (c of calendars.accounts(); track c.id) {
            <li class="row cal-row">
              <div class="row-main">
                <span class="dot" [style.background]="c.color"></span>
                <div class="meta">
                  <strong>{{ c.name }}</strong>
                  <span class="sub">
                    {{ c.kind }}
                    @if (c.last_synced_at) { · last synced {{ c.last_synced_at | date:'short' }} }
                    @else { · never synced }
                  </span>
                  @if (c.last_sync_status === 'error' || c.last_sync_status === 'partial') {
                    <span class="sub error">⚠ {{ c.last_sync_error }}</span>
                  }
                </div>
                <button class="ghost small" (click)="toggleEditCal(c.id)">
                  {{ editingCalId() === c.id ? 'Close' : 'Edit' }}
                </button>
                <button class="ghost" (click)="sync(c.id)" [disabled]="syncing() === c.id">
                  {{ syncing() === c.id ? 'Syncing…' : 'Sync now' }}
                </button>
                <button class="danger small" (click)="removeCalendar(c.id)">Remove</button>
              </div>
              @if (editingCalId() === c.id) {
                <form class="editor inline" (submit)="$event.preventDefault(); saveCal(c.id)">
                  <label>
                    Name <input type="text" [(ngModel)]="editCal.name" name="ec_name" required />
                  </label>
                  <label>
                    iCal URL <input type="url" [(ngModel)]="editCal.url" name="ec_url" required />
                  </label>
                  <label>
                    Color
                    <div class="swatches">
                      @for (col of colors; track col) {
                        <button type="button" class="swatch" [class.picked]="editCal.color === col" [style.background]="col" (click)="editCal.color = col"></button>
                      }
                      <input type="color" [(ngModel)]="editCal.color" name="ec_color" />
                    </div>
                  </label>
                  <div class="row-actions">
                    <button type="submit" class="primary" [disabled]="calBusy()">{{ calBusy() ? 'Saving…' : 'Save & re-sync' }}</button>
                  </div>
                </form>
              }
            </li>
          } @empty {
            <li class="muted empty">No calendars yet.</li>
          }
        </ul>

        <form class="editor" (submit)="$event.preventDefault(); addCalendar()">
          <h3>Add ICS calendar</h3>
          <label>
            Name <input type="text" [(ngModel)]="newCal.name" name="cal_name" placeholder="e.g. Family Google" required />
          </label>
          <label>
            iCal URL
            <input type="url" [(ngModel)]="newCal.url" name="cal_url" placeholder="https://calendar.google.com/calendar/ical/.../basic.ics" required />
          </label>
          <label>
            Assign to (optional)
            <select [(ngModel)]="newCal.memberId" name="cal_member">
              <option [ngValue]="null">— shared / family —</option>
              @for (m of family.members(); track m.id) {
                <option [ngValue]="m.id">{{ m.display_name }}</option>
              }
            </select>
          </label>
          <label>
            Color
            <div class="swatches">
              @for (c of colors; track c) {
                <button type="button" class="swatch" [class.picked]="newCal.color === c" [style.background]="c" (click)="newCal.color = c" [attr.aria-label]="c"></button>
              }
              <input type="color" [(ngModel)]="newCal.color" name="cal_color" />
            </div>
          </label>
          <div class="row-actions">
            <button type="submit" class="primary" [disabled]="calBusy()">{{ calBusy() ? 'Adding…' : 'Connect' }}</button>
          </div>
          @if (calError(); as err) { <p class="error">{{ err }}</p> }
        </form>

        <details class="hint-block">
          <summary>How to find your iCal URL</summary>
          <ul>
            <li><strong>Google Calendar:</strong> Settings → click your calendar → "Integrate calendar" → copy the "Secret address in iCal format". Keep that URL private — anyone with it can read the calendar.</li>
            <li><strong>Apple iCloud:</strong> open Calendar on Mac or iCloud.com → right-click the calendar → Share Calendar → check "Public Calendar" → copy the URL (replace <code>webcal://</code> with <code>https://</code>).</li>
            <li><strong>Outlook / Microsoft 365:</strong> Calendar settings → Shared calendars → Publish a calendar → copy the ICS link.</li>
          </ul>
        </details>
      </section>
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; background:var(--bg-canvas); color:var(--text-primary); }
    .wrap { max-width:42rem; margin:0 auto; padding:var(--s-6) var(--s-5) var(--s-9); }
    header { display:flex; align-items:center; gap:var(--s-3); margin-bottom:var(--s-6); }
    h1 { margin:0; font-family:var(--font-display); font-size:var(--fs-h1); }
    .back { color:var(--text-tertiary); text-decoration:none; font-size:var(--fs-small); }
    .back:hover { color:var(--accent); }
    section { margin-top:var(--s-7); }
    h2 { font-family:var(--font-display); font-size:var(--fs-h2); margin:0 0 var(--s-2); }
    h3 { font-size:var(--fs-h3); font-family:var(--font-display); margin:0 0 var(--s-3); }
    .hint, .hint.inline { color:var(--text-tertiary); font-size:var(--fs-small); margin:0 0 var(--s-3); }
    .hint.inline { display:inline; margin:0; font-weight:400; }
    .rows { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:var(--s-2); }
    .row { display:flex; align-items:center; gap:var(--s-3); background:var(--bg-raised); padding:var(--s-3) var(--s-4); border-radius:var(--r-md); border:1px solid var(--line-subtle); }
    .row.is-me { border-color:var(--accent); }
    .dot { width:1.1rem; height:1.1rem; border-radius:var(--r-pill); flex:none; box-shadow:0 0 0 2px var(--bg-raised), 0 0 0 3px var(--line-default); }
    .meta { flex:1; display:flex; flex-direction:column; }
    .sub { color:var(--text-tertiary); font-size:var(--fs-small); }
    .sub.error { color:var(--danger); display:block; margin-top:var(--s-1); word-break:break-word; }
    .cal-row { flex-direction:column; align-items:stretch; gap:var(--s-3); }
    .cal-row .row-main { display:flex; align-items:center; gap:var(--s-3); }
    .cal-row .meta { flex:1; min-width:0; }
    .editor.inline { background:var(--bg-sunken); margin:0; padding:var(--s-3); }
    .muted.empty { color:var(--text-tertiary); font-style:italic; padding:var(--s-5) 0; text-align:center; background:transparent; border:0; }
    .editor { display:flex; flex-direction:column; gap:var(--s-3); margin-top:var(--s-4); padding:var(--s-4) var(--s-5); background:var(--bg-surface); border-radius:var(--r-md); border:1px solid var(--line-subtle); }
    label { display:flex; flex-direction:column; gap:var(--s-1); color:var(--text-secondary); font-size:var(--fs-small); }
    input[type=text], input[type=email], input[type=url], select { padding:var(--s-2) var(--s-3); font-size:var(--fs-body); border-radius:var(--r-md); border:1px solid var(--line-default); background:var(--bg-sunken); color:var(--text-primary); }
    input:focus, select:focus { outline:2px solid var(--accent); outline-offset:1px; border-color:transparent; }
    .swatches { display:flex; flex-wrap:wrap; gap:var(--s-1); align-items:center; }
    .swatch { width:1.5rem; height:1.5rem; border-radius:var(--r-pill); border:2px solid transparent; cursor:pointer; padding:0; }
    .swatch.picked { border-color:var(--text-primary); transform:scale(1.1); }
    input[type=color] { width:2rem; height:1.6rem; padding:0; border:0; background:transparent; cursor:pointer; }
    .row-actions { display:flex; gap:var(--s-2); justify-content:flex-end; margin-top:var(--s-2); flex-wrap:wrap; }
    .primary { padding:var(--s-2) var(--s-4); border:0; background:var(--accent); color:var(--text-on-accent); font-weight:600; border-radius:var(--r-md); cursor:pointer; }
    .primary:hover:not(:disabled) { background:var(--accent-hover); }
    .primary:disabled { opacity:0.5; }
    .ghost { background:transparent; border:1px solid var(--line-default); padding:var(--s-1) var(--s-3); border-radius:var(--r-md); color:var(--text-primary); cursor:pointer; font-size:var(--fs-small); }
    .ghost:hover { border-color:var(--accent); color:var(--accent); }
    .danger { background:transparent; border:1px solid var(--danger); color:var(--danger); padding:var(--s-1) var(--s-3); border-radius:var(--r-md); cursor:pointer; font-size:var(--fs-small); }
    .danger:hover { background:var(--danger); color:#fff; }
    .danger.small, .ghost.small { padding:var(--s-1) var(--s-2); font-size:var(--fs-micro); }
    .add { margin-top:var(--s-3); align-self:flex-start; background:transparent; border:1px dashed var(--accent); color:var(--accent); padding:var(--s-2) var(--s-4); border-radius:var(--r-md); cursor:pointer; font-size:var(--fs-small); }
    .add:hover { background:var(--accent-soft); }
    .error { color:var(--danger); font-size:var(--fs-small); margin:0; }
    .hint-block { margin-top:var(--s-4); color:var(--text-tertiary); font-size:var(--fs-small); }
    .hint-block summary { cursor:pointer; }
    .hint-block ul { margin:var(--s-2) 0 0 var(--s-5); padding:0; display:flex; flex-direction:column; gap:var(--s-2); }
    code { font-family:var(--font-mono); background:var(--bg-sunken); padding:0 var(--s-1); border-radius:var(--r-sm); }
  `],
})
export class SettingsComponent implements OnInit {
  protected readonly family = inject(FamilyService);
  protected readonly calendars = inject(CalendarService);
  private readonly members = inject(MemberService);
  private readonly router = inject(Router);

  readonly colors = DEFAULT_COLORS;
  readonly editing = signal<EditingMember | null>(null);
  readonly busy = signal(false);
  readonly memberError = signal<string | null>(null);

  readonly newCal = { name: '', url: '', color: DEFAULT_COLORS[0], memberId: null as string | null };
  readonly calBusy = signal(false);
  readonly calError = signal<string | null>(null);
  readonly syncing = signal<string | null>(null);
  readonly editingCalId = signal<string | null>(null);
  readonly editCal = { name: '', url: '', color: DEFAULT_COLORS[0] };

  readonly timezones = COMMON_TIMEZONES;
  readonly detectedTz = detectTz();
  readonly tzBusy = signal(false);
  readonly currentTz = () => this.family.family()?.time_zone ?? this.detectedTz;

  async ngOnInit(): Promise<void> {
    const fam = this.family.family() ?? (await this.family.loadCurrent());
    if (!fam) { await this.router.navigateByUrl('/setup'); return; }
    await this.calendars.loadAccounts(fam.id);
  }

  startNew(): void {
    this.memberError.set(null);
    this.editing.set({
      id: null,
      display_name: '',
      color: this.colors[Math.floor(Math.random() * this.colors.length)],
      role: 'adult',
      invited_email: '',
    });
  }
  startEdit(m: MemberRow): void {
    this.memberError.set(null);
    this.editing.set({
      id: m.id,
      display_name: m.display_name,
      color: m.color,
      role: m.role,
      invited_email: m.invited_email ?? '',
    });
  }

  async saveEdit(): Promise<void> {
    const e = this.editing();
    if (!e) return;
    this.busy.set(true);
    this.memberError.set(null);
    try {
      if (e.id) {
        await this.members.updateMember(e.id, {
          display_name: e.display_name,
          color: e.color,
          role: e.role,
          invited_email: e.invited_email,
        });
      } else {
        await this.members.addMember({
          display_name: e.display_name,
          color: e.color,
          role: e.role,
          invited_email: e.invited_email,
        });
      }
      this.editing.set(null);
    } catch (err: any) {
      this.memberError.set(err?.message ?? 'Save failed');
    } finally {
      this.busy.set(false);
    }
  }

  async removeMember(id: string): Promise<void> {
    if (!confirm('Remove this member? They can be re-invited later.')) return;
    this.busy.set(true);
    try {
      await this.members.removeMember(id);
      this.editing.set(null);
    } catch (err: any) {
      this.memberError.set(err?.message ?? 'Remove failed');
    } finally {
      this.busy.set(false);
    }
  }

  async addCalendar(): Promise<void> {
    const fam = this.family.family();
    if (!fam) return;
    if (!this.newCal.name.trim() || !this.newCal.url.trim()) {
      this.calError.set('Name and URL are required');
      return;
    }
    this.calBusy.set(true);
    this.calError.set(null);
    try {
      const account = await this.calendars.addAccount({
        family_id: fam.id,
        kind: 'ics',
        name: this.newCal.name,
        color: this.newCal.color,
        ics_url: this.newCal.url,
        member_id: this.newCal.memberId,
      });
      this.newCal.name = '';
      this.newCal.url = '';
      this.newCal.color = DEFAULT_COLORS[0];
      this.newCal.memberId = null;
      // Trigger an initial sync so the user gets feedback.
      void this.sync(account.id);
    } catch (err: any) {
      this.calError.set(err?.message ?? 'Could not connect calendar');
    } finally {
      this.calBusy.set(false);
    }
  }

  async setTz(ev: Event): Promise<void> {
    const tz = (ev.target as HTMLSelectElement).value;
    this.tzBusy.set(true);
    try {
      await this.family.updateTimeZone(tz);
    } catch (e) { console.error(e); }
    finally { this.tzBusy.set(false); }
  }

  toggleEditCal(id: string): void {
    if (this.editingCalId() === id) { this.editingCalId.set(null); return; }
    const c = this.calendars.accounts().find((a) => a.id === id);
    if (!c) return;
    this.editCal.name = c.name;
    this.editCal.url = c.ics_url ?? '';
    this.editCal.color = c.color;
    this.editingCalId.set(id);
  }

  async saveCal(id: string): Promise<void> {
    this.calBusy.set(true);
    this.calError.set(null);
    try {
      await this.calendars.updateAccount(id, {
        name: this.editCal.name.trim(),
        ics_url: this.editCal.url.trim(),
        color: this.editCal.color,
      });
      this.editingCalId.set(null);
      void this.sync(id);
    } catch (err: any) {
      this.calError.set(err?.message ?? 'Save failed');
    } finally {
      this.calBusy.set(false);
    }
  }

  async sync(id: string): Promise<void> {
    this.syncing.set(id);
    try {
      await this.calendars.syncAccount(id);
      const fam = this.family.family();
      if (fam) await this.calendars.loadAccounts(fam.id);
    } catch (err: any) {
      this.calError.set(err?.message ?? 'Sync failed');
    } finally {
      this.syncing.set(null);
    }
  }

  async removeCalendar(id: string): Promise<void> {
    if (!confirm('Remove this calendar and all of its synced events?')) return;
    try {
      await this.calendars.removeAccount(id);
    } catch (err: any) {
      this.calError.set(err?.message ?? 'Remove failed');
    }
  }
}

interface EditingMember {
  id: string | null;
  display_name: string;
  color: string;
  role: MemberRole;
  invited_email: string;
}
