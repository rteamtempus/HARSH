import { ChangeDetectionStrategy, Component, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService, FamilyService, generatePassword } from 'data-access';

type Mode = 'signIn' | 'signUp';

@Component({
  selector: 'harsh-sign-in',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sign-in.component.html',
  styleUrl: './sign-in.component.scss',
})
export class SignInComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly family = inject(FamilyService);
  private readonly router = inject(Router);

  email = '';
  password = '';
  readonly mode = signal<Mode>('signIn');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);
  readonly generated = signal(false);

  constructor() {
    // Redirect home as soon as the session is established (covers both
    // direct sign-in and the magic-link recovery path).
    effect(async () => {
      const session = this.auth.session();
      if (!session) return;
      const fam = await this.family.loadCurrent();
      await this.router.navigateByUrl(fam ? '/' : '/setup');
    });
  }

  ngOnInit(): void {
    if (this.auth.session()) void this.bounceHome();
  }

  setMode(m: Mode): void {
    this.mode.set(m);
    this.error.set(null);
    this.info.set(null);
    this.generated.set(false);
  }

  generate(): void {
    this.password = generatePassword(20);
    this.generated.set(true);
    this.info.set('Generated. Copy it and save it somewhere safe before creating the account.');
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.password);
      this.info.set('Copied to clipboard.');
    } catch {
      this.info.set('Copy failed — select the password manually.');
    }
  }

  async signIn(): Promise<void> {
    this.error.set(null);
    this.info.set(null);
    this.busy.set(true);
    try {
      await this.auth.signInWithPassword(this.email.trim().toLowerCase(), this.password);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Sign-in failed');
    } finally {
      this.busy.set(false);
    }
  }

  async signUp(): Promise<void> {
    this.error.set(null);
    this.info.set(null);
    if (this.password.length < 8) {
      this.error.set('Password must be at least 8 characters');
      return;
    }
    this.busy.set(true);
    try {
      await this.auth.signUp(this.email.trim().toLowerCase(), this.password);
      this.info.set('Account created. If your project requires email confirmation, check your inbox.');
    } catch (e: any) {
      this.error.set(e?.message ?? 'Sign-up failed');
    } finally {
      this.busy.set(false);
    }
  }

  async forgot(): Promise<void> {
    if (!this.email.trim()) {
      this.error.set('Enter your email above first');
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.auth.sendMagicLink(this.email.trim().toLowerCase());
      this.info.set('Check your email for a sign-in link. Once you\'re in, change your password from Settings.');
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not send sign-in link');
    } finally {
      this.busy.set(false);
    }
  }

  private async bounceHome(): Promise<void> {
    const fam = await this.family.loadCurrent();
    await this.router.navigateByUrl(fam ? '/' : '/setup');
  }
}
