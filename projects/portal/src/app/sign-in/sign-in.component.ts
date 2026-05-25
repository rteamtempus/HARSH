import { ChangeDetectionStrategy, Component, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService, FamilyService } from 'data-access';

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
  readonly stage = signal<'email' | 'sent'>('email');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    // Redirect to home (or setup) the moment the magic link lands and the
    // Supabase client picks up the session from the URL hash.
    effect(async () => {
      const session = this.auth.session();
      if (!session) return;
      const fam = await this.family.loadCurrent();
      await this.router.navigateByUrl(fam ? '/' : '/setup');
    });
  }

  ngOnInit(): void {
    // If the user is already signed in (returning visit), bounce them home immediately.
    if (this.auth.session()) {
      void this.bounceHome();
    }
  }

  private async bounceHome(): Promise<void> {
    const fam = await this.family.loadCurrent();
    await this.router.navigateByUrl(fam ? '/' : '/setup');
  }

  async sendLink(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.auth.sendMagicLink(this.email.trim().toLowerCase());
      this.stage.set('sent');
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not send sign-in link');
    } finally {
      this.busy.set(false);
    }
  }
}
