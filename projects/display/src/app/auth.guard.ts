import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from 'data-access';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.ready()) {
    await new Promise<void>((resolve) => {
      const check = () => (auth.ready() ? resolve() : setTimeout(check, 20));
      check();
    });
  }
  return auth.user() ? true : router.parseUrl('/sign-in');
};
