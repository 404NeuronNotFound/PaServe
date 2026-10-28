import { createClient } from '@supabase/supabase-js';
import { boundedFetch } from '../common/http/request-context.js';

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { global: { fetch: boundedFetch } },
);
