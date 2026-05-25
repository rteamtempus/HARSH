// Copy to environment.ts and environment.development.ts and fill in values.
// Anon key is fetched from https://supabase.com/dashboard/project/<ref>/settings/api
// Google OAuth client id is from Google Cloud Console → APIs & Services → Credentials.
export const environment = {
  production: false,
  supabaseUrl: 'https://<your-project-ref>.supabase.co',
  supabaseAnonKey: '<anon-key>',
  googleOauthClientId: '<google-oauth-client-id>',
};
