/**
 * GitHub OAuth relay for the CMS. Deploy free on Cloudflare Workers.
 *
 * A git-based CMS runs entirely in the browser, and a browser cannot hold a
 * GitHub client secret. This is the smallest possible piece of server that
 * exchanges the OAuth code for a token and hands it back to the editor. It
 * stores nothing and has no database.
 *
 * Deploy:
 *   1. GitHub, Settings, Developer settings, OAuth Apps, New OAuth App.
 *        Homepage URL:      https://medpsycmoss.com
 *        Callback URL:      https://<your-worker>.workers.dev/callback
 *   2. Cloudflare, Workers, Create, paste this file.
 *   3. Settings, Variables. Add secrets GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.
 *   4. Put the worker URL in rebuild/admin/config.yml as backend.base_url.
 */

const ALLOWED_ORIGINS = [
  'https://medpsycmoss.com',
  'https://www.medpsycmoss.com',
  'http://localhost:8123',
  'http://localhost:8097',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Step 1: send her to GitHub to approve.
    if (url.pathname === '/auth') {
      const redirect = new URL('https://github.com/login/oauth/authorize');
      redirect.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      redirect.searchParams.set('scope', 'repo,user');
      redirect.searchParams.set('redirect_uri', `${url.origin}/callback`);
      // carry the caller's origin through so the callback can post back to it
      redirect.searchParams.set('state', url.searchParams.get('site_id') || ALLOWED_ORIGINS[0]);
      return Response.redirect(redirect.toString(), 302);
    }

    // Step 2: swap the code for a token and hand it to the opener window.
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      if (!code) return new Response('missing code', { status: 400 });

      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });
      const data = await res.json();

      // Only ever post the token back to an origin we recognise.
      const asked = url.searchParams.get('state') || '';
      const target = ALLOWED_ORIGINS.includes(asked) ? asked : ALLOWED_ORIGINS[0];

      const payload = data.access_token
        ? { token: data.access_token, provider: 'github' }
        : { error: data.error_description || 'authorisation failed' };

      // The handshake the CMS listens for.
      const body = `<!DOCTYPE html><meta charset="utf-8"><title>Signing in</title>
<script>
(function () {
  var msg = 'authorization:github:${data.access_token ? 'success' : 'error'}:' +
            ${JSON.stringify(JSON.stringify(payload))};
  function send(e) { window.opener.postMessage(msg, ${JSON.stringify(target)}); }
  window.addEventListener('message', send, false);
  if (window.opener) {
    window.opener.postMessage('authorizing:github', ${JSON.stringify(target)});
  } else {
    document.body.textContent = 'Open the editor from the site, not directly.';
  }
})();
</script>`;
      return new Response(body, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    }

    return new Response('MedPsycMoss CMS auth. Try /auth.', {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};
