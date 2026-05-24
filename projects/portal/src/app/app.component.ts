import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ReleasePopupComponent } from './release-notes/release-popup.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ReleasePopupComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  protected readonly title = signal('portal');
}
