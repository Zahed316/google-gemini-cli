const path = require('path');
const profileManager = require('./profile-manager');

const CDP_URL = 'http://localhost:9222';
const GEMINI_APP_URL = 'https://gemini.google.com/app';

function getPlaywright() {
  try {
    return require('playwright');
  } catch (e) {}

  const { execSync } = require('child_process');
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    if (globalRoot) {
      const p = require('path').join(globalRoot, 'playwright');
      return require(p);
    }
  } catch (e) {}

  try {
    const fs = require('fs');
    const path = require('path');
    const nvmDir = path.join(process.env.HOME || '/home/zahedrastgar', '.nvm/versions/node');
    if (fs.existsSync(nvmDir)) {
      const versions = fs.readdirSync(nvmDir).sort().reverse();
      for (const v of versions) {
        const candidate = path.join(nvmDir, v, 'lib/node_modules/playwright');
        if (fs.existsSync(candidate)) {
          return require(candidate);
        }
      }
    }
  } catch (e) {}

  throw new Error('Playwright could not be resolved in local or global modules');
}

async function isCdpReady() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

function getRunningChromeMode() {
  try {
    const { execSync } = require('child_process');
    const ps = execSync('ps aux', { encoding: 'utf8' });
    const lines = ps.split('\n').filter((l) => l.includes('9222') && (l.includes('/chrome') || l.includes('xvfb-run')));
    if (lines.length === 0) return null;
    const fullCmd = lines.join(' ');
    if (fullCmd.includes('--headless=new') || fullCmd.includes('--ozone-platform=headless')) {
      return 'native';
    }
    if (fullCmd.includes('--ozone-platform=x11') || fullCmd.includes('xvfb-run') || fullCmd.includes('Xvfb')) {
      return 'xvfb';
    }
    return 'visible';
  } catch {
    return null;
  }
}

function getRunningChromeProfile() {
  try {
    const { execSync } = require('child_process');
    const ps = execSync('ps aux', { encoding: 'utf8' });
    const lines = ps.split('\n').filter((l) => l.includes('9222') && (l.includes('/chrome') || l.includes('xvfb-run')));
    if (lines.length === 0) return null;
    const fullCmd = lines.join(' ');
    const userDirMatch = fullCmd.match(/--user-data-dir=([^\s]+)/);
    const profDirMatch = fullCmd.match(/--profile-directory=([^\s]+)/);
    return {
      userDataDir: userDirMatch ? userDirMatch[1] : null,
      profileDir: profDirMatch ? profDirMatch[1] : 'Default'
    };
  } catch {
    return null;
  }
}

async function stopChrome() {
  const { execSync } = require('child_process');
  try {
    execSync("pkill -f 'remote-debugging-port=9222' || true");
    await new Promise((r) => setTimeout(r, 800));
  } catch {}
}

async function ensureChrome(opts = {}) {
  let headlessMode = null;
  let forceRestart = false;
  let requestedProfile = null;

  if (typeof opts === 'string') {
    headlessMode = opts;
  } else if (opts && typeof opts === 'object') {
    headlessMode = opts.headless;
    forceRestart = Boolean(opts.restart);
    requestedProfile = opts.profile;
  }

  if (!headlessMode && process.env.GEMINI_HEADLESS) {
    headlessMode = process.env.GEMINI_HEADLESS.toLowerCase().trim();
  }

  let targetMode = null;
  if (headlessMode === true || headlessMode === 'xvfb' || headlessMode === 'xvfb-run') {
    targetMode = 'xvfb';
  } else if (headlessMode === 'native' || headlessMode === 'new' || headlessMode === 'builtin') {
    targetMode = 'native';
  } else if (
    headlessMode === 'visible' ||
    headlessMode === 'headful' ||
    headlessMode === false ||
    headlessMode === 'false'
  ) {
    targetMode = 'visible';
  }

  const targetProfile = profileManager.resolveProfile(requestedProfile);
  const currentProfile = getRunningChromeProfile();
  const currentMode = getRunningChromeMode();
  const cdpUp = await isCdpReady();

  const profileMatches =
    currentProfile &&
    currentProfile.userDataDir === targetProfile.userDataDir &&
    currentProfile.profileDir === targetProfile.profileDir;

  const modeMatches = !targetMode || currentMode === targetMode;

  if (cdpUp && !forceRestart && profileMatches && modeMatches) {
    return targetProfile;
  }

  await stopChrome();

  const { spawn } = require('child_process');
  const chromeBin = '/opt/google/chrome/chrome';

  const baseArgs = [
    '--window-size=1920,1080',
    '--remote-debugging-port=9222',
    `--user-data-dir=${targetProfile.userDataDir}`,
    `--profile-directory=${targetProfile.profileDir}`,
    GEMINI_APP_URL
  ];

  let proc;
  if (targetMode === 'native') {
    const nativeEnv = { ...process.env };
    delete nativeEnv.WAYLAND_DISPLAY;
    delete nativeEnv.X_PRIVILEGED_WAYLAND_SOCKET;
    proc = spawn(
      chromeBin,
      ['--headless=new', '--ozone-platform=headless', ...baseArgs],
      { detached: true, stdio: 'ignore', env: nativeEnv }
    );
  } else if (targetMode === 'xvfb') {
    const xvfbEnv = { ...process.env };
    delete xvfbEnv.WAYLAND_DISPLAY;
    delete xvfbEnv.X_PRIVILEGED_WAYLAND_SOCKET;
    proc = spawn(
      'xvfb-run',
      ['-a', chromeBin, '--ozone-platform=x11', ...baseArgs],
      { detached: true, stdio: 'ignore', env: xvfbEnv }
    );
  } else {
    proc = spawn(
      chromeBin,
      baseArgs,
      { detached: true, stdio: 'ignore' }
    );
  }
  proc.unref();

  const start = Date.now();
  while (Date.now() - start < 15000) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isCdpReady()) return;
  }
  throw new Error(`Chrome CDP failed to become ready on port 9222 within 15s (mode: ${targetMode || 'visible'})`);
}

async function checkRobotVerification(page, options = {}) {
  const url = page.url();
  const isSorryUrl = url.includes('google.com/sorry');

  let hasCaptchaText = false;
  try {
    hasCaptchaText = await page.evaluate(() => {
      const text = document.body ? document.body.innerText.toLowerCase() : '';
      return (
        text.includes('unusual traffic from your computer network') ||
        text.includes('systems have detected unusual traffic') ||
        text.includes('our systems have detected unusual traffic') ||
        text.includes('verify you\'re human') ||
        text.includes('verify that you are not a robot') ||
        document.querySelector('#captcha-form, iframe[src*="recaptcha"], iframe[src*="challenge"]') !== null
      );
    });
  } catch {}

  if (!isSorryUrl && !hasCaptchaText) {
    return { verified: true };
  }

  console.warn('[gemini] Google Robot Verification (CAPTCHA) detected on:', url);

  // 1. Attempt automatic click on standard checkbox if present
  try {
    for (const frame of page.frames()) {
      if (frame.url().includes('recaptcha') || frame.url().includes('challenge')) {
        const checkbox = await frame.$('.recaptcha-checkbox-border, #recaptcha-anchor, [role="checkbox"]');
        if (checkbox) {
          console.log('[gemini] Attempting to click verification checkbox...');
          await checkbox.click();
          await page.waitForTimeout(2000);
          if (!page.url().includes('google.com/sorry')) {
            console.log('[gemini] Verification checkbox succeeded.');
            return { verified: true };
          }
        }
      }
    }
  } catch {}

  // 2. If running in visible mode or user opted into waiting
  const runningMode = getRunningChromeMode();
  if (runningMode === 'visible' || options.waitForVerification) {
    console.warn('\n===============================================================');
    console.warn('[!] ACTION REQUIRED: Please solve the Google verification in the browser.');
    console.warn('Waiting up to 120 seconds for verification to complete...');
    console.warn('===============================================================\n');
    const startWait = Date.now();
    while (Date.now() - startWait < 120000) {
      await page.waitForTimeout(2000);
      const curUrl = page.url();
      if (curUrl.startsWith('https://gemini.google.com') && !curUrl.includes('google.com/sorry')) {
        console.log('[gemini] Verification resolved by user! Continuing execution.');
        return { verified: true };
      }
    }
  }

  // 3. Headless or timeout: stop work cleanly and alert user
  const runningProfile = getRunningChromeProfile();
  const profileHint = runningProfile ? `gemini --login ${runningProfile.profileDir}` : 'gemini --login';
  throw new Error(
    `Google Robot Verification (CAPTCHA) Required.\n` +
    `Google flagged the connection with an anti-bot challenge on: ${url}\n\n` +
    `Resolution Steps:\n` +
    `1. Launch visible browser to complete the verification:\n` +
    `   ${profileHint}   OR   gemini --visible "retry prompt"\n` +
    `2. Or switch to an alternate Google profile:\n` +
    `   gemini -p <other-profile> "your prompt"\n`
  );
}

async function getGeminiPage(browser, options = {}) {
  let geminiPage = null;
  const pagesToClose = [];

  for (const ctx of browser.contexts()) {
    const pages = ctx.pages();
    for (const page of pages) {
      const url = page.url();
      if (url.startsWith('https://gemini.google.com')) {
        if (!geminiPage) {
          geminiPage = page;
        } else {
          // Close duplicate Gemini tabs to prevent process and tab bloat
          pagesToClose.push(page);
        }
      } else if (url === 'about:blank' && pages.length > 1) {
        pagesToClose.push(page);
      }
    }
  }

  for (const p of pagesToClose) {
    await p.close().catch(() => {});
  }

  if (geminiPage) {
    await checkRobotVerification(geminiPage, options);
    return geminiPage;
  }

  let ctx = browser.contexts()[0];
  if (!ctx) ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(GEMINI_APP_URL, { waitUntil: 'domcontentloaded' });
  await checkRobotVerification(page, options);
  return page;
}

async function getPickerButton(page) {
  return page.waitForSelector('button[aria-label*="Open mode picker"]', { timeout: 3000 });
}

async function selectModelAndThinking(page, model, thinking) {
  const openMenu = async () => {
    const btn = await getPickerButton(page);
    await btn.click();
    await page.waitForSelector('[role="menuitem"], .mat-mdc-menu-item', { timeout: 3000 });
    await page.waitForTimeout(200);
  };

  if (model) {
    try {
      const btn = await getPickerButton(page);
      const currentModeText = (await btn.innerText()).trim();

      if (!currentModeText.toLowerCase().includes(model.toLowerCase())) {
        await openMenu();
        const items = await page.$$('[role="menuitem"], .mat-mdc-menu-item');
        let clicked = false;
        for (const item of items) {
          const rawText = await item.innerText();
          const text = rawText.toLowerCase();
          const matches =
            (model.toLowerCase() === 'lite' || model.toLowerCase() === 'flash-lite')
              ? text.includes('flash-lite') || text.includes('lite')
              : model.toLowerCase() === 'flash'
                ? text.includes('flash') && !text.includes('lite') && !text.includes('flash-lite')
                : text.includes(model.toLowerCase());

          if (matches) {
            const isDisabled = await item.evaluate(
              (el) =>
                el.hasAttribute('disabled') ||
                el.getAttribute('aria-disabled') === 'true' ||
                el.classList.contains('mat-mdc-menu-item-disabled')
            );
            if (isDisabled) {
              const resetMatch = rawText.match(/Limit resets [^\n]+/i);
              console.warn(
                `[gemini] Model "${model}" is currently rate-limited (${resetMatch ? resetMatch[0] : 'limit reached'}). Continuing with available model.`
              );
            } else {
              await item.click();
              clicked = true;
            }
            break;
          }
        }
        if (!clicked) {
          await page.keyboard.press('Escape').catch(() => {});
        }
        await page.waitForTimeout(300);
      }
    } catch (err) {
      console.warn(`[gemini-driver] Failed to select model "${model}":`, err.message);
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  if (thinking) {
    try {
      const menuVisible = await page.$('[role="menuitem"], .mat-mdc-menu-item');
      if (!menuVisible) {
        await openMenu();
      }

      // Expand Thinking level submenu
      const thinkingTrigger = await page.$(
        '[value="thinking_level"], [role="menuitem"]:has-text("Thinking level"), gem-menu-item:has-text("Thinking level")'
      );
      if (thinkingTrigger) {
        await thinkingTrigger.hover();
        await thinkingTrigger.click();
        await page.waitForTimeout(200);
      } else {
        console.warn('[gemini-driver] Thinking level trigger item not found in menu.');
      }

      const items = await page.$$('[role="menuitem"], .mat-mdc-menu-item');
      let clicked = false;
      for (const item of items) {
        const rawText = await item.innerText();
        const text = rawText.toLowerCase();
        if (
          !text.includes('thinking level') &&
          (text.startsWith(thinking.toLowerCase()) || text.includes(thinking.toLowerCase()))
        ) {
          const isDisabled = await item.evaluate(
            (el) =>
              el.hasAttribute('disabled') ||
              el.getAttribute('aria-disabled') === 'true' ||
              el.classList.contains('mat-mdc-menu-item-disabled')
          );
          if (isDisabled) {
            const resetMatch = rawText.match(/Limit resets [^\n]+/i);
            console.warn(
              `[gemini] Thinking level "${thinking}" is currently rate-limited (${resetMatch ? resetMatch[0] : 'limit reached'}). Continuing with available level.`
            );
          } else {
            await item.click();
            clicked = true;
          }
          break;
        }
      }

      if (!clicked) {
        console.warn(`[gemini-driver] Thinking option "${thinking}" not found in menu.`);
      }

      await page.waitForTimeout(200);
      if (await page.$('[role="menuitem"], .mat-mdc-menu-item')) {
        await page.keyboard.press('Escape').catch(() => {});
      }
    } catch (err) {
      console.warn(`[gemini-driver] Failed to select thinking level "${thinking}":`, err.message);
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
}

async function sendPrompt({
  prompt,
  model,
  thinking,
  isNewChat = false,
  onChunk = null,
  headless = null,
  profile = null,
  restart = false,
  ephemeral = false,
  file = null,
  files = null,
  waitForVerification = false,
  download = null
}) {
  await ensureChrome({ headless, profile, restart });

  const playwright = getPlaywright();
  const browser = await playwright.chromium.connectOverCDP(CDP_URL);

  try {
    const page = await getGeminiPage(browser, { waitForVerification });

    if (isNewChat) {
      const newChatBtn = await page.$('a[aria-label*="New chat"], a[href="/app"], [data-test-id="side-nav-sparkle-button"]');
      if (newChatBtn) {
        try {
          await newChatBtn.click();
          await page.waitForTimeout(500);
        } catch {
          await page.goto(GEMINI_APP_URL, { waitUntil: 'domcontentloaded' });
        }
      } else {
        await page.goto(GEMINI_APP_URL, { waitUntil: 'domcontentloaded' });
      }
    }

    const textboxSelector = 'div[contenteditable="true"][role="textbox"]';
    await page.waitForSelector(textboxSelector, { timeout: 15000 });

    if (model || thinking) {
      await selectModelAndThinking(page, model, thinking);
    }

    if (file || files) {
      const fileList = Array.isArray(files) ? files : (file ? [file] : []);
      for (const f of fileList) {
        await attachFile(page, f);
      }
    }

    const initialCount = (await page.$$('model-response')).length;

    const textbox = await page.waitForSelector(textboxSelector, { timeout: 15000 });
    await textbox.click();
    await textbox.fill(prompt);
    await page.waitForTimeout(200);

    const sendBtnSelector = 'button[aria-label*="Send message"], button[aria-label="Send message"]';
    const sendBtn = await page.$(sendBtnSelector);
    if (sendBtn && !(await sendBtn.isDisabled().catch(() => true))) {
      await sendBtn.click().catch(() => {});
    }
    await textbox.press('Enter').catch(() => {});

    await page.waitForFunction(
      (count) => {
        const responses = document.querySelectorAll('model-response');
        const stopBtn = document.querySelector('button[aria-label*="Stop" i], button[data-test-id="stop-button"]');
        return responses.length > count || stopBtn !== null;
      },
      initialCount,
      { timeout: 30000 }
    );

    let lastText = '';
    let stableStartTime = null;
    const STABLE_DURATION_MS = 500;
    const POLL_INTERVAL_MS = 200;
    const MAX_WAIT_MS = 180000;
    const streamStartTime = Date.now();

    while (Date.now() - streamStartTime < MAX_WAIT_MS) {
      await page.waitForTimeout(POLL_INTERVAL_MS);

      const currentText = await page.evaluate(() => {
        const responses = document.querySelectorAll('model-response');
        if (responses.length === 0) return null;
        const latest = responses[responses.length - 1];
        const content = latest.querySelector('message-content');
        return content ? (content.innerText || '') : '';
      });

      if (currentText !== null && currentText.length > lastText.length) {
        const chunk = currentText.slice(lastText.length);
        if (onChunk && typeof onChunk === 'function') {
          onChunk(chunk);
        }
        lastText = currentText;
        stableStartTime = null;
      }

      const stopButton = await page.$('button[aria-label*="Stop"], button[aria-label*="stop"]');

      const hasFinishedContent = await page.evaluate(() => {
        const responses = document.querySelectorAll('model-response');
        if (responses.length === 0) return false;
        const latest = responses[responses.length - 1];
        const hasText = (latest.querySelector('message-content')?.innerText || '').trim().length > 0;
        const hasImg = latest.querySelector('img, generated-image, .image-container') !== null;
        return hasText || hasImg;
      });

      if (!stopButton) {
        if (hasFinishedContent) {
          if (stableStartTime === null) {
            stableStartTime = Date.now();
          } else if (Date.now() - stableStartTime >= STABLE_DURATION_MS) {
            break;
          }
        }
      } else {
        stableStartTime = null;
      }
    }

    if (ephemeral) {
      try {
        const url = page.url();
        const match = url.match(/\/app\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          await deleteConversationInternal(page, match[1]).catch(() => {});
        }
      } catch {}
    }

    let downloadedPath = null;
    if (download) {
      downloadedPath = await downloadGeneratedMedia(page, download).catch((err) => {
        console.warn('[gemini] Download error:', err.message);
        return null;
      });
    }

    if (download) {
      return { text: lastText, downloaded: downloadedPath };
    }

    return lastText;
  } finally {
    await browser.close();
  }
}

async function dismissOverlays(page) {
  const backdrop = await page.$('.cdk-overlay-backdrop');
  if (backdrop && (await backdrop.isVisible())) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}

async function ensureSidebarOpen(page) {
  await dismissOverlays(page);
  await page.waitForSelector('side-navigation-v2, nav, [role="navigation"]', { timeout: 10000 }).catch(() => {});

  const openBtn = await page.$(
    'button[aria-label*="Open sidebar" i], button[data-test-id="side-nav-sparkle-button"][aria-label*="Open sidebar" i], button[aria-label*="Expand sidebar" i]'
  );
  if (openBtn) {
    const isVisible = await openBtn.isVisible().catch(() => false);
    if (isVisible) {
      try {
        await openBtn.click();
        await page.waitForSelector('gem-nav-list-item a[href*="/app/"]', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(300);
      } catch {}
    }
  }

  await page.waitForSelector('gem-nav-list-item a[href*="/app/"], a[href*="/app/"]', { timeout: 10000 }).catch(() => {});
}

async function listConversationsInternal(page) {
  await ensureSidebarOpen(page);
  await page
    .waitForSelector('gem-nav-list-item a[href*="/app/"], a[href*="/app/"]', { timeout: 10000 })
    .catch(() => {});
  return await page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll(
        'gem-nav-list-item[data-test-id="conversation"], gem-nav-list-item:has(a[href*="/app/"])'
      )
    );
    const seen = new Set();
    const result = [];
    let idx = 1;

    for (const item of items) {
      const a = item.querySelector('a[href*="/app/"]');
      if (!a) continue;
      const href = a.getAttribute('href') || '';
      const match = href.match(/\/app\/([a-zA-Z0-9_-]+)/);
      if (!match) continue;
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);

      const titleEl =
        item.querySelector('.conversation-title, [data-test-id="conversation-title"], .mdc-list-item__primary-text') || a;
      let title = (titleEl ? titleEl.innerText : a.innerText || '').trim();
      const ariaLabel = a.getAttribute('aria-label');
      if (ariaLabel && (!title || title.length === 0)) {
        title = ariaLabel.trim();
      }
      title = title.split('\n')[0].trim();

      result.push({
        index: idx++,
        id,
        title,
        url: `https://gemini.google.com/app/${id}`
      });
    }
    return result;
  });
}

function resolveConversation(convs, idOrIndex) {
  if (idOrIndex === undefined || idOrIndex === null || idOrIndex === '') {
    throw new Error('Conversation index or ID is required');
  }
  const str = String(idOrIndex).trim();
  if (/^\d+$/.test(str)) {
    const idx = parseInt(str, 10);
    const byIndex = convs.find((c) => c.index === idx);
    if (byIndex) return byIndex;
  }
  const cleanId = str.replace(/^.*\/app\//, '').split(/[?#]/)[0];
  const byId = convs.find((c) => c.id === cleanId || c.id === str);
  if (byId) return byId;

  if (cleanId && cleanId.length >= 8) {
    return {
      index: null,
      id: cleanId,
      title: 'Conversation',
      url: `${GEMINI_APP_URL}/${cleanId}`
    };
  }

  throw new Error(`Conversation not found: ${idOrIndex}`);
}

async function listConversations(opts = {}) {
  await ensureChrome(opts);
  const playwright = getPlaywright();
  const browser = await playwright.chromium.connectOverCDP(CDP_URL);
  try {
    const page = await getGeminiPage(browser);
    return await listConversationsInternal(page);
  } finally {
    await browser.close();
  }
}

async function getConversationTranscript(idOrIndex, opts = {}) {
  await ensureChrome(opts);
  const playwright = getPlaywright();
  const browser = await playwright.chromium.connectOverCDP(CDP_URL);
  try {
    const page = await getGeminiPage(browser);
    const convs = await listConversationsInternal(page);
    const target = resolveConversation(convs, idOrIndex);
    const targetUrl = target.url || `${GEMINI_APP_URL}/${target.id}`;

    if (!page.url().includes(target.id)) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      await page
        .waitForSelector('user-query, model-response, div[contenteditable="true"][role="textbox"]', { timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(500);
    }

    const transcriptData = await page.evaluate(async () => {
      const turnEls = Array.from(document.querySelectorAll('user-query, model-response'));
      const turns = [];

      for (let i = 0; i < turnEls.length; i++) {
        const el = turnEls[i];
        el.scrollIntoView({ behavior: 'instant', block: 'center' });

        const role = el.tagName.toLowerCase() === 'user-query' ? 'user' : 'gemini';
        let content = '';

        if (role === 'user') {
          const lines = Array.from(el.querySelectorAll('.query-text-line'));
          if (lines.length > 0) {
            content = lines
              .map((l) => l.innerText.trim())
              .filter(Boolean)
              .join('\n');
          } else {
            const clone = el.cloneNode(true);
            clone
              .querySelectorAll('.cdk-visually-hidden, button, .luminous-actions-container')
              .forEach((e) => e.remove());
            content = clone.innerText.trim();
          }
        } else {
          const mc = el.querySelector('message-content');
          if (mc) {
            content = mc.innerText.trim();
          } else {
            const clone = el.cloneNode(true);
            clone
              .querySelectorAll('.cdk-visually-hidden, button, response-feedback')
              .forEach((e) => e.remove());
            content = clone.innerText.trim();
          }
        }

        turns.push({ role, content });
      }

      const docTitle = document.title.replace(/\s*-\s*Google Gemini$/i, '').trim();
      return { docTitle, turns };
    });

    const title =
      target.title && target.title !== 'Conversation'
        ? target.title
        : transcriptData.docTitle || target.title || 'Untitled';

    return {
      id: target.id,
      title,
      url: targetUrl,
      turns: transcriptData.turns
    };
  } finally {
    await browser.close();
  }
}

async function deleteConversationInternal(page, targetId) {
  await ensureSidebarOpen(page);
  const item = await page.$(`gem-nav-list-item:has(a[href*="/app/${targetId}"])`);
  if (!item) {
    throw new Error(`Conversation element not found for ID: ${targetId}`);
  }

  await item.evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
  await page.waitForTimeout(100);
  await item.hover();
  await page.waitForTimeout(100);

  const moreBtn = await item.$(
    'button[aria-label*="More options" i], button:has([data-mat-icon-name="more_vert"])'
  );
  if (!moreBtn) {
    throw new Error(`More options button not found for conversation: ${targetId}`);
  }
  await moreBtn.click();

  const deleteMenuItem = await page.waitForSelector(
    '[data-test-id="delete-button"], [role="menuitem"]:has-text("Delete")',
    { timeout: 3000 }
  );
  await deleteMenuItem.click();

  const dialog = await page.waitForSelector('mat-dialog-container', { timeout: 5000 });
  const confirmBtn = await dialog.waitForSelector('button:has-text("Delete")', { timeout: 3000 });
  await confirmBtn.click();

  await dialog.waitForElementState('hidden', { timeout: 5000 }).catch(() => {});
  await item.evaluate((el) => el.remove()).catch(() => {});
  await page.waitForTimeout(500);

  return { status: 'deleted', id: targetId };
}

async function deleteConversation(idOrIndex, opts = {}) {
  await ensureChrome(opts);
  const playwright = getPlaywright();
  const browser = await playwright.chromium.connectOverCDP(CDP_URL);
  try {
    const page = await getGeminiPage(browser);
    const convs = await listConversationsInternal(page);
    const target = resolveConversation(convs, idOrIndex);
    return await deleteConversationInternal(page, target.id);
  } finally {
    await browser.close();
  }
}

async function getUploadToolsButton(page) {
  return page.$(
    'button[aria-label="Upload & tools"], button[aria-label*="Upload & tools" i], button[aria-label*="tools" i], button:has([data-mat-icon-name="plus"])'
  );
}

async function attachFile(page, filePath) {
  const fs = require('fs');
  const path = require('path');
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File to attach not found: ${filePath}`);
  }

  const btn = await getUploadToolsButton(page);
  if (!btn) {
    throw new Error('Upload & tools (+) button not found on Gemini page.');
  }

  await btn.click();
  await page.waitForTimeout(300);

  const uploadItem = await page.$(
    '[role="menuitem"]:has-text("Upload files"), .mat-mdc-menu-item:has-text("Upload files")'
  );
  if (!uploadItem) {
    throw new Error('"Upload files" option not found in tools menu.');
  }

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 8000 }),
    uploadItem.click()
  ]);

  await fileChooser.setFiles(resolvedPath);
  await page.waitForTimeout(1000);

  // Wait up to 15s for file preview chip to appear and send button to become enabled
  await page.waitForFunction(() => {
    const hasChip = document.querySelector('[aria-label*="close" i], [aria-label*="remove" i], file-preview') !== null;
    const btn = document.querySelector('button[aria-label*="Send message"], button[aria-label="Send message"]');
    const btnReady = btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
    return hasChip && btnReady;
  }, { timeout: 15000 }).catch(() => {});
}

async function downloadGeneratedMedia(page, targetPath) {
  const fs = require('fs');
  const path = require('path');
  const resolvedTarget = path.resolve(targetPath);

  await page.waitForTimeout(1000);

  // 1. Check for rendered image in latest response via canvas toDataURL
  const imgDataUrl = await page.evaluate(() => {
    const lastResp = document.querySelector('model-response:last-of-type');
    if (!lastResp) return null;
    const img = lastResp.querySelector(
      'generated-image img, img.image, .image-container img, img[src*="blob:"], img[src*="googleusercontent"], img'
    );
    if (!img) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 1024;
      canvas.height = img.naturalHeight || img.height || 1024;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    } catch (e) {
      return null;
    }
  });

  if (imgDataUrl && imgDataUrl.startsWith('data:image/')) {
    let dest = resolvedTarget;
    if (fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isDirectory()) {
      dest = path.join(resolvedTarget, `gemini-image-${Date.now()}.png`);
    } else if (!path.extname(dest)) {
      dest = `${dest}.png`;
    }
    const base64 = imgDataUrl.split(',')[1];
    fs.writeFileSync(dest, Buffer.from(base64, 'base64'));
    return dest;
  }

  // 2. Check for download button on latest response
  const downloadBtn = await page.$(
    'model-response:last-of-type button[aria-label*="Download" i], model-response:last-of-type a[download], [data-test-id*="download"]'
  );

  if (downloadBtn) {
    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 8000 }),
        downloadBtn.click()
      ]);
      let dest = resolvedTarget;
      if (fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isDirectory()) {
        dest = path.join(resolvedTarget, download.suggestedFilename() || 'gemini-media');
      }
      await download.saveAs(dest);
      return dest;
    } catch {}
  }

  // 3. Check for generated image in latest response with data: URI
  const imgData = await page.evaluate(() => {
    const lastResp = document.querySelector('model-response:last-of-type');
    if (!lastResp) return null;
    const img = lastResp.querySelector(
      'generated-image img, img[src*="googleusercontent"], img[src*="blob:"], .image-container img'
    );
    if (!img) return null;
    return { src: img.src, alt: img.alt || '' };
  });

  if (imgData && imgData.src) {
    let dest = resolvedTarget;
    if (fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isDirectory()) {
      dest = path.join(resolvedTarget, `gemini-media-${Date.now()}.png`);
    } else if (!path.extname(dest)) {
      dest = `${dest}.png`;
    }

    if (imgData.src.startsWith('data:')) {
      const base64 = imgData.src.split(',')[1];
      fs.writeFileSync(dest, Buffer.from(base64, 'base64'));
      return dest;
    }
  }

  return null;
}

async function getBrowserStatus(opts = {}) {
  const cdpUp = await isCdpReady();
  const runningMode = getRunningChromeMode();
  const runningProfile = getRunningChromeProfile();
  const activeProfile = profileManager.getActiveProfile();

  if (!cdpUp) {
    return {
      connected: false,
      mode: null,
      runningProfile: null,
      activeProfile,
      tabs: []
    };
  }

  const playwright = getPlaywright();
  const browser = await playwright.chromium.connectOverCDP(CDP_URL);
  const tabs = [];

  try {
    for (const ctx of browser.contexts()) {
      for (const [idx, page] of ctx.pages().entries()) {
        const title = await page.title().catch(() => 'Untitled');
        tabs.push({
          index: idx + 1,
          title: title.trim(),
          url: page.url()
        });
      }
    }
  } finally {
    await browser.close();
  }

  return {
    connected: true,
    mode: runningMode || 'visible',
    runningProfile,
    activeProfile,
    tabs
  };
}

module.exports = {
  getPlaywright,
  getGeminiPage,
  checkRobotVerification,
  sendPrompt,
  ensureChrome,
  stopChrome,
  isCdpReady,
  getRunningChromeMode,
  getRunningChromeProfile,
  getBrowserStatus,
  getUploadToolsButton,
  attachFile,
  downloadGeneratedMedia,
  listConversations,
  listConversationsInternal,
  getConversationTranscript,
  deleteConversation,
  deleteConversationInternal,
  profileManager
};
