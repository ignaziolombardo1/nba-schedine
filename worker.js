import { info, nome } from "./squadre.js";
import { proiettaPartita, proiettaGiocatori, consigli, valuta, phi, STD, frazioneGara, probLive, segnaliLive } from "./modello.js";
import { caricaGiorno, caricaStatistiche, caricaInfortuni, caricaBoxscore, caricaUltime, caricaGamelog, dataUS, get } from "./espn.js";

const J = (o, ttl = 0) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": ttl ? `public, max-age=${ttl}` : "no-store", "access-control-allow-origin": "*" } });
const ERR = (m, s = 500) => new Response(JSON.stringify({ errore: m }), { status: s, headers: { "content-type": "application/json" } });

// ---- Supabase (secrets SUPABASE_URL e SUPABASE_KEY)
const dbOk = (env) => !!(env.SUPABASE_URL && env.SUPABASE_KEY);
async function db(env, metodo, { params, corpo, prefer, tabella = "nba_consigli" } = {}) {
  const u = new URL(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${tabella}`);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  const h = { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, "Content-Type": "application/json" };
  if (prefer) h.Prefer = prefer;
  const r = await fetch(u.toString(), { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined });
  if (!r.ok) throw new Error(`Supabase ${r.status} ${(await r.text()).slice(0, 120)}`);
  const t = await r.text(); return t ? JSON.parse(t) : [];
}

function costruisci(partite, teams, players, infortuni, b2b, forma = {}) {
  const out = [];
  for (const p of partite) {
    if (!teams[p.casa] || !teams[p.trasf]) continue;
    const r = proiettaPartita(p.casa, p.trasf, teams, b2b);
    const giocatori = players.length ? [...proiettaGiocatori(p.casa, p.trasf, teams, players, infortuni, forma, r.margine), ...proiettaGiocatori(p.trasf, p.casa, teams, players, infortuni, forma, -r.margine)] : [];
    const inf = players.filter((q) => (q.sq === p.casa || q.sq === p.trasf) && q.min >= 20 && infortuni[q.nome.trim().toLowerCase()])
      .map((q) => ({ nome: q.nome, sq: q.sq, ...infortuni[q.nome.trim().toLowerCase()] }));
    out.push({ ...p, r, giocatori, inf });
  }
  return out;
}


async function leggiForma(env) {
  if (!dbOk(env)) return { mappa: {}, stato: null };
  try {
    const righe = await db(env, "GET", { tabella: "nba_forma", params: { select: "pid,dati,agg", limit: "3000" } });
    const mappa = {}; let stato = null;
    for (const r of righe) { if (r.pid === "_stato") stato = r.dati; else mappa[r.pid] = r.dati; }
    return { mappa, stato, n: Object.keys(mappa).length };
  } catch (e) { return { mappa: {}, stato: null, errore: e.message }; }
}

// Ogni 30 minuti (cron): aggiorna la forma recente dei giocatori che giocano oggi e domani. Pochi per volta per restare nei limiti.
async function aggiornaForma(env) {
  if (!dbOk(env)) return;
  const [stat, g0, g1] = await Promise.all([caricaStatistiche(), caricaGiorno(0), caricaGiorno(1)]);
  const squadre = []; for (const p of [...g0.partite, ...g1.partite]) { if (p.stato === "post") continue; squadre.push(p.casa, p.trasf); }
  const elenco = {}; let errore = null;
  try { for (const r of await db(env, "GET", { tabella: "nba_forma", params: { select: "pid,agg", limit: "3000" } })) elenco[r.pid] = r.agg; } catch (e) { errore = e.message; }
  const vecchio = Date.now() - 18 * 3600e3;
  const candidati = [];
  for (const sq of [...new Set(squadre)]) {
    const gs = stat.players.filter((q) => q.sq === sq && q.min >= 20 && q.pid).sort((a, b) => b.min - a.min).slice(0, 9);
    for (const q of gs) if (!elenco[q.pid] || Date.parse(elenco[q.pid]) < vecchio) candidati.push(q);
  }
  const lotto = candidati.slice(0, 26), righe = []; let falliti = 0, ultimoErr = errore;
  await Promise.all(lotto.map(async (q) => {
    try { righe.push({ pid: q.pid, nome: q.nome, sq: q.sq, dati: await caricaGamelog(q.pid), agg: new Date().toISOString() }); }
    catch (e) { falliti++; ultimoErr = e.message; }
  }));
  righe.push({ pid: "_stato", nome: "stato", sq: "", dati: { ultimo: new Date().toISOString(), ok: righe.length, falliti, da_fare: Math.max(0, candidati.length - lotto.length), errore: ultimoErr }, agg: new Date().toISOString() });
  await db(env, "POST", { tabella: "nba_forma", params: { on_conflict: "pid" }, corpo: righe, prefer: "resolution=merge-duplicates" });
}

async function apiDiag(env) {
  const v = [], prova = async (nome, fn) => { try { v.push({ nome, ok: true, dettaglio: String(await fn()) }); } catch (e) { v.push({ nome, ok: false, dettaglio: String(e.message || e) }); } };
  let gg = null, stat = null;
  await prova("Partite di oggi (ESPN)", async () => { gg = await caricaGiorno(0); return `${gg.partite.length} partite, ${gg.ieri.length} finite ieri, ${Object.keys(gg.linee).length} linee`; });
  await prova("Statistiche squadre e giocatori", async () => { stat = await caricaStatistiche(); return stat.diag.join(" · "); });
  await prova("Infortuni", async () => `${Object.keys(await caricaInfortuni()).length} segnalati`);
  await prova("Registro consigli (Supabase)", async () => { if (!dbOk(env)) throw new Error("secrets SUPABASE_URL / SUPABASE_KEY mancanti"); const r = await db(env, "GET", { params: { select: "chiave", limit: "5000" } }); return `${r.length} consigli salvati`; });
  await prova("Forma recente giocatori", async () => { if (!dbOk(env)) throw new Error("serve Supabase"); const f = await leggiForma(env); if (f.errore) throw new Error(f.errore + " (hai creato la tabella nba_forma?)"); const s = f.stato || {}; return `${f.n} giocatori con le ultime 10 partite${s.ultimo ? `, ultimo aggiornamento ${s.ultimo.slice(0, 16)}, ${s.falliti} falliti, ${s.da_fare} da fare` : ", nessun aggiornamento ancora"}${s.errore ? ", errore: " + s.errore : ""}`; });
  await prova("Calendario squadra (ultimi incontri)", async () => `${(await caricaUltime("BOS")).length} partite trovate per BOS`);
  return { aggiornato: new Date().toISOString(), voci: v };
}

async function apiGiorno(env, ctx, offset, data = null) {
  const errori = [];
  const [g, stat, fm] = await Promise.all([caricaGiorno(offset, data), caricaStatistiche(), leggiForma(env)]);
  let infortuni = {};
  try { infortuni = await caricaInfortuni(); } catch (e) { errori.push("infortuni: " + e.message); }
  const b2b = [...new Set(g.ieri.flatMap((p) => [p.casa, p.trasf]))];
  const gare = costruisci(g.partite, stat.teams, stat.players, infortuni, b2b, fm.mappa);
  const picks = consigli(gare);
  const sigle = new Set(); gare.forEach((x) => { sigle.add(x.casa); sigle.add(x.trasf); });
  g.ieri.forEach((x) => { sigle.add(x.casa); sigle.add(x.trasf); });
  let registro = "non configurato";
  if (dbOk(env)) {
    const GIORNO = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
    const righe = {};
    for (const x of picks) {
      const gara = gare.find((q) => q.id === x.g);
      if (!gara || gara.stato !== "pre") continue;
      const chiave = `${x.g}|${x.tipo}|${x.pid || x.squadra || ""}`;
      righe[chiave] = { chiave, event_id: x.g, data: GIORNO, partita: x.partita, tipo: x.tipo, testo: x.testo, squadra: x.squadra, prob: x.prob, stima: String(x.stima) };
    }
    const lista = Object.values(righe);
    registro = `${lista.length} consigli da salvare`;
    if (lista.length) ctx.waitUntil(db(env, "POST", { params: { on_conflict: "chiave" }, corpo: lista, prefer: "resolution=ignore-duplicates" }).catch(() => {}));
  }
  const sq = {}; sigle.forEach((s) => { sq[s] = info(s); });
  const finiteNome = new Set();
  return { aggiornato: new Date().toISOString(), offset, squadre: sq, linee: g.linee, ieri: g.ieri, b2b,
    partite: gare.map((x) => ({ id: x.id, casa: x.casa, trasf: x.trasf, ora: x.ora, stato: x.stato, dettaglio: x.dettaglio, ptCasa: x.ptCasa, ptTr: x.ptTr,
      r: { ...x.r, pw: phi(x.r.margine / STD.Spread) }, giocatori: x.giocatori, inf: x.inf })),
    picks, diag: [...stat.diag, `forma: ${fm.n || 0} giocatori`, `partite: ${gare.length}`, `linee: ${Object.keys(g.linee).length}`, `infortuni: ${Object.keys(infortuni).length}`, `registro: ${registro}`, ...errori] };
}

// partite finite -> consigli ricalcolati e confrontati con i risultati
async function apiEsiti(offset, data = null) {
  const g = await caricaGiorno(offset, data), stat = await caricaStatistiche();
  const finite = [...g.ieri, ...g.partite.filter((p) => p.stato === "post")];
  const gare = costruisci(finite, stat.teams, stat.players, {}, []);
  const picks = consigli(gare);
  const box = {};
  await Promise.all(gare.filter((x) => picks.some((p) => p.g === x.id && ["Punti", "Rimbalzi", "Assist"].includes(p.tipo))).map(async (x) => {
    try { box[x.id] = await caricaBoxscore(x.id); } catch { box[x.id] = null; }
  }));
  const ris = picks.map((p) => {
    const gara = gare.find((x) => x.id === p.g);
    const [esito, dettaglio] = valuta(p, { casa: gara.casa, trasf: gara.trasf, ptCasa: gara.ptCasa, ptTr: gara.ptTr }, box[p.g]);
    return { ...p, esito, dettaglio };
  });
  return { squadre: Object.fromEntries([...new Set(gare.flatMap((x) => [x.casa, x.trasf]))].map((s) => [s, info(s)])), risultati: ris };
}

async function apiStorico(env) {
  if (!dbOk(env)) return { attivo: false, righe: [] };
  const righe = await db(env, "GET", { params: { select: "*", order: "creato.desc", limit: "3000" } });
  const attesa = righe.filter((r) => r.esito == null);
  if (attesa.length) {
    try {
      const finite = new Map();
      for (const off of [0, -1]) {
        const g = await caricaGiorno(off);
        for (const p of [...g.partite, ...g.ieri]) if (p.stato === "post") finite.set(p.id, p);
      }
      const box = {}, agg = [];
      for (const r of attesa) {
        const gara = finite.get(String(r.event_id)); if (!gara) continue;
        let b = null;
        if (["Punti", "Rimbalzi", "Assist"].includes(r.tipo)) {
          if (!(r.event_id in box)) { try { box[r.event_id] = await caricaBoxscore(r.event_id); } catch { box[r.event_id] = null; } }
          b = box[r.event_id]; if (!b) continue;
        }
        const [esito, dettaglio] = valuta(r, gara, b);
        r.esito = esito; r.dettaglio = dettaglio; agg.push({ chiave: r.chiave, esito, dettaglio });
      }
      if (agg.length) await db(env, "POST", { params: { on_conflict: "chiave" }, corpo: agg, prefer: "resolution=merge-duplicates" });
    } catch {}
  }
  return { attivo: true, righe };
}


async function apiLive(env) {
  const [g, gPrima, stat] = await Promise.all([caricaGiorno(0, null, 5), caricaGiorno(-1, null, 5).catch(() => ({ partite: [] })), caricaStatistiche()]);
  const fm = await leggiForma(env);
  const visti = new Set(g.partite.map((p) => p.id));
  g.partite = [...g.partite, ...gPrima.partite.filter((p) => p.stato === "in" && !visti.has(p.id))];
  let infortuni = {}; try { infortuni = await caricaInfortuni(); } catch {}
  const gare = costruisci(g.partite, stat.teams, stat.players, infortuni, [...new Set(g.ieri.flatMap((p) => [p.casa, p.trasf]))], fm.mappa);
  const picks = consigli(gare);
  const inCorso = gare.filter((x) => x.stato === "in");
  const out = await Promise.all(inCorso.map(async (x) => {
    let box = {}; try { box = await caricaBoxscore(x.id, 5); } catch {}
    const f = frazioneGara(x.periodo, x.orologio), ga = { ...x, f, finita: false };
    const mie = picks.filter((q) => q.g === x.id).map((q) => { const l = probLive(q, ga, box, x.giocatori); return l ? { ...q, adesso: l.adesso, pLive: l.p, cur: l.cur } : null; }).filter(Boolean);
    const gioc = Object.values(box).filter((b) => b.min != null && b.min > 0).sort((a, b) => (b.pts || 0) - (a.pts || 0)).slice(0, 10)
      .map((b) => ({ nome: b.nome, sq: b.sq, pts: b.pts, reb: b.reb, ast: b.ast, min: b.min }));
    const proiTot = x.ptCasa + x.ptTr + x.r.totale * (1 - f);
    const pwLive = phi((x.ptCasa - x.ptTr + x.r.margine * (1 - f)) / Math.max(STD.Spread * Math.sqrt(1 - f), 0.6));
    return { id: x.id, casa: x.casa, trasf: x.trasf, ptCasa: x.ptCasa, ptTr: x.ptTr, periodo: x.periodo, orologio: x.orologio, dettaglio: x.dettaglio, f, proiTot, pwLive,
      r: x.r, giocatori: gioc, picks: mie, segnali: segnaliLive(ga, box, x.giocatori).slice(0, 8) };
  }));
  const sq = {}; out.forEach((x) => { sq[x.casa] = info(x.casa); sq[x.trasf] = info(x.trasf); });
  return { aggiornato: new Date().toISOString(), squadre: sq, partite: out, totali: gare.length, finite: gare.filter((x) => x.stato === "post").length, prossime: gare.filter((x) => x.stato === "pre").map((x) => ({ id: x.id, casa: x.casa, trasf: x.trasf, ora: x.ora })) };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), p = url.pathname;
    if (!p.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      const off = Math.max(-2, Math.min(3, parseInt(url.searchParams.get("g") || "0") || 0));
      if (p === "/api/live") { const d = await apiLive(env); for (const q of d.prossime) { d.squadre[q.casa] = info(q.casa); d.squadre[q.trasf] = info(q.trasf); } return J(d, 3); }
      const dp = url.searchParams.get("d"), data = dp && /^\d{8}$/.test(dp) ? dp : null;
      if (p === "/api/diag") return J(await apiDiag(env));
      if (p === "/api/giorno") return J(await apiGiorno(env, ctx, off, data), 45);
      if (p === "/api/esiti") return J(await apiEsiti(off, data), 120);
      if (p === "/api/storico") return J(await apiStorico(env));
      if (p === "/api/ultime") { const s = (url.searchParams.get("s") || "").toUpperCase(); if (!/^[A-Z]{2,4}$/.test(s)) return ERR("sigla non valida", 400); return J({ s, ultime: await caricaUltime(s) }, 600); }
      return ERR("non trovato", 404);
    } catch (e) { return ERR(String(e.message || e)); }
  },
  // ogni 30 minuti: salva i consigli delle partite che non sono iniziate e verifica quelle finite
  async scheduled(event, env, ctx) {
    if (event.cron === "10,40 * * * *") { ctx.waitUntil(aggiornaForma(env).catch(() => {})); return; }
    ctx.waitUntil((async () => {
      try { await apiGiorno(env, ctx, 0); } catch {}
      try { await apiGiorno(env, ctx, 1); } catch {}
      try { await apiStorico(env); } catch {}
    })());
  },
};
