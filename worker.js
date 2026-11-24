const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 300;
const SESSION_REFRESH_THRESHOLD_SECONDS = 60 * 60 * 24 * 30;
const MAX_CHAT_BYTES = 750000;

function jsonResponse(data, status, corsHeaders) {
  return Response.json(data, { status, headers: corsHeaders });
}

function errorResponse(message, status, corsHeaders) {
  return jsonResponse({ error: { message } }, status, corsHeaders);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getBearerToken(request) {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer ([a-f0-9]{64})$/i);
  return match ? match[1] : '';
}

async function getSession(request, db) {
  const token = getBearerToken(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  const session = await db.prepare(
    'SELECT user_id, expires_at FROM auth_sessions WHERE session_hash = ? AND expires_at > ?'
  ).bind(tokenHash, now).first();
  if (session && session.expires_at - now < SESSION_LIFETIME_SECONDS - SESSION_REFRESH_THRESHOLD_SECONDS) {
    await db.prepare('UPDATE auth_sessions SET expires_at = ? WHERE session_hash = ?')
      .bind(now + SESSION_LIFETIME_SECONDS, tokenHash).run();
  }
  return session || null;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function createUserSession(db, identity) {
  const now = new Date().toISOString();
  await db.prepare(
    'INSERT INTO users (id, provider, provider_user_id, email, name, picture, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture, updated_at = excluded.updated_at'
  ).bind(
    identity.id,
    identity.provider,
    identity.providerUserId,
    identity.email || null,
    identity.name,
    identity.picture || '',
    now,
    now
  ).run();

  const token = createSessionToken();
  const tokenHash = await sha256(token);
  const sessionExpiry = Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS;
  await db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(Math.floor(Date.now() / 1000)).run();
  await db.prepare(
    'INSERT INTO auth_sessions (session_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(tokenHash, identity.id, sessionExpiry, now).run();

  return {
    token,
    user: {
      id: identity.id,
      provider: identity.provider,
      email: identity.email || '',
      name: identity.name,
      picture: identity.picture || ''
    }
  };
}

function getCookie(request, name) {
  const cookies = request.headers.get('Cookie') || '';
  const cookie = cookies.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!cookie) return '';
  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return '';
  }
}

function makeRedirect(url, cookies = []) {
  const headers = new Headers({ Location: url });
  cookies.forEach((cookie) => headers.append('Set-Cookie', cookie));
  return new Response(null, { status: 302, headers });
}

function makeGitHubAppRedirect(origin, path, valueName, value) {
  const target = new URL(path, origin);
  target.hash = new URLSearchParams({ [valueName]: value }).toString();
  return target.toString();
}

async function startGitHubSignIn(env, url, allowedOrigins) {
  const returnToValue = url.searchParams.get('return_to') || '';
  let returnTo;
  try {
    returnTo = new URL(returnToValue);
  } catch {
    return errorResponse('A valid return URL is required.', 400, {});
  }
  if (!allowedOrigins.includes(returnTo.origin) || returnTo.username || returnTo.password) {
    return errorResponse('The return URL is not allowed.', 403, {});
  }
  const returnPath = returnTo.pathname || '/';
  const appRedirect = (name, value) => makeRedirect(makeGitHubAppRedirect(returnTo.origin, returnPath, name, value));

  if (!env.CHAT_HISTORY) return appRedirect('github_error', 'Cloudflare D1 binding CHAT_HISTORY is not configured.');
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return appRedirect('github_error', 'Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET on the Cloudflare Worker first.');
  }

  const state = createSessionToken();
  const callbackUrl = `${url.origin}/auth/github/callback`;
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
  authorizeUrl.searchParams.set('scope', 'read:user user:email');
  authorizeUrl.searchParams.set('state', state);

  const cookieOptions = 'HttpOnly; Secure; SameSite=Lax; Path=/auth/github/callback; Max-Age=600';
  return makeRedirect(authorizeUrl.toString(), [
    `github_oauth_state=${state}; ${cookieOptions}`,
    `github_return_origin=${encodeURIComponent(returnTo.origin)}; ${cookieOptions}`,
    `github_return_path=${encodeURIComponent(returnPath)}; ${cookieOptions}`
  ]);
}

async function handleGitHubCallback(request, env, url) {
  const origin = getCookie(request, 'github_return_origin');
  const path = getCookie(request, 'github_return_path');
  const returnPath = path.startsWith('/') && !path.startsWith('//') ? path : '/';
  const clearCookies = [
    'github_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/auth/github/callback; Max-Age=0',
    'github_return_origin=; HttpOnly; Secure; SameSite=Lax; Path=/auth/github/callback; Max-Age=0',
    'github_return_path=; HttpOnly; Secure; SameSite=Lax; Path=/auth/github/callback; Max-Age=0'
  ];
  if (!origin) return new Response('Sign-in could not be completed. Return to the app and try again.', { status: 400, headers: { 'Set-Cookie': clearCookies[0] } });

  const redirectToApp = (key, value) => makeRedirect(
    makeGitHubAppRedirect(origin, returnPath, key, value),
    clearCookies
  );
  const state = url.searchParams.get('state') || '';
  if (!state || state !== getCookie(request, 'github_oauth_state')) {
    return redirectToApp('github_error', 'GitHub sign-in could not be verified. Please try again.');
  }
  if (url.searchParams.has('error') || !url.searchParams.get('code')) {
    return redirectToApp('github_error', 'GitHub sign-in was cancelled or denied.');
  }
  if (!env.CHAT_HISTORY || !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return redirectToApp('github_error', 'Cloudflare sign-in or chat-history setup is incomplete.');
  }

  try {
    const callbackUrl = `${url.origin}/auth/github/callback`;
    const tokenBody = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code: url.searchParams.get('code'),
      redirect_uri: callbackUrl,
      state
    });
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenBody
    });
    if (!tokenResponse.ok) return redirectToApp('github_error', 'GitHub could not complete sign-in. Check the OAuth App callback URL.');
    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) return redirectToApp('github_error', 'GitHub did not return an access token.');

    const githubHeaders = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${tokenData.access_token}`,
      'User-Agent': 'Taraksh-GPT'
    };
    const profileResponse = await fetch('https://api.github.com/user', { headers: githubHeaders });
    if (!profileResponse.ok) return redirectToApp('github_error', 'GitHub could not load your profile. Please try again.');
    const profile = await profileResponse.json();
    if (!Number.isSafeInteger(profile.id) || typeof profile.login !== 'string') {
      return redirectToApp('github_error', 'GitHub returned an invalid account profile.');
    }

    let email = typeof profile.email === 'string' ? profile.email : '';
    if (!email) {
      const emailsResponse = await fetch('https://api.github.com/user/emails', { headers: githubHeaders });
      if (emailsResponse.ok) {
        const emails = await emailsResponse.json();
        email = emails.find((item) => item.primary && item.verified)?.email || '';
      }
    }

    const providerUserId = String(profile.id);
    const session = await createUserSession(env.CHAT_HISTORY, {
      id: `github:${providerUserId}`,
      provider: 'github',
      providerUserId,
      email,
      name: profile.name || profile.login,
      picture: profile.avatar_url || ''
    });
    return redirectToApp('github_session', JSON.stringify(session));
  } catch (error) {
    console.error('GitHub sign-in failed.', error);
    return redirectToApp('github_error', 'GitHub sign-in failed. Check your OAuth App and Worker settings.');
  }
}

async function handleLogout(request, env, corsHeaders) {
  if (!env.CHAT_HISTORY) return errorResponse('Cloudflare D1 binding CHAT_HISTORY is not configured.', 503, corsHeaders);
  const token = getBearerToken(request);
  if (token) {
    await env.CHAT_HISTORY.prepare('DELETE FROM auth_sessions WHERE session_hash = ?')
      .bind(await sha256(token)).run();
  }
  return jsonResponse({ ok: true }, 200, corsHeaders);
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
  }
  if (new TextEncoder().encode(JSON.stringify(body.messages)).length > MAX_CHAT_BYTES) {
    return 'This chat is too large to save.';
  }
  return '';
}

async function handleChats(request, env, url, corsHeaders) {
  if (!env.CHAT_HISTORY) return errorResponse('Cloudflare D1 binding CHAT_HISTORY is not configured.', 503, corsHeaders);
  const session = await getSession(request, env.CHAT_HISTORY);
  if (!session) return errorResponse('Your sign-in session has expired. Sign in again to sync history.', 401, corsHeaders);

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
    await env.CHAT_HISTORY.prepare(
      'INSERT INTO chats (id, user_id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET title = excluded.title, messages = excluded.messages, updated_at = excluded.updated_at ' +
      'WHERE chats.user_id = excluded.user_id'
    ).bind(chatId, session.user_id, title || 'New chat', JSON.stringify(body.messages), createdAt, now).run();
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
  return jsonResponse(data, groqResponse.status, corsHeaders);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = (env.ALLOWED_ORIGIN || '')
      .split(',')
      .map((value) => value.trim().replace(/\/$/, ''))
      .filter(Boolean);
    const isAccountRoute = url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/');
    const isGitHubNavigation = request.method === 'GET' &&
      ['/auth/github', '/auth/github/callback'].includes(url.pathname);
    if (isAccountRoute && !allowedOrigins.length) {
      return new Response('ALLOWED_ORIGIN must be configured for account routes.', { status: 503 });
    }
    if (allowedOrigins.length && origin && !allowedOrigins.includes(origin)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (isAccountRoute && !origin && !isGitHubNavigation) return new Response('Forbidden', { status: 403 });

    const corsHeaders = {
      'Access-Control-Allow-Origin': origin || allowedOrigins[0] || '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    try {
      if (url.pathname === '/auth/github' && request.method === 'GET') {
        return await startGitHubSignIn(env, url, allowedOrigins);
      }
      if (url.pathname === '/auth/github/callback' && request.method === 'GET') {
        return await handleGitHubCallback(request, env, url);
      }
      if (url.pathname === '/auth/logout' && request.method === 'POST') {
        return await handleLogout(request, env, corsHeaders);
      }
      if (url.pathname === '/api/chats' || url.pathname.startsWith('/api/chats/')) {
        return await handleChats(request, env, url, corsHeaders);
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
