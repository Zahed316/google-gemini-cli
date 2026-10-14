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

async function getGeminiPage(browser) {
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      if (page.url().includes('google.com/sorry')) {
        await page.close().catch(() => {});
        continue;
      }
      if (page.url().startsWith('https://gemini.google.com')) {
        return page;
      }
    }
  }

  let ctx = browser.contexts()[0];
  if (!ctx) ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(GEMINI_APP_URL, { waitUntil: 'domcontentloaded' });
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
  ephemeral = false
}) {
  await ensureChrome({ headless, profile, restart });

  const playwright = getPlaywright();
  const browser = await playwright.chromium.connectOverCDP(CDP_URL);

  try {
    const page = await getGeminiPage(browser);

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

    const initialCount = (await page.$$('model-response')).length;

    const textbox = await page.waitForSelector(textboxSelector, { timeout: 15000 });
    await textbox.click();
    await textbox.fill(prompt);

    const sendBtnSelector = 'button[aria-label*="Send message"], button[aria-label="Send message"]';
    const sendBtn = await page.waitForSelector(sendBtnSelector, { timeout: 10000 });
    await sendBtn.click();

    await page.waitForFunction(
      (count) => document.querySelectorAll('model-response').length > count,
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

      if (!stopButton) {
        if (currentText !== null && currentText.trim().length > 0) {
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

module.exports = {
  sendPrompt,
  ensureChrome,
  stopChrome,
  isCdpReady,
  getRunningChromeMode,
  getRunningChromeProfile,
  listConversations,
  listConversationsInternal,
  getConversationTranscript,
  deleteConversation,
  deleteConversationInternal,
  profileManager
};
