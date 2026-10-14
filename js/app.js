import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, EMAIL_DOMAIN, AVATARS, AVATARS_FAM } from "./config.js";
import { createGame } from "./game.js";

/* =====================================================================
   Noël en famille — application (HTML + JS, sans build)
   Toute donnée venant des utilisateurs est insérée via textContent
   (jamais innerHTML) pour éviter les failles XSS.
   ===================================================================== */

const configured = !SUPABASE_URL.includes("VOTRE-PROJET") && !SUPABASE_ANON_KEY.includes("VOTRE-CLE");
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const app = document.getElementById("app");
const tabbar = document.getElementById("tabbar");
const toastEl = document.getElementById("toast");

let session = null;
let me = null; // { id, prenom, nom, avatar }
let renderId = 0;
let activeGame = null; // partie en cours (arrêtée quand on change d'écran)

/* ---------- Petits utilitaires ---------- */

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "value") node.value = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

const ICONS = {
  bookmark: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  bookmarkOn: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v6M14 11v6"/></svg>',
};

function iconButton(icon, label, onclick, { on = false, disabled = false } = {}) {
  const b = el("button", { type: "button", class: "icon-btn" + (on ? " on" : ""), "aria-label": label, title: label, onclick, disabled });
  b.innerHTML = ICONS[icon]; // constante, sans donnée utilisateur
  return b;
}

function slug(s) {
  return String(s)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function loginEmail(nom, prenom) {
  return `${slug(nom)}.${slug(prenom)}@${EMAIL_DOMAIN}`;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function avatarImg(name, cls = "avatar") {
  const img = el("img", { class: cls, alt: "", loading: "lazy", src: `assets/avatars/${encodeURIComponent(name || AVATARS_FAM[0])}` });
  img.addEventListener("error", () => {
    img.onerror = null;
    img.src = `assets/avatars/${encodeURIComponent(AVATARS_FAM[0])}`;
  }, { once: true });
  return img;
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => toastEl.classList.remove("show"), 2800);
}

function fullName(p) { return `${p.prenom} ${p.nom}`; }

function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/Invalid login credentials/i.test(m)) return "Nom, prénom ou mot de passe incorrect.";
  if (/already registered|already been registered/i.test(m)) return "Un compte existe déjà avec ce nom et ce prénom.";
  if (/Password should be at least/i.test(m)) return "Le mot de passe doit contenir au moins 6 caractères.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Connexion impossible. Vérifie ta connexion internet.";
  if (/schema cache|submit_score|get_leaderboard|public\.scores/i.test(m)) return "Le mini-jeu n'est pas encore installé dans Supabase : relance le fichier supabase/schema.sql (voir le README).";
  return m;
}

function setView(...nodes) {
  app.replaceChildren(...nodes.flat().filter(Boolean));
  window.scrollTo(0, 0);
}

function loadingView() { setView(el("p", { class: "loading", text: "Chargement…" })); }

function errorView(e) {
  setView(el("div", { class: "card auth-card" },
    el("h2", { text: "Oups…" }),
    el("p", { text: errMsg(e) }),
    el("div", { class: "actions" }, el("a", { class: "btn", href: "#/home", text: "Retour à l'accueil" }))));
}

/* ---------- Fenêtre de saisie (dialog) ---------- */

function formDialog({ title, fields, submit = "Valider", values = {}, note, onSubmit }) {
  return new Promise((resolve) => {
    const dlg = el("dialog");
    const inputs = {};
    const err = el("p", { class: "error" });
    const ok = el("button", { type: "submit", text: submit });
    const cancel = el("button", { type: "button", class: "ghost", text: "Annuler" });
    const form = el("form", { novalidate: true },
      el("h3", { text: title }),
      note ? el("p", { class: "hint", text: note }) : null,
      fields.map((f) => {
        const common = { name: f.name, maxlength: f.maxlength, placeholder: f.placeholder || "", required: f.required, autocomplete: "off", value: values[f.name] ?? "" };
        const input = f.multiline ? el("textarea", common) : el("input", { type: "text", ...common });
        inputs[f.name] = input;
        return el("label", {}, f.label, input);
      }),
      err,
      el("div", { class: "row" }, cancel, ok));
    dlg.append(form);
    let result = false;

    cancel.addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => { dlg.remove(); resolve(result); });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const out = {};
      for (const f of fields) {
        out[f.name] = inputs[f.name].value.trim();
        if (f.required && !out[f.name]) { err.textContent = `Merci de remplir : ${f.label}`; inputs[f.name].focus(); return; }
      }
      ok.disabled = true; err.textContent = "";
      try {
        await onSubmit(out);
        result = true;
        dlg.close();
      } catch (e) {
        err.textContent = errMsg(e);
        ok.disabled = false;
      }
    });

    document.body.append(dlg);
    dlg.showModal();
    const first = fields[0] && inputs[fields[0].name];
    if (first) first.focus();
  });
}

/* ---------- Données ---------- */

async function loadMe() {
  const { data, error } = await sb.from("profiles").select("id, prenom, nom, avatar").eq("id", session.user.id).single();
  if (error || !data) throw error || new Error("Profil introuvable");
  me = data;
}

function pickAvatarFor(id) { return AVATARS_FAM[hashStr(id) % AVATARS_FAM.length]; }


/* ---------- Vues ---------- */

function setupView() {
  setView(el("div", { class: "card auth-card" },
    el("h1", { text: "Noël en famille" }),
    el("p", { text: "Le site n'est pas encore relié à Supabase." }),
    el("p", { class: "hint", text: "Ouvre js/config.js et renseigne SUPABASE_URL et SUPABASE_ANON_KEY (voir le README)." })));
}

function authView() {
  let mode = "login";
  const box = el("div", { class: "card auth-card" });

  function draw() {
    const nom = el("input", { type: "text", name: "nom", required: true, autocomplete: "family-name", maxlength: 50 });
    const prenom = el("input", { type: "text", name: "prenom", required: true, autocomplete: "given-name", maxlength: 50 });
    const pwd = el("input", { type: "password", name: "password", required: true, minlength: 6, autocomplete: mode === "login" ? "current-password" : "new-password" });
    const pwd2 = el("input", { type: "password", name: "password2", minlength: 6, autocomplete: "new-password" });
    const err = el("p", { class: "error" });
    const submit = el("button", { type: "submit", class: "big", text: mode === "login" ? "Se connecter" : "Créer mon compte" });
    let chosen = AVATARS[0];

    const picker = el("div", { class: "avatar-picker", role: "radiogroup", "aria-label": "Choisis ton avatar" },
      AVATARS.map((a, i) => {
        const radio = el("input", { type: "radio", name: "avatar", value: a, checked: i === 0 });
        radio.addEventListener("change", () => { chosen = a; });
        return el("label", {}, radio, avatarImg(a, ""), el("span", { class: "sr-only", text: `Avatar ${i + 1}` }));
      }));

    const form = el("form", { novalidate: true },
      el("label", {}, "Nom de famille", nom),
      el("label", {}, "Prénom", prenom),
      el("label", {}, "Mot de passe", pwd),
      mode === "register" ? el("label", {}, "Confirme le mot de passe", pwd2) : null,
      mode === "register" ? el("div", {}, el("p", { class: "hint", text: "Choisis ton avatar" }), picker) : null,
      err, submit,
      mode === "register" ? el("p", { class: "hint", text: "Pas d'email : note bien ton mot de passe. En cas d'oubli, demande à l'administrateur du site de le réinitialiser." }) : null);

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      err.textContent = "";
      const n = nom.value.trim(), p = prenom.value.trim(), pw = pwd.value;
      if (!n || !p || !pw) { err.textContent = "Merci de tout remplir."; return; }
      if (!slug(n) || !slug(p)) { err.textContent = "Le nom et le prénom doivent contenir des lettres ou des chiffres."; return; }
      if (mode === "register") {
        if (pw.length < 6) { err.textContent = "Le mot de passe doit contenir au moins 6 caractères."; return; }
        if (pw !== pwd2.value) { err.textContent = "Les deux mots de passe sont différents."; return; }
      }
      submit.disabled = true;
      try {
        const email = loginEmail(n, p);
        let res;
        if (mode === "login") {
          res = await sb.auth.signInWithPassword({ email, password: pw });
        } else {
          res = await sb.auth.signUp({ email, password: pw, options: { data: { nom: n, prenom: p, avatar: chosen } } });
          if (!res.error && !res.data.session) {
            throw new Error("Inscription enregistrée, mais la confirmation par email est activée dans Supabase. Désactive « Confirm email » (voir le README).");
          }
        }
        if (res.error) throw res.error;
        session = res.data.session;
        await loadMe();
        if (location.hash === "#/home") route(); else location.hash = "#/home";
      } catch (e) {
        err.textContent = errMsg(e);
        submit.disabled = false;
      }
    });

    const tabs = el("div", { class: "tabs", role: "tablist" },
      el("button", { type: "button", role: "tab", class: mode === "login" ? "active" : "", text: "Connexion", onclick: () => { mode = "login"; draw(); } }),
      el("button", { type: "button", role: "tab", class: mode === "register" ? "active" : "", text: "Inscription", onclick: () => { mode = "register"; draw(); } }));

    box.replaceChildren(el("h1", { text: "Noël en famille" }), tabs, form);
  }

  draw();
  setView(box);
}

function homeView() {
  setView(
    el("h1", { text: `Bonjour ${me.prenom} !` }),
    el("div", { class: "home-tiles" },
      el("a", { class: "card home-tile", href: "#/list/me" }, el("span", { class: "emoji", text: "🎁" }), el("h2", { text: "Ma liste au Père Noël" }), el("p", { class: "hint", text: "Écris tes idées de cadeaux" })),
      el("a", { class: "card home-tile", href: "#/families" }, el("span", { class: "emoji", text: "🎄" }), el("h2", { text: "Mes familles" }), el("p", { class: "hint", text: "Voir les listes de tes proches" }))));
}

async function familiesView(rid) {
  const { data, error } = await sb.from("family_members").select("role, families(id, name, code)").eq("user_id", me.id);
  if (rid !== renderId) return;
  if (error) throw error;
  const fams = (data || []).map((r) => r.families).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const createBtn = el("button", { type: "button", text: "Créer une famille", onclick: async () => {
    const created = await formDialog({
      title: "Créer une famille",
      fields: [{ name: "name", label: "Nom de la famille", placeholder: "ex. Famille Dupont", required: true, maxlength: 60 }],
      submit: "Créer",
      onSubmit: async ({ name }) => {
        const { data: f, error: e } = await sb.rpc("create_family", { p_name: name });
        if (e) throw e;
        location.hash = `#/family/${f.id}`;
      },
    });
    if (created) toast("Famille créée !");
  } });

  const joinBtn = el("button", { type: "button", class: "ghost", text: "Rejoindre avec un code", onclick: async () => {
    const joined = await formDialog({
      title: "Rejoindre une famille",
      note: "Demande le code d'invitation à un membre de la famille.",
      fields: [{ name: "code", label: "Code d'invitation", placeholder: "XXXX-XXXX", required: true, maxlength: 12 }],
      submit: "Rejoindre",
      onSubmit: async ({ code }) => {
        const { data: f, error: e } = await sb.rpc("join_family", { p_code: code });
        if (e) throw e;
        location.hash = `#/family/${f.id}`;
      },
    });
    if (joined) toast("Bienvenue dans la famille !");
  } });

  setView(
    el("h1", { text: "Mes familles" }),
    fams.length
      ? el("div", { class: "tiles" }, fams.map((f) =>
          el("a", { class: "tile", href: `#/family/${f.id}` }, avatarImg(pickAvatarFor(f.id)), el("span", { class: "label", text: f.name }))))
      : el("p", { class: "empty", text: "Tu ne fais encore partie d'aucune famille. Crée-en une ou rejoins-en une avec un code." }),
    el("div", { class: "actions" }, createBtn, joinBtn));
}

async function familyView(fid, rid) {
  const [famRes, memRes] = await Promise.all([
    sb.from("families").select("id, name, code, created_by").eq("id", fid).maybeSingle(),
    sb.from("family_members").select("user_id, role, profiles(id, prenom, nom, avatar)").eq("family_id", fid),
  ]);
  if (rid !== renderId) return;
  if (famRes.error) throw famRes.error;
  if (memRes.error) throw memRes.error;
  const fam = famRes.data;
  if (!fam) throw new Error("Famille introuvable ou accès refusé.");

  const members = (memRes.data || []).map((m) => ({ ...m.profiles, role: m.role })).filter((m) => m.id)
    .sort((a, b) => a.prenom.localeCompare(b.prenom, "fr"));
  const count = {};
  members.forEach((m) => { const k = m.prenom.toLowerCase(); count[k] = (count[k] || 0) + 1; });
  const label = (m) => (count[m.prenom.toLowerCase()] > 1 ? `${m.prenom} ${m.nom.charAt(0).toUpperCase()}.` : m.prenom);
  const iAmAdmin = members.some((m) => m.id === me.id && m.role === "admin");
  const prettyCode = fam.code.slice(0, 4) + "-" + fam.code.slice(4);

  const copy = async () => {
    try { await navigator.clipboard.writeText(prettyCode); toast("Code copié !"); } catch { toast(`Code : ${prettyCode}`); }
  };

  const leave = el("button", { type: "button", class: "ghost small", text: "Quitter la famille", onclick: async () => {
    if (!confirm(`Quitter « ${fam.name} » ?`)) return;
    const { error } = await sb.from("family_members").delete().eq("family_id", fid).eq("user_id", me.id);
    if (error) return toast(errMsg(error));
    toast("Tu as quitté la famille."); location.hash = "#/families";
  } });
  const del = iAmAdmin ? el("button", { type: "button", class: "ghost small", text: "Supprimer la famille", onclick: async () => {
    if (!confirm(`Supprimer définitivement « ${fam.name} » pour tous ses membres ? Les listes de cadeaux ne sont pas effacées.`)) return;
    const { error } = await sb.from("families").delete().eq("id", fid);
    if (error) return toast(errMsg(error));
    toast("Famille supprimée."); location.hash = "#/families";
  } }) : null;

  setView(
    el("a", { class: "back", href: "#/families", text: "Retour aux familles" }),
    el("h1", { text: `${fam.name} – Mes membres` }),
    el("div", { class: "tiles" }, members.map((m) =>
      el("a", { class: "tile", href: `#/list/${m.id}`, title: fullName(m) }, avatarImg(m.avatar), el("span", { class: "label tag", text: label(m) })))),
    el("p", { class: "code-box" }, "Code d'invitation : ", el("strong", { text: prettyCode }), " ", el("button", { type: "button", class: "small ghost", text: "Copier", onclick: copy })),
    el("div", { class: "actions" }, leave, del));
}

async function listView(param, rid) {
  const ownerId = param === "me" || param === me.id ? me.id : param;
  const isMe = ownerId === me.id;

  const [profRes, listRes] = await Promise.all([
    isMe ? Promise.resolve({ data: me }) : sb.from("profiles").select("id, prenom, nom, avatar").eq("id", ownerId).maybeSingle(),
    sb.rpc("get_list", { p_owner: ownerId }),
  ]);
  if (rid !== renderId) return;
  if (profRes.error) throw profRes.error;
  if (listRes.error) throw listRes.error;
  const owner = profRes.data;
  if (!owner) throw new Error("Cette liste n'existe pas ou tu n'y as pas accès.");
  const gifts = listRes.data || [];
  const reload = () => listView(param, ++renderId);

  async function addGift() {
    await formDialog({
      title: isMe ? "Ajouter un cadeau" : `Proposer un cadeau à ${owner.prenom}`,
      note: isMe ? null : `${owner.prenom} ne verra jamais cette suggestion.`,
      fields: [
        { name: "title", label: "Idée de cadeau", required: true, maxlength: 120 },
        { name: "description", label: "Description (facultatif)", multiline: true, maxlength: 500, placeholder: "Taille, couleur, lien, marque…" },
      ],
      submit: isMe ? "Ajouter" : "Proposer",
      onSubmit: async ({ title, description }) => {
        const row = { owner_id: ownerId, title, description, suggested_by: isMe ? null : me.id };
        const { error } = await sb.from("gifts").insert(row);
        if (error) throw error;
        toast(isMe ? "Cadeau ajouté !" : "Idée proposée !");
        reload();
      },
    });
  }

  async function editGift(g) {
    await formDialog({
      title: "Modifier",
      values: { title: g.title, description: g.description },
      fields: [
        { name: "title", label: "Idée de cadeau", required: true, maxlength: 120 },
        { name: "description", label: "Description (facultatif)", multiline: true, maxlength: 500 },
      ],
      submit: "Enregistrer",
      onSubmit: async ({ title, description }) => {
        const { error } = await sb.from("gifts").update({ title, description }).eq("id", g.id);
        if (error) throw error;
        reload();
      },
    });
  }

  async function deleteGift(g) {
    if (!confirm(`Supprimer « ${g.title} » ?`)) return;
    const { error } = await sb.from("gifts").delete().eq("id", g.id);
    if (error) return toast(errMsg(error));
    reload();
  }

  async function toggleReserve(g) {
    if (g.reserved_by === me.id) {
      const { error } = await sb.from("reservations").delete().eq("gift_id", g.id).eq("reserved_by", me.id);
      if (error) return toast(errMsg(error));
      toast("Réservation annulée.");
    } else {
      const { error } = await sb.from("reservations").insert({ gift_id: g.id });
      if (error) {
        toast(error.code === "23505" ? "Quelqu'un vient de le réserver !" : errMsg(error));
      } else {
        toast("Cadeau réservé, chut ! 🤫");
      }
    }
    reload();
  }

  function giftRow(g) {
    const mine = g.suggested_by === me.id;
    const taken = !!g.reserved_by;
    const meta = [];
    if (g.suggested_by) meta.push(`Proposé par : ${g.suggested_by_name || "?"}`);
    if (taken) meta.push(`Déjà pris par : ${g.reserved_by === me.id ? "toi" : g.reserved_by_name || "?"}`);

    const icons = el("div", { class: "icons" });
    if (!isMe) {
      const byMe = g.reserved_by === me.id;
      icons.append(iconButton(byMe ? "bookmarkOn" : "bookmark",
        byMe ? "Annuler ma réservation" : taken ? "Déjà réservé" : "Réserver ce cadeau",
        () => toggleReserve(g), { on: byMe, disabled: taken && !byMe }));
    }
    if (isMe || mine) {
      icons.append(iconButton("edit", "Modifier", () => editGift(g)), iconButton("trash", "Supprimer", () => deleteGift(g)));
    }

    return el("li", { class: "gift" + (taken ? " taken" : "") },
      el("div", { class: "body" },
        el("div", { class: "title", text: g.title }),
        g.description ? el("div", { class: "desc", text: g.description }) : null,
        meta.length ? el("div", { class: "meta", text: meta.join(" · ") }) : null),
      icons);
  }

  const wishes = gifts.filter((g) => !g.suggested_by);
  const suggestions = gifts.filter((g) => g.suggested_by);
  const section = (title, items, emptyText) => [
    el("h2", { text: title }),
    items.length ? el("ul", { class: "gift-list" }, items.map(giftRow)) : el("p", { class: "empty", text: emptyText }),
  ];

  setView(
    isMe ? null : el("a", { class: "back", href: "#", text: "Retour", onclick: (ev) => { ev.preventDefault(); history.back(); } }),
    el("button", { type: "button", class: "big", text: isMe ? "Ajouter un cadeau" : "Proposer un cadeau", onclick: addGift }),
    el("h1", { text: `Liste de ${owner.prenom}` }),
    isMe ? el("p", { class: "hint", text: "Tes proches ne te montrent jamais ce qu'ils réservent ou te suggèrent : la surprise reste entière." }) : null,
    section("Souhaits", wishes, isMe ? "Ta liste est vide. Ajoute ta première idée !" : `${owner.prenom} n'a pas encore ajouté de souhaits.`),
    isMe ? null : section("Suggestions", suggestions, "Aucune suggestion pour le moment."));
}

async function gameView(rid) {
  const [famRes, bestRes] = await Promise.all([
    sb.from("family_members").select("families(id, name)").eq("user_id", me.id),
    sb.from("scores").select("best_score").eq("user_id", me.id).maybeSingle(),
  ]);
  if (rid !== renderId) return;
  if (famRes.error) throw famRes.error;
  if (bestRes.error) throw bestRes.error;
  const fams = (famRes.data || []).map((r) => r.families).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  let best = bestRes.data?.best_score || 0;
  let filter = "";
  let boardSeq = 0;

  const bestEl = el("span", { class: "best" });
  const renderBest = () => bestEl.replaceChildren("Meilleur score : ", el("strong", { text: String(best) }));
  renderBest();

  const canvas = el("canvas", { class: "game-canvas", tabindex: "0", role: "img", "aria-label": "Attrape-cadeaux : déplace le traîneau pour attraper les cadeaux" });
  const boardList = el("div");

  async function loadBoard() {
    const seq = ++boardSeq;
    const { data, error } = await sb.rpc("get_leaderboard", { p_family: filter || null });
    if (seq !== boardSeq) return;
    if (error) { boardList.replaceChildren(el("p", { class: "error", text: errMsg(error) })); return; }
    const rows = data || [];
    if (!rows.length) {
      boardList.replaceChildren(el("p", { class: "empty", text: "Aucun score pour l'instant. Sois le premier !" }));
      return;
    }
    const count = {};
    rows.forEach((r) => { const k = r.prenom.toLowerCase(); count[k] = (count[k] || 0) + 1; });
    const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };
    boardList.replaceChildren(el("ol", { class: "lb" }, rows.map((r) => {
      const isMe = r.user_id === me.id;
      let name = count[r.prenom.toLowerCase()] > 1 ? `${r.prenom} ${r.nom.charAt(0).toUpperCase()}.` : r.prenom;
      if (isMe) name += " (toi)";
      return el("li", { class: isMe ? "me" : "" },
        el("span", { class: "rank", text: medals[r.rank] || String(r.rank) }),
        avatarImg(r.avatar, ""),
        el("span", { class: "who", text: name, title: fullName(r) }),
        el("span", { class: "pts", text: String(r.best_score) }));
    })));
  }

  const select = el("select", { "aria-label": "Filtrer le classement", onchange: () => { filter = select.value; loadBoard(); } },
    el("option", { value: "", text: "Toutes mes familles" }),
    fams.map((f) => el("option", { value: f.id, text: f.name })));

  const playBtn = el("button", { type: "button", class: "small", text: "Jouer", onclick: () => {
    activeGame?.start();
    canvas.focus({ preventScroll: true });
  } });

  setView(
    el("h1", { text: "Attrape-cadeaux" }),
    el("div", { class: "game-wrap" },
      el("div", { class: "game-bar" }, bestEl, playBtn),
      canvas),
    el("div", { class: "card board" },
      el("h2", { text: "Classement" }),
      el("label", {}, el("span", { class: "sr-only", text: "Famille" }), select),
      boardList));

  activeGame = createGame(canvas, {
    onGameOver: async ({ score, durationMs }) => {
      if (score <= 0) return;
      const { data, error } = await sb.rpc("submit_score", { p_score: score, p_duration_ms: durationMs });
      if (error) return toast(errMsg(error));
      if (score > best) toast(`Nouveau record : ${score} ! 🏆`);
      best = data;
      renderBest();
      loadBoard();
    },
  });
  loadBoard();
}

async function profileView() {
  let chosen = me.avatar;
  const err = el("p", { class: "error" });
  const picker = el("div", { class: "avatar-picker", role: "radiogroup", "aria-label": "Avatar" },
    AVATARS.map((a, i) => {
      const radio = el("input", { type: "radio", name: "avatar", value: a, checked: a === me.avatar });
      radio.addEventListener("change", () => { chosen = a; });
      return el("label", {}, radio, avatarImg(a, ""), el("span", { class: "sr-only", text: `Avatar ${i + 1}` }));
    }));

  const saveAvatar = el("button", { type: "button", text: "Enregistrer mon avatar", onclick: async () => {
    const { error } = await sb.from("profiles").update({ avatar: chosen }).eq("id", me.id);
    if (error) return toast(errMsg(error));
    me.avatar = chosen; toast("Avatar mis à jour !"); profileView();
  } });

  const pw1 = el("input", { type: "password", minlength: 6, autocomplete: "new-password" });
  const pw2 = el("input", { type: "password", minlength: 6, autocomplete: "new-password" });
  const pwErr = el("p", { class: "error" });
  const pwForm = el("form", { novalidate: true },
    el("label", {}, "Nouveau mot de passe", pw1),
    el("label", {}, "Confirme le nouveau mot de passe", pw2),
    pwErr,
    el("button", { type: "submit", text: "Changer mon mot de passe" }));
  pwForm.addEventListener("submit", async (ev) => {
    ev.preventDefault(); pwErr.textContent = "";
    if (pw1.value.length < 6) { pwErr.textContent = "Au moins 6 caractères."; return; }
    if (pw1.value !== pw2.value) { pwErr.textContent = "Les deux mots de passe sont différents."; return; }
    const { error } = await sb.auth.updateUser({ password: pw1.value });
    if (error) { pwErr.textContent = errMsg(error); return; }
    pw1.value = pw2.value = ""; toast("Mot de passe modifié !");
  });

  setView(
    el("h1", { text: "Mon profil" }),
    el("div", { class: "card", style: "max-width:520px;margin:0 auto;display:grid;gap:18px;justify-items:center" },
      avatarImg(me.avatar, "big-avatar"),
      el("h2", { style: "margin:0", text: fullName(me) }),
      el("p", { class: "hint", text: "Pour te connecter : ton nom, ton prénom et ton mot de passe." }),
      picker, err, saveAvatar),
    el("div", { class: "card", style: "max-width:520px;margin:20px auto 0" }, el("h2", { style: "margin:0 0 10px", text: "Mot de passe" }), pwForm),
    el("div", { class: "actions" }, el("button", { type: "button", class: "ghost", text: "Se déconnecter", onclick: async () => {
      await sb.auth.signOut();
    } })));
}

/* ---------- Routage ---------- */

function highlightTab(path) {
  const tab = path === "list" ? "home" : path === "family" ? "families" : path;
  tabbar.querySelectorAll("a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
}

async function route() {
  const rid = ++renderId;
  if (activeGame) { activeGame.destroy(); activeGame = null; }
  if (!configured) { tabbar.hidden = true; return setupView(); }

  const m = (location.hash || "#/home").match(/^#\/([^/]*)\/?(.*)$/) || [];
  const path = m[1] || "home";
  const param = decodeURIComponent(m[2] || "");

  if (!session || !me) {
    tabbar.hidden = true;
    if (path !== "auth") history.replaceState(null, "", "#/auth");
    return authView();
  }
  if (path === "auth") { location.hash = "#/home"; return; }

  tabbar.hidden = false;
  highlightTab(path === "list" && param !== "me" && param !== me.id ? "families" : path);
  loadingView();
  try {
    if (path === "home") homeView();
    else if (path === "families") await familiesView(rid);
    else if (path === "family") await familyView(param, rid);
    else if (path === "list") await listView(param || "me", rid);
    else if (path === "game") await gameView(rid);
    else if (path === "profile") await profileView();
    else location.hash = "#/home";
  } catch (e) {
    if (rid === renderId) errorView(e);
  }
}

async function init() {
  window.addEventListener("hashchange", route);
  if (!configured) return route();

  sb.auth.onAuthStateChange((event, s) => {
    if (event === "SIGNED_OUT") {
      session = null; me = null;
      setTimeout(() => { location.hash = "#/auth"; route(); }, 0);
    } else if (s) {
      session = s;
    }
  });

  try {
    const { data } = await sb.auth.getSession();
    session = data.session;
    if (session) await loadMe();
  } catch {
    session = null; me = null;
    await sb.auth.signOut().catch(() => {});
  }
  route();
}

init();
