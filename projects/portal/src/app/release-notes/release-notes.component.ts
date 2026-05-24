import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Release, ReleaseService } from 'data-access';

// Persistent release-notes page — see FEATURES.md §9.3.
// The first-open-of-day popup is a separate component; this is the history view.

@Component({
  selector: 'app-release-notes',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './release-notes.component.html',
  styleUrl: './release-notes.component.scss',
})
export class ReleaseNotesComponent implements OnInit {
  private readonly releaseService = inject(ReleaseService);
  protected readonly releases = signal<Release[]>([]);
  protected readonly loading = signal(true);

  async ngOnInit() {
    try {
      this.releases.set(await this.releaseService.history());
    } finally {
      this.loading.set(false);
    }
  }
}
