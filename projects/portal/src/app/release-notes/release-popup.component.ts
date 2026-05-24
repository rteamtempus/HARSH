import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Release, ReleaseService } from 'data-access';

// First-open-of-day popup — see FEATURES.md §9.3.
// Batches every unread release into a single dismissible card. One popup per
// calendar day, regardless of how many sessions the user has.
//
// Mount once at the portal shell level. Dismissal acknowledges up through the
// newest unread version and marks today's popup as shown.

@Component({
  selector: 'app-release-popup',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './release-popup.component.html',
  styleUrl: './release-popup.component.scss',
})
export class ReleasePopupComponent implements OnInit {
  private readonly releaseService = inject(ReleaseService);
  protected readonly open = signal(false);
  protected readonly releases = signal<Release[]>([]);

  async ngOnInit() {
    try {
      if (!(await this.releaseService.shouldShowPopup())) return;
      const unread = await this.releaseService.unread();
      if (unread.length === 0) return;
      this.releases.set(unread);
      this.open.set(true);
    } catch {
      // Quietly skip — popup is best-effort, not load-critical.
    }
  }

  async dismiss() {
    const top = this.releases()[0];
    this.open.set(false);
    if (top) {
      try { await this.releaseService.acknowledge(top.version); } catch { /* best-effort */ }
    }
  }
}
