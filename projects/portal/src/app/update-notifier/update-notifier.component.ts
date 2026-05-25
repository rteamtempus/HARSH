import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, interval } from 'rxjs';

/**
 * Service-worker update banner. See FEATURES.md §0 (the portal is a PWA).
 *
 * Without this, deploys silently get cached by the previous service worker and
 * users have to manually clear site data in DevTools to see the new code.
 * This component asks the Angular SW to check for updates periodically, then
 * surfaces a banner when one is downloaded and ready to activate.
 *
 * Mounted once at the app shell so it appears regardless of which route the
 * user is on. No-ops in dev mode (SW is disabled) and when SW isn't enabled
 * (e.g. unsupported browser).
 */
@Component({
  selector: 'app-update-notifier',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './update-notifier.component.html',
  styleUrl: './update-notifier.component.scss',
})
export class UpdateNotifierComponent implements OnInit {
  private readonly sw = inject(SwUpdate);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly available = signal(false);

  ngOnInit(): void {
    if (!this.sw.isEnabled) return;

    // Banner appears the moment the SW downloads a new version.
    this.sw.versionUpdates
      .pipe(
        filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.available.set(true));

    // Periodic poll so long-running sessions notice deploys without a refresh.
    // 6h matches the cache TTL we set on /index.html via vercel.json (no-cache),
    // so this is the slowest path; usually the SW spots updates within seconds
    // of a navigation.
    interval(6 * 60 * 60 * 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.sw.checkForUpdate());

    // Also check whenever the tab comes back into focus — covers the common
    // case of leaving HARSH open on your phone for a day and coming back.
    if (typeof document !== 'undefined') {
      const onFocus = () => void this.sw.checkForUpdate();
      document.addEventListener('visibilitychange', onFocus);
      this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', onFocus));
    }
  }

  async reload(): Promise<void> {
    if (this.sw.isEnabled) {
      try { await this.sw.activateUpdate(); } catch { /* fall through to reload anyway */ }
    }
    document.location.reload();
  }
}
