import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ReleasePopupComponent } from './release-notes/release-popup';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ReleasePopupComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('portal');
}
