export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/health') {
      return Response.json({ ok: true, service: 'wxpush-gateway' });
    }

    if (pathname !== '/wxsend') {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== 'POST') {
      return Response.json(
        { ok: false, msg: 'Use POST for /wxsend' },
        { status: 405, headers: { Allow: 'POST' } },
      );
    }

    if (!env.WXPUSH_SERVICE) {
      return Response.json(
        { ok: false, msg: 'WXPush service binding is unavailable' },
        { status: 503 },
      );
    }

    try {
      return await env.WXPUSH_SERVICE.fetch(request);
    } catch (error) {
      console.error('WXPush service binding failed:', error);
      return Response.json(
        { ok: false, msg: 'WXPush service is temporarily unavailable' },
        { status: 502 },
      );
    }
  },
};
