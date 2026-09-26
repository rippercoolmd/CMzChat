// config.js - Konfigurasi GitHub API
const GITHUB_TOKEN = window.ENV?.GITHUB_TOKEN || "";
const GITHUB_REPO = window.ENV?.GITHUB_REPO || "";
const DB_URL = `https://api.github.com/repos/${GITHUB_REPO}/contents/`;

async function getDB(file){
  try {
    let r = await fetch(`https://raw.githubusercontent.com/${GITHUB_REPO}/main/${file}?t=${Date.now()}`);
    return await r.json();
  } catch(e) {
    console.error('Gagal load DB:', e);
    return {};
  }
}

async function saveDB(file, data){
  try {
    let get = await fetch(DB_URL + file, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
    let j = await get.json();
    let sha = j.sha;
    let content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
    await fetch(DB_URL + file, {
      method: "PUT",
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: "update " + file, content, sha })
    });
  } catch(e) {
    console.error('Gagal save DB:', e);
  }
}