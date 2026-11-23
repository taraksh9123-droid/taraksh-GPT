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

## Getting started

1. Clone or download this repository.
2. Open `index.html` in a modern browser.
3. Open **Settings** and enable **Smart mode**.
4. Deploy `worker.js` as a Cloudflare Worker, set `GROQ_API_KEY` in Worker secrets, and set `GROQ_PROXY_URL` in `config.js`.
5. Open **Chat** or **Code** and start using the assistant.

No build step or package installation is required.

## Groq configuration

The app sends Smart mode requests directly from the browser to:

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
9. Commit and push `config.js` and `index.html`. It is safe to commit `config.js` because it contains only the public Worker URL, not the Groq key.
10. In GitHub, open **Settings**, **Pages**, and deploy from the repository branch if Pages is not already enabled.
11. Open the GitHub Pages site and test Chat in Smart mode.

If Groq reports that a key is invalid or revoked, create a replacement key and update only the Cloudflare `GROQ_API_KEY` secret. Redeploy is not required.

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
- Search requests are sent to DuckDuckGo.
- Weather requests are sent to Open-Meteo.
- Voice, speech, image, and Python features depend on browser support and network availability.
- Browser local storage can be cleared by resetting settings or clearing site data.

## Project files

- `index.html` - complete application, styling, and client-side logic
- `robots.txt` - crawler rules
- `sitemap.xml` - published site sitemap
- `google0ae9b6fc5df16510.html` - Google site verification file

## Author

Created by [Taraksh Choudhary](https://github.com/taraksh9123-droid).
