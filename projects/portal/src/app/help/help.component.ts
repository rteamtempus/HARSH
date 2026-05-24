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
  templateUrl: './help.component.html',
  styleUrl: './help.component.scss',
})
export class HelpComponent {}
