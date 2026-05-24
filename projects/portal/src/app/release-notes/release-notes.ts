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
  template: `
    <section class="rn">
      <h1>What's new</h1>

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (releases().length === 0) {
        <p class="muted">No releases yet.</p>
      } @else {
        @for (r of releases(); track r.version) {
          <article>
            <header>
              <h2>v{{ r.version }}</h2>
              <time>{{ r.released_at | date: 'mediumDate' }}</time>
            </header>

            @if (r.notes.new_features.length) {
              <h3>New</h3>
              <ul>
                @for (item of r.notes.new_features; track item) { <li>{{ item }}</li> }
              </ul>
            }
            @if (r.notes.improvements.length) {
              <h3>Improvements</h3>
              <ul>
                @for (item of r.notes.improvements; track item) { <li>{{ item }}</li> }
              </ul>
            }
            @if (r.notes.fixes.length) {
              <h3>Fixes</h3>
              <ul>
                @for (item of r.notes.fixes; track item) { <li>{{ item }}</li> }
              </ul>
            }
          </article>
        }
      }
    </section>
  `,
  styles: [`
    .rn { max-width: 720px; margin: 0 auto; padding: 1.5rem; }
    h1 { margin: 0 0 1.5rem; }
    article { padding: 1rem 0; border-bottom: 1px solid var(--border, #e3e6ea); }
    article header { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
    article h2 { margin: 0; font-size: 1.05rem; }
    article time { color: var(--text-muted, #6b7785); font-size: .85rem; }
    h3 { margin: .75rem 0 .25rem; font-size: .85rem; text-transform: uppercase; color: var(--text-muted, #6b7785); letter-spacing: .04em; }
    ul { margin: 0; padding-left: 1.25rem; }
    li { margin: .15rem 0; }
    .muted { color: var(--text-muted, #6b7785); }
  `],
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
