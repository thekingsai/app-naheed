// All database access goes through one gated function in the health project.
export async function db(action, args = {}) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/naheed_api`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: process.env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ p_secret: process.env.DB_API_SECRET, p_action: action, p_args: args }),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`db ${action} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
