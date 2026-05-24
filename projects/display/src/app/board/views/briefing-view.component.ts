import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Briefing } from 'data-access';

/**
 * Briefing surface for the display — see FEATURES.md §4.5.
 * Stateless view component. Parent (board) loads briefing data and passes it in.
 * When briefing is null, shows a guidance message.
 */
@Component({
  selector: 'harsh-briefing-view',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './briefing-view.component.html',
  styleUrl: './briefing-view.component.scss',
})
export class BriefingViewComponent {
  readonly briefing = input.required<Briefing | null>();
}
