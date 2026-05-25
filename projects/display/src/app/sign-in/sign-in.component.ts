import { ChangeDetectionStrategy, Component, OnInit, effect, inject, signal } from '@angular/core';
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
  templateUrl: './sign-in.component.html',
  styleUrl: './sign-in.component.scss',
})
export class DisplaySignInComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  email = '';
  readonly stage = signal<'email' | 'sent'>('email');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(async () => {
      if (this.auth.session()) await this.router.navigateByUrl('/');
    });
  }

  ngOnInit(): void {
    if (this.auth.session()) void this.router.navigateByUrl('/');
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
