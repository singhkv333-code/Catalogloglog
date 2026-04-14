// Supabase client (shared)
// PORT FROM OLD PROJECT: Supabase URL + anon key copied from `Catalog/userentry/index.html`

let _client = null;

export const SUPABASE_URL = 'https://pjsyvlhwuhdibpahputx.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqc3l2bGh3dWhkaWJwYWhwdXR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3OTE2OTMsImV4cCI6MjA4NTM2NzY5M30._5uc9ukbShs4kVblc8EpkQYTF6aFTth1vcXEJPQixxw';

function _createSupabaseClient() {
  const factory = window?.supabase?.createClient;
  if (typeof factory !== 'function') {
    throw new Error(
      'Supabase SDK not found. Include `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>` before importing supabase-client.js.'
    );
  }
  return factory(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export function getSupabaseClient() {
  if (_client) return _client;
  _client = _createSupabaseClient();
  return _client;
}
