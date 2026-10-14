#!/usr/bin/env node

const { parseArgs } = require('util');
const path = require('path');
const fs = require('fs');

const VERSION = '1.0.0';
let DRIVER_PATH = path.join(__dirname, '../src/gemini-driver');
if (!fs.existsSync(DRIVER_PATH + '.js') && !fs.existsSync(DRIVER_PATH)) {
  DRIVER_PATH = path.join(
    process.env.HOME || '/home/zahedrastgar',
    '.local/share/gemini-cli/gemini-driver'
  );
}

function printHelp() {
  console.log(`gemini - CLI bridge for Google Gemini

Usage:
  gemini [options] [prompt...]
  cat file | gemini [options] [prompt...]

Options:
  -m, --model <name>       Model to use (e.g. argon, pro, flash)
  -t, --thinking <level>   Thinking reasoning depth (e.g. low, medium, high)
  -n, --new                Start a new chat session
  -p, --profile <name|idx> Choose Google/Chrome profile by name, email, or index
  --list-profiles          List discovered Chrome profiles and accounts
  --set-profile <name|idx> Set default persistent profile
  --login [profile]        Launch visible Chrome window to log in to Google account
  -l, --list               List conversations
  --view <index|id>        View conversation transcript
  -d, --delete <index|id>  Delete specific conversation
  -y, --yes                Skip confirmation for deletion
  -e, --ephemeral          Auto-delete conversation after completion (zero sidebar clutter)
  --format <format>        Output format ('text' or 'ndjson' for agent harnesses)
  --doctor                 Run diagnostic health checks on Chrome, CDP, and profiles
  --headless [mode]        Run in headless mode: 'xvfb' (default) or 'native' (--headless=new)
  --visible                Force visible browser window (overrides GEMINI_HEADLESS)
  --restart                Restart browser instance in the selected mode
  --json                   Format output as JSON
  -h, --help               Show this help message
  -v, --version            Show version number

Examples:
  gemini "Explain quantum computing in simple terms"
  gemini --list-profiles
  gemini --set-profile 3
  gemini -p chatgpt "Prompt using secondary account"
  gemini --login work
  gemini --headless "Run silently in virtual display (xvfb)"
  gemini --headless native "Run with Chrome native headless=new"
  gemini --visible "Run with visible browser"
  cat file.txt | gemini "Summarize this file"
  gemini -m argon -t high "Complex reasoning query"
  gemini -n "Start fresh conversation"
  gemini -l
  gemini -l --json
  gemini --view 1
  gemini -d 1 -y
`);
}

async function readStdin() {
  if (process.stdin.isTTY) {
    return '';
  }
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
    process.stdin.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const normalizedArgs = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--headless') {
      const next = rawArgs[i + 1];
      if (
        next &&
        !next.startsWith('-') &&
        ['xvfb', 'xvfb-run', 'native', 'new', 'builtin'].includes(next.toLowerCase())
      ) {
        normalizedArgs.push(`--headless=${next.toLowerCase()}`);
        i++;
      } else {
        normalizedArgs.push('--headless=xvfb');
      }
    } else if (arg === '--login') {
      const next = rawArgs[i + 1];
      if (next && !next.startsWith('-')) {
        normalizedArgs.push(`--login=${next}`);
        i++;
      } else {
        normalizedArgs.push('--login=');
      }
    } else {
      normalizedArgs.push(arg);
    }
  }

  let values, positionals;
  try {
    const parsed = parseArgs({
      args: normalizedArgs,
      options: {
        model: { type: 'string', short: 'm' },
        thinking: { type: 'string', short: 't' },
        new: { type: 'boolean', short: 'n' },
        profile: { type: 'string', short: 'p' },
        'list-profiles': { type: 'boolean' },
        'set-profile': { type: 'string' },
        login: { type: 'string' },
        list: { type: 'boolean', short: 'l' },
        view: { type: 'string' },
        delete: { type: 'string', short: 'd' },
        json: { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
        ephemeral: { type: 'boolean', short: 'e' },
        format: { type: 'string' },
        doctor: { type: 'boolean' },
        headless: { type: 'string' },
        visible: { type: 'boolean' },
        restart: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' }
      },
      allowPositionals: true
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (values.version) {
    console.log(VERSION);
    process.exit(0);
  }

  if (values.doctor || (positionals.length === 1 && positionals[0] === 'doctor')) {
    let driver;
    try {
      driver = require(DRIVER_PATH);
    } catch (err) {
      console.error('Error:', `Failed to load Gemini driver: ${err.message}`);
      process.exit(1);
    }

    console.log('==> Running google-gemini-cli Doctor...\n');
    console.log(`[✓] Node.js Version: ${process.version}`);

    const { execSync } = require('child_process');
    const fs = require('fs');

    const chromeBin = '/opt/google/chrome/chrome';
    if (fs.existsSync(chromeBin)) {
      console.log(`[✓] Google Chrome: ${chromeBin}`);
    } else {
      console.log(`[!] Google Chrome: Not found at ${chromeBin}`);
    }

    let xvfbFound = false;
    try {
      execSync('which xvfb-run', { stdio: 'ignore' });
      xvfbFound = true;
    } catch {}
    if (xvfbFound) {
      console.log(`[✓] Virtual Display (Xvfb): Available for silent headless mode`);
    } else {
      console.log(`[!] Virtual Display (Xvfb): Not installed (run: sudo apt install xvfb)`);
    }

    const cdpUp = await driver.isCdpReady();
    const runningMode = driver.getRunningChromeMode();
    const runningProfile = driver.getRunningChromeProfile();
    if (cdpUp) {
      console.log(`[✓] CDP Port 9222: Connected (${runningMode || 'visible'} mode)`);
      if (runningProfile) {
        console.log(`[✓] Active Browser Data Dir: ${runningProfile.userDataDir}`);
      }
    } else {
      console.log(`[-] CDP Port 9222: Offline (will auto-launch on demand)`);
    }

    const profiles = driver.profileManager.listProfiles();
    console.log(`[✓] Discovered Profiles: ${profiles.length} profile(s) found`);
    const active = profiles.find((p) => p.isActive);
    if (active) {
      console.log(`[✓] Default Profile: "${active.name}" (${active.email || 'no email'})`);
    }

    if (process.env.WAYLAND_DISPLAY) {
      console.log(`[i] Desktop Display Server: Wayland (${process.env.WAYLAND_DISPLAY}) - Ozone isolation active`);
    } else {
      console.log(`[i] Desktop Display Server: X11 / Headless`);
    }

    console.log('\nDoctor status: Ready.');
    process.exit(0);
  }

  if (values['list-profiles']) {
    let driver;
    try {
      driver = require(DRIVER_PATH);
    } catch (err) {
      console.error('Error:', `Failed to load Gemini driver: ${err.message}`);
      process.exit(1);
    }
    const profiles = driver.profileManager.listProfiles();
    if (values.json) {
      console.log(JSON.stringify(profiles, null, 2));
    } else {
      console.log(`${'#'.padEnd(4)} ${'ID'.padEnd(16)} ${'NAME'.padEnd(16)} ${'EMAIL'.padEnd(28)} ${'ACTIVE'.padEnd(8)} USER DATA DIR`);
      for (const p of profiles) {
        const star = p.isActive ? '*' : ' ';
        const idx = `${p.index} ${star}`.padEnd(4);
        const id = p.id.slice(0, 15).padEnd(16);
        const name = (p.name || '-').slice(0, 15).padEnd(16);
        const email = (p.email || '-').slice(0, 27).padEnd(28);
        const active = (p.isActive ? 'yes' : 'no').padEnd(8);
        const dir = p.profileDir !== 'Default' ? `${p.userDataDir} (${p.profileDir})` : p.userDataDir;
        console.log(`${idx} ${id} ${name} ${email} ${active} ${dir}`);
      }
      console.log('\nUse "gemini -p <index|id>" to use a profile for a single run, or "gemini --set-profile <index|id>" to set default.');
    }
    process.exit(0);
  }

  if (values['set-profile']) {
    let driver;
    try {
      driver = require(DRIVER_PATH);
    } catch (err) {
      console.error('Error:', `Failed to load Gemini driver: ${err.message}`);
      process.exit(1);
    }
    const resolved = driver.profileManager.setActiveProfile(values['set-profile']);
    console.log(`Active profile set to "${resolved.name}" (${resolved.id}) [${resolved.email || 'No email'}]`);
    console.log(`User data directory: ${resolved.userDataDir}`);
    process.exit(0);
  }

  if (values.login !== undefined) {
    let driver;
    try {
      driver = require(DRIVER_PATH);
    } catch (err) {
      console.error('Error:', `Failed to load Gemini driver: ${err.message}`);
      process.exit(1);
    }
    const targetQuery = values.login || values.profile || null;
    const target = driver.profileManager.resolveProfile(targetQuery);
    console.log(`Launching visible Chrome for profile "${target.name}" (${target.id})...`);
    console.log(`User data directory: ${target.userDataDir}`);
    console.log(`Please sign in to Google / Gemini in the opened browser window.`);
    try {
      await driver.ensureChrome({
        headless: 'visible',
        profile: target.id,
        restart: true
      });
      console.log('Browser window opened and CDP ready. Complete login in the browser.');
      process.exit(0);
    } catch (err) {
      console.error('Error starting browser for login:', err.message);
      if (err.message.includes('port 9222')) {
        console.error('Tip: If using the main profile, close running Chrome instances or use a dedicated profile like: gemini --login <new-profile-name>');
      }
      process.exit(1);
    }
  }

  let headlessMode = null;
  if (values.visible) {
    headlessMode = 'visible';
  } else if (values.headless) {
    headlessMode = values.headless;
  }
  const driverOpts = {
    headless: headlessMode,
    profile: values.profile || null,
    restart: Boolean(values.restart)
  };

  if (values.list) {
    let driver;
    try {
      driver = require(DRIVER_PATH);
    } catch (err) {
      console.error('Error:', `Failed to load Gemini driver: ${err.message}`);
      process.exit(1);
    }

    try {
      const convs = await driver.listConversations(driverOpts);
      if (values.json) {
        console.log(JSON.stringify(convs, null, 2));
      } else {
        if (convs.length === 0) {
          console.log('No conversations found.');
        } else {
          const titleWidth = Math.min(
            50,
            Math.max(25, ...convs.map((c) => (c.title ? c.title.length : 0)))
          );
          console.log(`${'#'.padEnd(4)} ${'TITLE'.padEnd(titleWidth)} ${'ID'}`);
          for (const c of convs) {
            const t = (c.title || 'Untitled').slice(0, titleWidth);
            console.log(`${String(c.index).padEnd(4)} ${t.padEnd(titleWidth)} ${c.id}`);
          }
        }
      }
      process.exit(0);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  }

  if (values.view !== undefined) {
    let driver;
    try {
      driver = require(DRIVER_PATH);
    } catch (err) {
      console.error('Error:', `Failed to load Gemini driver: ${err.message}`);
      process.exit(1);
    }

    try {
      const transcript = await driver.getConversationTranscript(values.view, driverOpts);
      if (values.json) {
        console.log(JSON.stringify(transcript, null, 2));
      } else {
        console.log(`# ${transcript.title}\n`);
        for (const turn of transcript.turns) {
          const roleLabel = turn.role === 'user' ? 'User' : 'Gemini';
          console.log(`### ${roleLabel}\n${turn.content}\n`);
        }
      }
      process.exit(0);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  }

  if (values.delete !== undefined) {
    let driver;
    try {
      driver = require(DRIVER_PATH);
    } catch (err) {
      console.error('Error:', `Failed to load Gemini driver: ${err.message}`);
      process.exit(1);
    }

    if (process.stdin.isTTY && !values.yes) {
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      const answer = await new Promise((resolve) => {
        rl.question(`Delete conversation ${values.delete}? [y/N] `, resolve);
      });
      rl.close();
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.error('Aborted.');
        process.exit(0);
      }
    }

    try {
      const result = await driver.deleteConversation(values.delete, driverOpts);
      if (values.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Deleted conversation ${result.id}`);
      }
      process.exit(0);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  }

  const stdinData = await readStdin();
  const positionalPrompt = positionals.join(' ').trim();
  const stdinPrompt = stdinData.trim();

  let fullPrompt = '';
  if (positionalPrompt && stdinPrompt) {
    fullPrompt = `${positionalPrompt}\n\n${stdinPrompt}`;
  } else if (positionalPrompt) {
    fullPrompt = positionalPrompt;
  } else if (stdinPrompt) {
    fullPrompt = stdinPrompt;
  }

  if (!fullPrompt) {
    console.error('Error: No prompt provided. Provide a prompt argument or pipe content via stdin.');
    console.error('Run "gemini --help" for usage information.');
    process.exit(1);
  }

  let sendPrompt;
  try {
    const driver = require(DRIVER_PATH);
    sendPrompt = driver.sendPrompt;
  } catch (err) {
    console.error('Error:', `Failed to load Gemini driver: ${err.message}`);
    process.exit(1);
  }

  let hadOutput = false;
  let endsWithNewline = false;
  const isNdjson = values.format === 'ndjson';

  if (isNdjson) {
    console.log(JSON.stringify({ event: 'start', model: values.model || 'default', thinking: values.thinking || 'default' }));
  }

  try {
    const result = await sendPrompt({
      prompt: fullPrompt,
      model: values.model,
      thinking: values.thinking,
      isNewChat: Boolean(values.new),
      headless: driverOpts.headless,
      profile: driverOpts.profile,
      restart: driverOpts.restart,
      ephemeral: Boolean(values.ephemeral),
      onChunk: (chunk) => {
        if (chunk) {
          hadOutput = true;
          if (isNdjson) {
            console.log(JSON.stringify({ event: 'chunk', text: chunk }));
          } else {
            endsWithNewline = chunk.endsWith('\n');
            process.stdout.write(chunk);
          }
        }
      }
    });

    if (isNdjson) {
      console.log(JSON.stringify({ event: 'done', text: result }));
    } else if ((result && !result.endsWith('\n')) || (hadOutput && !endsWithNewline)) {
      process.stdout.write('\n');
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
