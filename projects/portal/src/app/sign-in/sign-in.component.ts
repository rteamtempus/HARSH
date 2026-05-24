import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
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
