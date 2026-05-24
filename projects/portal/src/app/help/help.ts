import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

// "How to use" — see FEATURES.md §9.2.
// Tone: friendly + conversational, not a dry manual. Update as features land.
// Each section: what it does, how to use it, voice/tap examples where relevant.

@Component({
  selector: 'app-help',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="help">
      <header>
        <h1>How to use this</h1>
        <p class="lede">
          A short tour of what lives where. If something feels missing, it probably
          isn't built yet — check the
          <a routerLink="/release-notes">release notes</a> for what's new.
        </p>
      </header>

      <article>
        <h2>Brain dump (home page)</h2>
        <p>
          Type or talk into the box on the home screen. Don't worry about
          structure — say everything that's in your head. The assistant pulls
          out the to-dos, events, and reminders, and shows you a card per item
          to confirm before anything gets saved.
        </p>
        <p class="status">Status: planned — Phase 1.</p>
      </article>

      <article>
        <h2>Lists</h2>
        <p>
          Make as many lists as you want — Grocery, Hardware Store, Books to
          Read, anything. Default lists come pre-made; rename or remove any of
          them. Brain dump routes new items into the right list automatically.
        </p>
      </article>

      <article>
        <h2>Calendar</h2>
        <p>
          The calendar shows shared events and connected external calendars
          (Google, ICS feeds). Add events via the calendar page or by saying
          "lawn guy is coming next Tuesday at 10."
        </p>
      </article>

      <article>
        <h2>Routines</h2>
        <p>
          Routines are the recurring stuff that doesn't belong on a list (trash,
          lawn, HVAC filter). They surface in the daily briefing when they're
          coming up — they don't pile up as overdue items.
        </p>
        <p class="status">Status: planned — Phase 1.</p>
      </article>

      <article>
        <h2>Briefings (on the TV)</h2>
        <p>
          The display in the living room shows a calm daily briefing — what's
          today, what needs your attention, what's coming. It refreshes a few
          times a day (morning, midday, evening, before bed) and when something
          relevant changes.
        </p>
        <p class="status">Status: planned — Phase 2.</p>
      </article>

      <article>
        <h2>Weekly planning meeting</h2>
        <p>
          Sit down with your spouse, hit record on your phone, talk through
          the week. The app transcribes, pulls out proposed to-dos, events,
          and routine changes, and shows you everything in one screen to
          confirm before anything saves.
        </p>
        <p class="status">Status: planned — Phase 4.</p>
      </article>

      <article>
        <h2>Settings</h2>
        <p>
          Family members, calendars, timezone, voice for the briefings, and
          themes all live in the hamburger menu. Voice is a family-wide
          choice — the assistant uses the same voice on every device.
        </p>
      </article>

      <footer>
        <p>
          <a routerLink="/release-notes">See what's new →</a>
        </p>
      </footer>
    </section>
  `,
  styles: [`
    .help { max-width: 720px; margin: 0 auto; padding: 1.5rem; }
    header { margin-bottom: 2rem; }
    h1 { margin: 0 0 .25rem; }
    .lede { color: var(--text-muted, #6b7785); }
    article { margin-bottom: 1.75rem; }
    article h2 { margin: 0 0 .5rem; font-size: 1.15rem; }
    .status {
      font-size: .85rem;
      color: var(--text-muted, #6b7785);
      font-style: italic;
      margin: .25rem 0 0;
    }
    footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border, #e3e6ea); }
    a { color: var(--accent, #4f7a9a); }
  `],
})
export class HelpComponent {}
