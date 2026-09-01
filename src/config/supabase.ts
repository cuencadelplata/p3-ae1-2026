import { createClient } from '@supabase/supabase-js';

import { env } from './env.js';

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});
