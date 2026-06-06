import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import {
  AuthService,
  CalendarAccountRow,
  CalendarService,
  FamilyService,
  GOOGLE_DEFAULT_VOICE,
  MemberRole,
  MemberRow,
  MemberService,
  TTS_ADAPTER,
  TtsAdapter,
  detectTz,
  generatePassword,
} from 'data-access';
import { environment } from '../../environments/environment';

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
  imports: [FormsModule, DatePipe, HeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
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
  readonly syncingAll = signal(false);
  readonly googleClientId = environment.googleOauthClientId;
  readonly editingCalId = signal<string | null>(null);
  readonly editCal = { name: '', url: '', color: DEFAULT_COLORS[0] };

  readonly timezones = COMMON_TIMEZONES;
  readonly detectedTz = detectTz();
  readonly tzBusy = signal(false);
  readonly currentTz = () => this.family.family()?.time_zone ?? this.detectedTz;

  // Quiet hours — backed by families.settings.quiet_hours.
  readonly qhBusy = signal(false);
  quietStartDraft = '21:00';
  quietEndDraft = '07:00';
  quietStart = () => this.family.quietHours().start;
  quietEnd = () => this.family.quietHours().end;

  // Change password (Account section).
  private readonly authService = inject(AuthService);
  newPassword = '';
  readonly pwBusy = signal(false);
  readonly pwError = signal<string | null>(null);
  readonly pwInfo = signal<string | null>(null);
  readonly newPasswordGenerated = signal(false);

  private readonly tts = inject<TtsAdapter>(TTS_ADAPTER);
  readonly voices = signal<Array<{ id: string; label: string; description?: string; locale: string }>>([]);
  readonly voiceBusy = signal(false);
  readonly previewing = signal(false);
  readonly voiceError = signal<string | null>(null);
  readonly currentVoiceId = () => this.family.voiceSettings()?.voiceId ?? GOOGLE_DEFAULT_VOICE;
  readonly selectedVoiceLabel = () => {
    const id = this.currentVoiceId();
    const v = this.voices().find((x) => x.id === id);
    return v ? `${v.label} — ${v.description ?? ''}` : id;
  };

  async ngOnInit(): Promise<void> {
    const fam = this.family.family() ?? (await this.family.loadCurrent());
    if (!fam) { await this.router.navigateByUrl('/setup'); return; }
    await this.calendars.loadAccounts(fam.id);
    const qh = this.family.quietHours();
    this.quietStartDraft = qh.start;
    this.quietEndDraft = qh.end;
    try {
      this.voices.set(await this.tts.listVoices());
    } catch {
      // Voice list is best-effort — picker just falls back to id strings if it fails.
    }
  }

  async saveQuietHours(): Promise<void> {
    this.qhBusy.set(true);
    try {
      await this.family.updateQuietHours(this.quietStartDraft, this.quietEndDraft);
    } catch (e) { console.error(e); }
    finally { this.qhBusy.set(false); }
  }

  generatePw(): void {
    this.newPassword = generatePassword(20);
    this.newPasswordGenerated.set(true);
    this.pwInfo.set('Generated. Copy it and save it somewhere safe before saving.');
    this.pwError.set(null);
  }

  async copyPw(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.newPassword);
      this.pwInfo.set('Copied to clipboard.');
    } catch {
      this.pwInfo.set('Copy failed — select the password manually.');
    }
  }

  async changePassword(): Promise<void> {
    this.pwError.set(null);
    this.pwInfo.set(null);
    if (this.newPassword.length < 8) {
      this.pwError.set('Password must be at least 8 characters');
      return;
    }
    this.pwBusy.set(true);
    try {
      await this.authService.updatePassword(this.newPassword);
      this.pwInfo.set('Password changed. Use the new one next time you sign in.');
      // Clear the field so it doesn't linger on screen, but keep generated flag
      // false so the "save this" warning hides.
      this.newPassword = '';
      this.newPasswordGenerated.set(false);
    } catch (e: any) {
      this.pwError.set(e?.message ?? 'Could not change password');
    } finally {
      this.pwBusy.set(false);
    }
  }

  async setVoice(ev: Event): Promise<void> {
    const id = (ev.target as HTMLSelectElement).value;
    if (!id) return;
    this.voiceBusy.set(true);
    this.voiceError.set(null);
    try {
      await this.family.updateVoiceSettings('google-chirp3-hd', id);
    } catch (e: any) {
      this.voiceError.set(e?.message ?? 'Could not save voice');
    } finally {
      this.voiceBusy.set(false);
    }
  }

  async previewVoice(): Promise<void> {
    this.previewing.set(true);
    this.voiceError.set(null);
    try {
      const result = await this.tts.synthesize(
        'Hi — this is how the assistant will sound when it talks to your family.',
        { voiceId: this.currentVoiceId() },
      );
      const blob = new Blob([result.audio], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.addEventListener('ended', () => URL.revokeObjectURL(url));
      await audio.play();
    } catch (e: any) {
      this.voiceError.set(
        e?.message?.includes('GOOGLE_CLOUD_API_KEY')
          ? 'TTS not configured yet — set GOOGLE_CLOUD_API_KEY on the tts edge function.'
          : e?.message ?? 'Preview failed',
      );
    } finally {
      this.previewing.set(false);
    }
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

  connectGoogle(): void {
    if (!this.googleClientId) {
      this.calError.set('Google OAuth client id is not configured in this build.');
      return;
    }
    const url = this.calendars.googleOauthUrl({
      clientId: this.googleClientId,
      redirectUri: `${window.location.origin}/auth/google/callback`,
    });
    window.location.assign(url);
  }

  async syncAll(): Promise<void> {
    const fam = this.family.family();
    if (!fam) return;
    this.syncingAll.set(true);
    this.calError.set(null);
    try {
      await this.calendars.syncAll(fam.id);
      await this.calendars.loadAccounts(fam.id);
    } catch (err: any) {
      this.calError.set(err?.message ?? 'Sync all failed');
    } finally {
      this.syncingAll.set(false);
    }
  }

  async sync(id: string): Promise<void> {
    this.syncing.set(id);
    try {
      const acc = this.calendars.accounts().find((a) => a.id === id);
      if (!acc) throw new Error('account not found');
      await this.calendars.syncAccount({ id: acc.id, kind: acc.kind });
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
