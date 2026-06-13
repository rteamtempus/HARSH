import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UpdateNotifierComponent } from './update-notifier/update-notifier.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, UpdateNotifierComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  protected readonly title = signal('display');
}
