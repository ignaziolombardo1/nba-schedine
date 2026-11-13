"use strict";
const $ = (s, r = document) => r.querySelector(s);
const APP = $("#app");
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const OR = "#ff8a2a", GR = "#3ddc84", RD = "#ff5d5d", AM = "#ffb066", MU = "#8b93a5";
const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const VERSIONE = "56";
// blocca lo zoom a pizzico di iOS (che ignora user-scalable)
for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, (e) => e.preventDefault());
const GIORNI = [["Ieri", -1], ["Oggi", 0], ["Domani", 1], ["Dopodomani", 2]];
const MERC = { Punti: { k: "pts", u: "pt" }, Rimbalzi: { k: "reb", u: "rimb." }, Assist: { k: "ast", u: "ass." } };
const SC = [["Punti giocatori", "ti-target", ["Punti"]], ["Assist", "ti-users", ["Assist"]], ["Rimbalzi", "ti-arrows-up-down", ["Rimbalzi"]], ["Totali partita", "ti-chart-bar", ["Totale"]], ["Punti squadre", "ti-shield", ["Squadra"]], ["Vincente", "ti-trophy", ["Vincente"]]];

// ---------- matematica
function erf(x) { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
const phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
const pct = (p) => Math.round(p * 100) + "%";

// ---------- dati
let giorno = ls.get("giorno", 0);
if (typeof giorno !== "number" && !/^\d{8}$/.test(String(giorno))) giorno = 0;
const IMP0 = { soglia: 0.70, mercati: { Punti: true, Rimbalzi: true, Assist: true, Totale: true, Squadra: true, Vincente: true }, puntata: 5, bankroll: 100, kelly: 0.25 };
const impo = () => { const i = ls.get("imp", {}); return { ...IMP0, ...i, mercati: { ...IMP0.mercati, ...(i.mercati || {}) } }; };
function applicaImp(D) { const i = impo(); if (!D || !D.picks) return D; return { ...D, picks: D.picks.filter((x) => x.prob >= i.soglia && i.mercati[x.tipo] !== false) }; }
const cache = {};
function salvaLocale(k, d) {
  const val = JSON.stringify({ t: Date.now(), d });
  try { localStorage.setItem("D|" + k, val); } catch { try { Object.keys(localStorage).filter((x) => x.startsWith("D|")).forEach((x) => localStorage.removeItem(x)); localStorage.setItem("D|" + k, val); } catch {} }
}
function cacheLocale(k) { try { const o = JSON.parse(localStorage.getItem("D|" + k) || "null"); return o && Date.now() - o.t < 12 * 3600e3 ? o.d : null; } catch { return null; } }
async function api(path, ttl = 0) {
  const c = cache[path];
  if (c && Date.now() - c.t < ttl) return c.d;
  const r = await fetch(path);
  const d = await r.json();
  if (!r.ok || d.errore) throw new Error(d.errore || "Errore " + r.status);
  cache[path] = { t: Date.now(), d };
  if (path.startsWith("/api/giorno")) salvaLocale(path, d);
  return d;
}
const qs = () => "d=" + (typeof giorno === "number" ? etGiorno(giorno).ymd : giorno);
const dati = async (force) => { if (force) delete cache["/api/giorno?" + qs()]; return applicaImp(await api("/api/giorno?" + qs(), 40000)); };

// ---------- pezzi grafici
const T = (D, ab) => (D.squadre && D.squadre[ab]) || { n: ab, b: ab, c: "#4a5060" };
const logo = (ab, s = 38) => `<img class="tl" style="width:${s}px;height:${s}px" loading="lazy" alt="" src="https://a.espncdn.com/i/teamlogos/nba/500/${esc(String(ab).toLowerCase())}.png" onerror="this.style.visibility='hidden'">`;
const foto = (pid, s = 46) => pid ? `<img class="ph" style="width:${s}px;height:${s}px" loading="lazy" alt="" src="https://a.espncdn.com/i/headshots/nba/players/full/${esc(pid)}.png" onerror="this.style.visibility='hidden'">` : `<span class="ph" style="width:${s}px;height:${s}px;display:inline-block"></span>`;
function anello(p, col, size = 52) {
  const r = size / 2 - 5, L = 2 * Math.PI * r, c = size / 2;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#232836" stroke-width="6"/><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${col}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(L * p / 100).toFixed(1)} ${L.toFixed(1)}" transform="rotate(-90 ${c} ${c})"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" fill="#f2f2f2" font-size="${size > 60 ? 18 : 13}" font-weight="600">${Math.round(p)}%</text></svg>`;
}
const colProb = (p) => (p >= 0.85 ? "#3ddc84" : p >= 0.78 ? "#9be564" : p >= 0.72 ? "#ffc24a" : OR);
// ---------- LA MIA SCHEDINA: si compone con i consigli dell'app o con giocate scritte a mano
const PM = new Map(); // consigli visibili -> giocata
const miaLeggi = () => ls.get("mia", []);
function legDa(x) {
  const m = /(over|under) ([\d.]+)/.exec(x.testo || "");
  const k = x.tipo === "Punti" ? "pts" : x.tipo === "Rimbalzi" ? "reb" : x.tipo === "Assist" ? "ast" : x.tipo === "Totale" ? "tot" : x.tipo === "Squadra" ? "sq" : "win";
  return { id: x.id, chiave: chiaveGiocata(x), testo: x.testo, prob: x.prob, partita: x.partita, g: x.g, pid: x.pid || null, sq: x.squadra || null, k, dir: m ? m[1] : "over", soglia: m ? +m[2] : null, nome: k === "pts" || k === "reb" || k === "ast" ? String(x.testo).split(/ (over|under) /)[0] : null };
}
function addBtn(x) { PM.set(x.id, legDa(x)); const on = miaLeggi().some((l) => l.id === x.id); return `<button class="addl${on ? " on" : ""}" data-add="${esc(x.id)}" aria-label="Aggiungi alla mia schedina">${on ? "✓" : "+"}</button>`; }
function barraMia() {
  const el = document.getElementById("miabar"); if (!el) return;
  const L = miaLeggi(); if (location.hash.startsWith("#/mia")) { el.style.display = "none"; return; }
  const q = L.reduce((a, l) => a / Math.max(0.05, l.prob), 1);
  el.style.display = "flex"; el.innerHTML = L.length ? `<a href="#/mia" aria-label="La mia schedina: ${L.length} giocate, quota giusta ${q.toFixed(2)}"><i class="ti ti-ticket"></i><b>${L.length}</b></a>` : `<a href="#/mia" class="vuota" aria-label="Componi la tua schedina"><i class="ti ti-ticket"></i><b>Schedina</b></a>`;
}
// Raggruppa per giornata (la più recente aperta, le altre chiuse) con il conteggio di quelle centrate
const nomeGiorno = (d) => { const x = new Date(d + "T12:00:00"); return isNaN(x) ? String(d || "Senza data") : x.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "long" }); };
function perGiornata(voci, disegna) {
  const m = new Map();
  for (const v of voci) { const d = String(v.r.data || "").slice(0, 10) || "—"; if (!m.has(d)) m.set(d, []); m.get(d).push(v); }
  return [...m].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([d, l], i) => {
    const ch = l.filter((v) => v.r.esito === 0 || v.r.esito === 1), ok = ch.filter((v) => v.r.esito === 1).length;
    const col = !ch.length ? MU : ok / ch.length >= 0.6 ? GR : ok / ch.length >= 0.4 ? AM : RD;
    return `<details class="dt giorno"${i === 0 ? " open" : ""}><summary><span style="text-transform:capitalize">${esc(nomeGiorno(d))}</span><span style="color:${col};margin-left:auto">${ch.length ? `${ok} su ${ch.length} · ${Math.round(ok / ch.length * 100)}%` : `${l.length} in attesa`}</span></summary>${l.map(disegna).join("")}</details>`;
  }).join("");
}
const segStorico = (att) => `<div class="seg">${[["c", "conto", "Conto"], ["r", "registro", "Registro"], ["s", "storico", "Modello"], ["e", "esiti", "Esiti"]].map(([k, h, n]) => `<a href="#/${h}"${att === k ? ' class="on"' : ""}>${n}</a>`).join("")}</div>`;
const tabelliniCache = {};
// elenco delle partite finite toccabili: ognuna apre il suo tabellino
function riquadroTabellini(righe) {
  const m = new Map(); for (const r of righe) { const id = String(r.g ?? r.event_id ?? ""); if (/^\d+$/.test(id) && r.tipo !== "Schedina" && !m.has(id)) m.set(id, r.partita); }
  if (!m.size) return "";
  return `<h2>Tabellini delle partite</h2><div class="cap" style="margin-top:0">Tocca una partita per vedere formazioni, punti, rimbalzi e assist.</div>` + [...m].slice(0, 12).map(([id, n]) => `<div class="card riga" data-tab="${id}" style="cursor:pointer;padding:10px 12px"><b>${esc(n || "Partita")}</b><span class="s">Tabellino <i class="ti ti-chevron-down"></i></span></div><div class="tabl" id="tb${id}" hidden></div>`).join("");
}
document.addEventListener("click", async (e) => {
  const fv = e.target.closest("[data-fav]");
  if (fv) {
    e.preventDefault(); e.stopPropagation();
    const [t, id, nome, sq] = fv.dataset.fav.split("|"), P = pref();
    if (t === "sq") P.sq = P.sq.includes(id) ? P.sq.filter((x) => x !== id) : [...P.sq, id];
    else P.pl = P.pl.some((x) => x.pid === id) ? P.pl.filter((x) => x.pid !== id) : [...P.pl, { pid: id, nome, sq }];
    ls.set("pref", P); sincPref();
    if ((location.hash || "#/") === "#/" && ultimoD) { clearTimeout(timer); const y = window.scrollY; disegnaPartite(ultimoD, true); window.scrollTo(0, y); }
    else { const on = siSegue(t, id); fv.classList.toggle("on", on); fv.textContent = on ? "★" : "☆"; }
    return;
  }
  const tb = e.target.closest("[data-tab]");
  if (tb) {
    const id = tb.dataset.tab, box = document.getElementById("tb" + id), ch = tb.querySelector(".ti-chevron-down,.ti-chevron-up"); if (!box) return;
    if (!box.hidden) { box.hidden = true; ch && ch.classList.replace("ti-chevron-up", "ti-chevron-down"); return; }
    box.hidden = false; ch && ch.classList.replace("ti-chevron-down", "ti-chevron-up");
    if (!tabelliniCache[id]) {
      box.innerHTML = skel();
      try {
        const R = await api("/api/tabellino?id=" + id, 120);
        tabelliniCache[id] = formazioniLive(ultimoD || { squadre: {} }, { giocatori: R.giocatori || [], casa: tb.dataset.casa || R.casa, trasf: tb.dataset.trasf || R.trasf }) + `<a class="btn" style="display:block;text-align:center" href="#/partita/${id}">Apri lo studio di questa partita</a>`;
      } catch { box.innerHTML = `<div class="vuoto">Tabellino non disponibile, riprova tra poco.</div>`; return; }
    }
    box.innerHTML = tabelliniCache[id]; return;
  }
  const d = e.target.closest("[data-delm]");
  if (d) { // doppio tocco per confermare
    if (d.dataset.sicuro) { ls.set("registro", ls.get("registro", []).filter((r) => r.id !== d.dataset.delm)); if (location.hash.startsWith("#/live")) { clearTimeout(timer); vistaLive(false); } return; }
    d.dataset.sicuro = "1"; d.textContent = "Tocca ancora per togliere"; setTimeout(() => { if (d.isConnected) { delete d.dataset.sicuro; d.textContent = "Rimuovi"; } }, 3500); return;
  }
  const b = e.target.closest("[data-add]"); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const l = PM.get(b.dataset.add); if (!l) return;
  let L = miaLeggi(); const i = L.findIndex((x) => x.id === l.id);
  if (i >= 0) L.splice(i, 1); else L.push(l);
  ls.set("mia", L); b.classList.toggle("on", i < 0); b.textContent = i < 0 ? "✓" : "+"; barraMia(); if (location.hash.startsWith("#/mia") && window.__miaAgg) window.__miaAgg();
}, true);
function cardPick(x) { return `<div class="card cardp"><div style="min-width:0"><div class="s">${esc(x.partita)} · ${esc(x.tipo)}</div><div style="font-weight:500">${esc(x.testo)}${x.dubbio ? ` <span class="s" style="color:${AM}">· in dubbio ${Math.round(x.dubbio * 100)}%</span>` : ""}</div></div><div><div class="v" style="color:${colProb(x.prob)}">${pct(x.prob)}</div><div class="e">stima ${esc(x.stima)}</div></div>${addBtn(x)}</div>`; }
function rigaPick(D, x) {
  const vis = x.pid ? foto(x.pid, 34) : x.squadra ? logo(x.squadra, 30) : `<span class="ph" style="width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center"><i class="ti ti-chart-bar" style="color:${OR}"></i></span>`;
  return `<div class="pick">${anello(x.prob * 100, colProb(x.prob), 48)}${vis}<div style="min-width:0"><div class="t">${esc(x.testo)}</div><div class="s">${esc(x.partita)}${x.dubbio ? ` · <span style="color:${AM}">in dubbio (gioca col ${Math.round(x.dubbio * 100)}%)</span>` : ""}</div></div>${addBtn(x)}</div>`;
}
function topBar(D) {
  const ora = D && D.aggiornato ? new Date(D.aggiornato).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
  return `<div class="top"><img class="logo" src="/icon-192.png" alt=""><div><div class="nome">NBA Schedine</div><div class="s">Studio e consigli sul basket${ora ? " · agg. " + ora : ""}</div></div></div>`;
}
const GS = ["DOM", "LUN", "MAR", "MER", "GIO", "VEN", "SAB"], MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const fmtET = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
function etGiorno(off) {
  const [y, m, d] = fmtET.format(new Date(Date.now() + off * 86400000)).split("-").map(Number);
  return { ymd: `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`, y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}
function giorniChips() {
  const sel = typeof giorno === "string" ? giorno : etGiorno(giorno).ymd;
  const selM = +sel.slice(4, 6), selY = sel.slice(0, 4);
  const celle = [];
  for (let o = -3; o <= 7; o++) celle.push([o, etGiorno(o)]);
  const fuori = !celle.some(([, g]) => g.ymd === sel);
  const extra = fuori ? `<button class="dd on" data-d="${sel}"><span class="dw">${GS[new Date(Date.UTC(+selY, selM - 1, +sel.slice(6, 8))).getUTCDay()]}</span><b>${+sel.slice(6, 8)}</b><span class="oo"></span></button>` : "";
  return `<div class="riga" style="margin:2px 0 8px"><b style="font-size:15px">${MESI[selM - 1]} ${selY}</b><label class="cal chipbtn"><i class="ti ti-calendar"></i> Calendario<input type="date" id="cal" value="${selY}-${String(selM).padStart(2, "0")}-${sel.slice(6, 8)}"></label></div>
  <div class="strip" id="strip">${extra}${celle.map(([o, g]) => `<button class="dd${g.ymd === sel ? " on" : ""}${o === 0 ? " today" : ""}" data-g="${o}"><span class="dw">${GS[g.dow]}</span><b>${g.d}</b><span class="oo">${o === 0 ? "Oggi" : ""}</span></button>`).join("")}</div>`;
}
function bindGiorni() {
  APP.querySelectorAll("[data-g]").forEach((b) => b.onclick = () => { giorno = +b.dataset.g; ls.set("giorno", giorno); route(); });
  APP.querySelectorAll("[data-d]").forEach((b) => b.onclick = () => { giorno = b.dataset.d; ls.set("giorno", giorno); route(); });
  const c = $("#cal"); if (c) c.onchange = () => { if (c.value) { giorno = c.value.replaceAll("-", ""); ls.set("giorno", giorno); route(); } };
  const st = $("#strip"), on = st && st.querySelector(".dd.on");
  if (on) st.scrollLeft = on.offsetLeft - st.clientWidth / 2 + on.offsetWidth / 2;
}
const skel = () => `<div class="skel"></div><div class="skel"></div><div class="skel"></div>`;
const errBox = (e) => `<div class="err"><b>Non riesco a caricare i dati.</b><br>${esc(e.message || e)}<br><button class="btn" style="margin-top:10px" onclick="route(true)">Riprova</button></div>`;


// parziali per quarto
function tabQuarti(p, D) {
  const a = p.qTr || [], b = p.qCasa || []; if (!a.length && !b.length) return "";
  const n = Math.max(a.length, b.length, 4), cur = p.stato === "in" ? (p.periodo || 0) : 0;
  const nm = (i) => (i < 4 ? "Q" + (i + 1) : i === 4 ? "OT" : "OT" + (i - 3));
  const riga = (ab, q, tot) => `<tr><td><b>${esc(ab)}</b></td>${Array.from({ length: n }, (_, i) => `<td class="${cur === i + 1 ? "cur" : ""}">${q[i] ?? "–"}</td>`).join("")}<td class="tot">${tot ?? 0}</td></tr>`;
  return `<table class="qt"><tr><th></th>${Array.from({ length: n }, (_, i) => `<th>${nm(i)}</th>`).join("")}<th>TOT</th></tr>${riga(p.trasf, a, p.ptTr)}${riga(p.casa, b, p.ptCasa)}</table>`;
}
// illumina la squadra che ha appena segnato (confronta con l'ultimo punteggio visto)
const ultimiPt = {};
function illumina(card, id, ptTr, ptCasa) {
  const prima = ultimiPt[id]; ultimiPt[id] = [ptTr, ptCasa]; if (!prima || !card) return;
  [[0, ptTr, "t"], [1, ptCasa, "c"]].forEach(([i, v, lato]) => {
    const d = v - prima[i]; if (!(d > 0)) return;
    const tm = card.querySelector(`.tm[data-l="${lato}"]`) || card.querySelectorAll(".tm")[lato === "t" ? 0 : 1]; if (!tm) return;
    tm.dataset.plus = "+" + d; tm.classList.remove("glow"); void tm.offsetWidth; tm.classList.add("glow");
  });
}
function schedaPartita(D, p, topPick, cliccabile) {
  const t = T(D, p.casa), v = T(D, p.trasf), r = p.r;
  let chip, col = MU;
  if (p.stato === "post") { chip = "Finale"; col = GR; } else if (p.stato === "in") { chip = `<span class="dot"></span>Live · ${esc(p.dettaglio)}`; col = OR; } else chip = esc(p.ora);
  const fav = r.margine > 0 ? p.casa : p.trasf;
  const cc = t.c, ct = v.c.toLowerCase() === cc.toLowerCase() ? "#5a6378" : v.c;
  const team = (ab, ruolo, stima) => `<div class="tm">${logo(ab, 54)}<div class="tn">${esc(T(D, ab).b)}</div><div class="s">${ruolo}</div><div class="st">${stima.toFixed(0)} <span>stimati</span></div></div>`;
  const centro = p.stato === "pre"
    ? `<div class="mid"><div class="ora">${esc(String(p.ora).slice(-5))}</div><div class="s">${esc(String(p.ora).slice(0, 5))}</div></div>`
    : `<div class="mid"><div class="sc"><span class="big${p.stato === "in" ? " liveN" : ""}" data-sc="t">${p.ptTr ?? 0}</span><i>-</i><span class="big${p.stato === "in" ? " liveN" : ""}" data-sc="c">${p.ptCasa ?? 0}</span></div></div>`;
  let chips = `<span class="chip">Totale ${r.totale.toFixed(0)}</span>`;
  if (topPick) chips += `<span class="chip" style="color:${GR}">${esc(topPick.testo)} · ${pct(topPick.prob)}</span>`;
  for (const s of [p.casa, p.trasf]) if ((D.b2b || []).includes(s)) chips += `<span class="chip" style="color:${AM}">${esc(T(D, s).b)} back-to-back</span>`;
  if (cliccabile) {
    const favC = r.pw >= 0.5, lato = (ab, ruolo, n) => `<div class="cl ${ruolo}">${logo(ab, 34)}<div class="tn"><b class="n12${p.stato === "pre" && (n === 1) === favC ? " fv" : ""}">${n}</b>${esc(ab)}${stella("sq", ab)}</div></div>`;
    const mezzo = p.stato === "pre"
      ? `<div class="cm"><span class="w">${pct(r.pw)}</span><i>-</i><span class="w">${pct(1 - r.pw)}</span></div>`
      : `<div class="cm"><span class="big${p.stato === "in" ? " liveN" : ""}" data-sc="c">${p.ptCasa ?? 0}</span><i>-</i><span class="big${p.stato === "in" ? " liveN" : ""}" data-sc="t">${p.ptTr ?? 0}</span></div>`;
    const q = (p.qTr || []).length ? `<div class="qr" data-qt>${(p.qTr || []).map((v, i) => `<span class="${p.stato === "in" && p.periodo === i + 1 ? "cur" : ""}">Q${i + 1} ${(p.qCasa || [])[i] ?? 0}-${v}</span>`).join("")}</div>` : "";
    const fin = p.stato === "post";
    return `<${fin ? "div" : "a"} class="card gm cmp${p.stato === "in" ? " inlive" : ""}"${fin ? ` data-tab="${p.id}" data-casa="${p.casa}" data-trasf="${p.trasf}"` : ` href="#/partita/${p.id}"`} data-gid="${p.id}" data-st="${p.stato}" style="--ca:${ct};--cb:${cc}${fin ? ";cursor:pointer" : ""}">
  <div class="riga" style="margin-bottom:4px"><span class="pill" data-pill style="color:${col}">${chip}</span><span class="s">${p.stato === "pre" ? `stimati ${r.ptTr.toFixed(0)}-${r.ptCasa.toFixed(0)}` : fin ? "Tabellino" : "Studia"} <i class="ti ${fin ? "ti-chevron-down" : "ti-chevron-right"}"></i></span></div>
  <div class="cg"><div class="tm cr" data-l="c">${lato(p.casa, "ca", 1)}</div>${mezzo}<div class="tm cr" data-l="t">${lato(p.trasf, "tr", 2)}</div></div>${q}
  <div class="bar" style="margin:6px 0 6px"><div style="width:${(r.pw * 100).toFixed(0)}%;background:${cc}"></div><div style="flex:1;background:${ct}"></div></div>${chips}</${fin ? "div" : "a"}>${fin ? `<div class="tabl" id="tb${p.id}" hidden></div>` : ""}`;
  }
  const tag = cliccabile ? "a" : "div", href = cliccabile ? ` href="#/partita/${p.id}"` : "";
  return `<${tag} class="card gm${p.stato === "in" ? " inlive" : ""}"${href} data-gid="${p.id}" data-st="${p.stato}" style="--ca:${ct};--cb:${cc}">
  <div class="riga" style="margin-bottom:10px"><span class="pill" data-pill style="color:${col}">${chip}</span>${cliccabile ? `<span class="s">Studia <i class="ti ti-chevron-right"></i></span>` : ""}</div>
  <div class="mu">${team(p.trasf, "trasferta", r.ptTr)}${centro}${team(p.casa, "casa", r.ptCasa)}</div>${p.stato !== "pre" ? `<div data-qt>${tabQuarti(p, D)}</div>` : ""}
  <div class="bar"><div style="width:${((1 - r.pw) * 100).toFixed(0)}%;background:${ct}"></div><div style="flex:1;background:${cc}"></div></div>
  <div class="riga s" style="margin:4px 0 8px"><b style="color:#e8eaf0">${pct(1 - r.pw)}</b><b style="color:#e8eaf0">${pct(r.pw)}</b></div>${chips}</${tag}>`;
}
const raggruppa = (picks) => [["Molto probabili (80% o più)", picks.filter((x) => x.prob >= 0.8)], ["Probabili (70-80%)", picks.filter((x) => x.prob >= 0.7 && x.prob < 0.8)], ["Da valutare (sotto il 70%)", picks.filter((x) => x.prob < 0.7)]];

function confrontoMercato(D) {
  if (!D.partite.length) return "";
  if (!D.valore || !D.valore.length) return "";
  return `<h2>Modello contro bookmaker</h2><div class="cap" style="margin-top:0">Giocatori dove il nostro calcolo, unito al mercato, vede più probabilità di quelle dei bookmaker. Il mercato di solito è più preciso: usalo come segnale da verificare, non come certezza.</div>` +
    D.valore.slice(0, 8).map((v) => `<div class="card riga" style="gap:10px;padding:10px 12px"><div class="lg" style="flex:1;min-width:0">${foto(v.pid, 36)}<div style="min-width:0"><div style="font-weight:600">${esc(v.nome)} ${v.lato} ${v.linea}</div><div class="s">${esc(v.mercato)} · ${esc(v.partita)} · ${divTag(v.div)}</div></div></div><div style="text-align:right"><div style="font-size:19px;font-weight:600;color:${colProb(v.pFin)}">${pct(v.pFin)}</div><div class="s">mercato ${pct(v.pMk)} · modello ${pct(v.pMod)}</div></div></div>`).join("");
}
function migliori(D) {
  const viste = new Set(), scelte = [];
  for (const x of D.picks) {
    if (x.prob < 0.74) break;
    const k = x.g + x.tipo;
    if (viste.has(k)) continue;
    viste.add(k); scelte.push(x);
    if (scelte.length >= 8) break;
  }
  if (!scelte.length) return "";
  return `<div class="riga" style="margin:14px 0 8px"><h2 style="margin:0">Migliori giocate</h2><a class="s" href="#/combo" style="color:var(--or)">Vedi tutte <i class="ti ti-chevron-right"></i></a></div>
  <div class="strip hscroll">${scelte.map((x, i) => `<a class="best${i === 0 ? " top" : ""}" href="#/partita/${x.g}">
    <div class="riga"><span class="tag">${i === 0 ? "★ La più forte" : esc(x.tipo)}</span>${anello(x.prob * 100, colProb(x.prob), 46)}</div>
    <div class="lg" style="margin:10px 0 4px">${x.pid ? foto(x.pid, 40) : x.squadra ? logo(x.squadra, 36) : `<span class="ph" style="width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center"><i class="ti ti-chart-bar" style="color:${OR}"></i></span>`}<div class="bt" style="margin:0">${esc(x.testo)}</div></div><div class="s">${esc(x.partita)}</div><div class="s" style="margin-top:6px">Stima ${esc(x.stima)}</div></a>`).join("")}</div>`;
}

// ---------- PARTITE
function avvisiDati(D, daCache) {
  let h = "";
  const eta = D.aggiornato ? Math.round((Date.now() - Date.parse(D.aggiornato)) / 60000) : null;
  if (daCache) h += `<div class="avv"><i class="ti ti-refresh"></i> Dati salvati sul telefono${eta != null ? " (di " + (eta < 60 ? eta + " minuti" : Math.round(eta / 60) + " ore") + " fa)" : ""}: aggiorno…</div>`;
  else if (eta != null && eta > 15) h += `<div class="avv warn"><i class="ti ti-clock-exclamation"></i> Ultimo aggiornamento ${eta < 60 ? eta + " minuti" : Math.round(eta / 60) + " ore"} fa: l'app non è riuscita a ricaricare. Tocca «Aggiorna ora» in fondo.</div>`;
  for (const x of D.salute || []) h += `<div class="avv ${x.liv === "err" ? "err" : "warn"}"><i class="ti ti-alert-triangle"></i> ${esc(x.t)} <a href="#/diag" style="text-decoration:underline">Dettagli</a></div>`;
  return h;
}
// la giocata più probabile tra quelle delle partite ancora da giocare (o la migliore in assoluto)
function giocataDelGiorno(D) {
  const n = D.partite.length; if (!n) return "";
  const live = D.partite.filter((p) => p.stato === "in").length, fin = D.partite.filter((p) => p.stato === "post").length, pre = n - live - fin;
  const cand = D.picks.filter((x) => D.partite.find((p) => p.id === x.g && p.stato === "pre")), top = [...(cand.length ? cand : [])].sort((a, b) => b.prob - a.prob)[0];
  const riep = `<div class="riep">${n} ${n === 1 ? "partita" : "partite"}${live ? ` · <span style="color:${OR}">${live} in corso</span>` : ""}${pre ? ` · ${pre} da giocare` : ""}${fin ? ` · ${fin} finite` : ""}</div>`;
  if (!top) return riep;
  return riep + `<a class="gdg" href="#/partita/${top.g}"><div class="gt">Giocata del giorno</div><div class="gx">${esc(top.testo)}</div><div class="gp"><b>${Math.round(top.prob * 100)}%</b><span class="s">${esc(top.partita)}</span></div><div class="gb"><i style="width:${Math.round(top.prob * 100)}%"></i></div></a>`;
}
function hero(D) {
  const n = D.partite.length; if (!n) return "";
  const live = D.partite.filter((p) => p.stato === "in").length, fin = D.partite.filter((p) => p.stato === "post").length, pre = n - live - fin;
  const top = D.picks.find((x) => D.partite.find((p) => p.id === x.g && p.stato === "pre")) || D.picks[0];
  return `<div class="hero"><div class="hn">${n}</div><div style="min-width:0"><div class="ht">${n === 1 ? "partita" : "partite"} in programma</div><div class="s">${live ? `<span class="dot"></span>${live} in corso · ` : ""}${pre} da giocare · ${fin} finite</div></div></div>`;
}
// punteggi che si aggiornano da soli (ogni 10 secondi) quando ci sono partite in corso o vicine all'inizio
function seguiPunteggi(D) {
  const ora = Date.now(), vicine = D.partite.some((p) => p.stato === "pre" && p.iso && Date.parse(p.iso) - ora < 15 * 60000);
  if (!D.partite.some((p) => p.stato === "in") && !vicine) return;
  for (const p of D.partite) if (p.stato === "in") ultimiPt[p.id] = [p.ptTr, p.ptCasa];
  const giro = async () => {
    if (location.hash !== "" && location.hash !== "#/") return;
    try {
      const L = await (await fetch("/api/live")).json(); if (L.errore) throw 0;
      const vive = new Set(L.partite.map((x) => x.id)); let cambio = false;
      for (const x of L.partite) {
        const c = APP.querySelector(`[data-gid="${x.id}"]`); if (!c) continue;
        if (c.dataset.st !== "in") { cambio = true; continue; }
        const t = c.querySelector('[data-sc="t"]'), k = c.querySelector('[data-sc="c"]'), pl = c.querySelector("[data-pill]");
        if (t && String(t.textContent) !== String(x.ptTr)) { t.textContent = x.ptTr; t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash"); }
        if (k && String(k.textContent) !== String(x.ptCasa)) { k.textContent = x.ptCasa; k.classList.remove("flash"); void k.offsetWidth; k.classList.add("flash"); }
        if (pl) pl.innerHTML = `<span class="dot"></span>Live · ${esc(x.dettaglio)}`;
        illumina(c, x.id, x.ptTr, x.ptCasa);
        const qe = c.querySelector("[data-qt]"); if (qe) qe.innerHTML = qe.classList.contains("qr") ? (x.qTr || []).map((v, i) => `<span class="${x.periodo === i + 1 ? "cur" : ""}">Q${i + 1} ${(x.qCasa || [])[i] ?? 0}-${v}</span>`).join("") : tabQuarti(x, D);
      }
      for (const p of D.partite) if (p.stato === "in" && !vive.has(p.id)) cambio = true;
      if (cambio) return route(true);
    } catch {}
    timer = setTimeout(giro, 10000);
  };
  timer = setTimeout(giro, 10000);
}
async function vistaPartite(force) {
  // mostra subito l'ultimo giorno salvato sul telefono, poi lo aggiorna
  const salvato = force ? null : cacheLocale("/api/giorno?" + qs());
  if (salvato) disegnaPartite(applicaImp(salvato), false, true); else { APP.innerHTML = topBar() + giorniChips() + skel(); bindGiorni(); }
  let D; try { D = await dati(force); } catch (e) { if (!salvato) { APP.innerHTML = topBar() + giorniChips() + errBox(e); bindGiorni(); } return; }
  if (!location.hash.replace(/^#/, "").replace(/^\//, "")) { const y = window.scrollY; disegnaPartite(D, true); if (salvato) window.scrollTo(0, y); }
}

// accesso rapido ai consigli divisi per tipo, con il numero di giocate
function riquadriConsigli(D) {
  const P = applicaImp(D).picks || []; if (!P.length) return "";
  return `<div class="sub" style="margin-top:6px">Scegli un tipo di giocata</div><div class="grid2">` + SC.map(([t, ic, tipi], i) => {
    const l = P.filter((x) => tipi.includes(x.tipo)); if (!l.length) return "";
    return `<a class="card" href="#/categoria/${i}" style="padding:12px;display:block"><div class="s"><i class="ti ${ic}" style="color:var(--or)"></i> ${esc(t)}</div><div style="font-size:22px;font-weight:700;margin-top:2px">${l.length}</div><div class="s">migliore ${pct(l[0].prob)}</div></a>`;
  }).join("") + `</div>`;
}
// ---------- PREFERITI (squadre e giocatori seguiti, salvati sul telefono)
const pref = () => { const v = ls.get("pref", null); return v && v.sq && v.pl ? v : { sq: [], pl: [] }; };
const siSegue = (t, id) => pref()[t].some((x) => (t === "sq" ? x : x.pid) === id);
const stella = (t, id, nome = "", sq = "") => { const on = siSegue(t, id); return `<button class="star${on ? " on" : ""}" data-fav="${t}|${esc(id)}|${esc(nome)}|${esc(sq)}" aria-label="${on ? "Non seguire più" : "Segui"}">${on ? "★" : "☆"}</button>`; };
const partitaPreferita = (p) => { const P = pref(); return P.sq.includes(p.casa) || P.sq.includes(p.trasf) || P.pl.some((x) => x.sq === p.casa || x.sq === p.trasf); };
function riquadroPreferiti(D) {
  const P = pref(); if (!P.sq.length && !P.pl.length) return `<div class="cap" style="margin-top:0">Tocca la ☆ accanto a una squadra o a un giocatore per seguirlo: le sue partite salgono in alto.</div>`;
  const righe = [];
  for (const ab of P.sq) { const g = D.partite.find((p) => p.casa === ab || p.trasf === ab); righe.push(`<a class="riga rg" ${g ? `href="#/partita/${g.id}"` : ""} style="color:inherit"><div class="lg">${logo(ab, 24)}<b>${esc(T(D, ab).n)}</b></div><span class="s">${g ? (g.stato === "pre" ? esc(String(g.ora).slice(-5)) : g.stato === "in" ? esc(g.dettaglio) + " · " + g.ptTr + "-" + g.ptCasa : "Finale " + g.ptTr + "-" + g.ptCasa) : "non gioca"}</span></a>`); }
  for (const f of P.pl) { let x = null, g = null; for (const q of D.partite) { const t = q.giocatori.find((y) => String(y.pid) === String(f.pid)); if (t) { x = t; g = q; break; } }
    righe.push(`<a class="riga rg" ${x ? `href="#/giocatore/${esc(f.pid)}"` : ""} style="color:inherit"><div class="lg">${foto(f.pid, 24)}<b>${esc(f.nome)}</b></div><span class="s">${x ? `stima ${x.pts.v.toFixed(0)} pt · ${x.reb.v.toFixed(0)} rb · ${x.ast.v.toFixed(0)} as` : "non gioca"}</span></a>`); }
  return `<div class="card"><div class="s" style="margin-bottom:4px">I tuoi preferiti oggi</div>${righe.join("")}</div>`;
}
// manda al server i preferiti di questo telefono (solo se le notifiche sono attive) per avvisare di ciò che segui
async function sincPref() {
  try { if (!("serviceWorker" in navigator) || !("PushManager" in window)) return; const reg = await navigator.serviceWorker.ready, sb = await reg.pushManager.getSubscription(); if (!sb) return;
    await fetch("/api/push-pref", { method: "POST", body: JSON.stringify({ endpoint: sb.endpoint, pref: pref() }) }); } catch {}
}
let firmaHome = "", ultimoD = null;
const firmaDati = (D) => D.partite.map((p) => p.id + p.stato + p.ptTr + p.ptCasa).join(",");
function disegnaPartite(D, conPoll, daCache) {
  firmaHome = firmaDati(D); ultimoD = D;
  const top = (id) => D.picks.find((x) => x.g === id);
  let h = topBar(D) + giorniChips();
  if (!D.partite.length) h += `<div class="vuoto">Nessuna partita trovata per questo giorno. Prova un altro giorno.</div>`;
  h += avvisiDati(D, daCache);
  h += giocataDelGiorno(D);
  { const m = confrontoMercato(D); if (m) h += `<details class="dt"><summary>Confronto con i bookmaker</summary>${m}</details>`; }
  if (D.partite.length) h += riquadroPreferiti(D);
  for (const [t, st] of [["In corso", "in"], ["Da giocare", "pre"], ["Finite", "post"]]) {
    const l = D.partite.filter((p) => p.stato === st).sort((a, b) => partitaPreferita(b) - partitaPreferita(a)); if (!l.length) continue;
    h += `<h2 class="sez${st === "in" ? " live" : ""}">${st === "in" ? '<span class="dot"></span>' : ""}${t}<span class="n">${l.length}</span></h2>` + l.map((p) => schedaPartita(D, p, top(p.id), true)).join("");
  }
  if (D.ieri.length) {
    h += `<details class="dt"><summary>Risultati di ieri (${D.ieri.length})</summary>` + D.ieri.map((p) => `<div class="card"><div class="riga"><div class="lg">${logo(p.trasf, 28)}<b>${esc(p.trasf)}</b></div><b style="font-size:18px">${p.ptTr} - ${p.ptCasa}</b><div class="lg"><b>${esc(p.casa)}</b>${logo(p.casa, 28)}</div></div></div>`).join("") + `</details>`;
  }
  h += `<button class="btn" id="agg"><i class="ti ti-refresh"></i> Aggiorna ora</button>`;
  APP.innerHTML = h; bindGiorni(); $("#agg").onclick = () => route(true);
  if (conPoll) seguiPunteggi(D);
}


// ---------- CALCOLATORE (valore, Kelly, multipla)
function vistaCalcolatore() {
  const back = `<a class="back" href="#/storico"><i class="ti ti-chevron-left"></i>Storico</a>`;
  const S = ls.get("calc", { legs: [{ p: "", q: "" }] });
  APP.innerHTML = back + `<h2>Calcolatore</h2><div class="cap" style="margin-top:0">Inserisci per ogni selezione la probabilità che stimi (o quella dell'app) e la quota offerta dal bookmaker. Vedi subito se c'è valore e quanto puntare.</div><div id="legs"></div><button class="btn" id="add" style="margin:6px 0">Aggiungi selezione</button><div id="ris"></div>`;
  const calcola = () => {
    ls.set("calc", S);
    const L = S.legs.map((l) => ({ p: parseFloat(String(l.p).replace(",", ".")) / 100, q: parseFloat(String(l.q).replace(",", ".")) })).filter((l) => l.p > 0 && l.p < 1 && l.q > 1);
    let h = "";
    if (!L.length) { $("#ris").innerHTML = ""; return; }
    L.forEach((l, i) => { if (S.legs.length > 1) h += `<div class="s">Selezione ${i + 1}</div>`; h += rigaValore(valoreGiocata(l.p, l.q)); });
    if (L.length > 1) {
      const p = L.reduce((a, l) => a * l.p, 1), q = L.reduce((a, l) => a * l.q, 1), v = valoreGiocata(p, q);
      h += `<div class="card"><div class="s">Multipla di ${L.length} selezioni</div><div class="row3"><div class="tile"><b>${q.toFixed(2)}</b><span>quota totale</span></div><div class="tile"><b>${(p * 100).toFixed(0)}%</b><span>probabilità</span></div><div class="tile"><b>${(1 / p).toFixed(2)}</b><span>quota giusta</span></div></div>${rigaValore(v)}<div class="cap" style="margin:0">Le selezioni sono considerate indipendenti: se sono della stessa partita (es. squadra e totale) la probabilità reale è diversa.</div></div>`;
    }
    $("#ris").innerHTML = h;
  };
  const disegna = () => {
    $("#legs").innerHTML = S.legs.map((l, i) => `<div class="grid2" style="align-items:center"><input class="linea" inputmode="decimal" placeholder="Probabilità % (es. 72)" data-p="${i}" value="${esc(l.p)}"><input class="linea" inputmode="decimal" placeholder="Quota (es. 1.85)" data-q="${i}" value="${esc(l.q)}"></div>`).join("");
    $("#legs").querySelectorAll("input").forEach((el) => el.oninput = () => { const i = +(el.dataset.p ?? el.dataset.q); S.legs[i][el.dataset.p != null ? "p" : "q"] = el.value; calcola(); });
  };
  $("#add").onclick = () => { S.legs.push({ p: "", q: "" }); disegna(); };
  disegna(); calcola();
}

// ---------- IMPOSTAZIONI (salvate sul telefono)
function vistaImpostazioni() {
  const i = impo();
  const back = `<a class="back" href="#/storico"><i class="ti ti-chevron-left"></i>Storico</a>`;
  let h = back + `<h2>Impostazioni</h2><div class="cap" style="margin-top:0">Valgono solo su questo telefono. Cambiano le giocate che vedi nelle pagine Partite, Studio e Combo; le proposte di schedina usano soglie proprie.</div>`;
  h += `<div class="card"><div class="sub" style="margin-top:0">Probabilità minima delle giocate</div><div class="tabs">${[0.70, 0.75, 0.80, 0.85].map((v) => `<button class="chipbtn${i.soglia === v ? " on" : ""}" data-sg="${v}">${Math.round(v * 100)}%</button>`).join("")}</div></div>`;
  h += `<div class="card"><div class="sub" style="margin-top:0">Quali giocate vedere</div>${Object.keys(IMP0.mercati).map((m) => `<label class="sw"><input type="checkbox" data-mk="${m}" ${i.mercati[m] !== false ? "checked" : ""}> ${esc({ Vincente: "Squadra vincente", Squadra: "Punti di una squadra", Totale: "Totale della partita" }[m] || m)}</label>`).join("")}</div>`;
  const pushOk = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  h += `<div class="card"><div class="sub" style="margin-top:0"><i class="ti ti-bell"></i> Notifiche sul telefono</div>` + (pushOk
    ? `<div class="cap" style="margin:4px 0 8px">Ogni mattina la Giocata del giorno e le schedine quota 2, 5, 10 e 20; a fine giornata i risultati. Per le squadre e i giocatori con la ★ ricevi anche l'inizio e la fine della partita, con i numeri dei tuoi giocatori.</div><div class="grid2"><button class="btn" id="pushOn" style="margin:0">Attiva</button><button class="btn" id="pushProva" style="margin:0">Invia prova</button></div><div class="cap" id="pushMsg" style="margin-bottom:0">${Notification.permission === "granted" ? "Permesso già concesso: tocca «Attiva» per collegare questo telefono." : Notification.permission === "denied" ? "Le notifiche sono bloccate nelle impostazioni del telefono per questa app." : ""}</div>`
    : `<div class="cap" style="margin:4px 0 0">Per le notifiche su iPhone serve iOS 16.4 o più recente e l'app aperta dalla schermata Home: in Safari tocca Condividi → «Aggiungi alla schermata Home», poi apri l'app da lì e torna qui.</div>`) + `</div>`;
  h += `<div class="card"><div class="sub" style="margin-top:0">Puntata predefinita nel registro (€)</div><input class="linea" inputmode="decimal" id="pun" value="${i.puntata}" style="margin-top:0"></div>`;
  h += `<div class="card"><div class="sub" style="margin-top:0">Bankroll (€)</div><input class="linea" inputmode="decimal" id="bk" value="${i.bankroll}" style="margin-top:0"><div class="sub">Quanto del consiglio di Kelly seguire</div><div class="tabs">${[[0.1, "10%"], [0.25, "25%"], [0.5, "50%"]].map(([v, t]) => `<button class="chipbtn${i.kelly === v ? " on" : ""}" data-kl="${v}">${t}</button>`).join("")}</div><div class="cap">Il bankroll serve a calcolare la puntata consigliata e la curva nel registro. Meglio una frazione prudente di Kelly: 25% è lo standard dei tipster.</div></div>`;
  h += `<button class="btn" id="ripr">Ripristina le impostazioni iniziali</button>`;
  APP.innerHTML = h;
  const salva = (m) => { ls.set("imp", { ...impo(), ...m }); };
  APP.querySelectorAll("[data-sg]").forEach((b) => b.onclick = () => { salva({ soglia: +b.dataset.sg }); vistaImpostazioni(); });
  APP.querySelectorAll("[data-mk]").forEach((c) => c.onchange = () => { const mk = { ...impo().mercati, [c.dataset.mk]: c.checked }; salva({ mercati: mk }); });
  $("#pun").oninput = (e) => { const v = parseFloat(String(e.target.value).replace(",", ".")); if (v > 0) salva({ puntata: v }); };
  if ($("#pushOn")) {
    const msg = (t) => { $("#pushMsg").textContent = t; };
    $("#pushOn").onclick = async () => {
      try {
        const perm = await Notification.requestPermission(); if (perm !== "granted") return msg("Permesso non concesso: abilita le notifiche per l'app nelle impostazioni del telefono.");
        const reg = await navigator.serviceWorker.ready, k = (await (await fetch("/api/push-chiave")).json()).chiave;
        if (!k) throw new Error("chiave non disponibile (serve Supabase)");
        const raw = atob(k.replace(/-/g, "+").replace(/_/g, "/")), key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
        const r = await fetch("/api/push-iscrivi", { method: "POST", body: JSON.stringify(sub.toJSON()) }); if (!r.ok) throw new Error("iscrizione non salvata");
        sincPref(); msg("Fatto: questo telefono è collegato. Tocca «Invia prova».");
      } catch (e) { msg("Non riuscito: " + (e.message || e)); }
    };
    $("#pushProva").onclick = async () => { try { const r = await (await fetch("/api/push-prova", { method: "POST" })).json(); msg(r.inviati ? "Prova inviata: dovrebbe arrivare tra pochi secondi." : "Nessun telefono collegato o invio rifiutato (" + JSON.stringify(r.esiti || []) + "): tocca prima «Attiva»."); } catch (e) { msg("Non riuscito: " + (e.message || e)); } };
  }
  $("#bk").oninput = (e) => { const v = parseFloat(String(e.target.value).replace(",", ".")); if (v > 0) salva({ bankroll: v }); };
  APP.querySelectorAll("[data-kl]").forEach((b) => b.onclick = () => { salva({ kelly: +b.dataset.kl }); vistaImpostazioni(); });
  $("#ripr").onclick = () => { ls.set("imp", {}); vistaImpostazioni(); };
}

// ---------- REGISTRO PERSONALE (salvato sul telefono)
const chiaveGiocata = (x) => `${x.g}|${x.tipo}|${x.pid || x.squadra || (x.tipo === "Totale" ? x.testo : "")}`;
const eur = (v) => (v >= 0 ? "+" : "-") + Math.abs(v).toFixed(2).replace(".", ",") + " €";
// valore atteso e puntata di Kelly: p = probabilità stimata, q = quota decimale
function valoreGiocata(p, q) {
  const ev = p * q - 1, b = q - 1, k = b > 0 ? Math.max(0, (p * q - 1) / b) : 0, i = impo();
  return { ev, edge: p - 1 / q, kelly: k, puntata: k * (i.kelly || 0.25) * (i.bankroll || 100) };
}
const rigaValore = (v) => `<div class="s" style="line-height:1.5;margin:2px 0 8px">Valore atteso <b style="color:${v.ev > 0 ? GR : RD}">${v.ev >= 0 ? "+" : ""}${(v.ev * 100).toFixed(1)}%</b> · vantaggio ${v.edge >= 0 ? "+" : ""}${(v.edge * 100).toFixed(1)} punti${v.ev > 0 ? ` · puntata consigliata <b style="color:#f2f2f2">${v.puntata.toFixed(2).replace(".", ",")} €</b> (Kelly ${Math.round((impo().kelly || 0.25) * 100)}% del bankroll)` : " · a questa quota non conviene giocarla"}</div>`;
function btnRegistro(o) {
  const gia = ls.get("registro", []).some((r) => r.id === o.id);
  return `<button class="btn regbtn" data-reg="${esc(JSON.stringify(o))}" style="margin:8px 0 0">${gia ? `<i class="ti ti-check"></i> Nel registro` : `<i class="ti ti-notebook"></i> Ho giocato questa`}</button><div class="regform" style="display:none"></div>`;
}
function bindRegistro() {
  APP.querySelectorAll(".regbtn").forEach((b) => b.onclick = () => {
    const o = JSON.parse(b.dataset.reg), f = b.nextElementSibling;
    if (ls.get("registro", []).some((r) => r.id === o.id)) { location.hash = "#/registro"; return; }
    f.style.display = "block";
    f.innerHTML = `<div class="grid2"><input class="linea" inputmode="decimal" placeholder="Quota (es. 2.10)" data-q><input class="linea" inputmode="decimal" placeholder="Puntata in € (es. 5)" data-p value="${impo().puntata}"></div><div data-val></div><button class="btn" data-ok style="margin:0 0 6px">Salva nel registro</button>`;
    f.querySelector("[data-q]").oninput = (e) => { const q = parseFloat(String(e.target.value).replace(",", ".")); f.querySelector("[data-val]").innerHTML = q > 1 && o.prob > 0 ? rigaValore(valoreGiocata(o.prob, q)) : ""; };
    f.querySelector("[data-ok]").onclick = () => {
      const q = parseFloat(String(f.querySelector("[data-q]").value).replace(",", ".")), p = parseFloat(String(f.querySelector("[data-p]").value).replace(",", "."));
      if (!(q > 1) || !(p > 0)) { f.querySelector("[data-ok]").textContent = "Inserisci quota (maggiore di 1) e puntata"; return; }
      const r = ls.get("registro", []); r.unshift({ ...o, quota: q, puntata: p, data: new Date().toISOString().slice(0, 10), esito: null }); ls.set("registro", r);
      b.innerHTML = `<i class="ti ti-check"></i> Nel registro`; f.style.display = "none";
    };
  });
}

// curva del bankroll, serie e rendimento per tipo di giocata
function statisticheRegistro(chiuse) {
  if (chiuse.length < 2) return "";
  const ord = [...chiuse].reverse(); // il registro è dal più recente: qui dal più vecchio
  const b0 = impo().bankroll || 100; let b = b0, picco = b0, dd = 0; const pt = [b0];
  for (const r of ord) { b += r.esito === 1 ? r.puntata * (r.quota - 1) : -r.puntata; pt.push(b); picco = Math.max(picco, b); dd = Math.max(dd, picco - b); }
  const lo = Math.min(...pt), hi = Math.max(...pt), W = 320, H = 90, sx = (i) => (i / (pt.length - 1)) * W, sy = (v) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
  const col = b >= b0 ? GR : RD, d = pt.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(" ");
  let serie = 0, tipo = ord[ord.length - 1].esito; for (let i = ord.length - 1; i >= 0 && ord[i].esito === tipo; i--) serie++;
  const per = {}; for (const r of chiuse) { const c = (per[r.tipo || "Altro"] ||= { n: 0, ok: 0, pr: 0, pu: 0 }); c.n++; c.ok += r.esito; c.pu += r.puntata; c.pr += r.esito === 1 ? r.puntata * (r.quota - 1) : -r.puntata; }
  const nomi = { Totale: "Totale partita", Squadra: "Punti squadra", Vincente: "Vincente", Punti: "Punti giocatore", Rimbalzi: "Rimbalzi", Assist: "Assist", Schedina: "Schedine" };
  const qm = chiuse.reduce((a, r) => a + r.quota, 0) / chiuse.length, pm = chiuse.reduce((a, r) => a + (r.prob || 0), 0) / chiuse.length;
  const cl = chiuse.filter((r) => r.chiusura > 1), clv = cl.length ? cl.reduce((a, r) => a + (r.quota / r.chiusura - 1), 0) / cl.length : null;
  return `<div class="card"><div class="riga"><div class="s">Bankroll (partendo da ${b0} €)</div><b style="color:${col}">${b.toFixed(2).replace(".", ",")} €</b></div>
  <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:90px;margin-top:6px"><path d="${d} L${W} ${H} L0 ${H} Z" fill="${col}" opacity=".12"/><path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/></svg>
  <div class="row3" style="margin-top:8px"><div class="tile"><b style="color:${tipo === 1 ? GR : RD}">${serie}${tipo === 1 ? "V" : "P"}</b><span>serie in corso</span></div><div class="tile"><b>-${dd.toFixed(0)} €</b><span>calo massimo</span></div><div class="tile">${clv != null ? `<b style="color:${clv >= 0 ? GR : RD}">${clv >= 0 ? "+" : ""}${(clv * 100).toFixed(1)}%</b><span>CLV medio (${cl.length})</span>` : `<b>${qm.toFixed(2)}</b><span>quota media</span>`}</div></div>
  <div class="s" style="margin-top:8px">Centrate ${(chiuse.filter((r) => r.esito === 1).length / chiuse.length * 100).toFixed(0)}% · previste in media ${(pm * 100).toFixed(0)}% · quota pareggio ${(1 / Math.max(0.01, chiuse.filter((r) => r.esito === 1).length / chiuse.length)).toFixed(2)}</div></div>
  <div class="sub">Rendimento per tipo di giocata</div>` + Object.entries(per).sort((x, y) => y[1].n - x[1].n).map(([t, c]) => `<div class="card riga" style="padding:9px 12px"><div><div style="font-weight:500">${esc(nomi[t] || t)}</div><div class="s">${c.ok}/${c.n} centrate · ${c.pu.toFixed(0)} € puntati</div></div><b style="color:${c.pr >= 0 ? GR : RD}">${eur(c.pr)} <span class="s">(${(c.pr / c.pu * 100).toFixed(0)}%)</span></b></div>`).join("");
}
// Salva solo esito e nota sul registro attuale: una giocata aggiunta o tolta nel frattempo non si perde mai
function salvaReg(nuovo) {
  const m = new Map(nuovo.map((r) => [r.id, r])), att = ls.get("registro", []);
  const out = att.map((r) => { const n = m.get(r.id); return n ? { ...r, es: n.es, ...(r.esito == null ? { esito: n.esito, nota: n.nota } : {}) } : r; });
  ls.set("registro", out); return out;
}
// Una riga per ogni giocata della schedina: presa o sbagliata, quanto è stato fatto e di quanto
function dettaglioLegs(r) {
  if (!r.legs || !r.es || r.es.length !== r.legs.length) return "";
  return r.legs.map((l, i) => {
    const e = r.es[i], sg = +l.soglia, over = l.dir !== "under", u = { pts: "pt", reb: "reb", ast: "ast", tot: "pt", sq: "pt" }[l.k] || "";
    if (e.esito === 2) return `<div class="s" style="margin-top:4px;color:${AM}"><i class="ti ti-circle-dashed"></i> ${esc(l.testo)} · annullata (non ha giocato)</div>`;
    if (e.esito == null) return `<div class="s" style="margin-top:4px"><i class="ti ti-clock"></i> ${esc(l.testo)} · ancora da giocare</div>`;
    const ok = e.esito === 1, c = ok ? GR : RD;
    let t = "";
    if (e.cur != null && sg) { const d = over ? e.cur - sg : sg - e.cur; t = ` · fatto ${e.cur} ${u} (${d >= 0 ? "+" : ""}${(Math.round(d * 10) / 10).toString().replace(".", ",")} ${ok ? "sopra" : "sotto"} la linea)`; }
    return `<div class="s" style="margin-top:4px;color:${c}"><i class="ti ${ok ? "ti-circle-check-filled" : "ti-circle-x-filled"}"></i> ${esc(l.testo)}${t}</div>`;
  }).join("");
}
let aggiornandoReg = false;
// Controlla da solo le giocate aperte: si chiama all'avvio, al ritorno nell'app, nel Live e nel Registro
async function aggiornaRegistro(reg = ls.get("registro", [])) {
  if (aggiornandoReg) return reg; aggiornandoReg = true;
  try {
  if (reg.some((r) => r.esito == null)) {
    try {
      const S = await api("/api/storico", 0), m = new Map([...(S.schedine || []), ...(S.righe || [])].map((r) => [r.chiave, r.esito]));
      reg = reg.map((r) => {
        if (r.esito != null) return r;
        if (r.legs && r.legs.length && r.legs.every((l) => l.chiave)) { const es = r.legs.map((l) => m.get(l.chiave)); if (es.some((e) => e === 0)) return { ...r, esito: 0 }; if (es.every((e) => e === 1)) return { ...r, esito: 1 }; return r; }
        const e = m.get(r.chiave); return (e === 0 || e === 1) ? { ...r, esito: e } : r; });
      reg = salvaReg(reg);
    } catch {}
  }
  const lim = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10), conLegs = reg.filter((r) => r.legs && r.legs.length && (r.esito == null || (String(r.data) >= lim && (!r.es || r.es.some((x) => x.esito == null)))));
  if (conLegs.length) {
    try {
      const R = await Promise.all(conLegs.map((r) => fetch("/api/valuta-giocate", { method: "POST", body: JSON.stringify({ legs: r.legs }) }).then((x) => x.json())));
      const mappa = new Map(conLegs.map((r, i) => [r.id, R[i].esiti || []]));
      reg = reg.map((r) => {
        const es0 = mappa.get(r.id); if (!es0 || es0.length !== r.legs.length) return r;
        const es = es0, dett = es0.map((x) => ({ esito: x.esito, cur: x.cur ?? null })); r = { ...r, es: dett };
        if (r.esito != null) return r;
        if (es.some((x) => x.esito === 0)) return { ...r, esito: 0 };
        if (es.some((x) => x.esito === 2)) return { ...r, nota: "una giocata annullata (giocatore non sceso in campo): segna tu l'esito" };
        if (es.every((x) => x.esito === 1)) return { ...r, esito: 1 };
        return r;
      }); reg = salvaReg(reg);
    } catch {}
  }
  } finally { aggiornandoReg = false; }
  return reg;
}
// ---------- IL MIO CONTO: ricariche, giocate e risultato mese per mese
const nomeMese = (ym) => { const d = new Date(ym + "-15T12:00:00"); const t = d.toLocaleDateString("it-IT", { month: "long", year: "numeric" }); return t.charAt(0).toUpperCase() + t.slice(1); };
const spostaMese = (ym, n) => { const d = new Date(ym + "-15T12:00:00"); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7); };
const euro = (v) => v.toFixed(2).replace(".", ",") + " €";
async function vistaConto() {
  APP.innerHTML = topBar() + segStorico("c") + skel();
  const reg = await aggiornaRegistro(ls.get("registro", []));
  const mov = ls.get("mov", []), oggiYM = new Date().toISOString().slice(0, 7); let ym = ls.get("contoMese", oggiYM);
  const incasso = (r) => r.esito === 1 ? r.puntata * r.quota : 0;
  // saldo da sempre: ricariche - prelievi - puntate + vincite
  const dep = mov.filter((m) => m.tipo === "dep").reduce((a, m) => a + m.importo, 0), pre = mov.filter((m) => m.tipo === "prel").reduce((a, m) => a + m.importo, 0);
  const saldo = dep - pre - reg.reduce((a, r) => a + (+r.puntata || 0), 0) + reg.reduce((a, r) => a + incasso(r), 0);
  const disegna = () => {
    ls.set("contoMese", ym);
    const mr = reg.filter((r) => String(r.data).slice(0, 7) === ym), mm = mov.filter((m) => String(m.data).slice(0, 7) === ym);
    const dM = mm.filter((m) => m.tipo === "dep").reduce((a, m) => a + m.importo, 0), pM = mm.filter((m) => m.tipo === "prel").reduce((a, m) => a + m.importo, 0);
    const chiuse = mr.filter((r) => r.esito === 0 || r.esito === 1), vinte = chiuse.filter((r) => r.esito === 1), aperte = mr.filter((r) => r.esito == null);
    const puntato = chiuse.reduce((a, r) => a + r.puntata, 0), incassato = chiuse.reduce((a, r) => a + incasso(r), 0), netto = incassato - puntato, roi = puntato ? netto / puntato * 100 : 0;
    const col = netto >= 0 ? GR : RD;
    let h = topBar() + segStorico("c");
    h += `<div class="card gm" style="--ca:${saldo >= 0 ? "#1c3a2a" : "#3a1c1c"};--cb:transparent"><div class="s">Saldo stimato del conto</div><div style="font-family:'Barlow Condensed',Inter,sans-serif;font-weight:700;font-size:46px;line-height:1.05;color:${saldo >= 0 ? "#fff" : RD}">${euro(saldo)}</div><div class="s">Ricariche meno prelievi, meno le puntate, più le vincite. Si aggiorna da solo con i tuoi esiti.</div></div>`;
    h += `<div class="mese"><button class="chipbtn" data-ms="-1">‹</button><b>${nomeMese(ym)}</b><button class="chipbtn" data-ms="1"${ym >= oggiYM ? " disabled style=\"opacity:.35\"" : ""}>›</button></div>`;
    h += `<div class="row3"><div class="tile"><b>${euro(dM)}</b><span>caricato${pM ? ` · prelevato ${euro(pM)}` : ""}</span></div><div class="tile"><b>${mr.length}</b><span>schedine giocate${aperte.length ? ` · ${aperte.length} aperte` : ""}</span></div><div class="tile"><b style="color:${chiuse.length ? col : "#fff"}">${chiuse.length ? (netto >= 0 ? "+" : "-") + euro(Math.abs(netto)) : "—"}</b><span>${chiuse.length ? `risultato · ROI ${roi >= 0 ? "+" : ""}${roi.toFixed(0)}%` : "nessuna chiusa"}</span></div></div>`;
    if (chiuse.length) h += `<div class="cap" style="margin-top:8px">Puntato ${euro(puntato)} su ${chiuse.length} schedine chiuse, incassato ${euro(incassato)}. Vinte ${vinte.length} su ${chiuse.length} (${Math.round(vinte.length / chiuse.length * 100)}%).</div>`;
    h += `<h2>Movimenti</h2><div class="card"><div class="grid2" style="align-items:center"><input class="linea" id="mImp" inputmode="decimal" placeholder="Importo in €"><div style="display:flex;gap:6px"><button class="btn" id="mDep" style="flex:1">Ricarica</button><button class="btn" id="mPre" style="flex:1">Prelievo</button></div></div>` +
      (mm.length ? mm.map((m) => `<div class="riga rg"><span>${m.tipo === "dep" ? "Ricarica" : "Prelievo"} · ${esc(nomeGiorno(String(m.data).slice(0, 10)))}</span><span><b style="color:${m.tipo === "dep" ? GR : AM}">${m.tipo === "dep" ? "+" : "-"}${euro(m.importo)}</b> <button class="chipbtn" data-dm="${esc(m.id)}" style="padding:2px 9px;font-size:11px">Togli</button></span></div>`).join("") : `<div class="cap" style="margin:8px 0 0">Nessun movimento in questo mese. Scrivi quanto hai caricato sul conto di gioco: il saldo lo calcola l'app.</div>`) + `</div>`;
    h += `<h2>Cosa hai giocato</h2>` + (mr.length ? perGiornata(mr.map((r) => ({ r })), ({ r }) => `<div class="card" style="padding:10px 12px"><div class="riga" style="align-items:flex-start;gap:10px"><div style="min-width:0"><b>${esc(r.nome)}</b><div class="s">quota ${r.quota} · ${euro(+r.puntata)}${r.esito === 1 ? ` · <b style="color:${GR}">vinta ${euro(incasso(r))}</b>` : r.esito === 0 ? ` · <b style="color:${RD}">persa</b>` : " · in corso"}</div></div></div><div class="s" style="line-height:1.4;margin-top:4px">${esc(r.testo || "")}</div>${dettaglioLegs(r)}</div>`) + `<div class="cap" style="text-align:center"><a href="#/registro" style="color:${OR}">Apri il registro per modificare o togliere una giocata</a></div>` : `<div class="vuoto">Nessuna schedina in questo mese. Quando ne giochi una dall'app, la trovi qui con quota, puntata e risultato.</div>`);
    h += `<div class="cap" style="text-align:center;margin-top:14px"><a href="#/calcolatore" style="color:${OR}"><i class="ti ti-calculator"></i> Calcolatore</a> &nbsp;·&nbsp; <a href="#/impostazioni" style="color:${OR}"><i class="ti ti-settings"></i> Impostazioni</a> &nbsp;·&nbsp; <a href="#/diag" style="color:${OR}"><i class="ti ti-stethoscope"></i> Controllo dati</a></div>`;
    APP.innerHTML = h;
    APP.querySelectorAll("[data-ms]").forEach((b) => b.onclick = () => { if (b.disabled) return; ym = spostaMese(ym, +b.dataset.ms); disegna(); });
    const aggiungi = (tipo) => { const v = parseFloat(String($("#mImp").value).replace(",", ".")); if (!(v > 0)) { $("#mImp").focus(); return; } const m = ls.get("mov", []); m.unshift({ id: "m" + Date.now(), data: new Date().toISOString().slice(0, 10), tipo, importo: v }); ls.set("mov", m); ym = oggiYM; vistaConto(); };
    $("#mDep").onclick = () => aggiungi("dep"); $("#mPre").onclick = () => aggiungi("prel");
    APP.querySelectorAll("[data-dm]").forEach((b) => b.onclick = () => { if (!b.dataset.s) { b.dataset.s = 1; b.textContent = "Sicuro?"; setTimeout(() => { if (b.isConnected) { delete b.dataset.s; b.textContent = "Togli"; } }, 3000); return; } ls.set("mov", ls.get("mov", []).filter((m) => m.id !== b.dataset.dm)); vistaConto(); });
  };
  disegna();
}
async function vistaRegistro() {
  const back = topBar() + segStorico("r");
  APP.innerHTML = back + skel();
  let reg = ls.get("registro", []);
  reg = await aggiornaRegistro(reg);
  const per = ls.get("regPer", 0), dal = per ? new Date(Date.now() - per * 86400000).toISOString().slice(0, 10) : "";
  const chiuse = reg.filter((r) => (r.esito === 0 || r.esito === 1) && String(r.data) >= dal), vinte = chiuse.filter((r) => r.esito === 1);
  const prof = chiuse.reduce((a, r) => a + (r.esito === 1 ? r.puntata * (r.quota - 1) : -r.puntata), 0), puntato = chiuse.reduce((a, r) => a + r.puntata, 0);
  let h = back + `<h2>Il mio registro</h2><div class="tabs">${[[0, "Tutto"], [7, "7 giorni"], [30, "30 giorni"]].map(([v, t]) => `<button class="chipbtn${per === v ? " on" : ""}" data-per="${v}">${t}</button>`).join("")}</div>`;
  if (!reg.length) h += `<div class="vuoto">Ancora vuoto. Nelle pagine Schedine e Studio tocca «Ho giocato questa», scrivi quota e puntata: a fine partita l'app calcola da sola guadagno e perdita. Resta salvato solo su questo telefono.</div>`;
  else {
    h += `<div class="card riga" style="gap:14px;justify-content:flex-start"><div><div class="s">Risultato delle giocate chiuse</div><div style="font-family:'Barlow Condensed',Inter,sans-serif;font-size:36px;font-weight:700;color:${prof >= 0 ? GR : RD}">${chiuse.length ? eur(prof) : "–"}</div><div class="s">${vinte.length} centrate su ${chiuse.length}${puntato ? ` · rendimento ${(prof / puntato * 100).toFixed(0)}% su ${puntato.toFixed(2).replace(".", ",")} € puntati` : ""} · ${reg.filter((r) => r.esito == null).length} in attesa</div></div></div>`;
    h += statisticheRegistro(chiuse);
    h += perGiornata(reg.map((r, i) => ({ r, i })), ({ r, i }) => `<div class="card" style="padding:10px 12px"><div class="riga" style="align-items:flex-start;gap:10px"><div style="min-width:0"><div style="font-weight:600">${esc(r.nome)}</div><div class="s" style="line-height:1.4">${esc(r.testo)}</div>${dettaglioLegs(r)}${r.nota ? `<div class="s" style="color:${AM}">${esc(r.nota)}</div>` : ""}<div class="s">${esc(r.data)} · quota ${r.quota} · ${r.puntata} € · prevista ${pct(r.prob)}</div>${r.esito == null ? `<div style="margin-top:6px"><button class="chipbtn" data-es="${i}|1" style="padding:3px 10px;font-size:11px">Vinta</button> <button class="chipbtn" data-es="${i}|0" style="padding:3px 10px;font-size:11px">Persa</button></div>` : ""}</div><div style="text-align:right"><b style="color:${r.esito === 1 ? GR : r.esito === 0 ? RD : MU}">${r.esito === 1 ? eur(r.puntata * (r.quota - 1)) : r.esito === 0 ? eur(-r.puntata) : "in attesa"}</b><div><button class="chipbtn" data-del="${i}" style="padding:3px 10px;font-size:11px;margin-top:6px">Elimina</button></div></div></div><div class="riga" style="margin-top:8px;gap:8px;justify-content:flex-start"><span class="s">Quota di chiusura</span><input class="linea" inputmode="decimal" data-cl="${i}" value="${r.chiusura || ""}" placeholder="es. 1.75" style="margin:0;width:90px;padding:4px 8px">${r.chiusura > 1 ? (() => { const c = r.quota / r.chiusura - 1; return `<b style="color:${c >= 0 ? GR : RD}">CLV ${c >= 0 ? "+" : ""}${(c * 100).toFixed(1)}%</b>`; })() : ""}</div></div>`).join("");
  }
  if (reg.length) h += `<div class="grid2" style="margin-top:6px"><button class="btn" id="csv" style="margin:0">Scarica CSV</button><button class="btn" id="bak" style="margin:0">Copia backup</button></div>`;
  h += `<button class="btn" id="rip" style="margin:8px 0 0">Ripristina da backup incollato</button><div class="cap">Il registro vive solo su questo telefono: ogni tanto copia il backup e conservalo (ad esempio nelle note).</div>`;
  APP.innerHTML = h;
  const csv = $("#csv"); if (csv) csv.onclick = () => {
    const R = ls.get("registro", []), q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const t = ["data;partita;giocata;tipo;quota;puntata;probabilita;esito;guadagno"].concat(R.map((r) => [r.data, r.nome, r.testo, r.tipo, r.quota, r.puntata, r.prob, r.esito == null ? "" : r.esito, r.esito == null ? "" : (r.esito === 1 ? r.puntata * (r.quota - 1) : -r.puntata).toFixed(2)].map(q).join(";"))).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + t], { type: "text/csv" })); a.download = "registro-nba.csv"; a.click();
  };
  const bak = $("#bak"); if (bak) bak.onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(ls.get("registro", []))); bak.textContent = "Copiato ✓"; } catch { bak.textContent = "Copia non riuscita"; } };
  $("#rip").onclick = () => { const t = prompt("Incolla qui il backup copiato:"); if (!t) return; try { const a = JSON.parse(t); if (!Array.isArray(a)) throw 0; ls.set("registro", a); vistaRegistro(); } catch { alert("Backup non valido"); } };
  APP.querySelectorAll("[data-per]").forEach((b) => b.onclick = () => { ls.set("regPer", +b.dataset.per); vistaRegistro(); });
  APP.querySelectorAll("[data-es]").forEach((b) => b.onclick = () => { const [i, e] = b.dataset.es.split("|"), r = ls.get("registro", []); r[+i].esito = +e; ls.set("registro", r); vistaRegistro(); });
  APP.querySelectorAll("[data-cl]").forEach((el) => el.onchange = () => { const r = ls.get("registro", []), v = parseFloat(String(el.value).replace(",", ".")); r[+el.dataset.cl].chiusura = v > 1 ? v : null; ls.set("registro", r); vistaRegistro(); });
  APP.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => { const r = ls.get("registro", []); r.splice(+b.dataset.del, 1); ls.set("registro", r); vistaRegistro(); });
}

// ---------- GIOCATORE
async function vistaGiocatore(pid) {
  const back = `<a class="back" href="javascript:history.back()"><i class="ti ti-chevron-left"></i>Indietro</a>`;
  APP.innerHTML = back + skel();
  let D; try { D = await dati(false); } catch (e) { APP.innerHTML = back + errBox(e); return; }
  let x = null, p = null;
  for (const g of D.partite) { const f = g.giocatori.find((q) => String(q.pid) === String(pid)); if (f) { x = f; p = g; break; } }
  if (!x) { APP.innerHTML = back + `<div class="vuoto">Giocatore non trovato per il giorno selezionato.</div>`; return; }
  const avv = x.sq === p.casa ? p.trasf : p.casa, dub = x.inf === "dubbio" ? `<span class="pill" style="color:${AM};margin-left:6px">Dubbio</span>` : "";
  let h = back + `<div class="card gm" style="--ca:${T(D, x.sq).c};--cb:transparent"><div class="lg">${foto(x.pid, 64)}<div style="min-width:0"><div class="nome" style="font-size:26px">${esc(x.nome)}${stella("pl", x.pid, x.nome, x.sq)}${dub}</div><div class="s">${logo(x.sq, 16)} ${esc(T(D, x.sq).n)} · contro ${esc(T(D, avv).b)} · ${esc(p.ora)}</div><div class="s">${Math.round(x.min)} minuti attesi${x.conForma ? " · con forma recente" : " · solo media stagione"}</div></div></div>${x.assenze ? `<div class="s" style="margin-top:8px;color:${AM}">Assenti in squadra: ${esc(x.assenze.join(", "))}. Una parte dei loro numeri passa a questo giocatore.</div>` : ""}</div>`;
  for (const [m, c] of Object.entries(MERC)) {
    const o = x[c.k], u = x.ult && x.ult[c.k];
    h += `<h2>${m}</h2><div class="card"><div class="row3"><div class="tile on"><b>${o.v.toFixed(1)}</b><span>stima per questa partita</span></div><div class="tile"><b>${o.media.toFixed(1)}</b><span>media stagione</span></div><div class="tile"><b>${u ? (u.reduce((a, b) => a + b, 0) / u.length).toFixed(1) : "–"}</b><span>ultime ${u ? u.length : 0}</span></div></div>`;
    if (u) {
      const sg = o.rec != null ? o.rec : o.lad.length ? o.lad[Math.floor(o.lad.length / 2)][0] : null, su = sg != null ? u.filter((v) => v > sg).length : null;
      h += `<div style="margin-top:12px"><div class="riga s"><span>ULTIME ${u.length} GARE (vecchia → recente)</span>${sg != null ? `<span>soglia ${sg}: superata ${su} volte su ${u.length}</span>` : ""}</div>${spark(u, sg, MU)}</div>`;
    } else h += `<div class="s" style="margin-top:10px">Ultime partite non ancora disponibili.</div>`;
    h += o.rec != null ? `<div style="margin-top:10px"><span class="s">CONSIGLIATO</span><div style="font-weight:600;color:${GR}">over ${o.rec} ${c.u} · ${pct(o.lad.find((q) => q[0] === o.rec)[1])}</div></div>` : `<div class="s" style="margin-top:10px">Nessuna soglia sopra il 70%.</div>`;
    h += `<div class="lad">${o.lad.map(([t, pr]) => `<span style="color:${pr >= 0.7 ? GR : pr >= 0.5 ? AM : MU}">over ${t} · ${pct(pr)}</span>`).join("")}</div></div>`;
  }
  h += `<a class="btn" style="display:block;text-align:center" href="#/partita/${p.id}">Apri la partita</a>`;
  APP.innerHTML = h;
}


// probabilità di una giocata scritta a mano, dal modello (stima e variabilità dei giocatori, totale e squadre)
function probCustom(g, c) {
  const over = (v, sd, t) => 1 - phi((t - v) / sd);
  let v, sd, nome = "", pid = null, sq = null, k = c.k;
  if (k === "tot") { v = g.r.totale; sd = 17; nome = "Totale"; }
  else if (k === "sq") { v = c.sq === g.casa ? g.r.ptCasa : g.r.ptTr; sd = 12; sq = c.sq; nome = T(window.__D, c.sq).b; }
  else { const pl = g.giocatori.find((x) => x.pid === c.pid); if (!pl) return null; const o = pl[k]; v = o.v; sd = o.sd; nome = pl.nome; pid = pl.pid; sq = pl.sq; if (pl.inf === "dubbio") c.pg = (pl[k].pg ?? 0.5); }
  let p = over(v, sd, c.soglia); if (c.dir === "under") p = 1 - p; p *= c.pg || 1;
  const u = k === "pts" ? "pt" : k === "reb" ? "rimb." : k === "ast" ? "ass." : "punti";
  const testo = k === "tot" ? `Totale ${c.dir} ${c.soglia}` : k === "sq" ? `${nome} ${c.dir} ${c.soglia} punti` : `${nome} ${c.dir} ${c.soglia} ${u}`;
  return { id: "mio_" + Date.now() + Math.random().toString(36).slice(2, 6), chiave: null, testo, prob: p, partita: `${g.trasf} @ ${g.casa}`, g: g.id, pid, sq, k, dir: c.dir, soglia: c.soglia, nome: k === "tot" || k === "sq" ? null : nome, mia: true, stima: v };
}
async function vistaMia() {
  const back = `<a class="back" href="#/combo"><i class="ti ti-chevron-left"></i>Consigli</a>`;
  barraMia();
  APP.innerHTML = back + `<h2>La mia schedina</h2>` + skel();
  let D = null; try { D = await dati(false); window.__D = D; } catch {}
  const gare = D ? D.partite.filter((x) => x.stato === "pre") : [];
  const preIds = new Set(gare.map((x) => x.id));
  APP.innerHTML = back + `<h2>La mia schedina</h2><div id="miaris"></div><div id="miacos"></div>`;
  // --- riepilogo: giocate scelte, probabilità, quota e salvataggio
  const riepilogo = () => {
    const L = miaLeggi(), el = $("#miaris");
    if (!L.length) {
      const pronte = (D && D.schedine || []).filter((x) => /^q\d+$/.test(x.id));
      el.innerHTML = `<div class="card"><div style="font-weight:600">Nessuna giocata scelta</div><div class="cap" style="margin:4px 0 8px">Parti da una schedina pronta oppure scegli tu le giocate qui sotto.</div>${pronte.length ? `<div class="grid2" style="gap:8px">${pronte.map((x) => `<button class="btn" data-pronta="${esc(x.id)}" style="margin:0">${esc(x.nome.replace("La bomba quota", "Quota"))}<br><span class="s">${pct(x.prob)} · ${x.legs.length} giocate</span></button>`).join("")}</div>` : ""}</div>`;
      el.querySelectorAll("[data-pronta]").forEach((b) => b.onclick = () => {
        const x = pronte.find((q) => q.id === b.dataset.pronta); if (!x) return;
        ls.set("mia", x.legs.map((l) => ({ id: l.id || `${l.g}|${l.tipo}|${l.pid || l.squadra || l.testo}`, ...legDa({ ...l, id: l.id || `${l.g}|${l.tipo}|${l.pid || l.squadra || l.testo}` }) })));
        barraMia(); riepilogo(); lista();
      });
      return;
    }
    const q = L.reduce((a, l) => a / Math.max(0.05, l.prob), 1), p = L.reduce((a, l) => a * l.prob, 1), stessa = new Set(L.map((l) => l.g)).size < L.length;
    el.innerHTML = L.map((l, i) => `<div class="card cardp"><div style="min-width:0"><div class="s">${esc(l.partita)}${l.mia ? " · scelta da te" : ""}</div><div style="font-weight:500">${esc(l.testo)}</div></div><div style="text-align:right"><div class="v" style="color:${colProb(l.prob)}">${pct(l.prob)}</div><button class="chipbtn" data-rm="${i}" style="padding:2px 9px;font-size:11px">Togli</button></div></div>`).join("") +
    `<div class="card"><div class="row3"><div class="tile"><b>${(p * 100).toFixed(0)}%</b><span>tutte centrate</span></div><div class="tile"><b>${q.toFixed(2)}</b><span>quota giusta</span></div><div class="tile"><b>${L.length}</b><span>giocate</span></div></div>${stessa ? `<div class="cap" style="margin:8px 0 0;color:${AM}">Ci sono più giocate della stessa partita: la probabilità reale è diversa da quella calcolata.</div>` : ""}
    <div class="grid2" style="margin-top:10px"><input class="linea" inputmode="decimal" placeholder="Quota offerta (es. 4.50)" id="miaq" style="margin:0"><input class="linea" inputmode="decimal" placeholder="Puntata €" id="miap" value="${impo().puntata}" style="margin:0"></div><div id="miaval"></div>
    <button class="btn" id="miaok" style="margin:6px 0 0"><i class="ti ti-notebook"></i> Salva e segui in diretta</button><div class="grid2" style="gap:8px;margin-top:8px"><button class="btn" id="miacp" style="margin:0"><i class="ti ti-copy"></i> Copia</button><button class="btn" id="miasvuota" style="margin:0">Svuota</button></div></div>`;
    el.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { const l = miaLeggi(); l.splice(+b.dataset.rm, 1); ls.set("mia", l); barraMia(); riepilogo(); lista(); });
    $("#miasvuota").onclick = () => { ls.set("mia", []); barraMia(); riepilogo(); lista(); };
    $("#miacp").onclick = async () => { try { await navigator.clipboard.writeText(testoSchedina({ nome: "La mia schedina", legs: L, prob: p })); $("#miacp").textContent = "Copiata ✓"; } catch { $("#miacp").textContent = "Copia non riuscita"; } };
    const mq = $("#miaq");
    mq.oninput = () => { const v = parseFloat(String(mq.value).replace(",", ".")); $("#miaval").innerHTML = v > 1 ? rigaValore(valoreGiocata(p, v)) : ""; };
    $("#miaok").onclick = () => {
      const qq = parseFloat(String(mq.value).replace(",", ".")), pu = parseFloat(String($("#miap").value).replace(",", "."));
      if (!(qq > 1) || !(pu > 0)) { $("#miaok").textContent = "Scrivi la quota (maggiore di 1) e la puntata"; return; }
      const r = ls.get("registro", []); r.unshift({ id: "mia|" + Date.now(), chiave: null, nome: `La mia schedina (${L.length})`, testo: L.map((l) => l.testo).join(" + "), tipo: "Schedina", prob: p, quota: qq, puntata: pu, data: new Date().toISOString().slice(0, 10), esito: null, legs: L });
      ls.set("registro", r); ls.set("mia", []); barraMia(); location.hash = "#/live";
    };
  };
  // --- scelta delle giocate: dai consigli oppure scritte a mano
  const lista = () => {
    const tab = ls.get("miaTab", "c"), el = $("#miacos");
    let h = `<div class="tabs" style="margin-top:14px"><button class="chipbtn${tab === "c" ? " on" : ""}" data-tab="c">Scegli dai consigli</button><button class="chipbtn${tab === "s" ? " on" : ""}" data-tab="s">Scrivi la tua</button></div>`;
    if (!gare.length) h += `<div class="cap">Non ci sono partite da giocare per il giorno selezionato: cambia giorno dalla pagina Consigli.</div>`;
    else if (tab === "c") {
      const cat = Math.min(ls.get("miaCat", 0), SC.length - 1);
      h += `<div class="tabs">${SC.map(([t], i) => `<button class="chipbtn${cat === i ? " on" : ""}" data-cat="${i}">${esc(t)}</button>`).join("")}</div>`;
      const l = (D.picks || []).filter((x) => preIds.has(x.g) && SC[cat][2].includes(x.tipo)).slice(0, 25);
      h += l.length ? l.map(cardPick).join("") : `<div class="vuoto">Nessuna giocata di questo tipo con probabilità sopra il 70%.</div>`;
    } else {
      const C = ls.get("miaForm", { g: "", k: "pts", pid: "", sq: "", dir: "over", soglia: "" }), g = gare.find((x) => x.id === C.g) || gare[0], pl = g.giocatori.slice().sort((a, b) => b.pts.v - a.pts.v);
      const sel = (id, opts, val) => `<select class="linea" id="${id}" style="margin:0">${opts.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(val) ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
      h += `<div class="cap" style="margin-top:0">Scrivi la linea che vedi sul tuo bookmaker: l'app calcola la probabilità.</div><div class="card">${sel("cg", gare.map((x) => [x.id, `${x.trasf} @ ${x.casa} · ${String(x.ora).slice(-5)}`]), g.id)}
      <div class="grid2" style="margin-top:8px">${sel("ck", [["pts", "Punti giocatore"], ["reb", "Rimbalzi giocatore"], ["ast", "Assist giocatore"], ["tot", "Totale partita"], ["sq", "Punti di una squadra"]], C.k)}${sel("cd", [["over", "Over"], ["under", "Under"]], C.dir)}</div>
      ${["pts", "reb", "ast"].includes(C.k) ? `<div style="margin-top:8px">${sel("cp", pl.map((x) => [x.pid, `${x.nome} (${x.sq})`]), C.pid || (pl[0] && pl[0].pid))}</div>` : C.k === "sq" ? `<div style="margin-top:8px">${sel("cs", [[g.trasf, g.trasf], [g.casa, g.casa]], C.sq || g.trasf)}</div>` : ""}
      <input class="linea" inputmode="decimal" id="cl" placeholder="Linea del bookmaker (es. 19.5)" value="${esc(C.soglia)}" style="margin:8px 0 0"><div id="cprob"></div><button class="btn" id="cadd" style="margin:8px 0 0">Aggiungi alla schedina</button></div>`;
    }
    el.innerHTML = h;
    el.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { ls.set("miaTab", b.dataset.tab); lista(); });
    el.querySelectorAll("[data-cat]").forEach((b) => b.onclick = () => { ls.set("miaCat", +b.dataset.cat); lista(); });
    if (tab === "s" && gare.length) {
      const leggi = () => ({ g: $("#cg").value, k: $("#ck").value, dir: $("#cd").value, pid: $("#cp") ? $("#cp").value : "", sq: $("#cs") ? $("#cs").value : "", soglia: parseFloat(String($("#cl").value).replace(",", ".")) });
      const salvaC = () => { const c = leggi(); ls.set("miaForm", { ...c, soglia: $("#cl").value }); return c; };
      const mostra = () => { const c = salvaC(), g = gare.find((x) => x.id === c.g); if (!g || !(c.soglia > 0)) { $("#cprob").innerHTML = ""; return null; } const r = probCustom(g, c); if (!r) { $("#cprob").innerHTML = ""; return null; } $("#cprob").innerHTML = `<div class="s" style="margin-top:8px">Per il modello: <b style="color:${colProb(r.prob)}">${pct(r.prob)}</b> · stima ${r.stima.toFixed(1)}</div>`; return r; };
      for (const id of ["cg", "ck"]) $("#" + id).onchange = () => { salvaC(); lista(); };
      for (const id of ["cd", "cp", "cs"]) if ($("#" + id)) $("#" + id).onchange = () => { salvaC(); mostra(); };
      $("#cl").oninput = mostra; mostra();
      $("#cadd").onclick = () => { const r = mostra(); if (!r) { $("#cadd").textContent = "Scrivi la linea del bookmaker"; return; } const l = miaLeggi(); l.push(r); ls.set("mia", l); barraMia(); riepilogo(); $("#cl").value = ""; ls.set("miaForm", { ...leggi(), soglia: "" }); mostra(); };
    }
  };
  window.__miaAgg = () => { riepilogo(); };
  riepilogo(); lista();
}

// ---------- SCHEDINE
const TONI = { ok: [GR, "ti-shield-check"], mid: [OR, "ti-scale"], alta: [RD, "ti-flame"] };
function testoSchedina(s) { return `${s.nome} (${s.legs.length} giocate, probabilità unita ${pct(s.prob)})\n` + s.legs.map((l) => `• ${l.testo} (${l.partita}) ${pct(l.prob)}`).join("\n"); }
function cardSchedina(s) {
  const [col, ic] = TONI[s.tono] || [OR, "ti-ticket"];
  return `<div class="card sch" style="border-top:3px solid ${col};padding:12px 14px"><div class="riga" style="align-items:center"><div><div class="sn"><i class="ti ${ic}" style="color:${col}"></i> ${esc(s.nome)}</div><div class="s">${esc(s.sotto)}</div></div><div style="text-align:right"><div class="sp" style="color:${col}">${pct(s.prob)}</div><div class="s">quota ${s.quotaEqua.toFixed(2)}</div></div></div>
  <div style="margin:8px 0 4px">${s.legs.map((l) => `<div class="leg" style="gap:8px;padding:4px 0">${l.pid ? foto(l.pid, 26) : l.squadra ? logo(l.squadra, 24) : `<span class="ph" style="width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center"><i class="ti ti-chart-bar" style="color:${OR}"></i></span>`}<div style="min-width:0;flex:1"><div style="font-weight:600;font-size:13.5px">${esc(l.testo)}</div><div class="s" style="font-size:11px">${esc(l.partita)} · ${esc(String(l.ora).slice(-5))}</div></div><b style="color:${colProb(l.prob)}">${pct(l.prob)}</b></div>`).join("")}</div>
  ${s.stessaPartita ? `<div class="s" style="color:${AM};margin-bottom:6px">Più giocate della stessa partita: la probabilità reale è diversa.</div>` : ""}
  <div class="grid2" style="gap:8px"><button class="btn cp" data-cp="${esc(testoSchedina(s))}" style="margin:0"><i class="ti ti-copy"></i> Copia</button>${btnRegistro({ id: s.chiave, chiave: s.chiave, nome: s.nome, testo: s.legs.map((l) => l.testo).join(" + "), prob: s.prob })}</div></div>`;
}
async function vistaSchedine(force) {
  APP.innerHTML = topBar() + giorniChips() + skel(); bindGiorni();
  let D; try { D = await dati(force); } catch (e) { APP.innerHTML = topBar() + giorniChips() + errBox(e); bindGiorni(); return; }
  let h = topBar(D) + giorniChips();
  const sc = D.schedine || [];
  h += `<div class="cap" style="margin-top:0">Quota = quota giusta calcolata dalle probabilità: il tuo bookmaker ne paga un po' meno. Stime del modello, nessuna schedina è sicura.</div>`;
  if (!sc.length) h += `<div class="vuoto">Per questo giorno non ci sono abbastanza partite da giocare o giocate sopra la soglia. Le proposte compaiono prima dell'inizio delle partite.</div>`;
  h += sc.map(cardSchedina).join("");
  const singola = D.picks.find((x) => D.partite.find((p) => p.id === x.g && p.stato === "pre"));
  if (singola) h += `<h2>Singola del giorno</h2><div class="card riga" style="gap:12px;border-top:3px solid ${GR}">${anello(singola.prob * 100, colProb(singola.prob), 64)}<div style="min-width:0;flex:1"><div style="font-weight:600;font-size:16px">${esc(singola.testo)}</div><div class="s">${esc(singola.partita)} · stima ${esc(singola.stima)}</div></div></div>${btnRegistro({ id: chiaveGiocata(singola), chiave: chiaveGiocata(singola), nome: "Singola", testo: singola.testo, prob: singola.prob })}<div class="cap">${esc(singola.motivo)}</div>`;
  h += `<div class="cap">Più giocate unisci, meno la schedina è probabile: tre giocate al 80% insieme valgono circa il 51%.</div>`;
  APP.innerHTML = h; bindGiorni(); bindRegistro();
  APP.querySelectorAll(".cp").forEach((b) => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.cp); b.innerHTML = `<i class="ti ti-check"></i> Copiata`; } catch { b.textContent = "Copia non riuscita"; } });
}

// ---------- COMBO

// ---------- RIEPILOGO PER CATEGORIA: tutte le giocate consigliate di un tipo, con le percentuali
async function vistaCategoria(n) {
  const back = `<a class="back" href="#/combo"><i class="ti ti-chevron-left"></i>Consigli</a>`, c = SC[n]; if (!c) { location.hash = "#/combo"; return; }
  APP.innerHTML = back + giorniChips() + skel(); bindGiorni();
  let D; try { D = await dati(false); } catch (e) { APP.innerHTML = back + errBox(e); return; }
  const ord = ls.get("catOrd", "p"), min = ls.get("catMin", 0.7);
  let l = applicaImp(D).picks.filter((x) => c[2].includes(x.tipo) && x.prob >= min);
  l = [...l].sort(ord === "p" ? (a, b) => b.prob - a.prob : (a, b) => String(a.partita).localeCompare(String(b.partita)) || b.prob - a.prob);
  let h = back + giorniChips() + `<h2><i class="ti ${c[1]}"></i> ${esc(c[0])}: tutte le giocate</h2><div class="tabs">${[["p", "Più sicure"], ["g", "Per partita"]].map(([k, t]) => `<button class="chipbtn${ord === k ? " on" : ""}" data-o="${k}">${t}</button>`).join("")}${[0.7, 0.8, 0.9].map((v) => `<button class="chipbtn${min === v ? " on" : ""}" data-m="${v}">≥${Math.round(v * 100)}%</button>`).join("")}</div>`;
  h += `<div class="cap" style="margin-top:0">${l.length} giocate. Quote e linee dei bookmaker compaiono dove disponibili (ESPN fornisce solo totali e spread delle squadre).</div>`;
  h += l.length ? l.map(cardPick).join("") : `<div class="vuoto">Nessuna giocata con questa probabilità minima.</div>`;
  APP.innerHTML = h; bindGiorni(); bindRegistro();
  APP.querySelectorAll("[data-o]").forEach((b) => b.onclick = () => { ls.set("catOrd", b.dataset.o); vistaCategoria(n); });
  APP.querySelectorAll("[data-m]").forEach((b) => b.onclick = () => { ls.set("catMin", +b.dataset.m); vistaCategoria(n); });
}
async function vistaCombo(force) {
  APP.innerHTML = topBar() + giorniChips() + skel(); bindGiorni();
  let D; try { D = await dati(force); } catch (e) { APP.innerHTML = topBar() + giorniChips() + errBox(e); bindGiorni(); return; }
  const gruppi = SC.map(([t, ic, tipi]) => [t, ic, D.picks.filter((x) => tipi.includes(x.tipo))]);
  const scelte = gruppi.map((g) => g[2][0]).filter(Boolean);
  let h = topBar(D) + giorniChips();
  h += riquadriConsigli(D);
  h += `<div class="cap">Per ogni giocata l'app trova la soglia che si supera con probabilità di almeno il 70% secondo il modello. Le percentuali sono stime, non certezze.</div>`;
  if (!D.partite.length) h += `<div class="vuoto">Nessuna partita per questo giorno.</div>`;
  const ess = ls.get("ess", false);
  h += `<label class="sw"><input type="checkbox" id="ess" ${ess ? "checked" : ""}> Vista essenziale (solo le giocate più forti)</label>`;
  if (ess) {
    const f = D.picks.filter((x) => x.prob >= 0.78).slice(0, 15);
    h += f.length ? f.map((x) => `<div class="card riga" style="padding:8px 12px"><div class="lg" style="flex:1">${x.pid ? foto(x.pid, 30) : x.squadra ? logo(x.squadra, 26) : ""}<div style="min-width:0"><b>${esc(x.testo)}</b><div class="s">${esc(x.partita)}</div></div></div><b style="color:${GR}">${pct(x.prob)}</b></div>`).join("") : `<div class="vuoto">Nessuna giocata sopra il 78% per ora.</div>`;
  } else {
    for (const [t, ic, l] of gruppi) {
      if (!l.length) continue;
      h += `<div class="card box"><h3><i class="ti ${ic}"></i>${esc(t)}<a href="#/categoria/${SC.findIndex((q) => q[0] === t)}" style="margin-left:auto;font-size:12px;font-weight:500;color:${OR}">Vedi tutte (${l.length}) <i class="ti ti-chevron-right"></i></a></h3>${l.slice(0, 3).map((x) => rigaPick(D, x)).join("")}</div>`;
      if (l.length > 3) h += `<details><summary>Altre giocate: ${esc(t)} (${l.length - 3})</summary>${l.slice(3).map(cardPick).join("")}</details>`;
    }
    const tutti = D.partite.flatMap((p) => p.giocatori);
    if (tutti.length) {
      h += `<h2>I migliori della giornata</h2><div class="card">`;
      for (const [m, c] of Object.entries(MERC)) {
        h += `<div class="s" style="margin-top:8px">${m.toUpperCase()}</div>` + [...tutti].sort((a, b) => b[c.k].v - a[c.k].v).slice(0, 5).map((p, i) => `<div class="riga" style="padding:3px 0"><span>${i + 1}. <b style="color:${T(D, p.sq).c}">${esc(p.sq)}</b> ${esc(p.nome)}</span><b style="color:${i === 0 ? OR : "#f2f2f2"}">${p[c.k].v.toFixed(1)}</b></div>`).join("");
      }
      h += `</div>`;
    }
  }
  APP.innerHTML = h; bindGiorni(); $("#ess").onchange = (e) => { ls.set("ess", e.target.checked); route(); };
}

// ---------- STUDIO PARTITA
async function vistaStudio(id, force) {
  APP.innerHTML = `<a class="back" href="#/"><i class="ti ti-chevron-left"></i>Partite</a>` + skel();
  let D; try { D = await dati(force); } catch (e) { APP.innerHTML = `<a class="back" href="#/"><i class="ti ti-chevron-left"></i>Partite</a>` + errBox(e); return; }
  const p = D.partite.find((x) => x.id === id);
  if (!p) { APP.innerHTML = `<a class="back" href="#/"><i class="ti ti-chevron-left"></i>Partite</a><div class="vuoto">Partita non trovata per il giorno selezionato.</div>`; return; }
  const picks = D.picks.filter((x) => x.g === id), r = p.r;
  const mer = ls.get("mercato", "Punti");
  let h = `<a class="back" href="#/"><i class="ti ti-chevron-left"></i>Partite</a>` + schedaPartita(D, p, picks[0], false);
  h += `<h2>Giocate consigliate</h2>`;
  if (!picks.length) h += `<div class="vuoto">Nessuna giocata sopra la soglia per questa partita.</div>`;
  for (const [t, l] of raggruppa(picks)) if (l.length) h += `<div class="sub">${esc(t)}</div>` + l.map((x) => cardPick(x) + `<div class="cap">${esc(x.motivo)}</div>`).join("");
  h += `<h2>Testa a testa</h2><div id="h2h"><div class="skel" style="height:70px"></div></div>`;
  h += `<h2>Ultimi incontri</h2><div id="ultime"><div class="skel" style="height:90px"></div></div>`;
  if (p.giocatori.length) {
    h += `<h2>I migliori di ogni squadra</h2>`;
    for (const sq of [p.casa, p.trasf]) {
      const ds = p.giocatori.filter((x) => x.sq === sq);
      h += `<div class="card"><div class="lg" style="margin-bottom:6px">${logo(sq, 26)}<b>${esc(T(D, sq).n)}</b></div>` + Object.entries(MERC).map(([m, c]) => `<div class="s" style="margin-top:8px">${m.toUpperCase()}</div>` + [...ds].sort((a, b) => b[c.k].v - a[c.k].v).slice(0, 3).map((x, i) => `<div class="riga" style="padding:2px 0"><span>${i + 1}. ${esc(x.nome)}</span><b style="color:${i === 0 ? OR : "#f2f2f2"}">${x[c.k].v.toFixed(1)}</b></div>`).join("")).join("") + `</div>`;
    }
  }
  const lt = D.linee["tot_" + p.casa] ?? (r.mk && r.mk.tot ? r.mk.tot.linea : undefined), lineaT = ls.get("L_tot_" + id, lt ?? "");
  h += `<h2>Totale e spread</h2><div class="card"><div class="s">Over/Under (punti totali)</div>${gauge(r.totale, lineaT)}<div id="totp" class="s"></div><input class="linea" id="lt" inputmode="decimal" placeholder="Linea Over/Under (es. 224.5)" value="${esc(lineaT)}">${mercatoPartita(p)}</div>`;
  if (p.giocatori.length) {
    h += `<h2>Giocatori</h2><div class="tabs">${Object.keys(MERC).map((m) => `<button class="chipbtn${m === mer ? " on" : ""}" data-m="${m}">${m}</button>`).join("")}</div>`;
    const c = MERC[mer];
    for (const sq of [p.casa, p.trasf]) {
      h += `<div class="sub">${esc(T(D, sq).n)}</div>`;
      h += p.giocatori.filter((x) => x.sq === sq).slice(0, 10).map((x) => schedaGiocatore(D, id, x, mer, c)).join("");
    }
  }
  if (p.inf && p.inf.length) h += `<h2>Infortuni segnalati</h2>` + p.inf.map((i) => `<div class="card" style="padding:9px 12px"><b>${esc(i.nome)}</b> <span class="s">(${esc(T(D, i.sq).b)})</span> <span style="color:${i.stato === "out" ? RD : AM}">${i.stato === "out" ? "Out, escluso dai calcoli" : "Dubbio, ancora incluso"}</span><div class="s">${esc(i.dettaglio)}</div></div>`).join("");
  const note = ["Infortuni: l'app legge l'elenco di ESPN ed esclude chi è «out». Controlla le ultime notizie e le formazioni poco prima della partita.", "Riposo: è considerato solo il back-to-back (squadra che ha giocato ieri, circa un punto in meno).", "Rimbalzi e assist: stima semplice basata sulla media e sul ritmo di gioco, meno precisa dei punti.", "Quote bookmaker: la stima finale unisce il modello (40%) e il mercato (60%). Se le due stime sono molto distanti, di solito il mercato sa qualcosa che il modello non vede (infortuni, formazioni): fidati meno della giocata."];
  if (Math.abs(r.margine) >= 10) note.push("Margine stimato ampio: nei finali sbilanciati i titolari possono giocare meno minuti, con rischio per gli over sui giocatori.");
  if (Math.abs(r.margine) < 3) note.push("Partita molto equilibrata: lo spread è poco affidabile, conta di più il totale.");
  for (const s of [p.casa, p.trasf]) if ((D.b2b || []).includes(s)) note.push(`${T(D, s).b} ha giocato ieri: stima ridotta di circa 1.2 punti.`);
  h += `<h2>Da controllare prima di decidere</h2><div class="cap" style="display:grid;gap:6px">${note.map((n) => `<div>• ${esc(n)}</div>`).join("")}</div>`;
  APP.innerHTML = h;
  aggiornaTot(r);
  $("#lt").oninput = (e) => { ls.set("L_tot_" + id, e.target.value); aggiornaTot(r); };
  APP.querySelectorAll("[data-m]").forEach((b) => b.onclick = () => { ls.set("mercato", b.dataset.m); vistaStudio(id); });
  APP.querySelectorAll("input[data-lk]").forEach((i) => i.oninput = () => { ls.set("L_" + i.dataset.lk, i.value); probLinea(i); });
  APP.querySelectorAll("input[data-lk]").forEach(probLinea);
  api(`/api/h2h?a=${p.casa}&b=${p.trasf}`, 600000).then((H) => {
    const el = $("#h2h"); if (!el) return; const l = H.partite || [];
    if (!l.length) { el.innerHTML = `<div class="cap">Nessuno scontro diretto tra queste squadre nella stagione in corso e nella scorsa.</div>`; return; }
    const v = l.filter((x) => x.vinta).length, m = (f) => l.reduce((a, x) => a + f(x), 0) / l.length;
    el.innerHTML = `<div class="card"><div class="riga"><div class="lg">${logo(p.casa, 28)}<b>${esc(T(D, p.casa).b)}</b></div><b style="font-size:22px;font-family:'Barlow Condensed',Inter,sans-serif">${v} - ${l.length - v}</b><div class="lg"><b>${esc(T(D, p.trasf).b)}</b>${logo(p.trasf, 28)}</div></div><div class="s" style="margin:6px 0 8px">Ultimi ${l.length} scontri: media ${m((x) => x.pf).toFixed(1)} a ${m((x) => x.pa).toFixed(1)} · totale medio ${m((x) => x.pf + x.pa).toFixed(1)}</div>` +
      l.map((x) => `<div class="riga rg"><div><div style="font-weight:500">${x.casa ? "in casa di " + esc(T(D, p.casa).b) : "in casa di " + esc(T(D, p.trasf).b)}</div><div class="s">${esc(x.data)}</div></div><b style="color:${x.vinta ? GR : RD}">${x.pf}-${x.pa}</b></div>`).join("") + `</div>`;
  }).catch(() => { const el = $("#h2h"); if (el) el.innerHTML = `<div class="cap">Scontri diretti non disponibili.</div>`; });
  Promise.all([p.casa, p.trasf].map((s) => api("/api/ultime?s=" + s, 600000).catch(() => null))).then((res) => {
    const el = $("#ultime"); if (!el) return;
    el.innerHTML = res.map((x, i) => ultimeHtml(D, [p.casa, p.trasf][i], x && x.ultime)).join("");
  });
}
function mercatoPartita(p) {
  const r = p.r, mk = r.mk; if (!mk || (!mk.tot && !mk.spr)) return `<div class="s" style="margin-top:8px">Nessuna quota bookmaker ancora per questa partita: stima del solo modello.</div>`;
  let h = `<div class="mk">`;
  if (mk.tot) h += `<div class="riga s"><span>BOOKMAKER · TOTALE ${mk.tot.linea}</span><span>${divTag(mk.tot.div)}</span></div><div class="grid3"><div><b style="color:${colProb(mk.tot.pMk)}">${pct(mk.tot.pMk)}</b><span>mercato over</span></div><div><b>${mk.totaleModello.toFixed(1)}</b><span>solo modello</span></div><div><b>${r.totale.toFixed(1)}</b><span>stima finale</span></div></div><div class="s">${mk.tot.n} ${mk.tot.n === 1 ? "libro" : "libri"} · il modello da solo darebbe over ${pct(mk.tot.pMod)}, insieme al mercato ${pct(mk.tot.pFin)}</div>`;
  if (mk.spr) h += `<div class="riga s" style="margin-top:8px"><span>BOOKMAKER · SPREAD ${esc(p.casa)} ${mk.spr.linea > 0 ? "+" : ""}${mk.spr.linea}</span><span>${divTag(mk.spr.div)}</span></div><div class="s">Margine stimato dal modello ${mk.margineModello.toFixed(1)}, dal mercato ${mk.spr.muMk.toFixed(1)}, finale ${r.margine.toFixed(1)} (a favore di ${esc(p.casa)}).</div>`;
  return h + `</div>`;
}
function gauge(stima, linea) {
  const lo = stima - 20, hi = stima + 20, pp = (v) => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  const l = parseFloat(linea);
  return `<div class="gauge">${l ? `<div class="l" style="left:${pp(l)}%"></div>` : ""}<div class="m" style="left:${pp(stima)}%"></div></div><div class="s">Stima ${stima.toFixed(1)}${l ? ` · linea ${l}` : ""}</div>`;
}
function aggiornaTot(r) {
  const el = $("#totp"), v = parseFloat($("#lt").value);
  if (!el) return;
  if (!v) { el.textContent = `Senza linea: punti totali stimati ${r.totale.toFixed(1)}. Inserisci la linea per ottenere le probabilità.`; return; }
  const po = 1 - phi((v - r.totale) / 17);
  el.innerHTML = `Over ${v}: <b style="color:${po >= 0.7 ? GR : po >= 0.5 ? OR : MU}">${pct(po)}</b> · Under: <b style="color:${1 - po >= 0.7 ? GR : 1 - po >= 0.5 ? OR : MU}">${pct(1 - po)}</b>`;
}
function spark(vals, soglia, col) {
  const mx = Math.max(...vals, soglia || 0, 1), w = 200, h = 34, bw = w / vals.length;
  const bars = vals.map((v, i) => { const bh = Math.max(2, v / mx * (h - 4)); return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${soglia != null && v > soglia ? GR : col}" opacity="${soglia != null && v > soglia ? 1 : 0.55}"/>`; }).join("");
  const ln = soglia != null ? `<line x1="0" x2="${w}" y1="${(h - soglia / mx * (h - 4)).toFixed(1)}" y2="${(h - soglia / mx * (h - 4)).toFixed(1)}" stroke="${AM}" stroke-dasharray="3 3" stroke-width="1"/>` : "";
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">${bars}${ln}</svg>`;
}
function formaHtml(x, mer, c, o) {
  const k = { Punti: "pts", Rimbalzi: "reb", Assist: "ast" }[mer];
  if (!x.conForma || !x.ult || !x.ult[k]) return `<div class="s" style="margin-top:8px">Forma recente non ancora disponibile (si usa la media stagione).</div>`;
  const v = x.ult[k], m10 = v.reduce((a, b) => a + b, 0) / v.length, diff = m10 - (mer === "Punti" ? x.stagione : o.media);
  const tag = diff >= 1.5 ? `<span style="color:${GR}">in forma</span>` : diff <= -1.5 ? `<span style="color:${RD}">in calo</span>` : `<span class="s">nella media</span>`;
  return `<div style="margin-top:10px"><div class="riga s"><span>ULTIME ${v.length} GARE</span><span>${tag} · media ${m10.toFixed(1)}</span></div>${spark(v, o.rec, MU)}</div>`;
}
const divTag = (d) => d === "alta" ? `<span style="color:${RD}">modello e mercato molto distanti</span>` : d === "media" ? `<span style="color:${AM}">in parte diversi</span>` : `<span style="color:${GR}">allineati</span>`;
function quoteGioc(o, c) {
  const m = o.mk;
  if (!m) return `<div class="s" style="margin-top:8px">Nessuna quota bookmaker per questo giocatore: stima del solo modello.</div>`;
  const libri = (m.libri || []).slice(0, 4).map((l) => `${esc(l.b)} ${l.o}/${l.u}`).join(" · ");
  return `<div class="mk"><div class="riga s"><span>BOOKMAKER · LINEA ${m.linea} ${c.u}</span><span>${divTag(m.div)}</span></div>
  <div class="grid3"><div><b style="color:${colProb(m.pMk)}">${pct(m.pMk)}</b><span>mercato over</span></div><div><b>${pct(m.pMod)}</b><span>solo modello</span></div><div><b style="color:${colProb(m.pFin)}">${pct(m.pFin)}</b><span>insieme</span></div></div>
  <div class="s">Il modello da solo stimava ${o.vModello.toFixed(1)}, il mercato ${m.muMk.toFixed(1)}: stima finale ${o.v.toFixed(1)}. ${m.n} ${m.n === 1 ? "libro" : "libri"}${libri ? " · quote over/under: " + libri : ""}</div></div>`;
}
// la linea che di solito offre il bookmaker è vicina alla mediana (probabilità ~50%): le soglie sopra il 70% sono linee più basse, pagate meno
function lineaTipica(o, c) {
  let l = Math.floor(o.v) + 0.5; if (Math.abs(l + 1 - o.v) < Math.abs(l - o.v)) l += 1; // .5 più vicino alla stima
  const po = 1 - phi((l - o.v) / o.sd);
  return `<div class="s" style="margin-top:6px;line-height:1.45">Linea tipica del bookmaker: circa <b style="color:#f2f2f2">${l}</b> ${c.u} (qui over ${pct(po)}). ${o.rec != null && o.rec < l ? `La soglia consigliata ${o.rec} è più bassa: più sicura ma pagata meno, e molti book non la offrono.` : ""}</div>`;
}
function schedaGiocatore(D, gid, x, mer, c) {
  const o = x[c.k], dub = x.inf === "dubbio" ? `<span class="pill" style="color:${AM};margin-left:6px">Dubbio</span>` : "";
  const tile = (n, v, on) => `<div class="tile${on ? " on" : ""}"><b>${v.toFixed(1)}</b><span>${n}</span></div>`;
  const rec = o.rec != null ? `<div style="margin-top:10px"><span class="s">CONSIGLIATO</span><div style="font-weight:600;color:${GR}">over ${o.rec} ${c.u} · ${pct(o.lad.find((q) => q[0] === o.rec)[1])}</div></div>` : `<div class="s" style="margin-top:10px">Nessuna soglia sopra il 70%: giocatore poco sicuro.</div>`;
  const lad = o.lad.map(([t, pr]) => { const col = pr >= 0.7 ? GR : pr >= 0.5 ? AM : MU; return `<span style="color:${col};${t === o.rec ? "border:1px solid " + col : ""}">over ${t} · ${pct(pr)}</span>`; }).join("");
  const key = `${gid}_${x.pid || x.nome}_${mer}`;
  return `<div class="card pl"><div class="lg">${foto(x.pid, 48)}<div style="min-width:0"><div class="tn">${x.pid ? `<a href="#/giocatore/${esc(x.pid)}" style="border-bottom:1px dotted #5a6378">${esc(x.nome)}</a>` : esc(x.nome)}${dub}</div><div class="s">${esc(x.sq)} · ${Math.round(x.min)} min attesi</div>${x.assenze && x.boost && x.boost[c.k] >= 0.3 ? `<div class="s" style="color:${AM}">+${x.boost[c.k].toFixed(1)} ${c.u} per l'assenza di ${esc(x.assenze.join(", "))}</div>` : ""}</div></div>
  <div class="row3">${tile("Punti", x.pts.v, mer === "Punti")}${tile("Rimbalzi", x.reb.v, mer === "Rimbalzi")}${tile("Assist", x.ast.v, mer === "Assist")}</div>${rec}${lineaTipica(o, c)}${quoteGioc(o, c)}${formaHtml(x, mer, c, o)}
  <div class="s" style="margin-top:8px">ALTRE SOGLIE POSSIBILI</div><div class="lad">${lad}</div>
  <input class="linea" inputmode="decimal" placeholder="Tua linea ${mer.toLowerCase()} (es. ${(Math.round(o.v * 2) / 2)})" data-lk="${esc(key)}" data-v="${o.v}" data-sd="${o.sd}" value="${esc(ls.get("L_" + key, ""))}"><div class="s" data-lp="${esc(key)}"></div></div>`;
}
function probLinea(i) {
  const el = APP.querySelector(`[data-lp="${CSS.escape(i.dataset.lk)}"]`); if (!el) return;
  const l = parseFloat(i.value); if (!l) { el.textContent = ""; return; }
  const po = 1 - phi((l - +i.dataset.v) / +i.dataset.sd);
  el.innerHTML = `Over ${l}: <b style="color:${po >= 0.7 ? GR : po >= 0.5 ? OR : MU}">${pct(po)}</b> · Under: <b>${pct(1 - po)}</b>`;
}
function ultimeHtml(D, sig, ul) {
  if (!ul || !ul.length) return `<div class="cap">Ultimi incontri di ${esc(sig)} non disponibili.</div>`;
  const m = (f) => ul.reduce((a, x) => a + f(x), 0) / ul.length;
  return `<div class="card"><div class="riga"><div class="lg">${logo(sig, 30)}<b>${esc(T(D, sig).n)}</b></div><div>${ul.map((x) => `<span class="fm" style="background:${x.vinta ? GR : RD}">${x.vinta ? "V" : "S"}</span>`).join("")}</div></div><div class="s" style="margin:6px 0 8px">Ultime ${ul.length}: ${m((x) => x.pf).toFixed(1)} fatti, ${m((x) => x.pa).toFixed(1)} subiti · totale ${m((x) => x.pf + x.pa).toFixed(1)}</div>` +
    ul.map((x) => `<div class="riga rg"><div class="lg">${logo(x.avv, 22)}<div><div style="font-weight:500">${x.casa ? "vs" : "@"} ${esc((D.squadre[x.avv] || { b: x.avv }).b)}</div><div class="s">${esc(x.data)}</div></div></div><b style="color:${x.vinta ? GR : RD}">${x.pf}-${x.pa}</b></div>`).join("") + `</div>`;
}


// ---------- LIVE
function schedaLive(D, p) {
  const t = T(D, p.casa), v = T(D, p.trasf), cc = t.c, ct = v.c.toLowerCase() === cc.toLowerCase() ? "#5a6378" : v.c;
  const lato = (ab, r, n, l) => `<div class="tm cr" data-l="${l}"><div class="cl ${r}">${logo(ab, 34)}<div class="tn"><b class="n12">${n}</b>${esc(T(D, ab).b.length > 7 ? ab : T(D, ab).b)}</div></div></div>`;
  return `<div class="card gm cmp inlive" data-lg="${p.id}" style="--ca:${ct};--cb:${cc}"><div class="riga" style="margin-bottom:4px"><span class="pill" style="color:${OR}"><span class="dot"></span>Live · ${esc(p.dettaglio)}</span><span class="s">Giocata al ${Math.round(p.f * 100)}%</span></div>
  <div class="cg">${lato(p.casa, "ca", 1, "c")}<div class="cm"><span class="big liveN">${p.ptCasa}</span><i>-</i><span class="big liveN">${p.ptTr}</span></div>${lato(p.trasf, "tr", 2, "t")}</div>
  <div class="qr">${(p.qTr || []).map((q, i) => `<span class="${p.periodo === i + 1 ? "cur" : ""}">Q${i + 1} ${(p.qCasa || [])[i] ?? 0}-${q}</span>`).join("")}</div>
  <div class="bar" style="margin:6px 0 2px"><div style="width:${(p.pwLive * 100).toFixed(0)}%;background:${cc}"></div><div style="flex:1;background:${ct}"></div></div>
  <div class="riga s" style="margin:0 0 6px"><span>1 ${esc(p.casa)} ${pct(p.pwLive)}</span><span>vittoria adesso</span><span>${esc(p.trasf)} ${pct(1 - p.pwLive)} 2</span></div>
  <span class="chip">Totale ora ${p.ptCasa + p.ptTr}</span><span class="chip">Finale stimato ${p.proiTot.toFixed(0)}</span>${p.mercato ? `<span class="chip" style="color:${AM}">Bookmaker ${p.mercato.linea}: over ${pct(p.mercato.pMk)} (${p.mercato.minuti} min fa)</span><span class="chip" style="color:${colProb(Math.max(p.mercato.pNostra, 1 - p.mercato.pNostra))}">Nostra stima: ${p.mercato.pNostra >= 0.5 ? "over" : "under"} ${pct(Math.max(p.mercato.pNostra, 1 - p.mercato.pNostra))}</span>` : ""}</div>`;
}
function rigaSegnale(x) {
  const vis = x.pid ? foto(x.pid, 34) : `<span class="ph" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center"><i class="ti ti-bolt" style="color:${OR}"></i></span>`;
  return `<div class="card seg"><div class="riga" style="gap:10px"><div class="lg" style="flex:1">${vis}<div style="min-width:0"><div style="font-weight:600">${esc(x.testo)}</div><div class="s">${esc(x.tipo)} · ora ${esc(x.adesso)} · stima ${esc(x.stima)}</div></div></div><div style="font-size:20px;font-weight:600;color:${colProb(x.prob)}">${pct(x.prob)}</div></div><div class="cap" style="margin:6px 0 0">${esc(x.motivo)}</div></div>`;
}
function rigaLive(x) {
  const hit = x.pLive >= 0.995 && x.cur != null, col = hit ? GR : x.pLive >= 0.7 ? GR : x.pLive >= 0.4 ? OR : RD;
  const delta = x.pLive - x.prob, fr = delta >= 0 ? "ti-arrow-up-right" : "ti-arrow-down-right";
  return `<div class="card riga" style="padding:10px 12px;gap:10px"><div style="min-width:0;flex:1"><div style="font-weight:500">${esc(x.testo)}</div><div class="s">${esc(x.tipo)} · ora ${esc(x.adesso)}</div><div class="s">Prima ${pct(x.prob)} <i class="ti ${fr}" style="color:${delta >= 0 ? GR : RD}"></i></div></div><div style="text-align:right"><div style="font-size:20px;font-weight:600;color:${col}">${pct(x.pLive)}</div><div class="s">${hit ? "Centrata" : x.pLive < 0.15 ? "Difficile" : "In corso"}</div></div></div>`;
}
const storiaLive = {}, eventiLive = [], statoGiocate = {};
function aggiornaStoriaLive(D) {
  for (const p of D.partite) {
    const a = (storiaLive[p.id] ||= []), ult = a[a.length - 1];
    if (!ult || ult.f !== p.f) a.push({ f: p.f, p: p.pwLive });
    for (const q of p.picks || []) {
      const k = p.id + "|" + (q.id || q.testo), prima = statoGiocate[k];
      const ora = q.pLive >= 0.995 ? "ok" : q.pLive <= 0.03 ? "no" : "in";
      if (prima && prima !== ora && ora !== "in") eventiLive.push({ t: Date.now(), ok: ora === "ok", testo: q.testo, partita: `${p.trasf} @ ${p.casa}` });
      statoGiocate[k] = ora;
    }
  }
  while (eventiLive.length > 20) eventiLive.shift();
}
function grafLive(p) {
  const a = storiaLive[p.id] || []; if (a.length < 2) return "";
  const w = 300, h = 70, X = (f) => (f * w).toFixed(1), Y = (v) => ((1 - v) * (h - 6) + 3).toFixed(1);
  const pts = a.map((q) => `${X(q.f)},${Y(q.p)}`).join(" ");
  const ca = T({ squadre: {} }, p.casa).c;
  return `<div class="card" style="padding:10px 12px"><div class="riga s"><span>Probabilità di vittoria di ${esc(p.casa)} nel tempo</span><b style="color:#e8eaf0">${pct(p.pwLive)}</b></div><svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="margin-top:6px"><line x1="0" x2="${w}" y1="${Y(0.5)}" y2="${Y(0.5)}" stroke="#2a3040" stroke-dasharray="4 4"/><polyline points="${pts}" fill="none" stroke="${OR}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg></div>`;
}
function novitaLive() {
  const l = eventiLive.filter((e) => Date.now() - e.t < 15 * 60000).slice(-4).reverse(); if (!l.length) return "";
  return `<div class="sub">Appena successo</div>` + l.map((e) => `<div class="card riga" style="padding:9px 12px;border-left:3px solid ${e.ok ? GR : RD}"><div style="min-width:0"><div style="font-weight:600">${esc(e.testo)}</div><div class="s">${esc(e.partita)}</div></div><b style="color:${e.ok ? GR : RD}">${e.ok ? "Centrata" : "Persa"}</b></div>`).join("");
}

// formazioni in riga: nome a sinistra, statistiche a destra
function formazioniLive(D, p) {
  if (!p.giocatori.length) return `<div class="vuoto" style="margin-top:12px">Formazioni e statistiche non ancora disponibili da ESPN.</div>`;
  const col = (g) => g.pts ?? 0;
  const tab = (sq) => {
    const l = p.giocatori.filter((g) => g.sq === sq); if (!l.length) return "";
    const top = Math.max(...l.map(col));
    const rg = (g) => { const n = g.nome.split(" "), br = n.length > 1 ? n[0][0] + ". " + n.slice(1).join(" ") : g.nome;
      const hot = col(g) >= 20 || (g.pts >= 10 && g.reb >= 10) || (g.pts >= 10 && g.ast >= 10);
      return `<tr class="${hot ? "hot" : ""}"><td class="nm"><div class="nmi">${g.pid ? foto(g.pid, 22) : ""}<span>${esc(br)}${g.pts === top && top > 0 ? ' <i class="ti ti-flame" style="color:' + OR + '"></i>' : ""}</span></div></td><td class="pt">${g.pts ?? 0}</td><td>${g.reb ?? 0}</td><td>${g.ast ?? 0}</td><td>${g.tre ?? "–"}</td><td>${g.stl ?? 0}</td><td>${g.blk ?? 0}</td><td class="${(g.pf ?? 0) >= 4 ? "fl" : ""}">${g.pf ?? 0}</td><td class="mn">${Math.round(g.min ?? 0)}</td></tr>`; };
    const tit = l.filter((g) => g.tit), pan = l.filter((g) => !g.tit).sort((a, b) => (b.min || 0) - (a.min || 0));
    const hd = `<tr class="th"><th></th><th>PT</th><th>RB</th><th>AS</th><th>3P</th><th>PR</th><th>ST</th><th>FL</th><th>MIN</th></tr>`;
    return `<div class="card fz"><div class="lg" style="margin-bottom:4px">${logo(sq, 24)}<b>${esc(T(D, sq).n)}</b><span class="s" style="margin-left:auto">${sq === p.casa ? "casa" : "trasferta"}</span></div><table class="bx">${hd}${(tit.length ? tit : pan.slice(0, 5)).map(rg).join("")}</table>${(tit.length ? pan : pan.slice(5)).length ? `<details class="pan"><summary>Panchina (${(tit.length ? pan : pan.slice(5)).length})</summary><table class="bx">${hd}${(tit.length ? pan : pan.slice(5)).map(rg).join("")}</table></details>` : ""}</div>`;
  };
  return `<div class="sub">Formazioni e statistiche</div>` + tab(p.trasf) + tab(p.casa) + `<div class="cap" style="margin-top:0">PT punti · RB rimbalzi · AS assist · 3P triple (segnate-tentate) · PR palle rubate · ST stoppate · FL falli (rosso da 4) · MIN minuti. In arancione chi ha 20+ punti o una doppia doppia.</div>`;
}

// stato di una giocata della mia schedina rispetto alla partita in corso
function avanzamentoLeg(l, D) {
  const p = D.partite.find((x) => x.id === l.g);
  if (!p) return D.prossime.some((x) => x.id === l.g) ? { st: "pre", testo: "non ancora iniziata" } : { st: "nd", testo: "partita non in corso" };
  let cur = null;
  if (l.k === "tot") cur = (p.ptTr || 0) + (p.ptCasa || 0);
  else if (l.k === "sq") cur = l.sq === p.casa ? p.ptCasa : p.ptTr;
  else if (l.k === "win") { const d = l.sq === p.casa ? (p.ptCasa || 0) - (p.ptTr || 0) : (p.ptTr || 0) - (p.ptCasa || 0); return { st: d > 0 ? "vant" : "svant", testo: `${d > 0 ? "in vantaggio di " : "sotto di "}${Math.abs(d)}`, cur: d, soglia: 0, p }; }
  else { const g = p.giocatori.find((x) => (l.pid && x.pid === l.pid) || (l.nome && x.nome === l.nome)); if (!g) return { st: "nd", testo: "giocatore non ancora nel tabellino", p }; cur = g[l.k]; }
  const over = l.dir !== "under", sg = l.soglia;
  const st = over ? (cur > sg ? "ok" : "in") : (cur > sg ? "no" : "in");
  return { st, cur, soglia: sg, testo: `${cur} / ${sg}`, p };
}
function mieGiocateLive(D) {
  const oggi = new Date().toISOString().slice(0, 10), R = ls.get("registro", []).filter((r) => r.legs && r.legs.length && (r.esito == null || String(r.data) >= oggi || r.esito != null && String(r.data) >= new Date(Date.now() - 86400000).toISOString().slice(0, 10)));
  if (!R.length) return "";
  const col = { ok: GR, no: RD, in: OR, vant: GR, svant: AM, pre: MU, nd: MU };
  return `<div class="sub"><i class="ti ti-ticket" style="color:${OR}"></i> Le mie giocate</div>` + R.map((r) => `<div class="card"><div class="riga"><b>${esc(r.nome)}</b><span class="s">${r.esito === 1 ? "<b style=\"color:" + GR + "\">VINTA</b> · " : r.esito === 0 ? "<b style=\"color:" + RD + "\">PERSA</b> · " : ""}quota ${r.quota} · ${r.puntata} €${r.esito == null ? `<button class="chipbtn" data-delm="${esc(r.id)}" style="padding:2px 9px;font-size:11px;margin-left:6px">Rimuovi</button>` : ""}</span></div>` + (r.esito != null && r.es ? dettaglioLegs(r) : r.legs.map((l) => {
    const a = avanzamentoLeg(l, D), c = col[a.st] || MU, pr = a.soglia > 0 && a.cur != null ? Math.max(0, Math.min(100, (a.cur / a.soglia) * 100)) : 0;
    const ic = a.st === "ok" ? "ti-circle-check-filled" : a.st === "no" ? "ti-circle-x-filled" : "ti-circle-dashed";
    return `<div style="margin-top:10px"><div class="riga" style="gap:8px"><div style="min-width:0;flex:1"><i class="ti ${ic}" style="color:${c}"></i> ${esc(l.testo)}</div><b style="color:${c};white-space:nowrap">${esc(a.testo)}</b></div>${a.soglia > 0 ? `<div class="bar" style="height:4px;margin-top:4px"><div style="width:${pr}%;background:${c}"></div></div>` : ""}${a.p ? `<div class="s" style="margin-top:2px">${esc(a.p.dettaglio || "")}</div>` : ""}</div>`;
  }).join("")) + `</div>`).join("");
}
const bloccoLive = {};
async function vistaLive(primo = true) {
  if (primo) { APP.innerHTML = topBar() + skel(); delete APP.dataset.live; aggiornaRegistro(); }
  let D; try { D = await api("/api/live", 3000); } catch (e) { if (primo) APP.innerHTML = topBar() + errBox(e); timer = setTimeout(() => location.hash.startsWith("#/live") && vistaLive(false), 20000); return; }
  if (!location.hash.startsWith("#/live")) return;
  aggiornaStoriaLive(D);
  const B = []; // blocchi con chiave: si riscrive solo quello che cambia, così la pagina non lampeggia
  B.push(["top", topBar(D) + novitaLive() + `<div class="cap" style="margin-top:0">Si aggiorna da solo ogni 6 secondi (ESPN pubblica i dati ogni 10-20 secondi circa). Le probabilità tengono conto di punteggio, tempo rimasto e minuti giocati.</div>`]);
  if (!D.partite.length) {
    let h = `<div class="vuoto"><b>Nessuna partita in corso.</b><br>Oggi: ${D.totali} partite, ${D.finite} finite.</div>`;
    if (D.prossime.length) h += `<h2>Prossime partite</h2>` + D.prossime.map((q) => `<a class="card riga" href="#/partita/${q.id}"><div class="lg">${logo(q.trasf, 28)}<b>${esc(q.trasf)}</b><span class="s">@</span>${logo(q.casa, 28)}<b>${esc(q.casa)}</b></div><span class="s">${esc(q.ora)}</span></a>`).join("");
    B.push(["vuoto", h]);
  }
  B.push(["mie", mieGiocateLive(D)]);
  for (const p of D.partite) {
    let h = schedaLive(D, p) + formazioniLive(D, p) + grafLive(p);
    if (p.segnali && p.segnali.length) h += `<div class="sub"><span class="pill" style="color:${OR}"><span class="dot"></span>Segnali live</span> <span class="s">nati durante la partita</span></div>` + p.segnali.map(rigaSegnale).join("");
    const picks = [...p.picks].sort((a, b) => (a.pLive >= 0.995) - (b.pLive >= 0.995) || b.pLive - a.pLive);
    if (picks.length) h += `<div class="sub">Le nostre giocate su questa partita</div>` + picks.map(rigaLive).join("");
    h += `<a class="btn" style="display:block;text-align:center" href="#/partita/${p.id}">Apri lo studio di questa partita</a>`;
    B.push(["g" + p.id, h]);
  }
  const chiavi = B.map((x) => x[0]).join("|"), y = window.scrollY;
  if (!primo && APP.dataset.live === chiavi && APP.querySelector("[data-blk]")) {
    for (const [k, h] of B) {
      const el = APP.querySelector(`[data-blk="${k}"]`); if (!el || bloccoLive[k] === h) continue;
      const aperti = [...el.querySelectorAll("details")].map((d) => d.open);
      el.innerHTML = h; bloccoLive[k] = h;
      el.querySelectorAll("details").forEach((d, i) => { if (aperti[i]) d.open = true; });
    }
  } else {
    APP.innerHTML = B.map(([k, h]) => `<div data-blk="${k}">${h}</div>`).join(""); APP.dataset.live = chiavi;
    for (const k of Object.keys(bloccoLive)) delete bloccoLive[k];
    for (const [k, h] of B) bloccoLive[k] = h;
  }
  window.scrollTo(0, y);
  for (const p of D.partite) illumina(APP.querySelector(`[data-lg="${p.id}"]`), p.id, p.ptTr, p.ptCasa);
  timer = setTimeout(() => !document.hidden && location.hash.startsWith("#/live") && vistaLive(false), 6000);
}

// ---------- ESITI e STORICO
function barraPerc(t, k, n, att) { const p = n ? k / n * 100 : 0; return `<div class="card pc"><div class="s">${esc(t)}</div><b>${k}/${n}</b> <span class="s">(${p.toFixed(0)}%${att != null ? " · previsto " + pct(att) : ""})</span><div class="mini"><i style="width:${p.toFixed(0)}%;background:${p >= 60 ? GR : RD}"></i></div></div>`; }
function precisioneModello(S) {
  const nomi = { Totale: "Punti totali della partita", Squadra: "Punti di una squadra", Punti: "Punti di un giocatore", Rimbalzi: "Rimbalzi", Assist: "Assist" }, per = {};
  for (const r of S.righe || []) {
    if (r.esito !== 0 && r.esito !== 1 || !nomi[r.tipo]) continue;
    const st = parseFloat(r.stima), m = /fatto (-?\d+(?:\.\d+)?)/.exec(r.dettaglio || ""); if (!Number.isFinite(st) || !m) continue;
    const c = (per[r.tipo] ||= { n: 0, ae: 0, e: 0 }); c.n++; c.ae += Math.abs(st - +m[1]); c.e += st - +m[1];
  }
  const l = Object.entries(per).filter(([, c]) => c.n >= 3); if (!l.length) return "";
  return `<h2>Precisione del modello</h2><div class="grid2">` + l.map(([t, c]) => `<div class="card pc"><div class="s">${esc(nomi[t])}</div><b>±${(c.ae / c.n).toFixed(1)}</b> <span class="s">di errore medio</span><div class="s">${c.n} giocate · ${Math.abs(c.e / c.n) < 0.5 ? "nessuna tendenza" : c.e > 0 ? "stima in media " + (c.e / c.n).toFixed(1) + " in più del reale" : "stima in media " + (-c.e / c.n).toFixed(1) + " in meno del reale"}</div></div>`).join("") + `</div><div class="cap">Confronta la stima dell'app con quello che è successo davvero nelle giocate già chiuse.</div>`;
}
function schedineStorico(S) {
  const l = (S.schedine || []); if (!l.length) return "";
  const ris = l.filter((r) => r.esito === 0 || r.esito === 1), att = l.length - ris.length;
  const per = {}; for (const r of ris) { const c = (per[r.squadra] ||= { n: 0, ok: 0, pr: 0, nome: String(r.partita || r.squadra) }); c.n++; c.ok += r.esito; c.pr += r.prob; }
  let h = `<h2>Schedine proposte</h2>`;
  if (!ris.length) return h + `<div class="vuoto">Salvate ${l.length} schedine, ${att} in attesa che le partite finiscano. Qui vedrai quante ne vengono centrate.</div>`;
  h += `<div class="grid2">` + Object.values(per).map((c) => barraPerc(c.nome, c.ok, c.n, c.pr / c.n)).join("") + `</div>`;
  h += ris.slice(0, 8).map((r) => `<div class="card riga" style="padding:9px 12px;gap:10px"><div style="min-width:0"><div style="font-weight:500">${esc(r.partita)} · ${esc(r.data)}</div><div class="s">${esc(r.dettaglio || "")} · prevista ${pct(r.prob)}</div></div><b style="color:${r.esito === 1 ? GR : RD}">${r.esito === 1 ? "Centrata" : "Sbagliata"}</b></div>`).join("");
  return h;
}
function rigaEsito(r) {
  const [s, c] = { 1: ["✓", GR], 0: ["✗", RD], 2: ["–", MU] }[r.esito];
  return `<div class="card riga" style="padding:10px 12px;gap:10px;justify-content:flex-start"><div style="width:28px;height:28px;border-radius:50%;background:${c}22;color:${c};display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">${s}</div><div style="min-width:0;flex:1"><div style="font-weight:500">${esc(r.testo)}</div><div class="s">${esc(r.partita)} · ${esc(r.dettaglio || "")}</div></div><div class="s">${pct(r.prob)}</div></div>`;
}
async function vistaEsiti() {
  APP.innerHTML = topBar() + segStorico("e") + giorniChips() + skel(); bindGiorni();
  let E; try { E = await api("/api/esiti?" + qs(), 60000); } catch (e) { APP.innerHTML = topBar() + segStorico("e") + giorniChips() + errBox(e); bindGiorni(); return; }
  const ris = E.risultati, val = ris.filter((x) => x.esito !== 2); ultimoD = { squadre: E.squadre || {} };
  let h = topBar() + segStorico("e") + giorniChips();
  if (!val.length) h += `<div class="vuoto">Nessuna partita finita da verificare per questo giorno. Torna a partite concluse.</div>`;
  else {
    const ok = val.filter((x) => x.esito === 1).length, p = ok / val.length * 100;
    h += `<div class="card riga" style="gap:14px;justify-content:flex-start">${anello(p, p >= 60 ? GR : OR, 76)}<div><div class="s">Consigli delle partite finite</div><div style="font-size:20px;font-weight:600">${ok} su ${val.length} azzeccati</div><div class="s">${ris.length - val.length} non validi (giocatore fermo o dato mancante)</div></div></div>`;
    const cat = ls.get("esCat", null), sel = cat != null ? SC[cat] : null;
    h += `<div class="grid2">${SC.map(([t, , tipi], i) => { const v = val.filter((x) => tipi.includes(x.tipo)); return v.length ? `<div data-ec="${i}" style="cursor:pointer;${cat === i ? "outline:1px solid " + OR + ";border-radius:16px" : ""}">${barraPerc(t, v.filter((x) => x.esito === 1).length, v.length)}</div>` : ""; }).join("")}</div>`;
    if (sel) {
      const l = val.filter((x) => sel[2].includes(x.tipo)).sort((a, b) => b.prob - a.prob);
      h += `<h2>${esc(sel[0])} (${l.length})</h2><div class="cap" style="margin-top:0">Tutte le giocate della categoria, dalla più probabile. <a href="#" id="tutte" style="color:${OR}">Mostra tutto</a></div>` + l.map(rigaEsito).join("");
    } else
    for (const [t, c] of [["Azzeccati", 1], ["Sbagliati", 0]]) { const l = val.filter((x) => x.esito === c); if (l.length) h += `<h2>${t} (${l.length})</h2>` + l.map(rigaEsito).join(""); }
    const nulli = ris.filter((x) => x.esito === 2);
    if (nulli.length) h += `<details><summary>Non validi (${nulli.length})</summary>${nulli.map(rigaEsito).join("")}</details>`;
    h += riquadroTabellini(ris) + `<div class="cap">I consigli sono ricalcolati con le statistiche attuali. Per il registro vero guarda «Storico».</div>`;
  }
  APP.innerHTML = h; bindGiorni();
  APP.querySelectorAll("[data-ec]").forEach((el) => el.onclick = () => { const i = +el.dataset.ec; ls.set("esCat", ls.get("esCat", null) === i ? null : i); vistaEsiti(); });
  const tt = $("#tutte"); if (tt) tt.onclick = (e) => { e.preventDefault(); ls.set("esCat", null); vistaEsiti(); };
}
function schedineStorico(S) {
  const l = (S.schedine || []); if (!l.length) return "";
  const ris = l.filter((r) => r.esito === 0 || r.esito === 1), att = l.length - ris.length;
  const per = {}; for (const r of ris) { const c = (per[r.squadra] ||= { n: 0, ok: 0, pr: 0, nome: String(r.partita || r.squadra) }); c.n++; c.ok += r.esito; c.pr += r.prob; }
  let h = `<h2>Schedine proposte</h2>`;
  if (!ris.length) return h + `<div class="vuoto">Salvate ${l.length} schedine, ${att} in attesa che le partite finiscano. Qui vedrai quante ne vengono centrate.</div>`;
  h += `<div class="grid2">` + Object.values(per).map((c) => barraPerc(c.nome, c.ok, c.n, c.pr / c.n)).join("") + `</div>`;
  h += ris.slice(0, 8).map((r) => `<div class="card riga" style="padding:9px 12px;gap:10px"><div style="min-width:0"><div style="font-weight:500">${esc(r.partita)} · ${esc(r.data)}</div><div class="s">${esc(r.dettaglio || "")} · prevista ${pct(r.prob)}</div></div><b style="color:${r.esito === 1 ? GR : RD}">${r.esito === 1 ? "Centrata" : "Sbagliata"}</b></div>`).join("");
  return h;
}
function rigaEsito(r) {
  const [s, c] = { 1: ["✓", GR], 0: ["✗", RD], 2: ["–", MU] }[r.esito];
  return `<div class="card riga" style="padding:10px 12px;gap:10px;justify-content:flex-start"><div style="width:28px;height:28px;border-radius:50%;background:${c}22;color:${c};display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">${s}</div><div style="min-width:0;flex:1"><div style="font-weight:500">${esc(r.testo)}</div><div class="s">${esc(r.partita)} · ${esc(r.dettaglio || "")}</div></div><div class="s">${pct(r.prob)}</div></div>`;
}
async function vistaEsiti() {
  APP.innerHTML = topBar() + segStorico("e") + giorniChips() + skel(); bindGiorni();
  let E; try { E = await api("/api/esiti?" + qs(), 60000); } catch (e) { APP.innerHTML = topBar() + segStorico("e") + giorniChips() + errBox(e); bindGiorni(); return; }
  const ris = E.risultati, val = ris.filter((x) => x.esito !== 2); ultimoD = { squadre: E.squadre || {} };
  let h = topBar() + segStorico("e") + giorniChips();
  if (!val.length) h += `<div class="vuoto">Nessuna partita finita da verificare per questo giorno. Torna a partite concluse.</div>`;
  else {
    const ok = val.filter((x) => x.esito === 1).length, p = ok / val.length * 100;
    h += `<div class="card riga" style="gap:14px;justify-content:flex-start">${anello(p, p >= 60 ? GR : OR, 76)}<div><div class="s">Consigli delle partite finite</div><div style="font-size:20px;font-weight:600">${ok} su ${val.length} azzeccati</div><div class="s">${ris.length - val.length} non validi (giocatore fermo o dato mancante)</div></div></div>`;
    const cat = ls.get("esCat", null), sel = cat != null ? SC[cat] : null;
    h += `<div class="grid2">${SC.map(([t, , tipi], i) => { const v = val.filter((x) => tipi.includes(x.tipo)); return v.length ? `<div data-ec="${i}" style="cursor:pointer;${cat === i ? "outline:1px solid " + OR + ";border-radius:16px" : ""}">${barraPerc(t, v.filter((x) => x.esito === 1).length, v.length)}</div>` : ""; }).join("")}</div>`;
    if (sel) {
      const l = val.filter((x) => sel[2].includes(x.tipo)).sort((a, b) => b.prob - a.prob);
      h += `<h2>${esc(sel[0])} (${l.length})</h2><div class="cap" style="margin-top:0">Tutte le giocate della categoria, dalla più probabile. <a href="#" id="tutte" style="color:${OR}">Mostra tutto</a></div>` + l.map(rigaEsito).join("");
    } else
    for (const [t, c] of [["Azzeccati", 1], ["Sbagliati", 0]]) { const l = val.filter((x) => x.esito === c); if (l.length) h += `<h2>${t} (${l.length})</h2>` + l.map(rigaEsito).join(""); }
    const nulli = ris.filter((x) => x.esito === 2);
    if (nulli.length) h += `<details><summary>Non validi (${nulli.length})</summary>${nulli.map(rigaEsito).join("")}</details>`;
    h += riquadroTabellini(ris) + `<div class="cap">I consigli sono ricalcolati con le statistiche attuali. Per il registro vero guarda «Storico».</div>`;
  }
  APP.innerHTML = h; bindGiorni();
  APP.querySelectorAll("[data-ec]").forEach((el) => el.onclick = () => { const i = +el.dataset.ec; ls.set("esCat", ls.get("esCat", null) === i ? null : i); vistaEsiti(); });
  const tt = $("#tutte"); if (tt) tt.onclick = (e) => { e.preventDefault(); ls.set("esCat", null); vistaEsiti(); };
}
async function vistaStorico() {
  APP.innerHTML = topBar() + skel();
  let S; try { S = await api("/api/storico", 0); } catch (e) { APP.innerHTML = topBar() + errBox(e); return; }
  let h = topBar();
  if (!S.attivo) h += `<div class="vuoto">Il registro non è ancora attivo: servono i segreti SUPABASE_URL e SUPABASE_KEY nel progetto Cloudflare.</div>`;
  else {
    const val = S.righe.filter((r) => r.esito === 0 || r.esito === 1), att = S.righe.filter((r) => r.esito == null).length;
    if (!val.length) h += `<div class="vuoto">Nessun esito ancora: ${S.righe.length} consigli salvati, ${att} in attesa che le partite finiscano. Apri l'app prima delle partite e dopo la fine.</div>`;
    else {
      const ok = val.filter((r) => r.esito === 1).length, p = ok / val.length * 100, at = val.reduce((a, r) => a + r.prob, 0) / val.length;
      h += `<div class="card riga" style="gap:14px;justify-content:flex-start">${anello(p, p >= 60 ? GR : OR, 76)}<div><div class="s">Storico dei consigli salvati</div><div style="font-size:20px;font-weight:600">${ok} su ${val.length} azzeccati</div><div class="s">Il modello prevedeva in media il ${pct(at)} · ${att} in attesa</div></div></div>`;
      const sub = (l) => [l.filter((r) => r.esito === 1).length, l.length, l.reduce((a, r) => a + r.prob, 0) / l.length];
      h += `<h2>Per categoria</h2><div class="grid2">${SC.map(([t, , tipi]) => { const l = val.filter((r) => tipi.includes(r.tipo)); return l.length ? barraPerc(t, ...sub(l)) : ""; }).join("")}</div>`;
      h += `<h2>Calibrazione</h2><div class="grid2">${[[0.7, 0.75, "70-75%"], [0.75, 0.8, "75-80%"], [0.8, 0.85, "80-85%"], [0.85, 1.01, "85% e oltre"]].map(([a, b, n]) => { const l = val.filter((r) => r.prob >= a && r.prob < b); return l.length ? barraPerc(n, ...sub(l)) : ""; }).join("")}</div><div class="cap">Se in una fascia la percentuale reale è molto più bassa di quella prevista, il modello è troppo ottimista lì.</div>`;
      h += `<h2>Esiti per giornata</h2>` + perGiornata(val.map((r) => ({ r })), ({ r }) => rigaEsito(r));
    }
  }
  h += riquadroTabellini((S.righe || []).filter((r) => r.esito === 0 || r.esito === 1).slice(0, 80)) + precisioneModello(S) + schedineStorico(S);
  h += `<div class="cap" style="text-align:center;margin-top:14px"><a href="#/registro" style="color:${OR}"><i class="ti ti-notebook"></i> Il mio registro</a> &nbsp;·&nbsp; <a href="#/calcolatore" style="color:${OR}"><i class="ti ti-calculator"></i> Calcolatore</a> &nbsp;·&nbsp; <a href="#/impostazioni" style="color:${OR}"><i class="ti ti-settings"></i> Impostazioni</a></div>`;
  h += `<div class="cap" style="text-align:center;margin-top:18px"><a href="#/diag" style="color:${OR}"><i class="ti ti-stethoscope"></i> Controllo dei dati</a></div>`;
  APP.innerHTML = h;
}

async function vistaDiag() {
  APP.innerHTML = topBar() + skel();
  let D; try { D = await api("/api/diag", 0); } catch (e) { APP.innerHTML = topBar() + errBox(e); return; }
  const v = D.controlli || D.voci || [];
  let h = topBar() + `<h2>Controllo dei dati</h2><div class="cap" style="margin-top:0">Verifica una per una le fonti usate dall'app. Se una voce è rossa, il motivo è scritto sotto.</div>`;
  h += v.map((x) => `<div class="card"><div class="riga"><b>${esc(x.nome)}</b><span class="pill" style="color:${x.ok ? GR : RD}">${x.ok ? "OK" : "Errore"}</span></div><div class="s" style="margin-top:4px">${esc(x.dettaglio)}</div></div>`).join("");
  h += `<div class="cap">Versione dell'app sul telefono: ${VERSIONE}.</div><div class="cap">Controllato alle ${esc(new Date(D.ora || D.aggiornato || Date.now()).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }))}. <a href="#/diag" onclick="route(true);return false" style="color:${OR}">Ricontrolla</a></div>`;
  APP.innerHTML = h;
}

// ---------- router
let timer = null;
function route(force) {
  clearTimeout(timer); barraMia();
  const hsh = location.hash.replace(/^#/, "") || "/";
  const attivo = hsh.startsWith("/live") ? "live" : hsh.startsWith("/schedine") ? "schedine" : hsh.startsWith("/combo") || hsh.startsWith("/categoria") || hsh.startsWith("/mia") ? "consigli" : hsh.startsWith("/esiti") || hsh.startsWith("/storico") || hsh.startsWith("/conto") ? "storico" : hsh.startsWith("/diag") || hsh.startsWith("/registro") || hsh.startsWith("/impostazioni") ? "storico" : "partite";
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("on", a.dataset.r === attivo));
  const cat = /^\/categoria\/(\d+)/.exec(hsh), m = /^\/partita\/(\d+)/.exec(hsh), gp = /^\/giocatore\/(\d+)/.exec(hsh);
  if (hsh.startsWith("/impostazioni")) vistaImpostazioni();
  else if (hsh.startsWith("/calcolatore")) vistaCalcolatore();
  else if (hsh.startsWith("/registro")) vistaRegistro();
  else if (hsh.startsWith("/conto")) vistaConto();
  else if (gp) vistaGiocatore(gp[1]);
  else if (m) vistaStudio(m[1], force === true);
  else if (attivo === "live") vistaLive(true);
  else if (attivo === "schedine") vistaSchedine(force === true);
  else if (hsh.startsWith("/mia")) vistaMia();
  else if (cat) vistaCategoria(+cat[1]);
  else if (hsh.startsWith("/combo")) vistaCombo(force === true);
  else if (attivo === "esiti") vistaEsiti();
  else if (hsh.startsWith("/diag")) vistaDiag();
  else if (attivo === "storico") vistaStorico();
  else vistaPartite(force === true);
  if (!m && !gp) window.scrollTo(0, 0);
}
window.route = route;
window.addEventListener("hashchange", () => route());
// Al ritorno nell'app non si ricarica la pagina: la pagina Partite si aggiorna in silenzio (senza tornare in cima), il Live riprende subito
let ultimoNascosto = Date.now();
document.addEventListener("visibilitychange", async () => {
  if (document.hidden) { ultimoNascosto = Date.now(); return; }
  const h = location.hash.replace(/^#/, "") || "/";
  aggiornaRegistro();
  if (h.startsWith("/live")) { clearTimeout(timer); vistaLive(false); return; }
  if (h === "/" && Date.now() - ultimoNascosto > 30000) {
    try {
      const D = await dati(true);
      if ((location.hash.replace(/^#/, "") || "/") !== "/") return;
      if (firmaDati(D) === firmaHome) return; // niente è cambiato: non ridisegnare
      clearTimeout(timer); const y = window.scrollY; disegnaPartite(D, true); window.scrollTo(0, y);
    } catch {}
  }
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
// Se il telefono chiude la pagina in secondo piano e la riapre da zero, si torna dove eri (pagina e posizione) entro 30 minuti
const salvaPosizione = () => ls.set("ult", { h: location.hash, y: window.scrollY, t: Date.now() });
document.addEventListener("visibilitychange", () => { if (document.hidden) salvaPosizione(); });
window.addEventListener("pagehide", salvaPosizione);
let ripristinaY = null;
{ const u = ls.get("ult", null); if (u && Date.now() - u.t < 30 * 60000 && (!location.hash || location.hash === "#/") && u.h && u.h !== "#/") { location.hash = u.h; ripristinaY = u.y; } else if (u && Date.now() - u.t < 30 * 60000 && (!location.hash || location.hash === "#/")) ripristinaY = u.y; }
route();
setTimeout(() => { aggiornaRegistro(); sincPref(); }, 2500);
if (ripristinaY) for (const ms of [500, 1200, 2500]) setTimeout(() => window.scrollTo(0, ripristinaY), ms);
