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

  constructor() {
    // The display is an ambient TV surface; default it to dark unless the user
    // has explicitly saved a theme. We must read the stored flag BEFORE
    // injecting ThemeService, because ThemeService persists its applied state on
    // construction — so once it's injected, localStorage is always populated.
    let saved = false;
    try { saved = !!localStorage.getItem('harsh.theme'); } catch { /* private mode, etc. */ }
    const theme = inject(ThemeService);
    if (!saved) theme.apply({ mode: 'dark' });
  }
}
