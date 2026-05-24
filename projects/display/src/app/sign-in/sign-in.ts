import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from 'data-access';

/**
 * Temporary auth screen for the display. Phase 4 will replace this with a
 * device-pairing flow (Portal generates a code, Display submits it).
 */
@Component({
  selector: 'harsh-display-sign-in',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="wrap">
      <h1 class="h-display">HARSH</h1>
      <p class="muted">Display</p>

      @if (stage() === 'email') {
        <form (submit)="$event.preventDefault(); sendCode()">
          <label>
            Email
            <input type="email" [(ngModel)]="email" name="email" required />
          </label>
          <button type="submit" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send code' }}</button>
        </form>
      } @else {
        <form (submit)="$event.preventDefault(); verifyCode()">
          <p>Enter the code sent to <strong>{{ email }}</strong>.</p>
          <label>
            Code
            <input
              type="text" inputmode="numeric" autocomplete="one-time-code"
              maxlength="6" [(ngModel)]="code" name="code" required
            />
          </label>
          <button type="submit" [disabled]="busy()">{{ busy() ? 'Verifying…' : 'Sign in' }}</button>
        </form>
      }
      @if (error(); as e) { <p class="error">{{ e }}</p> }
    </main>
  `,
  styles: [`
    :host { display:grid; place-items:center; min-height:100dvh; background:var(--bg-canvas); color:var(--text-primary); }
    .wrap { width:min(36rem, 90vw); display:flex; flex-direction:column; gap:var(--s-4); }
    h1 { margin:0; }
    .muted { color:var(--text-tertiary); margin:0 0 var(--s-5); }
    form { display:flex; flex-direction:column; gap:var(--s-4); }
    label { display:flex; flex-direction:column; gap:var(--s-1); color:var(--text-secondary); font-size:var(--fs-small); }
    input { padding:var(--s-4) var(--s-5); font-size:var(--fs-h3); border-radius:var(--r-md); border:1px solid var(--line-default); background:var(--bg-sunken); color:var(--text-primary); }
    input:focus { outline:2px solid var(--accent); border-color:transparent; }
    button { padding:var(--s-4) var(--s-5); font-size:var(--fs-body); border-radius:var(--r-md); border:0; background:var(--accent); color:var(--text-on-accent); font-weight:600; cursor:pointer; }
    button:disabled { opacity:0.5; }
    .error { color:var(--danger); }
  `],
})
export class DisplaySignInComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  email = '';
  code = '';
  readonly stage = signal<'email' | 'code'>('email');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  async sendCode(): Promise<void> {
    this.error.set(null); this.busy.set(true);
    try {
      await this.auth.sendOtp(this.email.trim().toLowerCase());
      this.stage.set('code');
    } catch (e: any) { this.error.set(e?.message ?? 'Could not send'); }
    finally { this.busy.set(false); }
  }

  async verifyCode(): Promise<void> {
    this.error.set(null); this.busy.set(true);
    try {
      await this.auth.verifyOtp(this.email.trim().toLowerCase(), this.code.trim());
      await this.router.navigateByUrl('/');
    } catch (e: any) { this.error.set(e?.message ?? 'Invalid code'); }
    finally { this.busy.set(false); }
  }
}
