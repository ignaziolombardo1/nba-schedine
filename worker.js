import { info, nome } from "./squadre.js";
import { proiettaPartita, proiettaGiocatori, consigli, valuta, phi, STD, frazioneGara, probLive } from "./modello.js";
import { caricaGiorno, caricaStatistiche, caricaInfortuni, caricaBoxscore, caricaUltime, dataUS } from "./espn.js";

const J = (o, ttl = 0) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": ttl ? `public, max-age=${ttl}` : "no-store", "access-control-allow-origin": "*" } });
const ERR = (m, s = 500) => new Response(JSON.stringify({ errore: m }), { status: s, headers: { "content-type": "application/json" } });

// ---- Supabase (secrets SUPABASE_URL e SUPABASE_KEY)
const dbOk = (env) => !!(env.SUPABASE_URL && env.SUPABASE_KEY);
async function db(env, metodo, { params, corpo, prefer } = {}) {
  const u = new URL(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/consigli`);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  const h = { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, "Content-Type": "application/json" };
  if (prefer) h.Prefer = prefer;
  const r = await fetch(u.toString(), { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined });
  if (!r.ok) throw new Error(`Supabase ${r.status} ${(await r.text()).slice(0, 120)}`);
  const t = await r.text(); return t ? JSON.parse(t) : [];
}

function costruisci(partite, teams, players, infortuni, b2b) {
  const out = [];
  for (const p of partite) {
    if (!teams[p.casa] || !teams[p.trasf]) continue;
    const r = proiettaPartita(p.casa, p.trasf, teams, b2b);
    const giocatori = players.length ? [...proiettaGiocatori(p.casa, p.trasf, teams, players, infortuni), ...proiettaGiocatori(p.trasf, p.casa, teams, players, infortuni)] : [];
    const inf = players.filter((q) => (q.sq === p.casa || q.sq === p.trasf) && q.min >= 20 && infortuni[q.nome.trim().toLowerCase()])
      .map((q) => ({ nome: q.nome, sq: q.sq, ...infortuni[q.nome.trim().toLowerCase()] }));
    out.push({ ...p, r, giocatori, inf });
  }
  return out;
}

async function apiGiorno(env, ctx, offset) {
  const errori = [];
  const [g, stat] = await Promise.all([caricaGiorno(offset), caricaStatistiche()]);
  let infortuni = {};
  try { infortuni = await caricaInfortuni(); } catch (e) { errori.push("infortuni: " + e.message); }
  const b2b = [...new Set(g.ieri.flatMap((p) => [p.casa, p.trasf]))];
  const gare = costruisci(g.partite, stat.teams, stat.players, infortuni, b2b);
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
    picks, diag: [...stat.diag, `partite: ${gare.length}`, `linee: ${Object.keys(g.linee).length}`, `infortuni: ${Object.keys(infortuni).length}`, `registro: ${registro}`, ...errori] };
}

// partite finite -> consigli ricalcolati e confrontati con i risultati
async function apiEsiti(offset) {
  const g = await caricaGiorno(offset), stat = await caricaStatistiche();
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
      for (const off of [0, -1, -2]) {
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


async function apiLive() {
  const [g, stat] = await Promise.all([caricaGiorno(0), caricaStatistiche()]);
  let infortuni = {}; try { infortuni = await caricaInfortuni(); } catch {}
  const gare = costruisci(g.partite, stat.teams, stat.players, infortuni, [...new Set(g.ieri.flatMap((p) => [p.casa, p.trasf]))]);
  const picks = consigli(gare);
  const inCorso = gare.filter((x) => x.stato === "in");
  const out = await Promise.all(inCorso.map(async (x) => {
    let box = {}; try { box = await caricaBoxscore(x.id, 15); } catch {}
    const f = frazioneGara(x.periodo, x.orologio), ga = { ...x, f, finita: false };
    const mie = picks.filter((q) => q.g === x.id).map((q) => { const l = probLive(q, ga, box, x.giocatori); return l ? { ...q, adesso: l.adesso, pLive: l.p, cur: l.cur } : null; }).filter(Boolean);
    const gioc = Object.values(box).filter((b) => b.min != null && b.min > 0).sort((a, b) => (b.pts || 0) - (a.pts || 0)).slice(0, 10)
      .map((b) => ({ nome: b.nome, sq: b.sq, pts: b.pts, reb: b.reb, ast: b.ast, min: b.min }));
    const proiTot = x.ptCasa + x.ptTr + x.r.totale * (1 - f);
    const pwLive = phi((x.ptCasa - x.ptTr + x.r.margine * (1 - f)) / Math.max(STD.Spread * Math.sqrt(1 - f), 0.6));
    return { id: x.id, casa: x.casa, trasf: x.trasf, ptCasa: x.ptCasa, ptTr: x.ptTr, periodo: x.periodo, orologio: x.orologio, dettaglio: x.dettaglio, f, proiTot, pwLive,
      r: x.r, giocatori: gioc, picks: mie };
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
      if (p === "/api/live") { const d = await apiLive(); for (const q of d.prossime) { d.squadre[q.casa] = info(q.casa); d.squadre[q.trasf] = info(q.trasf); } return J(d, 10); }
      if (p === "/api/giorno") return J(await apiGiorno(env, ctx, off), 45);
      if (p === "/api/esiti") return J(await apiEsiti(off), 120);
      if (p === "/api/storico") return J(await apiStorico(env));
      if (p === "/api/ultime") { const s = (url.searchParams.get("s") || "").toUpperCase(); if (!/^[A-Z]{2,4}$/.test(s)) return ERR("sigla non valida", 400); return J({ s, ultime: await caricaUltime(s) }, 600); }
      return ERR("non trovato", 404);
    } catch (e) { return ERR(String(e.message || e)); }
  },
  // ogni 30 minuti: salva i consigli delle partite che non sono iniziate e verifica quelle finite
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try { await apiGiorno(env, ctx, 0); } catch {}
      try { await apiGiorno(env, ctx, 1); } catch {}
      try { await apiStorico(env); } catch {}
    })());
  },
};
