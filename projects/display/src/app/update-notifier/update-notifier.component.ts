import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, interval } from 'rxjs';

/**
 * Service-worker update banner for the display PWA. Mirrors the portal's
 * UpdateNotifierComponent.
 *
 * Without this, deploys get silently cached by the previous service worker and
 * the display keeps showing old code until site data is cleared. This asks the
 * Angular SW to check for updates periodically + on focus, then surfaces a
 * "Reload" banner when a new version is downloaded and ready to activate.
 *
 * Mounted once at the app shell. No-ops in dev (SW disabled) and on browsers
 * without SW support.
 */
@Component({
  selector: 'harsh-update-notifier',
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

    // Periodic poll so the long-running TV session notices deploys without a
    // manual refresh — the display is meant to stay open for days.
    interval(6 * 60 * 60 * 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.sw.checkForUpdate());

    // Also check when the tab/app regains focus (e.g. waking the kiosk).
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
