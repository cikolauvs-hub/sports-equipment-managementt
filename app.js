/* GearTrack — sports equipment monitoring & management
   Storage: browser localStorage (the web equivalent of the C++ file handling:
   records are saved permanently and reloaded whenever the system is opened). */
"use strict";

const ACCOUNTS_KEY = "geartrack_accounts";
const DATA_KEY = u => "geartrack_data_" + u;
const SESSION_KEY = "geartrack_session";
const STATUSES = ["Available", "Borrowed", "Damaged", "Missing"];

const $ = id => document.getElementById(id);
let currentUser = null;
let items = [];
let editingId = null;
let sortDir = 1;          // 1 = ascending, -1 = descending
let statusFilter = "";

/* ---------- storage helpers ---------- */
const memStore = {};      // fallback if the browser blocks localStorage
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return key in memStore ? JSON.parse(memStore[key]) : fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { memStore[key] = JSON.stringify(value); toast("Browser storage is blocked, data will not persist."); }
  return true;
}
const saveItems = () => save(DATA_KEY(currentUser), items);

/* ---------- passwords (salted SHA-256; plain text is never stored) ---------- */
async function hash(password, salt) {
  const text = salt + ":" + password;
  if (window.crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 5381;                                  // fallback for very old browsers
  for (const c of text) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return "f" + h.toString(16);
}
const makeSalt = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/* ---------- auth ---------- */
document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === tab));
  const login = tab.dataset.tab === "login";
  $("loginForm").classList.toggle("hidden", !login);
  $("signupForm").classList.toggle("hidden", login);
  $("loginMsg").textContent = $("signMsg").textContent = "";
}));

$("signupForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
  const user = $("signUser").value.trim();
  const pass = $("signPass").value;
  const msg = $("signMsg");
  const accounts = load(ACCOUNTS_KEY, {});
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(user)) return msg.textContent = "Account name: 3–24 letters, numbers, . _ -";
  if (pass.length < 4) return msg.textContent = "Password must be at least 4 characters.";
  if (pass !== $("signPass2").value) return msg.textContent = "Passwords don't match.";
  if (accounts[user.toLowerCase()]) return msg.textContent = "That account name is taken.";
  const salt = makeSalt();
  accounts[user.toLowerCase()] = { name: user, salt, hash: await hash(pass, salt), created: Date.now() };
  if (!save(ACCOUNTS_KEY, accounts)) return;
  save(DATA_KEY(user.toLowerCase()), []);
  e.target.reset();
  enter(user.toLowerCase());
  } catch (err) { $("signMsg").textContent = "Something went wrong: " + err.message; }
});

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const key = $("loginUser").value.trim().toLowerCase();
  const acc = load(ACCOUNTS_KEY, {})[key];
  const msg = $("loginMsg");
  if (!acc || (await hash($("loginPass").value, acc.salt)) !== acc.hash)
    return msg.textContent = "Wrong account name or password.";
  e.target.reset();
  enter(key);
});

function enter(key) {
  currentUser = key;
  try { sessionStorage.setItem(SESSION_KEY, key); } catch {}
  items = load(DATA_KEY(key), []);
  $("whoami").textContent = load(ACCOUNTS_KEY, {})[key]?.name || key;
  $("auth").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("search").value = ""; statusFilter = ""; $("filterStatus").value = "";
  render();
}

$("logoutBtn").addEventListener("click", () => {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  currentUser = null; items = [];
  $("app").classList.add("hidden");
  $("auth").classList.remove("hidden");
});

/* ---------- render: stats, search, sort, table ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function renderStats() {
  const total = items.reduce((n, i) => n + i.quantity, 0);
  const by = s => items.filter(i => i.status === s).reduce((n, i) => n + i.quantity, 0);
  const cards = [["", "Total units", total], ...STATUSES.map(s => [s, s, by(s)])];
  $("stats").innerHTML = cards.map(([val, label, n]) =>
    `<button class="stat" data-status="${val}"><b>${n}</b><small>${label}</small></button>`).join("");
  $("stats").querySelectorAll(".stat").forEach(b => b.addEventListener("click", () => {
    statusFilter = b.dataset.status; $("filterStatus").value = statusFilter; render();
  }));
}

function visibleItems() {
  const q = $("search").value.trim().toLowerCase();
  const key = $("sortBy").value;
  return items
    .filter(i => !statusFilter || i.status === statusFilter)
    .filter(i => !q || [i.name, i.category, i.condition, i.status].some(v => v.toLowerCase().includes(q)))
    .sort((a, b) => {
      const r = key === "quantity" ? a.quantity - b.quantity
        : a[key].localeCompare(b[key], undefined, { sensitivity: "base" });
      return (r || a.name.localeCompare(b.name)) * sortDir;
    });
}

function render() {
  renderStats();
  const list = visibleItems();
  $("rows").innerHTML = list.map(i => `
    <tr>
      <td class="name">${esc(i.name)}</td>
      <td>${esc(i.category)}</td>
      <td class="num">${i.quantity}</td>
      <td><span class="pill c-${i.condition}">${i.condition}</span></td>
      <td><span class="pill s-${i.status}">${i.status}</span></td>
      <td class="actions-cell">
        <button class="btn sm" data-edit="${i.id}">Edit</button>
        <button class="btn sm" data-del="${i.id}">Delete</button>
      </td>
    </tr>`).join("");
  $("empty").classList.toggle("hidden", list.length > 0);
  $("empty").textContent = items.length ? "No equipment matches your search." : "No equipment yet — add your first item.";
  $("sortDir").textContent = sortDir === 1
    ? ($("sortBy").value === "quantity" ? "1 → 9" : "A → Z")
    : ($("sortBy").value === "quantity" ? "9 → 1" : "Z → A");
}

["input", "change"].forEach(ev => {
  $("search").addEventListener(ev, render);
  $("sortBy").addEventListener(ev, render);
});
$("filterStatus").addEventListener("change", e => { statusFilter = e.target.value; render(); });
$("sortDir").addEventListener("click", () => { sortDir *= -1; render(); });

/* ---------- add / update / delete ---------- */
function openItem(item) {
  editingId = item ? item.id : null;
  $("dialogTitle").textContent = item ? "Edit equipment" : "Add equipment";
  $("fName").value = item?.name ?? "";
  $("fCategory").value = item?.category ?? "";
  $("fQty").value = item?.quantity ?? 1;
  $("fCondition").value = item?.condition ?? "Good";
  $("fStatus").value = item?.status ?? "Available";
  $("itemMsg").textContent = "";
  $("itemDialog").showModal();
  $("fName").focus();
}
$("addBtn").addEventListener("click", () => openItem(null));
$("cancelItem").addEventListener("click", () => $("itemDialog").close());

$("itemForm").addEventListener("submit", e => {
  e.preventDefault();
  const name = $("fName").value.trim();
  const category = $("fCategory").value.trim();
  const quantity = parseInt($("fQty").value, 10);
  if (!name || !category) return $("itemMsg").textContent = "Name and category are required.";
  if (!Number.isInteger(quantity) || quantity < 0) return $("itemMsg").textContent = "Quantity must be 0 or more.";
  const data = { name, category, quantity, condition: $("fCondition").value, status: $("fStatus").value };
  if (editingId) {
    Object.assign(items.find(i => i.id === editingId), data);
    toast("Equipment updated");
  } else {
    items.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...data });
    toast("Equipment added");
  }
  saveItems(); render();
  $("itemDialog").close();
});

let deleteId = null;
$("rows").addEventListener("click", e => {
  const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
  if (ed) openItem(items.find(i => i.id === ed.dataset.edit));
  if (del) {
    deleteId = del.dataset.del;
    $("delText").textContent = `"${items.find(i => i.id === deleteId).name}" will be removed permanently.`;
    $("delDialog").showModal();
  }
});
$("delDialog").addEventListener("close", () => {
  if ($("delDialog").returnValue === "ok" && deleteId) {
    items = items.filter(i => i.id !== deleteId);
    saveItems(); render(); toast("Equipment deleted");
  }
  deleteId = null; $("delDialog").returnValue = "";
});

/* ---------- backup: export / import (move an inventory between devices) ---------- */
$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `geartrack-${currentUser}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
});
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw 0;
    const clean = data.filter(d => d && d.name && d.category && Number.isInteger(+d.quantity))
      .map(d => ({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: String(d.name).slice(0, 60), category: String(d.category).slice(0, 30),
        quantity: Math.max(0, +d.quantity),
        condition: ["Good", "Fair", "Poor"].includes(d.condition) ? d.condition : "Good",
        status: STATUSES.includes(d.status) ? d.status : "Available"
      }));
    items = items.concat(clean); saveItems(); render();
    toast(`Imported ${clean.length} item(s)`);
  } catch { toast("That file isn't a valid GearTrack backup."); }
});

/* ---------- toast & startup ---------- */
let toastTimer;
function toast(text) {
  const t = $("toast"); t.textContent = text; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

(function init() {
  let s = null;
  try { s = sessionStorage.getItem(SESSION_KEY); } catch {}
  if (s && load(ACCOUNTS_KEY, {})[s]) enter(s);
})();