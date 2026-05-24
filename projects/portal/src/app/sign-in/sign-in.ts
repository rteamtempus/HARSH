import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService, FamilyService } from 'data-access';

@Component({
  selector: 'harsh-sign-in',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="wrap">
      <h1>HARSH</h1>
      <p class="tag">Holly · Ayla · Rory · Stevie · Hazel</p>

      @if (stage() === 'email') {
        <form (submit)="$event.preventDefault(); sendCode()">
          <label>
            Email
            <input
              type="email"
              [(ngModel)]="email"
              name="email"
              autocomplete="email"
              inputmode="email"
              required
            />
          </label>
          <button type="submit" [disabled]="busy()">
            {{ busy() ? 'Sending…' : 'Send code' }}
          </button>
        </form>
      } @else {
        <form (submit)="$event.preventDefault(); verifyCode()">
          <p>Enter the 6-digit code we emailed to <strong>{{ email }}</strong>.</p>
          <label>
            Code
            <input
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]*"
              maxlength="6"
              [(ngModel)]="code"
              name="code"
              required
            />
          </label>
          <button type="submit" [disabled]="busy()">
            {{ busy() ? 'Verifying…' : 'Sign in' }}
          </button>
          <button type="button" class="link" (click)="stage.set('email')">Use a different email</button>
        </form>
      }

      @if (error(); as e) { <p class="error">{{ e }}</p> }
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; background:var(--bg-canvas); color:var(--text-primary); }
    .wrap { max-width:24rem; margin:0 auto; padding:var(--s-7) var(--s-5); }
    h1 { font-family:var(--font-display); font-size:var(--fs-display); margin:0; letter-spacing:-0.02em; line-height:1; }
    .tag { color:var(--text-tertiary); margin:var(--s-2) 0 var(--s-7); font-size:var(--fs-small); letter-spacing:0.02em; }
    form { display:flex; flex-direction:column; gap:var(--s-4); }
    label { display:flex; flex-direction:column; gap:var(--s-1); font-weight:500; color:var(--text-secondary); font-size:var(--fs-small); }
    input { padding:var(--s-3) var(--s-4); font-size:var(--fs-body); border-radius:var(--r-md); border:1px solid var(--line-default); background:var(--bg-sunken); color:var(--text-primary); }
    input:focus { outline:2px solid var(--accent); outline-offset:1px; border-color:transparent; }
    button { padding:var(--s-3) var(--s-4); font-size:var(--fs-body); border-radius:var(--r-md); border:0; background:var(--accent); color:var(--text-on-accent); font-weight:600; cursor:pointer; transition:background var(--dur-fast) var(--ease-out); }
    button:hover:not(:disabled) { background:var(--accent-hover); }
    button:active:not(:disabled) { background:var(--accent-press); }
    button:disabled { opacity:0.5; cursor:default; }
    button.link { background:transparent; color:var(--text-secondary); padding:var(--s-1); font-weight:400; text-decoration:underline; }
    button.link:hover:not(:disabled) { background:transparent; color:var(--accent); }
    .error { color:var(--danger); font-size:var(--fs-small); }
  `],
})
export class SignInComponent {
  private readonly auth = inject(AuthService);
  private readonly family = inject(FamilyService);
  private readonly router = inject(Router);

  email = '';
  code = '';
  readonly stage = signal<'email' | 'code'>('email');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  async sendCode(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.auth.sendOtp(this.email.trim().toLowerCase());
      this.stage.set('code');
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not send code');
    } finally {
      this.busy.set(false);
    }
  }

  async verifyCode(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.auth.verifyOtp(this.email.trim().toLowerCase(), this.code.trim());
      const fam = await this.family.loadCurrent();
      await this.router.navigateByUrl(fam ? '/' : '/setup');
    } catch (e: any) {
      this.error.set(e?.message ?? 'Invalid code');
    } finally {
      this.busy.set(false);
    }
  }
}
