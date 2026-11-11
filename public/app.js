"use strict";
const $ = (s, r = document) => r.querySelector(s);
const APP = $("#app");
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const OR = "#ff8a2a", GR = "#3ddc84", RD = "#ff5d5d", AM = "#ffb066", MU = "#8b93a5";
const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const GIORNI = [["Ieri", -1], ["Oggi", 0], ["Domani", 1], ["Dopodomani", 2]];
const MERC = { Punti: { k: "pts", u: "pt" }, Rimbalzi: { k: "reb", u: "rimb." }, Assist: { k: "ast", u: "ass." } };
const SC = [["Squadre e totali", "ti-chart-bar", ["Vincente", "Squadra", "Totale"]], ["Punti", "ti-target", ["Punti"]], ["Assist", "ti-users", ["Assist"]], ["Rimbalzi", "ti-arrows-up-down", ["Rimbalzi"]]];

// ---------- matematica
function erf(x) { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
const phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
const pct = (p) => Math.round(p * 100) + "%";

// ---------- dati
let giorno = ls.get("giorno", 0);
if (typeof giorno !== "number" && !/^\d{8}$/.test(String(giorno))) giorno = 0;
const cache = {};
async function api(path, ttl = 0) {
  const c = cache[path];
  if (c && Date.now() - c.t < ttl) return c.d;
  const r = await fetch(path);
  const d = await r.json();
  if (!r.ok || d.errore) throw new Error(d.errore || "Errore " + r.status);
  cache[path] = { t: Date.now(), d };
  return d;
}
const qs = () => "d=" + (typeof giorno === "number" ? etGiorno(giorno).ymd : giorno);
const dati = (force) => { if (force) delete cache["/api/giorno?" + qs()]; return api("/api/giorno?" + qs(), 40000); };

// ---------- pezzi grafici
const T = (D, ab) => (D.squadre && D.squadre[ab]) || { n: ab, b: ab, c: "#4a5060" };
const logo = (ab, s = 38) => `<img class="tl" style="width:${s}px;height:${s}px" loading="lazy" alt="" src="https://a.espncdn.com/i/teamlogos/nba/500/${esc(String(ab).toLowerCase())}.png" onerror="this.style.visibility='hidden'">`;
const foto = (pid, s = 46) => pid ? `<img class="ph" style="width:${s}px;height:${s}px" loading="lazy" alt="" src="https://a.espncdn.com/i/headshots/nba/players/full/${esc(pid)}.png" onerror="this.style.visibility='hidden'">` : `<span class="ph" style="width:${s}px;height:${s}px;display:inline-block"></span>`;
function anello(p, col, size = 52) {
  const r = size / 2 - 5, L = 2 * Math.PI * r, c = size / 2;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#232836" stroke-width="6"/><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${col}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(L * p / 100).toFixed(1)} ${L.toFixed(1)}" transform="rotate(-90 ${c} ${c})"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" fill="#f2f2f2" font-size="${size > 60 ? 18 : 13}" font-weight="600">${Math.round(p)}%</text></svg>`;
}
const colProb = (p) => (p >= 0.85 ? "#3ddc84" : p >= 0.78 ? "#9be564" : p >= 0.72 ? "#ffc24a" : OR);
function cardPick(x) { return `<div class="card cardp"><div style="min-width:0"><div class="s">${esc(x.partita)} · ${esc(x.tipo)}</div><div style="font-weight:500">${esc(x.testo)}</div></div><div><div class="v" style="color:${colProb(x.prob)}">${pct(x.prob)}</div><div class="e">stima ${esc(x.stima)}</div></div></div>`; }
function rigaPick(D, x) {
  const vis = x.pid ? foto(x.pid, 34) : x.squadra ? logo(x.squadra, 30) : `<span class="ph" style="width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center"><i class="ti ti-chart-bar" style="color:${OR}"></i></span>`;
  return `<div class="pick">${anello(x.prob * 100, colProb(x.prob), 48)}${vis}<div style="min-width:0"><div class="t">${esc(x.testo)}</div><div class="s">${esc(x.partita)}</div></div></div>`;
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
  let chips = `<span class="chip">Totale ${r.totale.toFixed(1)}</span><span class="chip">Spread ${esc(T(D, fav).b)} -${Math.abs(r.margine).toFixed(1)}</span>`;
  if (topPick) chips += `<span class="chip" style="color:${GR}">Top: ${esc(topPick.testo)} · ${pct(topPick.prob)}</span>`;
  for (const s of [p.casa, p.trasf]) if ((D.b2b || []).includes(s)) chips += `<span class="chip" style="color:${AM}">${esc(T(D, s).b)} back-to-back</span>`;
  const tag = cliccabile ? "a" : "div", href = cliccabile ? ` href="#/partita/${p.id}"` : "";
  return `<${tag} class="card gm${p.stato === "in" ? " inlive" : ""}"${href} data-gid="${p.id}" data-st="${p.stato}" style="--ca:${ct};--cb:${cc}">
  <div class="riga" style="margin-bottom:10px"><span class="pill" data-pill style="color:${col}">${chip}</span>${cliccabile ? `<span class="s">Studia <i class="ti ti-chevron-right"></i></span>` : ""}</div>
  <div class="mu">${team(p.trasf, "trasferta", r.ptTr)}${centro}${team(p.casa, "casa", r.ptCasa)}</div>
  <div class="bar"><div style="width:${((1 - r.pw) * 100).toFixed(0)}%;background:${ct}"></div><div style="flex:1;background:${cc}"></div></div>
  <div class="riga s" style="margin:4px 0 10px"><span><b style="color:#e8eaf0">${pct(1 - r.pw)}</b> ${esc(p.trasf)}</span><span>probabilità di vittoria</span><span>${esc(p.casa)} <b style="color:#e8eaf0">${pct(r.pw)}</b></span></div>${chips}</${tag}>`;
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
function hero(D) {
  const n = D.partite.length; if (!n) return "";
  const live = D.partite.filter((p) => p.stato === "in").length, fin = D.partite.filter((p) => p.stato === "post").length, pre = n - live - fin;
  const top = D.picks.find((x) => D.partite.find((p) => p.id === x.g && p.stato === "pre")) || D.picks[0];
  return `<div class="hero"><div class="hn">${n}</div><div style="min-width:0"><div class="ht">${n === 1 ? "partita" : "partite"} in programma</div><div class="s">${live ? `<span class="dot"></span>${live} in corso · ` : ""}${pre} da giocare · ${fin} finite</div>${top ? `<div class="htop"><i class="ti ti-star-filled"></i> ${esc(top.testo)} <b>${pct(top.prob)}</b></div>` : ""}</div></div>`;
}
// punteggi che si aggiornano da soli (ogni 10 secondi) quando ci sono partite in corso o vicine all'inizio
function seguiPunteggi(D) {
  const ora = Date.now(), vicine = D.partite.some((p) => p.stato === "pre" && p.iso && Date.parse(p.iso) - ora < 15 * 60000);
  if (!D.partite.some((p) => p.stato === "in") && !vicine) return;
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
      }
      for (const p of D.partite) if (p.stato === "in" && !vive.has(p.id)) cambio = true;
      if (cambio) return route(true);
    } catch {}
    timer = setTimeout(giro, 10000);
  };
  timer = setTimeout(giro, 10000);
}
async function vistaPartite(force) {
  APP.innerHTML = topBar() + giorniChips() + skel(); bindGiorni();
  let D; try { D = await dati(force); } catch (e) { APP.innerHTML = topBar() + giorniChips() + errBox(e); bindGiorni(); return; }
  const top = (id) => D.picks.find((x) => x.g === id);
  let h = topBar(D) + giorniChips();
  if (!D.partite.length) h += `<div class="vuoto">Nessuna partita trovata per questo giorno. Prova un altro giorno.</div>`;
  if (D.partite.length && !D.partite.some((p) => p.giocatori && p.giocatori.length)) h += `<div class="card" style="border-color:${RD}"><b style="color:${RD}">Giocatori non disponibili</b><div class="s" style="margin-top:4px">${esc((D.diag || []).filter((x) => /giocatori/.test(x)).join(" · ") || "ESPN non ha restituito le statistiche dei giocatori.")}</div></div>`;
  h += hero(D);
  h += migliori(D);
  h += confrontoMercato(D);
  if (D.partite.length) h += `<h2>Tutte le partite</h2>`;
  h += D.partite.map((p) => schedaPartita(D, p, top(p.id), true)).join("");
  if (D.ieri.length) {
    h += `<h2>Risultati di ieri</h2>` + D.ieri.map((p) => `<div class="card"><div class="riga"><div class="lg">${logo(p.trasf, 28)}<b>${esc(p.trasf)}</b></div><b style="font-size:18px">${p.ptTr} - ${p.ptCasa}</b><div class="lg"><b>${esc(p.casa)}</b>${logo(p.casa, 28)}</div></div></div>`).join("");
  }
  h += `<button class="btn" id="agg"><i class="ti ti-refresh"></i> Aggiorna ora</button>`;
  APP.innerHTML = h; bindGiorni(); $("#agg").onclick = () => route(true);
  seguiPunteggi(D);
}

// ---------- SCHEDINE
const TONI = { ok: [GR, "ti-shield-check"], mid: [OR, "ti-scale"], alta: [RD, "ti-flame"] };
function testoSchedina(s) { return `${s.nome} (${s.legs.length} giocate, probabilità unita ${pct(s.prob)})\n` + s.legs.map((l) => `• ${l.testo} (${l.partita}) ${pct(l.prob)}`).join("\n"); }
function cardSchedina(s) {
  const [col, ic] = TONI[s.tono] || [OR, "ti-ticket"];
  return `<div class="card sch" style="border-top:3px solid ${col}"><div class="riga" style="align-items:flex-start"><div><div class="sn"><i class="ti ${ic}" style="color:${col}"></i> ${esc(s.nome)}</div><div class="s">${esc(s.sotto)}</div></div><div style="text-align:right"><div class="sp" style="color:${col}">${pct(s.prob)}</div><div class="s">tutte centrate</div></div></div>
  <div style="margin:10px 0 4px">${s.legs.map((l) => `<div class="leg">${l.pid ? foto(l.pid, 32) : l.squadra ? logo(l.squadra, 28) : `<span class="ph" style="width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center"><i class="ti ti-chart-bar" style="color:${OR}"></i></span>`}<div style="min-width:0;flex:1"><div style="font-weight:600">${esc(l.testo)}</div><div class="s">${esc(l.partita)} · ${esc(l.ora)}</div></div><b style="color:${colProb(l.prob)}">${pct(l.prob)}</b></div>`).join("")}</div>
  <div class="s" style="line-height:1.5">Quota giusta per questa probabilità: <b style="color:#f2f2f2">${s.quotaEqua.toFixed(2)}</b>. Ha senso solo se il tuo bookmaker ne offre di più.${s.stessaPartita ? ` <span style="color:${AM}">Alcune giocate sono della stessa partita, quindi la probabilità reale è diversa.</span>` : ""}</div>
  <button class="btn cp" data-cp="${esc(testoSchedina(s))}" style="margin:10px 0 0"><i class="ti ti-copy"></i> Copia la schedina</button></div>`;
}
async function vistaSchedine(force) {
  APP.innerHTML = topBar() + giorniChips() + skel(); bindGiorni();
  let D; try { D = await dati(force); } catch (e) { APP.innerHTML = topBar() + giorniChips() + errBox(e); bindGiorni(); return; }
  let h = topBar(D) + giorniChips();
  const sc = D.schedine || [];
  h += `<div class="cap" style="margin-top:0">Proposte costruite dall'app con le giocate più probabili del giorno, una sola per partita. Sono stime del modello: nessuna schedina è sicura.</div>`;
  if (!sc.length) h += `<div class="vuoto">Per questo giorno non ci sono abbastanza partite da giocare o giocate sopra la soglia. Le proposte compaiono prima dell'inizio delle partite.</div>`;
  h += sc.map(cardSchedina).join("");
  const singola = D.picks.find((x) => D.partite.find((p) => p.id === x.g && p.stato === "pre"));
  if (singola) h += `<h2>Singola del giorno</h2><div class="card riga" style="gap:12px;border-top:3px solid ${GR}">${anello(singola.prob * 100, colProb(singola.prob), 64)}<div style="min-width:0;flex:1"><div style="font-weight:600;font-size:16px">${esc(singola.testo)}</div><div class="s">${esc(singola.partita)} · stima ${esc(singola.stima)}</div></div></div><div class="cap">${esc(singola.motivo)}</div>`;
  h += `<div class="cap">Più giocate unisci, meno la schedina è probabile: tre giocate al 80% insieme valgono circa il 51%.</div>`;
  APP.innerHTML = h; bindGiorni();
  APP.querySelectorAll(".cp").forEach((b) => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.cp); b.innerHTML = `<i class="ti ti-check"></i> Copiata`; } catch { b.textContent = "Copia non riuscita"; } });
}

// ---------- COMBO
async function vistaCombo(force) {
  APP.innerHTML = topBar() + giorniChips() + skel(); bindGiorni();
  let D; try { D = await dati(force); } catch (e) { APP.innerHTML = topBar() + giorniChips() + errBox(e); bindGiorni(); return; }
  const gruppi = SC.map(([t, ic, tipi]) => [t, ic, D.picks.filter((x) => tipi.includes(x.tipo))]);
  const scelte = gruppi.map((g) => g[2][0]).filter(Boolean);
  let h = topBar(D) + giorniChips();
  if (scelte.length) { const c = scelte.reduce((a, x) => a * x.prob, 1); h += `<div class="card riga" style="gap:14px;justify-content:flex-start">${anello(c * 100, OR, 76)}<div><div class="s">I primi di ogni riquadro, insieme</div><div style="font-weight:600;font-size:15px">Meglio non esagerare</div><div class="s">Stima con eventi indipendenti: più giocate unisci, meno è probabile.</div></div></div>`; }
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
      h += `<div class="card box"><h3><i class="ti ${ic}"></i>${esc(t)}</h3>${l.slice(0, 3).map((x) => rigaPick(D, x)).join("")}</div>`;
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
function schedaGiocatore(D, gid, x, mer, c) {
  const o = x[c.k], dub = x.inf === "dubbio" ? `<span class="pill" style="color:${AM};margin-left:6px">Dubbio</span>` : "";
  const tile = (n, v, on) => `<div class="tile${on ? " on" : ""}"><b>${v.toFixed(1)}</b><span>${n}</span></div>`;
  const rec = o.rec != null ? `<div style="margin-top:10px"><span class="s">CONSIGLIATO</span><div style="font-weight:600;color:${GR}">over ${o.rec} ${c.u} · ${pct(o.lad.find((q) => q[0] === o.rec)[1])}</div></div>` : `<div class="s" style="margin-top:10px">Nessuna soglia sopra il 70%: giocatore poco sicuro.</div>`;
  const lad = o.lad.map(([t, pr]) => { const col = pr >= 0.7 ? GR : pr >= 0.5 ? AM : MU; return `<span style="color:${col};${t === o.rec ? "border:1px solid " + col : ""}">over ${t} · ${pct(pr)}</span>`; }).join("");
  const key = `${gid}_${x.pid || x.nome}_${mer}`;
  return `<div class="card pl"><div class="lg">${foto(x.pid, 48)}<div style="min-width:0"><div class="tn">${esc(x.nome)}${dub}</div><div class="s">${esc(x.sq)} · ${Math.round(x.min)} min attesi</div></div></div>
  <div class="row3">${tile("Punti", x.pts.v, mer === "Punti")}${tile("Rimbalzi", x.reb.v, mer === "Rimbalzi")}${tile("Assist", x.ast.v, mer === "Assist")}</div>${rec}${quoteGioc(o, c)}${formaHtml(x, mer, c, o)}
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
  const tm = (ab, ruolo) => `<div class="tm">${logo(ab, 54)}<div class="tn">${esc(T(D, ab).b)}</div><div class="s">${ruolo}</div></div>`;
  return `<div class="card gm inlive" style="--ca:${ct};--cb:${cc}"><div class="riga" style="margin-bottom:10px"><span class="pill" style="color:${OR}"><span class="dot"></span>Live · ${esc(p.dettaglio)}</span><span class="s">Giocata al ${Math.round(p.f * 100)}%</span></div>
  <div class="mu">${tm(p.trasf, "trasferta")}<div class="mid"><div class="sc"><span class="big liveN">${p.ptTr}</span><i>-</i><span class="big liveN">${p.ptCasa}</span></div></div>${tm(p.casa, "casa")}</div>
  <div class="bar" style="height:4px"><div style="width:${(p.f * 100).toFixed(0)}%;background:${OR}"></div></div>
  <div class="s" style="margin:10px 0 0">Probabilità di vittoria in questo momento</div><div class="bar"><div style="width:${((1 - p.pwLive) * 100).toFixed(0)}%;background:${ct}"></div><div style="flex:1;background:${cc}"></div></div>
  <div class="riga s" style="margin:4px 0 8px"><span>${esc(p.trasf)} ${pct(1 - p.pwLive)}</span><span>${esc(p.casa)} ${pct(p.pwLive)}</span></div>
  <span class="chip">Totale ora ${p.ptCasa + p.ptTr}</span><span class="chip">Finale stimato ${p.proiTot.toFixed(0)}</span><span class="chip">Prima della gara ${p.r.totale.toFixed(0)}</span>${p.mercato ? `<span class="chip" style="color:${AM}">Bookmaker ${p.mercato.linea}: over ${pct(p.mercato.pMk)} (${p.mercato.minuti} min fa)</span><span class="chip" style="color:${colProb(Math.max(p.mercato.pNostra, 1 - p.mercato.pNostra))}">Nostra stima: ${p.mercato.pNostra >= 0.5 ? "over" : "under"} ${pct(Math.max(p.mercato.pNostra, 1 - p.mercato.pNostra))}</span>` : ""}</div>`;
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
async function vistaLive(primo = true) {
  if (primo) APP.innerHTML = topBar() + skel();
  let D; try { D = await api("/api/live", 3000); } catch (e) { if (primo) APP.innerHTML = topBar() + errBox(e); timer = setTimeout(() => location.hash.startsWith("#/live") && vistaLive(false), 20000); return; }
  if (!location.hash.startsWith("#/live")) return;
  let h = topBar(D) + `<div class="cap" style="margin-top:0">Si aggiorna da solo ogni 6 secondi (ESPN pubblica i dati ogni 10-20 secondi circa). Le probabilità tengono conto di punteggio, tempo rimasto e minuti giocati.</div>`;
  if (!D.partite.length) {
    h += `<div class="vuoto"><b>Nessuna partita in corso.</b><br>Oggi: ${D.totali} partite, ${D.finite} finite.</div>`;
    if (D.prossime.length) h += `<h2>Prossime partite</h2>` + D.prossime.map((q) => `<a class="card riga" href="#/partita/${q.id}"><div class="lg">${logo(q.trasf, 28)}<b>${esc(q.trasf)}</b><span class="s">@</span>${logo(q.casa, 28)}<b>${esc(q.casa)}</b></div><span class="s">${esc(q.ora)}</span></a>`).join("");
  }
  for (const p of D.partite) {
    h += schedaLive(D, p);
    if (p.segnali && p.segnali.length) h += `<div class="sub"><span class="pill" style="color:${OR}"><span class="dot"></span>Segnali live</span> <span class="s">nati durante la partita</span></div>` + p.segnali.map(rigaSegnale).join("");
    const picks = [...p.picks].sort((a, b) => (a.pLive >= 0.995) - (b.pLive >= 0.995) || b.pLive - a.pLive);
    if (picks.length) h += `<div class="sub">Giocate di questa partita</div>` + picks.map(rigaLive).join("");
    if (p.giocatori.length) {
      const tab = (sq) => { const l = p.giocatori.filter((g) => g.sq === sq); if (!l.length) return ""; const rg = (g) => `<div class="riga rg"><span style="min-width:0">${esc(g.nome)}</span><b style="white-space:nowrap">${g.pts ?? 0} · ${g.reb ?? 0} · ${g.ast ?? 0} · ${Math.round(g.min ?? 0)}</b></div>`;
        const tit = l.filter((g) => g.tit), pan = l.filter((g) => !g.tit);
        return `<div class="card"><div class="riga" style="padding-bottom:4px"><div class="lg">${logo(sq, 24)}<b>${esc(T(D, sq).n)}</b></div><span class="s">PT · RIM · AST · MIN</span></div>${tit.length ? `<div class="s" style="padding:4px 0">QUINTETTO BASE</div>` + tit.map(rg).join("") : ""}${pan.length ? `<div class="s" style="padding:8px 0 4px">PANCHINA</div>` + pan.map(rg).join("") : ""}</div>`; };
      h += `<div class="sub">Formazioni e statistiche</div>` + tab(p.trasf) + tab(p.casa);
    }
    h += `<a class="btn" style="display:block;text-align:center" href="#/partita/${p.id}">Apri lo studio di questa partita</a>`;
  }
  const y = window.scrollY; APP.innerHTML = h; window.scrollTo(0, y);
  timer = setTimeout(() => !document.hidden && location.hash.startsWith("#/live") && vistaLive(false), 6000);
}

// ---------- ESITI e STORICO
function barraPerc(t, k, n, att) { const p = n ? k / n * 100 : 0; return `<div class="card pc"><div class="s">${esc(t)}</div><b>${k}/${n}</b> <span class="s">(${p.toFixed(0)}%${att != null ? " · previsto " + pct(att) : ""})</span><div class="mini"><i style="width:${p.toFixed(0)}%;background:${p >= 60 ? GR : RD}"></i></div></div>`; }
function rigaEsito(r) {
  const [s, c] = { 1: ["✓", GR], 0: ["✗", RD], 2: ["–", MU] }[r.esito];
  return `<div class="card riga" style="padding:10px 12px;gap:10px;justify-content:flex-start"><div style="width:28px;height:28px;border-radius:50%;background:${c}22;color:${c};display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">${s}</div><div style="min-width:0;flex:1"><div style="font-weight:500">${esc(r.testo)}</div><div class="s">${esc(r.partita)} · ${esc(r.dettaglio || "")}</div></div><div class="s">${pct(r.prob)}</div></div>`;
}
async function vistaEsiti() {
  APP.innerHTML = topBar() + giorniChips() + skel(); bindGiorni();
  let E; try { E = await api("/api/esiti?" + qs(), 60000); } catch (e) { APP.innerHTML = topBar() + giorniChips() + errBox(e); bindGiorni(); return; }
  const ris = E.risultati, val = ris.filter((x) => x.esito !== 2);
  let h = topBar() + giorniChips();
  if (!val.length) h += `<div class="vuoto">Nessuna partita finita da verificare per questo giorno. Torna a partite concluse.</div>`;
  else {
    const ok = val.filter((x) => x.esito === 1).length, p = ok / val.length * 100;
    h += `<div class="card riga" style="gap:14px;justify-content:flex-start">${anello(p, p >= 60 ? GR : OR, 76)}<div><div class="s">Consigli delle partite finite</div><div style="font-size:20px;font-weight:600">${ok} su ${val.length} azzeccati</div><div class="s">${ris.length - val.length} non validi (giocatore fermo o dato mancante)</div></div></div>`;
    h += `<div class="grid2">${SC.map(([t, , tipi]) => { const v = val.filter((x) => tipi.includes(x.tipo)); return v.length ? barraPerc(t, v.filter((x) => x.esito === 1).length, v.length) : ""; }).join("")}</div>`;
    for (const [t, c] of [["Azzeccati", 1], ["Sbagliati", 0]]) { const l = val.filter((x) => x.esito === c); if (l.length) h += `<h2>${t} (${l.length})</h2>` + l.map(rigaEsito).join(""); }
    const nulli = ris.filter((x) => x.esito === 2);
    if (nulli.length) h += `<details><summary>Non validi (${nulli.length})</summary>${nulli.map(rigaEsito).join("")}</details>`;
    h += `<div class="cap">I consigli sono ricalcolati con le statistiche attuali. Per il registro vero guarda «Storico».</div>`;
  }
  APP.innerHTML = h; bindGiorni();
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
      h += `<h2>Ultimi esiti</h2>` + val.slice(0, 30).map(rigaEsito).join("");
    }
  }
  h += `<div class="cap" style="text-align:center;margin-top:18px"><a href="#/diag" style="color:${OR}"><i class="ti ti-stethoscope"></i> Controllo dei dati</a></div>`;
  APP.innerHTML = h;
}

async function vistaDiag() {
  APP.innerHTML = topBar() + skel();
  let D; try { D = await api("/api/diag", 0); } catch (e) { APP.innerHTML = topBar() + errBox(e); return; }
  const v = D.controlli || D.voci || [];
  let h = topBar() + `<h2>Controllo dei dati</h2><div class="cap" style="margin-top:0">Verifica una per una le fonti usate dall'app. Se una voce è rossa, il motivo è scritto sotto.</div>`;
  h += v.map((x) => `<div class="card"><div class="riga"><b>${esc(x.nome)}</b><span class="pill" style="color:${x.ok ? GR : RD}">${x.ok ? "OK" : "Errore"}</span></div><div class="s" style="margin-top:4px">${esc(x.dettaglio)}</div></div>`).join("");
  h += `<div class="cap">Controllato alle ${esc(new Date(D.ora || D.aggiornato || Date.now()).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }))}. <a href="#/diag" onclick="route(true);return false" style="color:${OR}">Ricontrolla</a></div>`;
  APP.innerHTML = h;
}

// ---------- router
let timer = null;
function route(force) {
  clearTimeout(timer);
  const hsh = location.hash.replace(/^#/, "") || "/";
  const attivo = hsh.startsWith("/live") ? "live" : hsh.startsWith("/schedine") ? "schedine" : hsh.startsWith("/combo") ? "partite" : hsh.startsWith("/esiti") ? "esiti" : hsh.startsWith("/storico") ? "storico" : hsh.startsWith("/diag") ? "storico" : "partite";
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("on", a.dataset.r === attivo));
  const m = /^\/partita\/(\d+)/.exec(hsh);
  if (m) vistaStudio(m[1], force === true);
  else if (attivo === "live") vistaLive(true);
  else if (attivo === "schedine") vistaSchedine(force === true);
  else if (hsh.startsWith("/combo")) vistaCombo(force === true);
  else if (attivo === "esiti") vistaEsiti();
  else if (hsh.startsWith("/diag")) vistaDiag();
  else if (attivo === "storico") vistaStorico();
  else vistaPartite(force === true);
  if (!m) window.scrollTo(0, 0);
}
window.route = route;
window.addEventListener("hashchange", () => route());
document.addEventListener("visibilitychange", () => { if (!document.hidden && !location.hash.startsWith("#/partita")) route(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
route();
