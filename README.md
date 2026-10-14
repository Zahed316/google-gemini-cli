# Google Gemini CLI (`google-gemini-cli`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey.svg)](https://github.com/Zahed316/google-gemini-cli)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Zahed316/google-gemini-cli/pulls)

A high-performance, universal CLI bridge and programmatic Node.js SDK for **Google Gemini** ([gemini.google.com](https://gemini.google.com/app)) powered by the **Chrome DevTools Protocol (CDP)**.

Interact with Google's most capable models—including **Gemini Argon**, **Gemini Pro**, **Gemini Flash**, and deep **Thinking levels**—directly from your terminal, CI/CD scripts, or autonomous agent harnesses (Claude Code, Hermes, AutoResearch).

---

## 🌟 Why `google-gemini-cli`?

- 🚀 **Zero API Key Required:** Connects straight to your authenticated Google account over local Chrome DevTools Protocol. No per-token metering, billing tiers, or API subscription fees.
- 🧠 **Cutting-Edge Models:** Full access to **Gemini Argon**, **Gemini Pro**, **Gemini Flash**, and **Gemini Flash-Lite** with configurable reasoning depth (`low`, `medium`, `high`).
- 👻 **True Silent Headless Modes:**
  - **`xvfb` (Virtual Display):** Completely isolated virtual screen with Wayland/X11 platform isolation. Prevents desktop theme switching (Daylight/Night) and avoids intrusive window popups.
  - **`native` (`--headless=new`):** Chromium native modern headless mode with full 1080p desktop sidebar hydration.
- 🔄 **Multi-Account & Profile Discovery:** Automatically scans and indexes all your local Chrome profiles (`~/.config/google-chrome*`). Seamlessly rotate between accounts when hitting quota limits.
- ⏱️ **5-Hour Rate Limit Detection:** Automatically identifies disabled models, extracts the exact UI reset timestamp (e.g. `Limit resets Oct 15, 2:19 AM`), alerts you, and gracefully falls back to available models.
- 🔍 **Full Conversation Observability:** List recent conversations (`-l`), dump complete transcripts in Markdown or JSON (`--view <id>`), and delete specific threads (`-d <id> -y`). *Strictly prohibits dangerous `--delete-all` operations for user safety.*
- 🧹 **Ephemeral Agent Mode (`-e, --ephemeral`):** Stream responses directly to stdout and automatically clean up the conversation afterwards—leaving zero clutter in your Gemini sidebar.
- 📎 **File Attachments via `+` (Upload & Tools):** Attach PDFs, documents, images, and code files with `-f, --file <path>`. Automates clicking Gemini's `+` button and intercepts native file choosers over CDP.
- 🛡️ **Intelligent Anti-Bot & Robot Verification:** Proactively detects CAPTCHA and "unusual traffic" challenges. Cleanly pauses or aborts with explicit manual recovery steps without hanging headless automation.
- 🧼 **Strict Tab Hygiene:** Reuses active browser sessions, prunes duplicate tabs, and closes dead `about:blank` pages to maintain optimal memory and CPU performance.
- 📡 **Agent Harness Ready (`--format ndjson`):** Streams structured, typed JSON events for integration into Claude Code, Cursor, OpenDevin, and custom autonomous harnesses.
- 🩺 **Diagnostic Doctor (`gemini doctor`):** Instant verification of Chrome paths, CDP port 9222 status, Xvfb virtual displays, and profile authentication.
- 📊 **Browser & Tab Inspector (`gemini --status`):** Inspect active browser processes, running profile, CDP port connection, and open tabs with titles and URLs.
- ⚡ **Streamlined Unix Pipeline:** Pipe files, logs, or command output (`cat file.js | gemini "refactor"`), with real-time streaming output to stdout.

---

## 📦 Installation

### Option 1: Quick Installer (Recommended for Linux & macOS)

```bash
git clone https://github.com/Zahed316/google-gemini-cli.git
cd google-gemini-cli
./scripts/install.sh
```

Ensure `~/.local/bin` is in your `$PATH`:
```bash
export PATH="$HOME/.local/bin:$PATH"
```

### Option 2: Global NPM Link

```bash
git clone https://github.com/Zahed316/google-gemini-cli.git
cd google-gemini-cli
npm install -g .
```

---

## 🔑 Initial Setup & Google Authentication

To sign in with your Google account:

```bash
# 1. Launch a visible Chrome instance to sign in
gemini --login

# Or log in with a named profile (e.g. work, personal, flow)
gemini --login work
```

Sign in to Google in the opened browser window. Your session cookies and credentials remain 100% local inside your isolated Chrome profile.

---

## 🚀 Quick Start & Examples

### 1. Basic Prompting

```bash
gemini "Explain quantum computing in simple terms"
```

### 2. Unix Stdin Piping

```bash
# Pipe code for instant review
cat src/index.js | gemini "Review this code for potential security or memory bugs"

# Pipe log files for troubleshooting
journalctl -u nginx --no-pager -n 50 | gemini "Identify root cause of 502 errors"
```

### 3. Model & Thinking Reasoning Selection

```bash
# Gemini Argon with High Thinking reasoning
gemini -m argon -t high "Solve this complex math and concurrency challenge..."

# Gemini Pro
gemini -m pro "Design an architectural spec for a distributed queue"

# Gemini Flash (Fastest response)
gemini -m flash "Draft a quick commit message for this git diff"
```

### 4. True Headless Background Execution

Run silently in the background without opening any desktop window:

```bash
# Virtual display headless via Xvfb (default headless)
gemini --headless "Run completely hidden in background"

# Native modern headless (--headless=new)
gemini --headless native "Run with Chromium native headless engine"

# Force visible browser when needed
gemini --visible "Show browser window during execution"
```

> **Tip:** You can set your preferred mode persistently via environment variable:
> ```bash
> export GEMINI_HEADLESS=xvfb   # or 'native'
> ```

### 5. File Attachments & Upload Tools

Attach documents, images, and code files directly using Gemini's `+` (Upload & tools) button via CDP:

```bash
# Attach a PDF or document for analysis
gemini -f path/to/document.pdf "Summarize this report in 5 bullet points"

# Attach an image or code file
gemini -f screenshot.png "Extract text and analyze UI layout"
```

### 6. Browser & Tab Inspection

Check what browser instances and tabs are open before taking actions:

```bash
# Human-readable summary of running Chrome, mode, profile, and tabs
gemini --status

# Machine-readable JSON output
gemini --status --json
```

### 7. Google Robot Verification / Anti-Bot Protocol

Google occasionally triggers automated security challenges ("Unusual traffic from your computer network" or CAPTCHA):

- **Automatic Checkbox Attempt:** The CLI attempts to automatically check trivial reCAPTCHA checkboxes.
- **Clean Headless Abort:** If an interactive CAPTCHA is presented while running headless, `google-gemini-cli` aborts immediately with explicit recovery instructions (`gemini --login <profile>` or `gemini -p <profile>`) rather than hanging indefinitely.
- **Interactive Waiting Mode:** Use `--wait-for-verification` or `--visible` to pause up to 120 seconds while you solve the verification challenge in the browser window.

---

## 👥 Multi-Account & Profile Rotation

Google Gemini enforces a 5-hour rolling rate limit on premium models for free tier accounts. With `google-gemini-cli`, you can register multiple accounts and switch between them instantly:

### Discover Detected Profiles

```bash
gemini --list-profiles
```

Output:
```text
#    ID               NAME             EMAIL                        ACTIVE   USER DATA DIR
1 *  flow             Zahed            persianstyle6@gmail.com      yes      ~/.config/google-chrome-flow
2    main             Your Chrome      persianstyle6@gmail.com      no       ~/.config/google-chrome
3    main-profile2    chatgpt          chatgptbehzad@gmail.com      no       ~/.config/google-chrome (Profile 2)
4    beta             Beta             -                            no       ~/.config/google-chrome-beta
```

### Switch Profiles On The Fly

```bash
# Run using profile by index number
gemini -p 3 "Prompt using secondary account"

# Run using profile by name or email substring
gemini -p chatgpt "Prompt using chatgpt account"

# Set persistent default active profile
gemini --set-profile 3
```

---

## 🗂️ Conversation Observability & Management

Inspect, audit, and clean up conversations directly from the terminal:

### List Recent Conversations

```bash
# Human-readable table
gemini -l

# JSON output for harness integration
gemini -l --json
```

### View Full Conversation Transcript

```bash
# View conversation by index or ID
gemini --view 1

# Output as raw JSON
gemini --view 1 --json
```

### Safe Conversation Deletion

```bash
# Prompt confirmation before deletion
gemini -d 1

# Non-interactive deletion (for scripts and agents)
gemini -d 1 -y
```

*(Note: Bulk deletion like `--delete-all` is intentionally prohibited to prevent accidental data loss).*

---

## 📖 CLI Reference

```text
Usage:
  gemini [options] [prompt...]
  cat file | gemini [options] [prompt...]

Options:
  -m, --model <name>       Model to use (argon, pro, flash, flash-lite)
  -t, --thinking <level>   Thinking reasoning depth (low, medium, high)
  -n, --new                Start a new chat session
  -f, --file <path>        Attach a file using Gemini's '+' (Upload & tools) button
  -p, --profile <name|idx> Choose Google/Chrome profile by name, email, or index
  --list-profiles          List discovered Chrome profiles and accounts
  --set-profile <name|idx> Set default persistent profile
  --login [profile]        Launch visible Chrome window to log in to Google account
  --status                 Inspect browser process, active profile, and open tabs
  -l, --list               List conversations
  --view <index|id>        View conversation transcript
  -d, --delete <index|id>  Delete specific conversation
  -y, --yes                Skip confirmation for deletion
  -e, --ephemeral          Auto-delete conversation after completion (zero sidebar clutter)
  --format <format>        Output format ('text' or 'ndjson' for agent harnesses)
  --doctor                 Run diagnostic health checks on Chrome, CDP, and profiles
  --wait-for-verification  Wait for user to solve challenge if robot verification appears
  --headless [mode]        Run in headless mode: 'xvfb' (default) or 'native' (--headless=new)
  --visible                Force visible browser window (overrides GEMINI_HEADLESS)
  --restart                Restart browser instance in the selected mode
  --json                   Format output as JSON
  -h, --help               Show help message
  -v, --version            Show version number
```

---

## 🛠️ Programmatic Node.js SDK

You can also import `google-gemini-cli` directly into your Node.js projects:

```javascript
const {
  sendPrompt,
  listConversations,
  getConversationTranscript,
  profileManager
} = require('google-gemini-cli');

async function main() {
  // 1. Send prompt with streaming response
  const response = await sendPrompt({
    prompt: 'Summarize the architecture of distributed raft clusters',
    model: 'argon',
    thinking: 'high',
    headless: 'xvfb',
    onChunk: (chunk) => {
      process.stdout.write(chunk);
    }
  });

  // 2. List recent conversations
  const convs = await listConversations();
  console.log('Conversations:', convs);
}

main().catch(console.error);
```

---

## 🔬 Architecture & Wayland Ozone Isolation

On Linux desktop environments running GNOME Wayland (`WAYLAND_DISPLAY=wayland-1`), Chromium's default Ozone abstraction prioritizes Wayland even when wrapped inside `xvfb-run` (`DISPLAY=:99`), which would normally cause windows to unexpectedly appear on the desktop and trigger desktop theme switches.

`google-gemini-cli` solves this by strictly isolating the process environment:
1. **For `xvfb`:** Cleanses `WAYLAND_DISPLAY` and `X_PRIVILEGED_WAYLAND_SOCKET` from the environment and explicitly passes `--ozone-platform=x11`.
2. **For `native`:** Passes `--headless=new` and `--ozone-platform=headless` with a locked `--window-size=1920,1080` to force complete desktop sidebar hydration.

---

## 🔒 Security & Privacy

- **No Credentials in Repo:** This repository contains zero API keys, secrets, session cookies, or user tokens.
- **Local Chrome DevTools Protocol:** All communication occurs over loopback `http://localhost:9222`.
- **Pre-Commit Defense:** Verified with **Crenox Pro Security Client** to enforce strict credential scanning and prevent credential leakage.

---

## 🤝 Contributing

Contributions, bug reports, and feature requests are welcome!
1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is open-source software licensed under the [MIT License](LICENSE).
Copyright (c) 2026 **Zahed Rastgar**.
