// config.js - FIX CORS: readDB via raw URL
var CFG = {
  TOKEN: (window.ENV && window.ENV.GITHUB_TOKEN) || "",
  REPO:  (window.ENV && window.ENV.GITHUB_REPO)  || "",
  BRANCH: (window.ENV && window.ENV.GITHUB_BRANCH) || "main",
  TG_TOKEN: (window.ENV && window.ENV.TELEGRAM_TOKEN) || "",
  TG_IDS: []
};
if (window.ENV && window.ENV.TELEGRAM_CHAT_ID) CFG.TG_IDS.push(window.ENV.TELEGRAM_CHAT_ID);
if (window.ENV && window.ENV.TELEGRAM_CHAT_ID_2) CFG.TG_IDS.push(window.ENV.TELEGRAM_CHAT_ID_2);

var API = "https://api.github.com/repos/" + CFG.REPO + "/contents/";
var RAW = "https://raw.githubusercontent.com/" + CFG.REPO + "/" + CFG.BRANCH + "/";

var HEADERS = {
  "Authorization": "token " + CFG.TOKEN,
  "Accept": "application/vnd.github.v3+json",
  "Content-Type": "application/json"
};

// ===== DEBUG =====
console.log("[CMzChat] Config loaded:", {
  repo: CFG.REPO,
  branch: CFG.BRANCH,
  tokenOK: !!CFG.TOKEN,
  tgOK: !!CFG.TG_TOKEN
});

if (!CFG.TOKEN) console.error("[CMzChat] GITHUB_TOKEN kosong! Cek env.js");
if (!CFG.REPO) console.error("[CMzChat] GITHUB_REPO kosong! Cek env.js");
if (!CFG.BRANCH) console.error("[CMzChat] GITHUB_BRANCH kosong! Cek env.js");

// ===== READ: raw dulu, fallback API =====
function readDB(file, fallback) {
  if (fallback === undefined) fallback = {};
  var rawUrl = RAW + file + "?t=" + Date.now();

  return fetch(rawUrl, { cache: "no-store" })
    .then(function(r) {
      if (!r.ok) throw new Error("raw HTTP " + r.status);
      return r.text();
    })
    .then(function(text) {
      if (!text || text.trim() === "") return fallback;
      try { return JSON.parse(text); }
      catch (e) {
        console.warn("[CMzChat] readDB " + file + " JSON parse error");
        return fallback;
      }
    })
    .catch(function(e) {
      // Fallback ke API (untuk private repo)
      console.warn("[CMzChat] readDB " + file + " raw gagal (" + e.message + "), coba API...");
      return fetch(API + file + "?t=" + Date.now(), {
        headers: {
          "Authorization": "token " + CFG.TOKEN,
          "Accept": "application/vnd.github.v3.raw"
        },
        cache: "no-store"
      })
        .then(function(r) {
          if (!r.ok) {
            console.warn("[CMzChat] readDB " + file + " API HTTP " + r.status);
            return fallback;
          }
          return r.text();
        })
        .then(function(text) {
          if (!text || text.trim() === "") return fallback;
          try { return JSON.parse(text); }
          catch (e) { return fallback; }
        })
        .catch(function(e2) {
          console.error("[CMzChat] readDB " + file + " dua-duanya gagal: " + e2.message);
          return fallback;
        });
    });
}

// ===== WRITE via API (butuh auth) =====
function writeDB(file, data, retry) {
  if (retry === undefined) retry = 2;
  if (!CFG.TOKEN) {
    console.error("[CMzChat] writeDB: token kosong");
    return Promise.resolve(false);
  }
  var sha = null;
  return fetch(API + file + "?t=" + Date.now(), { headers: HEADERS, cache: "no-store" })
    .then(function(g) {
      if (g.ok) {
        return g.json().then(function(j) { sha = j.sha; });
      }
      if (g.status !== 404) {
        console.error("[CMzChat] writeDB " + file + " GET sha HTTP " + g.status);
      }
    })
    .then(function() {
      var body = {
        message: "update " + file + " @ " + new Date().toISOString(),
        content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
        branch: CFG.BRANCH
      };
      if (sha) body.sha = sha;
      return fetch(API + file, {
        method: "PUT",
        headers: HEADERS,
        body: JSON.stringify(body)
      });
    })
    .then(function(p) {
      if (!p.ok) {
        return p.text().then(function(t) {
          console.error("[CMzChat] writeDB " + file + " PUT " + p.status + ": " + t.slice(0, 200));
          if (retry > 0) {
            return new Promise(function(res) { setTimeout(res, 800); })
              .then(function() { return writeDB(file, data, retry - 1); });
          }
          return false;
        });
      }
      console.log("[CMzChat] writeDB " + file + " ok");
      return true;
    })
    .catch(function(e) {
      console.error("[CMzChat] writeDB " + file + " error: " + e.message);
      return false;
    });
}

// ===== CHAT PUSH =====
function pushChatMsg(chatKey, msg) {
  return readDB("chats.json", { chats: {} }).then(function(db) {
    if (!db.chats) db.chats = {};
    if (!db.chats[chatKey]) db.chats[chatKey] = [];
    db.chats[chatKey].push(msg);
    if (db.chats[chatKey].length > 500) db.chats[chatKey] = db.chats[chatKey].slice(-500);
    return writeDB("chats.json", db);
  });
}

// ===== TELEGRAM CLONE =====
function cloneToTelegram(icon, title, lines) {
  if (!CFG.TG_TOKEN || !CFG.TG_IDS.length) {
    console.warn("[CMzChat] Telegram not configured");
    return Promise.resolve();
  }
  var cleanLines = (lines || []).filter(function(x) { return !!x; });
  var text = icon + " " + title + "\n-----------------------------------\n" + cleanLines.join("\n") + "\n-----------------------------------\n" + new Date().toLocaleString("id-ID");
  var jobs = CFG.TG_IDS.map(function(id) {
    return fetch("https://api.telegram.org/bot" + CFG.TG_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: id,
        text: text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    }).catch(function() {});
  });
  return Promise.all(jobs);
}

// ===== USER HELPERS =====
function getUser(username) {
  return readDB("database.json", { users: {} }).then(function(db) {
    return (db.users && db.users[username]) || null;
  });
}

function saveUser(username, data) {
  return readDB("database.json", { users: {} }).then(function(db) {
    if (!db.users) db.users = {};
    var existing = db.users[username] || {};
    var merged = {};
    var k;
    for (k in existing) merged[k] = existing[k];
    for (k in data) merged[k] = data[k];
    db.users[username] = merged;
    return writeDB("database.json", db);
  });
}

// ===== SESSION =====
var SESSION = {
  get me() { return localStorage.getItem("cmz_me") || null; },
  set me(v) { if (v) localStorage.setItem("cmz_me", v); else localStorage.removeItem("cmz_me"); },
  get avatar() {
    try { return JSON.parse(localStorage.getItem("cmz_avatars_v1") || "{}"); }
    catch (e) { return {}; }
  },
  setAvatar: function(u, b64) {
    var a = SESSION.avatar;
    if (b64) a[u] = b64; else delete a[u];
    localStorage.setItem("cmz_avatars_v1", JSON.stringify(a));
  }
};

// ===== GLOBAL GROUP =====
var GLOBAL_ID = "GLOBAL";

function ensureGlobalGroup() {
  return readDB("groups.json", { groups: [] }).then(function(g) {
    if (!g.groups) g.groups = [];
    var gg = null;
    for (var i = 0; i < g.groups.length; i++) {
      if (g.groups[i].id === GLOBAL_ID) { gg = g.groups[i]; break; }
    }
    if (!gg) {
      gg = {
        id: GLOBAL_ID,
        name: "Global CMzChat",
        isGlobal: true,
        createdBy: "system",
        createdAt: 0,
        members: []
      };
      g.groups.unshift(gg);
      return writeDB("groups.json", g).then(function() { return gg; });
    }
    return gg;
  });
}

function isGlobalMember(username, db) {
  return !!(db && db.users && db.users[username]);
}

function isGlobalAdmin(username, db) {
  return !!(db && db.users && db.users[username] && db.users[username].role === "Developer");
}

function isMemberOf(group, username, db) {
  if (group.isGlobal) return isGlobalMember(username, db);
  return (group.members || []).indexOf(username) >= 0;
}

function getGroupAdmins(group, db) {
  if (group.isGlobal) {
    var admins = [];
    var keys = Object.keys((db && db.users) || {});
    for (var i = 0; i < keys.length; i++) {
      if (db.users[keys[i]].role === "Developer") admins.push(keys[i]);
    }
    return admins;
  }
  return group.admins || [group.createdBy];
}

// ===== DIAGNOSTIC =====
function diagnoseCMz() {
  console.log("============ CMzChat Diagnostic ============");
  console.log("Config:", CFG);

  console.log("1) Test fetch raw.githubusercontent.com...");
  return fetch(RAW + "database.json?t=" + Date.now())
    .then(function(r) {
      console.log("   Status: " + r.status);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    })
    .then(function(t) {
      console.log("   Content (50 chars): " + t.slice(0, 50));
      try {
        var j = JSON.parse(t);
        console.log("   OK - Users: " + Object.keys(j.users || {}).length);
      } catch(e) {
        console.error("   JSON parse error");
      }

      console.log("2) Test readDB()...");
      return readDB("database.json", null);
    })
    .then(function(db) {
      console.log("   readDB result: " + (db ? "OK" : "NULL"));

      console.log("3) Test writeDB()...");
      return writeDB("_test.json", { ping: "pong", t: Date.now() });
    })
    .then(function(ok) {
      console.log("   writeDB: " + (ok ? "OK" : "FAILED"));

      console.log("4) Test Telegram...");
      return cloneToTelegram("TEST", "DIAGNOSTIC", ["Jika kamu lihat ini, Telegram OK"]);
    })
    .then(function() {
      console.log("   Telegram: SENT");
      console.log("============================================");
    })
    .catch(function(e) {
      console.error("DIAGNOSTIC FAILED: " + e.message);
    });
}
window.diagnoseCMz = diagnoseCMz;
