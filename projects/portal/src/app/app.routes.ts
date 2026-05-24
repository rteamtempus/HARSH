import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';

export const routes: Routes = [
  {
    path: 'sign-in',
    loadComponent: () => import('./sign-in/sign-in').then((m) => m.SignInComponent),
  },
  {
    path: 'setup',
    canActivate: [authGuard],
    loadComponent: () => import('./setup/setup').then((m) => m.SetupComponent),
  },
  {
    path: 'calendar',
    canActivate: [authGuard],
    loadComponent: () => import('./calendar/calendar').then((m) => m.CalendarComponent),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./settings/settings').then((m) => m.SettingsComponent),
  },
  {
    path: 'help',
    canActivate: [authGuard],
    loadComponent: () => import('./help/help').then((m) => m.HelpComponent),
  },
  {
    path: 'release-notes',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./release-notes/release-notes').then((m) => m.ReleaseNotesComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./home/home').then((m) => m.HomeComponent),
  },
  { path: '**', redirectTo: '' },
];
