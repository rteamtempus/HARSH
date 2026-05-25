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

  /** Email + password sign-in (no email round-trip). */
  async signInWithPassword(email: string, password: string): Promise<void> {
    const { error } = await this.supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  /**
   * Email + password sign-up. If email confirmation is enabled in Supabase
   * (Auth → Providers → Email → "Confirm email"), a one-time confirmation
   * email is sent. Disable that toggle to eliminate the email round-trip
   * entirely once you're sure the address is yours.
   */
  async signUp(email: string, password: string): Promise<void> {
    const { error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    });
    if (error) throw error;
  }

  /**
   * Magic-link fallback. Used as the "forgot password" escape hatch — sends
   * an email with a sign-in link. Same Supabase rate cap as before.
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

  /**
   * Update the currently signed-in user's password. Used by the "set a
   * password after recovery" flow — the user lands here via a magic link,
   * then we let them pick a stable password.
   */
  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await this.supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

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

/**
 * Generate a strong human-friendly password. ~110 bits of entropy:
 * 20 chars from a 64-char alphabet with no visually-ambiguous glyphs.
 * Crypto-random (window.crypto). Safe to display on screen — caller is
 * expected to surface it to the user once and never persist it.
 */
export function generatePassword(length = 20): string {
  // Avoid 0/O/o, 1/l/I, etc. — easier to read off screen / copy by hand.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ' + 'abcdefghijkmnpqrstuvwxyz' + '23456789' + '!@#%&*-=+?';
  const out = new Array<string>(length);
  const rand = new Uint32Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(rand);
  } else {
    for (let i = 0; i < length; i++) rand[i] = Math.floor(Math.random() * 0xffffffff);
  }
  for (let i = 0; i < length; i++) out[i] = alphabet[rand[i] % alphabet.length];
  return out.join('');
}
