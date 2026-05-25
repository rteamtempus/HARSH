import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CalendarService } from 'data-access';

/**
 * Google OAuth callback route — Google redirects here with ?code=... after the
 * user grants consent. We hand the code to the gcal-oauth-exchange edge
 * function (which uses the client secret server-side) and redirect to settings.
 *
 * The redirect_uri sent to Google must match the one we use to exchange.
 * Using window.location.origin + '/auth/google/callback' guarantees that
 * symmetry across dev (localhost:4200) and prod (Vercel URL).
 */
@Component({
  selector: 'harsh-google-callback',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './google-callback.component.html',
  styleUrl: './google-callback.component.scss',
})
export class GoogleCallbackComponent implements OnInit {
  private readonly calendars = inject(CalendarService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly busy = signal(true);
  readonly success = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  async ngOnInit() {
    const code = this.route.snapshot.queryParamMap.get('code');
    const oauthError = this.route.snapshot.queryParamMap.get('error');

    if (oauthError) {
      this.busy.set(false);
      this.error.set(`Google denied access: ${oauthError}`);
      return;
    }
    if (!code) {
      this.busy.set(false);
      this.error.set('No authorization code in the URL.');
      return;
    }

    try {
      const result = await this.calendars.exchangeGoogleCode({
        code,
        redirectUri: `${window.location.origin}/auth/google/callback`,
      });
      this.success.set(result.email);
      this.busy.set(false);
      // Brief pause so the user sees the success message, then back to settings.
      setTimeout(() => this.router.navigateByUrl('/settings'), 1200);
    } catch (e: any) {
      this.busy.set(false);
      this.error.set(e?.message ?? 'Could not complete the connection.');
    }
  }
}
