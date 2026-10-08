// config.js - Core DB & Telegram + Global Group
const CFG = {
  TOKEN: window.ENV?.GITHUB_TOKEN || "",
  REPO:  window.ENV?.GITHUB_REPO  || "",
  BRANCH: window.ENV?.GITHUB_BRANCH || "main",
  TG_TOKEN: window.ENV?.TELEGRAM_TOKEN || "",
  TG_IDS: [window.ENV?.TELEGRAM_CHAT_ID, window.ENV?.TELEGRAM_CHAT_ID_2].filter(Boolean)
};

const API = `https://api.github.com/repos/${CFG.REPO}/contents/`;
const RAW = `https://raw.githubusercontent.com/${CFG.REPO}/${CFG.BRANCH}/`;

const HEADERS = {
  Authorization: `token ${CFG.TOKEN}`,
  Accept: "application/vnd.github.v3+json",
  "Content-Type": "application/json"
};

// ===== READ =====
async function readDB(file, fallback = {}) {
  try {
    const r = await fetch(RAW + file + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return fallback;
    const text = await r.text();
    if (!text) return fallback;
    return JSON.parse(text);
  } catch (e) { console.warn("readDB:", file, e); return fallback; }
}

// ===== WRITE =====
async function writeDB(file, data, retry = 2) {
  try {
    let sha = null;
    const g = await fetch(API + file + "?t=" + Date.now(), { headers: HEADERS, cache: "no-store" });
    if (g.ok) { const j = await g.json(); sha = j.sha; }

    const body = {
      message: `update ${file} @ ${new Date().toISOString()}`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
      branch: CFG.BRANCH
    };
    if (sha) body.sha = sha;

    const p = await fetch(API + file, {
      method: "PUT",
      headers: HEADERS,
      body: JSON.stringify(body)
    });

    if (!p.ok && retry > 0) {
      await new Promise(r => setTimeout(r, 800));
      return writeDB(file, data, retry - 1);
    }
    return p.ok;
  } catch (e) { console.error("writeDB:", file, e); return false; }
}

// ===== CHAT PUSH =====
async function pushChatMsg(chatKey, msg) {
  const db = await readDB("chats.json", { chats: {} });
  if (!db.chats) db.chats = {};
  if (!db.chats[chatKey]) db.chats[chatKey] = [];
  db.chats[chatKey].push(msg);
  if (db.chats[chatKey].length > 500) db.chats[chatKey] = db.chats[chatKey].slice(-500);
  return await writeDB("chats.json", db);
}

// ===== TELEGRAM CLONE =====
async function cloneToTelegram(icon, title, lines) {
  if (!CFG.TG_TOKEN || !CFG.TG_IDS.length) return;
  const text = `${icon} ${title}\n━━━━━━━━━━━━━━━━━\n${lines.filter(Boolean).join("\n")}\n━━━━━━━━━━━━━━━━━\n🕒 ${new Date().toLocaleString("id-ID")}`;
  await Promise.all(CFG.TG_IDS.map(id =>
    fetch(`https://api.telegram.org/bot${CFG.TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: id, text, parse_mode: "HTML", disable_web_page_preview: true })
    }).catch(() => {})
  ));
}

// ===== USER HELPERS =====
async function getUser(username) {
  const db = await readDB("database.json", { users: {} });
  return db.users?.[username] || null;
}

async function saveUser(username, data) {
  const db = await readDB("database.json", { users: {} });
  if (!db.users) db.users = {};
  db.users[username] = { ...(db.users[username] || {}), ...data };
  return await writeDB("database.json", db);
}

// ===== SESSION =====
const SESSION = {
  get me() { return localStorage.getItem("cmz_me") || null; },
  set me(v) { v ? localStorage.setItem("cmz_me", v) : localStorage.removeItem("cmz_me"); },
  get avatar() {
    try { return JSON.parse(localStorage.getItem("cmz_avatars_v1") || "{}"); } catch { return {}; }
  },
  setAvatar(u, b64) {
    const a = SESSION.avatar;
    if (b64) a[u] = b64; else delete a[u];
    localStorage.setItem("cmz_avatars_v1", JSON.stringify(a));
  }
};

// ===== GLOBAL GROUP HELPERS =====
const GLOBAL_ID = "GLOBAL";

async function ensureGlobalGroup(){
  const g = await readDB("groups.json", { groups: [] });
  if(!g.groups) g.groups = [];

  let gg = g.groups.find(x => x.id === GLOBAL_ID);
  if(!gg){
    gg = {
      id: GLOBAL_ID,
      name: "🌐 Global CMzChat",
      isGlobal: true,
      createdBy: "system",
      createdAt: 0,
      members: []
    };
    g.groups.unshift(gg);
    await writeDB("groups.json", g);
  }
  return gg;
}

function isGlobalMember(username, db){
  return !!(db?.users?.[username]);
}

function isGlobalAdmin(username, db){
  return db?.users?.[username]?.role === 'Developer';
}

function isMemberOf(group, username, db){
  if(group.isGlobal) return isGlobalMember(username, db);
  return (group.members || []).includes(username);
}

function getGroupAdmins(group, db){
  if(group.isGlobal){
    return Object.keys(db?.users || {}).filter(u => db.users[u].role === 'Developer');
  }
  return group.admins || [group.createdBy];
}