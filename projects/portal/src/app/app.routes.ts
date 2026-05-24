import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';

export const routes: Routes = [
  {
    path: 'sign-in',
    loadComponent: () => import('./sign-in/sign-in.component').then((m) => m.SignInComponent),
  },
  {
    path: 'setup',
    canActivate: [authGuard],
    loadComponent: () => import('./setup/setup.component').then((m) => m.SetupComponent),
  },
  {
    path: 'lists',
    canActivate: [authGuard],
    loadComponent: () => import('./lists/lists.component').then((m) => m.ListsComponent),
  },
  {
    path: 'routines',
    canActivate: [authGuard],
    loadComponent: () => import('./routines/routines.component').then((m) => m.RoutinesComponent),
  },
  {
    path: 'facts',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./household-facts/household-facts.component').then((m) => m.HouseholdFactsComponent),
  },
  {
    path: 'profiles',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./profiles/profiles.component').then((m) => m.ProfilesComponent),
  },
  {
    path: 'context',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./context-notes/context-notes.component').then((m) => m.ContextNotesComponent),
  },
  {
    path: 'calendar',
    canActivate: [authGuard],
    loadComponent: () => import('./calendar/calendar.component').then((m) => m.CalendarComponent),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./settings/settings.component').then((m) => m.SettingsComponent),
  },
  {
    path: 'help',
    canActivate: [authGuard],
    loadComponent: () => import('./help/help.component').then((m) => m.HelpComponent),
  },
  {
    path: 'release-notes',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./release-notes/release-notes.component').then((m) => m.ReleaseNotesComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./home/home.component').then((m) => m.HomeComponent),
  },
  { path: '**', redirectTo: '' },
];
