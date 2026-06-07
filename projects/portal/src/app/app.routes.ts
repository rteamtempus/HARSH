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
    path: 'briefing',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./briefing/briefing.component').then((m) => m.BriefingComponent),
  },
  {
    path: 'recipes',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./recipes/recipes.component').then((m) => m.RecipesComponent),
  },
  {
    path: 'inventory',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./inventory/inventory.component').then((m) => m.InventoryComponent),
  },
  {
    path: 'waste',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./waste/waste.component').then((m) => m.WasteComponent),
  },
  {
    path: 'meals',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./meals/meals.component').then((m) => m.MealsComponent),
  },
  {
    path: 'meeting',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./meeting/meeting.component').then((m) => m.MeetingComponent),
  },
  {
    path: 'meeting/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./meeting/meeting-review.component').then((m) => m.MeetingReviewComponent),
  },
  {
    path: 'auth/google/callback',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./auth/google-callback.component').then((m) => m.GoogleCallbackComponent),
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
