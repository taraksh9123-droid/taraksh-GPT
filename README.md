# Taraksh's Chatbot

A browser-based AI assistant for chat, coding, web searches, weather updates, image previews, voice input, calculations, and conversation history. The project is a lightweight static website built with HTML, CSS, and vanilla JavaScript.

## Features

- **Smart chat mode** powered by Groq
- **Normal mode** with built-in browser responses and web search helpers
- **Code workspace** for HTML, JavaScript, and Python
- **Code execution** for browser JavaScript, HTML previews, and Python through Pyodide
- **Code Agent** that can review, explain, improve, or write code directly into the editor
- **Calculator** with keyboard-friendly controls
- **Weather updates** using Open-Meteo
- **Web search** using DuckDuckGo
- **Image understanding, previews, and text-to-image generation**
- **Voice input** and text-to-speech replies where supported by the browser
- **Conversation history** with AI-generated titles for Smart mode chats, summaries, likes, plain-text and Markdown downloads, print-ready PDF export, themes, fonts, and message customization
- **Collapsible sidebar** with icon-led workspace shortcuts, a New chat action, and a scrollable Recents list with per-chat deletion
- **Guest mode** with conversations saved in this browser
- **GitHub sign-in** with per-account conversation history stored in Cloudflare D1
- **Up to 1,000 saved chats** per guest browser or signed-in account

## How the app is built

The project is a static, browser-first application with a small server-side proxy:

- **Frontend:** `index.html` contains the page markup, styles, and vanilla JavaScript. It manages the interface, chat state, local guest storage, exports, browser features, and calls to external services. There is no bundler or compile step.
- **Public configuration:** `config.js` supplies the deployed Worker URL and public GitHub OAuth client ID. These values are visible to website visitors and must never contain private API keys or OAuth secrets.
- **Backend:** `worker.js` runs on Cloudflare Workers. It keeps provider secrets off the static website, proxies Smart mode requests to Groq, generates images with Workers AI, handles GitHub OAuth, and accesses D1 for account history.
- **Account database:** `schema.sql` defines the D1 tables for GitHub users, hashed sign-in sessions, and saved chats.
- **Deployment configuration:** `wrangler.toml` names the Worker and declares its `CHAT_HISTORY` D1 and `AI` Workers AI bindings.

### Request and data flow

| Feature | Flow |
| --- | --- |
| Smart chat and AI titles | Browser → `POST /` on the Worker → Groq Chat Completions API |
| Image generation | Browser → `POST /api/images/generate` → Cloudflare Workers AI (`@cf/black-forest-labs/flux-1-schnell`) |
| GitHub sign-in | Browser → Worker `/auth/github` → GitHub OAuth → Worker callback → browser |
| Signed-in history | Browser → Worker `/api/chats...` → Cloudflare D1, scoped to the verified account |
| Guest history | Browser → this browser's `localStorage`; it is not uploaded unless the user signs in and history migration runs |
| Search and weather | Browser → DuckDuckGo and Open-Meteo |
| Python and image understanding | Browser downloads Pyodide or Transformers.js models when those features are used |

The Worker applies the configured `ALLOWED_ORIGIN` check to API and account requests and returns CORS headers for approved origins. Browser code does not receive the Groq API key or GitHub OAuth client secret.

### Main interface and conversation behavior

- The sidebar can collapse and expand; its state is retained in browser storage. **Recents** has its own scroll area so a long history does not push other navigation offscreen. The scrollbar is hidden visually while scrolling remains enabled.
- Starting a chat creates a separate conversation ID. Recent sessions are sorted by last update and can be reopened or deleted. Deletion asks for confirmation.
- Guest chats are stored locally. Signed-in chats are stored in D1 and can be loaded on another device after sign-in. Existing guest chats are migrated to the account on sign-in.
- Each guest browser and each signed-in account can save up to **1,000 chats**. At the limit, creating another chat is blocked and the app asks the user to delete a session from Recents. Paid upgrades are not currently available. The Worker enforces the account limit when saving, including concurrent create attempts.
- In Smart mode, after the first exchange the app makes a separate Groq request to create a concise session title. If title generation fails, the first prompt is used as a fallback; old chats with that fallback title retry title generation when opened in Smart mode. Normal mode does not request AI titles.
- Markdown tables and inline formatting in assistant replies are rendered in the chat. The application stores message content so history can be restored and exported.
- TXT and Markdown exports download the current conversation. PDF uses the browser print dialog; choose **Save as PDF**. Generated images are included in saved history and supported exports.
- The Code workspace can run JavaScript in the browser, show HTML previews, load Pyodide for Python, and use the Code Agent to explain, review, fix, or create code in the editor.
- Voice recognition, speech synthesis, Python, image understanding, and network-backed services depend on browser support, model downloads, and connectivity.

### Saved data and limits

- A chat record contains an ID, title, messages, and creation/update timestamps. Messages store a role and text, optional feedback, and optional generated-image data.
- The Worker accepts at most 500 messages per chat and 750,000 UTF-8 bytes of serialized messages per chat. Generated JPEG data URLs are limited to 160,000 characters each by the Worker; the browser compresses generated images to a smaller size before saving.
- The 1,000-chat limit is a count limit, not a promise that a browser's storage quota can hold 1,000 large chats. Browser storage may run out earlier, especially for image-heavy conversations.
- D1 stores a SHA-256 hash of each random app session token rather than the bearer token. OAuth access tokens are used by the Worker to retrieve the GitHub identity and are not sent to the frontend.

## Groq configuration

The app sends Smart mode requests to the configured Cloudflare Worker, which proxies them to:

`https://api.groq.com/openai/v1/chat/completions`

The current default model is `openai/gpt-oss-20b`. Do not put a Groq key in `index.html`, GitHub Pages, or `config.js`. Deploy `worker.js`, store the key in the Worker secret `GROQ_API_KEY`, and set only the proxy URL in `config.js`.

The Worker forwards the model, messages, temperature, and completion-token settings it needs. It does not expose the Groq credential to the browser.

## Image generation

In chat, ask for an image (for example, **“Generate an image of a dog”**). The Worker uses Cloudflare Workers AI with `@cf/black-forest-labs/flux-1-schnell`; `wrangler.toml` configures the required `AI` binding. If deploying from the Cloudflare dashboard, add a **Workers AI** binding named `AI` under the Worker’s **Settings → Bindings**, then deploy.

Workers AI currently includes a free daily allocation of 10,000 Neurons. Requests beyond that allocation may require a paid Workers plan; check [current pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/). Image prompts are sent to Cloudflare, and generated images are compressed and saved with the conversation.

## GitHub Pages deployment, step by step

1. Create a replacement key in the Groq console. Do not share or paste it into GitHub.
2. Open Cloudflare Dashboard, then go to **Workers & Pages**.
3. Select **Create**, **Start with Hello World**, and name the Worker `taraksh-gpt-groq-proxy`.
4. Open the Worker editor, replace the example code with the contents of `worker.js`, add the Workers AI binding named `AI` under **Settings → Bindings**, and deploy it.
5. Open **Settings**, **Variables and Secrets**, and add a secret named `GROQ_API_KEY` with the replacement key as its value.
6. Add a plain variable named `ALLOWED_ORIGIN` with your exact GitHub Pages origin, for example `https://taraksh9123-droid.github.io`. Do not include a path or trailing slash.
7. Copy the Worker URL, which normally looks like `https://taraksh-gpt-groq-proxy.<account-subdomain>.workers.dev`.
8. In this repository, create `config.js` from `config.example.js` and set `GROQ_PROXY_URL` to the Worker URL.
9. Commit and push `config.js` and `index.html`. `config.js` contains public URLs and the public GitHub client ID; never put `GROQ_API_KEY` or `GITHUB_CLIENT_SECRET` in it.
10. In GitHub, open **Settings**, **Pages**, and deploy from the repository branch if Pages is not already enabled.
11. Open the GitHub Pages site and test Chat in Smart mode.

If Groq reports that a key is invalid or revoked, create a replacement key and update only the Cloudflare `GROQ_API_KEY` secret. Redeploy is not required.

## Cloudflare history and GitHub sign-in

Each **New chat** creates a separate conversation session with its own ID, title, and messages, shown in the sidebar like ChatGPT chat history. Guest sessions stay in browser storage. GitHub accounts sync their sessions to D1, keyed by GitHub's stable numeric account ID; the client never supplies an owner ID for history operations. The Worker creates revocable, expiring sign-in sessions after completing GitHub's OAuth authorization-code flow.

Guest history in this browser and each signed-in account support up to 1,000 saved chats. At the limit, starting another chat is blocked with a notice to delete a conversation from **Recents**. Paid upgrades are not currently available.

The browser persists the app session in a 300-day `Secure`, `SameSite=Lax` cookie and migrates existing localStorage sessions on the next visit. The cookie is refreshed on page load; the Worker extends active D1 sessions as they approach expiry. Because GitHub Pages is static, this cookie is JavaScript-readable; the Worker stores only a hash of the session token in D1.

1. In [GitHub Developer settings](https://github.com/settings/developers), choose **OAuth Apps → New OAuth App**. Set the homepage to `https://taraksh9123-droid.github.io`.
2. Set **Authorization callback URL** to your Worker URL followed by `/auth/github/callback`, for example `https://your-worker.workers.dev/auth/github/callback`. Create the app and generate a client secret.
3. Set `window.GITHUB_CLIENT_ID` in `config.js` and the Worker variable `GITHUB_CLIENT_ID` to the app's client ID. Store `GITHUB_CLIENT_SECRET` only as a Cloudflare Worker secret; never put it in the website.
4. In Cloudflare, create a D1 database. Open its console and run all SQL from [`schema.sql`](./schema.sql).
5. In the Worker **Settings → Bindings**, add a D1 database binding named `CHAT_HISTORY` and select that database.
6. In Worker **Settings → Variables and Secrets**, set `ALLOWED_ORIGIN` to your exact site origin (comma-separated if you use multiple sites). Keep `GROQ_API_KEY` and `GITHUB_CLIENT_SECRET` as Worker secrets.
7. Deploy the updated `worker.js`, publish `index.html` and `config.js`, then test sign-in and chat history from the deployed HTTPS origin.

If GitHub OAuth or D1 settings are missing, guest mode and the existing chat tools continue to work; account sign-in/history reports the missing Worker configuration. Existing guest chats are copied to the account after GitHub sign-in. Signing out leaves account history on the server and returns to local guest history.

## Code Agent

Open the **Code** tab to use the Code Agent:

1. Write a prompt in the agent sidebar.
2. Click **Ask agent**.
3. Ask for explanations, fixes, improvements, or new code.
4. When the request generates code, the result is placed directly in the editor.

Use **Run code** to execute the current editor contents, or **Check code** for a focused review.

## Deployment

This is a static site and can be deployed with GitHub Pages or any static hosting provider. The included `robots.txt` and `sitemap.xml` support search engine discovery for the published GitHub Pages site.

For GitHub Pages:

1. Push the repository to GitHub.
2. Open **Settings → Pages**.
3. Select the deployment branch and repository root.
4. Open the generated site URL.

For local development, open `index.html` in a browser. Normal mode and guest history can be explored without a build step. Smart chat, generated images, GitHub sign-in, and account history require a reachable, correctly configured Worker. A `file://` preview is not a substitute for testing the published HTTPS site because browser origin checks differ.

There is no package manager manifest or bundled automated test suite. Before publishing Worker changes, run `node --check worker.js`; also test the affected flow from the deployed site. Python execution and image understanding may download runtime/model files on first use.

## Privacy and limitations

- Chat requests in Smart mode are sent to Groq.
- Smart mode sends the first user message and assistant reply to Groq once more to generate a concise title. Older chats whose title still matches the first prompt retry title generation when opened in Smart mode; if generation fails, the first prompt remains the fallback.
- Signed-in chat transcripts are stored in the configured Cloudflare D1 database. Guest transcripts remain in this browser's local storage.
- Image prompts are processed by Cloudflare Workers AI, and generated images are saved with their conversations.
- GitHub authorizes sign-in through the Cloudflare Worker; the Worker keeps the OAuth client secret and scopes D1 access to the verified GitHub account.
- Search requests are sent to DuckDuckGo.
- Weather requests are sent to Open-Meteo.
- Voice, speech, image, and Python features depend on browser support and network availability.
- Browser local storage can be cleared by resetting settings or clearing site data.

## Project files

```text
index.html                     Complete UI, styles, and browser-side application logic
worker.js                      Cloudflare Worker API proxy, image generation, OAuth, and chat-history routes
config.js                      Public Worker URL and GitHub OAuth client ID for this deployment
config.example.js              Safe template for public frontend configuration
wrangler.toml                  Worker name, D1 binding, Workers AI binding, and compatibility date
schema.sql                     D1 users, auth_sessions, and chats tables and indexes
README.md                      Setup, architecture, deployment, privacy, and feature documentation
robots.txt                     Search crawler rules
sitemap.xml                    Public-site sitemap
google0ae9b6fc5df16510.html     Google site-verification file
```

`config.js` is deployment-specific and should be reviewed before publishing. It may contain public URLs and a public client ID only; it must not contain `GROQ_API_KEY`, `GITHUB_CLIENT_SECRET`, or other credentials.

## Author

Created by [Taraksh Choudhary](https://github.com/taraksh9123-droid).
