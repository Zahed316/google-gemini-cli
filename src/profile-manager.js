const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || '/home/zahedrastgar';
const CONFIG_DIR = path.join(HOME, '.config', 'gemini-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_PROFILE_NAME = 'flow';
const DEFAULT_USER_DATA_DIR = path.join(HOME, '.config', 'google-chrome-flow');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return {
      activeProfile: DEFAULT_PROFILE_NAME,
      profiles: {
        flow: {
          id: 'flow',
          name: 'Flow (Default)',
          userDataDir: DEFAULT_USER_DATA_DIR,
          profileDir: 'Default'
        }
      }
    };
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const cfg = JSON.parse(raw);
    if (!cfg.profiles) cfg.profiles = {};
    if (!cfg.activeProfile) cfg.activeProfile = DEFAULT_PROFILE_NAME;
    return cfg;
  } catch {
    return { activeProfile: DEFAULT_PROFILE_NAME, profiles: {} };
  }
}

function saveConfig(cfg) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

function getLocalStateInfo(userDataDir) {
  const localStatePath = path.join(userDataDir, 'Local State');
  if (!fs.existsSync(localStatePath)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    return data.profile?.info_cache || {};
  } catch {
    return {};
  }
}

function listProfiles() {
  const cfg = loadConfig();
  const activeId = process.env.GEMINI_PROFILE || cfg.activeProfile || DEFAULT_PROFILE_NAME;

  const discovered = [];
  const configBase = path.join(HOME, '.config');

  const knownDirs = [
    { id: 'flow', name: 'Flow', dir: path.join(configBase, 'google-chrome-flow') },
    { id: 'main', name: 'Main', dir: path.join(configBase, 'google-chrome') },
    { id: 'beta', name: 'Beta', dir: path.join(configBase, 'google-chrome-beta') },
    { id: 'testing', name: 'Testing', dir: path.join(configBase, 'google-chrome-for-testing') },
    { id: 'headless', name: 'Headless', dir: path.join(configBase, 'google-chrome-headless') }
  ];

  try {
    const entries = fs.readdirSync(configBase);
    for (const e of entries) {
      if (e.startsWith('google-chrome-') && !knownDirs.some((k) => k.dir === path.join(configBase, e))) {
        const customId = e.replace('google-chrome-', '');
        knownDirs.push({
          id: customId,
          name: customId,
          dir: path.join(configBase, e)
        });
      }
    }
  } catch {}

  let idx = 1;
  const result = [];
  const seenIds = new Set();

  for (const kd of knownDirs) {
    if (!fs.existsSync(kd.dir)) continue;

    const infoCache = getLocalStateInfo(kd.dir);
    let subDirs = [];
    try {
      subDirs = fs.readdirSync(kd.dir).filter((d) => d === 'Default' || /^Profile \d+$/.test(d));
    } catch {}

    if (subDirs.length === 0) {
      subDirs = ['Default'];
    }

    for (const sub of subDirs) {
      const profInfo = infoCache[sub] || {};
      const email = profInfo.user_name || '';
      const name = profInfo.name || kd.name;

      const profileId = sub === 'Default' ? kd.id : `${kd.id}-${sub.toLowerCase().replace(/\s+/g, '')}`;
      if (seenIds.has(profileId)) continue;
      seenIds.add(profileId);

      const isActive =
        profileId === activeId ||
        (kd.id === activeId && sub === 'Default') ||
        (kd.dir === activeId && sub === 'Default');

      result.push({
        index: idx++,
        id: profileId,
        alias: kd.id,
        name,
        email,
        userDataDir: kd.dir,
        profileDir: sub,
        isActive: Boolean(isActive)
      });
    }
  }

  for (const [profKey, profVal] of Object.entries(cfg.profiles || {})) {
    if (!seenIds.has(profKey)) {
      result.push({
        index: idx++,
        id: profKey,
        alias: profKey,
        name: profVal.name || profKey,
        email: profVal.email || '',
        userDataDir: profVal.userDataDir,
        profileDir: profVal.profileDir || 'Default',
        isActive: profKey === activeId
      });
      seenIds.add(profKey);
    }
  }

  return result;
}

function resolveProfile(query) {
  const all = listProfiles();
  const cfg = loadConfig();

  let target = (query || process.env.GEMINI_PROFILE || cfg.activeProfile || DEFAULT_PROFILE_NAME).trim();

  if (/^\d+$/.test(target)) {
    const num = parseInt(target, 10);
    const byIdx = all.find((p) => p.index === num);
    if (byIdx) return byIdx;
  }

  const byId = all.find(
    (p) =>
      p.id.toLowerCase() === target.toLowerCase() ||
      p.alias.toLowerCase() === target.toLowerCase()
  );
  if (byId) return byId;

  const byEmail = all.find(
    (p) => p.email && p.email.toLowerCase().includes(target.toLowerCase())
  );
  if (byEmail) return byEmail;

  const byName = all.find(
    (p) => p.name && p.name.toLowerCase().includes(target.toLowerCase())
  );
  if (byName) return byName;

  if (target.startsWith('/') || target.startsWith('~')) {
    const fullPath = target.startsWith('~') ? path.join(HOME, target.slice(1)) : target;
    return {
      index: null,
      id: path.basename(fullPath).replace(/^google-chrome-?/, '') || 'custom',
      alias: 'custom',
      name: path.basename(fullPath),
      email: '',
      userDataDir: fullPath,
      profileDir: 'Default',
      isActive: false
    };
  }

  const newDir = path.join(HOME, '.config', `google-chrome-${target}`);
  return {
    index: null,
    id: target,
    alias: target,
    name: target,
    email: '',
    userDataDir: newDir,
    profileDir: 'Default',
    isActive: false,
    isNew: !fs.existsSync(newDir)
  };
}

function getActiveProfile() {
  const profiles = listProfiles();
  return profiles.find((p) => p.isActive) || profiles[0] || null;
}

function setActiveProfile(query) {
  const resolved = resolveProfile(query);
  const cfg = loadConfig();
  cfg.activeProfile = resolved.id;
  if (!cfg.profiles) cfg.profiles = {};
  cfg.profiles[resolved.id] = {
    id: resolved.id,
    name: resolved.name,
    email: resolved.email,
    userDataDir: resolved.userDataDir,
    profileDir: resolved.profileDir
  };
  saveConfig(cfg);
  return resolved;
}

module.exports = {
  listProfiles,
  resolveProfile,
  getActiveProfile,
  setActiveProfile,
  loadConfig,
  saveConfig,
  DEFAULT_USER_DATA_DIR,
  DEFAULT_PROFILE_NAME
};
