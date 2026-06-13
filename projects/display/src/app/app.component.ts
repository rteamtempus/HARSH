import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from 'data-access';
import { UpdateNotifierComponent } from './update-notifier/update-notifier.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, UpdateNotifierComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  protected readonly title = signal('display');
  private readonly theme = inject(ThemeService);

  constructor() {
    // The display is an ambient TV surface and its wall-mode text colors are
    // tuned for a DARK canvas. The shared ThemeService defaults to light, where
    // wall-mode's light cream text is invisible on the light background — which
    // reads as a blank screen on a fresh device. Default the display to dark
    // unless the user has explicitly saved a theme choice. Runs at the app
    // shell (root) so it applies before sign-in / board ever render.
    let saved = false;
    try { saved = !!localStorage.getItem('harsh.theme'); } catch { /* private mode, etc. */ }
    if (!saved) this.theme.apply({ mode: 'dark' });
  }
}
