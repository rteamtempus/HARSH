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
  template: `
    @if (open() && releases().length > 0) {
      <div class="backdrop" (click)="dismiss()">
        <div class="card" role="dialog" aria-labelledby="rn-heading" (click)="$event.stopPropagation()">
          <header>
            <h2 id="rn-heading">What's new</h2>
            <button type="button" class="close" (click)="dismiss()" aria-label="Dismiss">×</button>
          </header>

          <div class="body">
            @for (r of releases(); track r.version) {
              <section>
                <div class="ver-line">
                  <strong>v{{ r.version }}</strong>
                  <time>{{ r.released_at | date: 'mediumDate' }}</time>
                </div>
                @if (r.notes.new_features.length) {
                  <h3>New</h3>
                  <ul>@for (it of r.notes.new_features; track it) { <li>{{ it }}</li> }</ul>
                }
                @if (r.notes.improvements.length) {
                  <h3>Improvements</h3>
                  <ul>@for (it of r.notes.improvements; track it) { <li>{{ it }}</li> }</ul>
                }
                @if (r.notes.fixes.length) {
                  <h3>Fixes</h3>
                  <ul>@for (it of r.notes.fixes; track it) { <li>{{ it }}</li> }</ul>
                }
              </section>
            }
          </div>

          <footer>
            <button type="button" class="primary" (click)="dismiss()">Got it</button>
          </footer>
        </div>
      </div>
    }
  `,
  styles: [`
    .backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,.4);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000;
      padding: 1rem;
    }
    .card {
      background: var(--surface, #fff);
      color: var(--text, #1d2329);
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,.25);
      max-width: 480px; width: 100%;
      max-height: 80vh; display: flex; flex-direction: column;
    }
    header { padding: 1rem 1.25rem .25rem; display: flex; justify-content: space-between; align-items: center; }
    h2 { margin: 0; font-size: 1.1rem; }
    .close { background: none; border: none; font-size: 1.5rem; line-height: 1; cursor: pointer; color: var(--text-muted, #6b7785); }
    .body { overflow-y: auto; padding: .5rem 1.25rem 1rem; }
    section { padding: .75rem 0; border-bottom: 1px solid var(--border, #e3e6ea); }
    section:last-child { border-bottom: none; }
    .ver-line { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
    .ver-line time { color: var(--text-muted, #6b7785); font-size: .85rem; }
    h3 { margin: .5rem 0 .15rem; font-size: .8rem; text-transform: uppercase; color: var(--text-muted, #6b7785); letter-spacing: .04em; }
    ul { margin: 0; padding-left: 1.25rem; }
    li { margin: .1rem 0; }
    footer { padding: .75rem 1.25rem 1rem; display: flex; justify-content: flex-end; }
    .primary {
      background: var(--accent, #4f7a9a);
      color: white; border: none; border-radius: 6px;
      padding: .5rem 1rem; font-size: .95rem; cursor: pointer;
    }
  `],
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
