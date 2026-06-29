import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

      const SUPABASE_URL = 'https://zzqbonemlbyisnbvghor.supabase.co';
      const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6cWJvbmVtbGJ5aXNuYnZnaG9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMzc5ODksImV4cCI6MjA5NjkxMzk4OX0.EajrX1swPHXKOdl_r23Jl20Y7S_YRTZ8JIB2vSkrj44';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});
