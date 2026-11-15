import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {fetchShareImage} from './preview.mjs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'private, no-store',
};
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, {headers: cors});
  if (request.method !== 'POST') return new Response(null, {status: 405, headers: cors});

  const authorization = request.headers.get('authorization');
  const token = authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token || !authorization) return new Response(null, {status: 401, headers: cors});

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: {headers: {Authorization: authorization}},
    auth: {persistSession: false, autoRefreshToken: false},
  });
  const {data: {user}, error: authError} = await db.auth.getUser(token);
  if (authError || !user) return new Response(null, {status: 401, headers: cors});

  const body = await request.json().catch(() => null);
  const ids = body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 4 ||
    ids.some(id => typeof id !== 'string' || !uuid.test(id))) {
    return new Response(null, {status: 400, headers: cors});
  }

  const {data, error} = await db.from('dvpp_ideas').select('id, url').in('id', ids);
  if (error) return new Response(null, {status: 503, headers: cors});
  const previews = await Promise.all(data.map(async ({id, url}) => ({
    id, url,
    image: url ? await fetchShareImage(url).catch(() => null) : null,
  })));
  return Response.json({previews}, {headers: cors});
});
