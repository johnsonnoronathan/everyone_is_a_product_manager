export function Review({ review }) {
  // ruleid: react-dangerously-set-html
  return <div dangerouslySetInnerHTML={{__html: review.body}} />;
}
// ruleid: secret-in-browser-env-var
const supabase = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY);
// ok: secret-in-browser-env-var
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
