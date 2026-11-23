export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = (env.ALLOWED_ORIGIN || '').replace(/\/$/, '');
    if (allowedOrigin && origin && origin !== allowedOrigin) {
      return new Response('Forbidden', { status: 403 });
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin || '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: { message: 'Method not allowed.' } }, {
        status: 405,
        headers: corsHeaders
      });
    }

    const groqApiKey = env.GROQ_API_KEY || env.Groq_Api_key;
    if (!groqApiKey) {
      return Response.json({ error: { message: 'GROQ_API_KEY is not configured on the Worker.' } }, {
        status: 500,
        headers: corsHeaders
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: { message: 'Invalid JSON request.' } }, {
        status: 400,
        headers: corsHeaders
      });
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return Response.json({ error: { message: 'Messages are required.' } }, {
        status: 400,
        headers: corsHeaders
      });
    }

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`
      },
      body: JSON.stringify({
        model: body.model || 'openai/gpt-oss-20b',
        messages: body.messages,
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? 1024
      })
    });

    const data = await groqResponse.json();
    return Response.json(data, {
      status: groqResponse.status,
      headers: corsHeaders
    });
  }
};
