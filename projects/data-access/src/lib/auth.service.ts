import { Injectable, inject, signal } from '@angular/core';
import { Session, User } from '@supabase/supabase-js';
import { SUPABASE } from './supabase.client';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SUPABASE);

  readonly session = signal<Session | null>(null);
  readonly user = signal<User | null>(null);
  readonly ready = signal(false);

  constructor() {
    this.supabase.auth.getSession().then(({ data }) => {
      this.session.set(data.session);
      this.user.set(data.session?.user ?? null);
      this.ready.set(true);
      if (data.session) void this.claimInvitations();
    });
    this.supabase.auth.onAuthStateChange((event, session) => {
      this.session.set(session);
      this.user.set(session?.user ?? null);
      if (event === 'SIGNED_IN' && session) void this.claimInvitations();
    });
  }

  /**
   * Send a magic link. The email contains a clickable URL that lands back on
   * `redirectTo`; the Supabase JS client (with `detectSessionInUrl: true`,
   * which is the default) picks the tokens out of the URL hash and creates
   * the session automatically — no code-entry step.
   *
   * Switched from OTP (6-digit code) to magic link to match the owner's other
   * Supabase project and reduce email volume against the built-in rate cap.
   */
  async sendMagicLink(email: string): Promise<void> {
    const { error } = await this.supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    });
    if (error) throw error;
  }

  /** Link any pending family_member rows that were invited with this user's email. */
  private async claimInvitations(): Promise<void> {
    try {
      await this.supabase.rpc('claim_invitations');
    } catch (e) {
      console.warn('claim_invitations failed', e);
    }
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabase.auth.signOut();
    if (error) throw error;
  }
}
