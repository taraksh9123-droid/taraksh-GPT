const MAX_CHAT_BYTES = 750000;
const MAX_SAVED_CHATS = 1000;
const MAX_IMAGE_DATA_URL_LENGTH = 160000;
const CLERK_JWKS_CACHE_MS = 60 * 60 * 1000;
const clerkJwksCache = new Map();

function jsonResponse(data, status, corsHeaders) {
  return Response.json(data, { status, headers: corsHeaders });
}

function errorResponse(message, status, corsHeaders) {
  return jsonResponse({ error: { message } }, status, corsHeaders);
}

function getBearerToken(request) {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
  return match ? match[1] : '';
}

function decodeJwtSegment(segment) {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function getClerkJwks(issuer, refresh = false) {
  const cached = clerkJwksCache.get(issuer);
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached.keys;

  const response = await fetch(`${issuer}/.well-known/jwks.json`);
  if (!response.ok) throw new Error('Clerk public signing keys could not be loaded.');
  const jwks = await response.json();
  if (!Array.isArray(jwks.keys)) throw new Error('Clerk returned invalid public signing keys.');
  clerkJwksCache.set(issuer, { keys: jwks.keys, expiresAt: Date.now() + CLERK_JWKS_CACHE_MS });
  return jwks.keys;
}

async function getClerkSession(request, env, allowedOrigins) {
  const token = getBearerToken(request);
  if (!token) return null;

  const issuer = typeof env.CLERK_ISSUER === 'string' ? env.CLERK_ISSUER.replace(/\/$/, '') : '';
  let issuerUrl;
  try {
    issuerUrl = new URL(issuer);
  } catch {
    throw new Error('Set CLERK_ISSUER to the HTTPS issuer URL from your Clerk instance.');
  }
  if (issuerUrl.protocol !== 'https:' || issuerUrl.pathname !== '/' || issuerUrl.search || issuerUrl.hash) {
    throw new Error('CLERK_ISSUER must be an HTTPS origin without a path.');
  }

  const [encodedHeader, encodedClaims, encodedSignature] = token.split('.');
  let header;
  let claims;
  try {
    header = decodeJwtSegment(encodedHeader);
    claims = decodeJwtSegment(encodedClaims);
  } catch {
    return null;
  }
  if (!header || typeof header !== 'object' || Array.isArray(header) ||
      !claims || typeof claims !== 'object' || Array.isArray(claims) ||
      header.alg !== 'RS256' || typeof header.kid !== 'string' ||
      claims.iss !== issuer || typeof claims.sub !== 'string' ||
      typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000) ||
      (typeof claims.nbf === 'number' && claims.nbf > Math.floor(Date.now() / 1000))) {
    return null;
  }
  const authorizedParty = claims.azp;
  const requestOrigin = request.headers.get('Origin');
  if (authorizedParty !== undefined &&
      (typeof authorizedParty !== 'string' || !allowedOrigins.includes(authorizedParty) ||
       (requestOrigin && authorizedParty !== requestOrigin))) {
    return null;
  }

  let keys = await getClerkJwks(issuer);
  let jwk = keys.find((key) => key && key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) {
    keys = await getClerkJwks(issuer, true);
    jwk = keys.find((key) => key && key.kid === header.kid && key.kty === 'RSA');
  }
  if (!jwk) return null;

  let isValid;
  try {
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signature = Uint8Array.from(
      atob(encodedSignature.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encodedSignature.length / 4) * 4, '=')),
      (char) => char.charCodeAt(0)
    );
    isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signature,
      new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`)
    );
  } catch {
    return null;
  }
  if (!isValid) return null;

  const userId = `clerk:${claims.sub}`;
  const now = new Date().toISOString();
  await env.CHAT_HISTORY.prepare(
    'INSERT INTO users (id, provider, provider_user_id, email, name, picture, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture, updated_at = excluded.updated_at'
  ).bind(
    userId,
    'clerk',
    claims.sub,
    null,
    'Clerk user',
    '',
    now,
    now
  ).run();

  return { user_id: userId };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function validateChat(body, pathId) {
  if (!body || typeof body !== 'object' || body.id !== pathId ||
      !Array.isArray(body.messages) || body.messages.length > 500) {
    return 'A valid chat with messages is required.';
  }
  for (const message of body.messages) {
    if (!message || !['user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' || message.content.length > 30000 ||
        ![null, undefined, 'like', 'dislike'].includes(message.feedback)) {
      return 'The chat contains an invalid message.';
    }
    if (message.imageDataUrl !== undefined &&
        (message.role !== 'assistant' || typeof message.imageDataUrl !== 'string' ||
         message.imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH ||
         !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(message.imageDataUrl))) {
      return 'The chat contains an invalid generated image.';
    }
    if (message.imagePrompt !== undefined &&
        (message.role !== 'assistant' || typeof message.imagePrompt !== 'string' ||
         message.imagePrompt.length > 2048 || message.imageDataUrl === undefined)) {
      return 'The chat contains invalid generated image details.';
    }
  }
  if (new TextEncoder().encode(JSON.stringify(body.messages)).length > MAX_CHAT_BYTES) {
    return 'This chat is too large to save.';
  }
  return '';
}

async function handleChats(request, env, url, corsHeaders, allowedOrigins) {
  if (!env.CHAT_HISTORY) return errorResponse('Cloudflare D1 binding CHAT_HISTORY is not configured.', 503, corsHeaders);
  if (!env.CLERK_ISSUER) return errorResponse('Set CLERK_ISSUER on the Cloudflare Worker to enable Clerk authentication.', 503, corsHeaders);
  const session = await getClerkSession(request, env, allowedOrigins);
  if (!session) return errorResponse('Your Clerk session is invalid or expired. Sign in again to sync history.', 401, corsHeaders);

  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/api/chats' && request.method === 'GET') {
    const result = await env.CHAT_HISTORY.prepare(
      'SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM chats WHERE user_id = ? ORDER BY updated_at DESC'
    ).bind(session.user_id).all();
    return jsonResponse({ chats: result.results || [] }, 200, corsHeaders);
  }

  const match = path.match(/^\/api\/chats\/([A-Za-z0-9_-]{1,100})$/);
  if (!match) return errorResponse('Not found.', 404, corsHeaders);
  const chatId = decodeURIComponent(match[1]);

  if (request.method === 'GET') {
    const row = await env.CHAT_HISTORY.prepare(
      'SELECT id, title, messages, created_at AS createdAt, updated_at AS updatedAt FROM chats WHERE id = ? AND user_id = ?'
    ).bind(chatId, session.user_id).first();
    if (!row) return errorResponse('Chat not found.', 404, corsHeaders);
    let messages;
    try {
      messages = JSON.parse(row.messages);
    } catch {
      return errorResponse('Saved chat history is invalid.', 500, corsHeaders);
    }
    return jsonResponse({ chat: { ...row, messages } }, 200, corsHeaders);
  }

  if (request.method === 'PUT') {
    const body = await readJson(request);
    const validationError = validateChat(body, chatId);
    if (validationError) return errorResponse(validationError, 400, corsHeaders);

    const existing = await env.CHAT_HISTORY.prepare('SELECT user_id FROM chats WHERE id = ?')
      .bind(chatId).first();
    if (existing && existing.user_id !== session.user_id) return errorResponse('Chat not found.', 404, corsHeaders);

    const now = new Date().toISOString();
    const createdAt = typeof body.createdAt === 'string' && !Number.isNaN(Date.parse(body.createdAt))
      ? body.createdAt
      : now;
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : 'New chat';
    const saveResult = await env.CHAT_HISTORY.prepare(
      'INSERT INTO chats (id, user_id, title, messages, created_at, updated_at) ' +
      'SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM chats WHERE id = ? AND user_id = ?) ' +
      'OR (SELECT COUNT(*) FROM chats WHERE user_id = ?) < ? ' +
      'ON CONFLICT(id) DO UPDATE SET title = excluded.title, messages = excluded.messages, updated_at = excluded.updated_at ' +
      'WHERE chats.user_id = excluded.user_id'
    ).bind(
      chatId,
      session.user_id,
      title || 'New chat',
      JSON.stringify(body.messages),
      createdAt,
      now,
      chatId,
      session.user_id,
      session.user_id,
      MAX_SAVED_CHATS
    ).run();
    if (saveResult.meta?.changes === 0) {
      return errorResponse(
        'You have reached the 1,000-chat limit. Delete a chat from Recents before creating another. Paid upgrades are not available yet.',
        409,
        corsHeaders
      );
    }
    return jsonResponse({ ok: true }, 200, corsHeaders);
  }

  if (request.method === 'DELETE') {
    await env.CHAT_HISTORY.prepare('DELETE FROM chats WHERE id = ? AND user_id = ?')
      .bind(chatId, session.user_id).run();
    return jsonResponse({ ok: true }, 200, corsHeaders);
  }

  return errorResponse('Method not allowed.', 405, corsHeaders);
}

async function handleGroq(request, env, corsHeaders) {
  const groqApiKey = env.GROQ_API_KEY || env.Groq_Api_key;
  if (!groqApiKey) return errorResponse('GROQ_API_KEY is not configured on the Worker.', 500, corsHeaders);

  const body = await readJson(request);
  if (!body) return errorResponse('Invalid JSON request.', 400, corsHeaders);
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return errorResponse('Messages are required.', 400, corsHeaders);
  }

  const groqRequestBody = {
    model: body.model || 'openai/gpt-oss-20b',
    messages: body.messages,
    temperature: body.temperature ?? 0.7,
    max_completion_tokens: body.max_completion_tokens ?? body.max_tokens ?? 1024
  };
  if (body.reasoning_effort !== undefined) {
    groqRequestBody.reasoning_effort = body.reasoning_effort;
  }

  const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${groqApiKey}`
    },
    body: JSON.stringify(groqRequestBody)
  });
  const data = await groqResponse.json();
  return jsonResponse(data, groqResponse.status, corsHeaders);
}

async function handleImageGeneration(request, env, corsHeaders) {
  if (!env.AI) {
    return errorResponse('Workers AI binding AI is not configured. Add the AI binding to the Worker and deploy it.', 503, corsHeaders);
  }

  const body = await readJson(request);
  if (!body) return errorResponse('Invalid JSON request.', 400, corsHeaders);
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 2048) {
    return errorResponse('An image prompt of 1 to 2048 characters is required.', 400, corsHeaders);
  }

  const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
    prompt: body.prompt.trim()
  });
  if (!result || typeof result.image !== 'string') {
    return errorResponse('Workers AI returned no image.', 502, corsHeaders);
  }

  const imageBytes = Uint8Array.from(atob(result.image), (character) => character.charCodeAt(0));
  return new Response(imageBytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Cache-Control': 'no-store',
      'Content-Type': 'image/jpeg'
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = (env.ALLOWED_ORIGIN || '')
      .split(',')
      .map((value) => value.trim().replace(/\/$/, ''))
      .filter(Boolean);
    const isAccountRoute = url.pathname.startsWith('/api/');
    if (isAccountRoute && !allowedOrigins.length) {
      return new Response('ALLOWED_ORIGIN must be configured for account routes.', { status: 503 });
    }
    if (allowedOrigins.length && origin && !allowedOrigins.includes(origin)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (isAccountRoute && !origin) return new Response('Forbidden', { status: 403 });

    const corsHeaders = {
      'Access-Control-Allow-Origin': origin || allowedOrigins[0] || '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    try {
      if (url.pathname === '/api/images/generate') {
        if (request.method !== 'POST') return errorResponse('Method not allowed.', 405, corsHeaders);
        return await handleImageGeneration(request, env, corsHeaders);
      }
      if (url.pathname === '/api/chats' || url.pathname.startsWith('/api/chats/')) {
        return await handleChats(request, env, url, corsHeaders, allowedOrigins);
      }
      if (url.pathname !== '/') return errorResponse('Not found.', 404, corsHeaders);
      if (request.method !== 'POST') return errorResponse('Method not allowed.', 405, corsHeaders);
      return await handleGroq(request, env, corsHeaders);
    } catch (error) {
      console.error('Worker request failed.', error);
      return errorResponse('The service could not complete the request.', 500, corsHeaders);
    }
  }
};
