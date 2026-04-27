// Shared Supabase client for all views.
// Uses the Supabase JS SDK loaded from CDN (see HTML files).
// The "publishable" key is safe for client-side code — it's gated by RLS policies.

const SUPABASE_URL = 'https://ncwddjohtfjdlebvrmiq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_AAYrg5863rclvkSMvIaL2A_4-TVl2dE';

// `supabase` global is exposed by the @supabase/supabase-js CDN bundle.
// eslint-disable-next-line no-undef
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Expose for other scripts on the page.
window.sb = sb;
