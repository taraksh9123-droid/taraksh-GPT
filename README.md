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
- **Image attachment previews**
- **Voice input** and text-to-speech replies where supported by the browser
- **Conversation history**, summaries, likes, downloadable chats, themes, fonts, and message customization
- **Guest mode** with conversations saved in this browser
- **GitHub sign-in** with per-account conversation history stored in Cloudflare D1

## Getting started

1. Clone or download this repository.
2. Open `index.html` in a modern browser.
3. Open **Settings** and enable **Smart mode**.
4. Deploy `worker.js` as a Cloudflare Worker and follow [Cloudflare history and GitHub sign-in setup](#cloudflare-history-and-github-sign-in).
5. Open **Chat** or **Code** and start using the assistant.

No build step or package installation is required.

## Groq configuration

The app sends Smart mode requests to the configured Cloudflare Worker, which proxies them to:

`https://api.groq.com/openai/v1/chat/completions`

The current default model is `openai/gpt-oss-20b`. Do not put a Groq key in `index.html`, GitHub Pages, or `config.js`. Deploy `worker.js`, store the key in the Worker secret `GROQ_API_KEY`, and set only the proxy URL in `config.js`.

## GitHub Pages deployment, step by step

1. Create a replacement key in the Groq console. Do not share or paste it into GitHub.
2. Open Cloudflare Dashboard, then go to **Workers & Pages**.
3. Select **Create**, **Start with Hello World**, and name the Worker `taraksh-gpt-groq-proxy`.
4. Open the Worker editor, replace the example code with the contents of `worker.js`, and deploy it.
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

## Privacy and limitations

- Chat requests in Smart mode are sent to Groq.
- Signed-in chat transcripts are stored in the configured Cloudflare D1 database. Guest transcripts remain in this browser's local storage.
- GitHub authorizes sign-in through the Cloudflare Worker; the Worker keeps the OAuth client secret and scopes D1 access to the verified GitHub account.
- Search requests are sent to DuckDuckGo.
- Weather requests are sent to Open-Meteo.
- Voice, speech, image, and Python features depend on browser support and network availability.
- Browser local storage can be cleared by resetting settings or clearing site data.

## Project files

- `index.html` - complete application, styling, and client-side logic
- `worker.js` - Cloudflare Worker for Groq requests, GitHub sign-in, and account history
- `schema.sql` - Cloudflare D1 schema for users, sessions, and saved chats
- `config.js` - public Worker URL and GitHub OAuth App client ID
- `robots.txt` - crawler rules
- `sitemap.xml` - published site sitemap
- `google0ae9b6fc5df16510.html` - Google site verification file

## Author

Created by [Taraksh Choudhary](https://github.com/taraksh9123-droid).
