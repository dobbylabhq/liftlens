// Worker route (see wrangler.jsonc run_worker_first):
//   /assets/*  — a missing chunk must 404 instead of falling back to index.html.
//
// The SPA fallback would answer a missing script with index.html, and /assets/* is cached
// for a year as immutable → the browser remembers that HTML as the script → blank page that a
// reload can't fix. So that case becomes an uncached 404.

export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request)
    const type = res.headers.get('content-type') || ''
    if (res.status === 200 && type.includes('text/html')) {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
    }
    return res
  },
}
