import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService, FamilyService, ListService, ProfileService, ThemeService } from 'data-access';

/**
 * Shared portal header — appears at the top of every authenticated page.
 *
 * Brand on the left (family name + signed-in email, linked to /), hamburger
 * on the right that opens a single slide-out menu with every route. Replaces
 * the previous per-page back buttons.
 *
 * Sign-out also tears down the active realtime subscriptions on the most
 * commonly-loaded services so the next sign-in starts clean.
 */
@Component({
  selector: 'harsh-header',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
})
export class HeaderComponent {
  protected readonly family = inject(FamilyService);
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly lists = inject(ListService);
  private readonly profiles = inject(ProfileService);

  readonly menuOpen = signal(false);

  toggleMenu(): void { this.menuOpen.update((v) => !v); }

  async signOut(): Promise<void> {
    this.menuOpen.set(false);
    this.lists.unsubscribe();
    this.profiles.unsubscribe();
    await this.auth.signOut();
    await this.router.navigateByUrl('/sign-in');
  }
}
