import { createClient } from '@supabase/supabase-js';

import type { Database } from '../types/database.js';
import { env } from './env.js';

export const createSupabaseClient = (url: string, key: string) =>
  createClient<Database>(url, key, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
  });

export const supabase = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_KEY);
