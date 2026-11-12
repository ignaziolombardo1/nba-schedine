// Quote dei bookmaker tramite The Odds API (https://the-odds-api.com). Serve il segreto ODDS_API_KEY.
// Le quote vengono scaricate dal cron (non a ogni apertura dell'app) e salvate su Supabase (tabella nba_forma, righe "_quote*"),
// così i crediti gratuiti (500 al mese) bastano. Il segreto facoltativo ODDS_REGIONS (default "us") e ODDS_PROPS
// (default "player_points") permettono di cambiare bookmaker e mercati dei giocatori.
import { SQUADRE } from "./squadre.js";
import { normNome } from "./modello.js";

const BASE = "https://api.the-odds-api.com/v4/sports/basketball_nba";
const MAPPA_PROPS = { player_points: "pts", player_rebounds: "reb", player_assists: "ast" };

// nome completo -> sigla
const DA_NOME = {};
for (const [sig, v] of Object.entries(SQUADRE)) { const k = v[0].toLowerCase(); if (!DA_NOME[k]) DA_NOME[k] = sig; }
const sigla = (nomeCompleto) => {
  const k = String(nomeCompleto || "").toLowerCase();
  if (DA_NOME[k]) return DA_NOME[k];
  const ult = k.split(" ").slice(-1)[0];
  const trovato = Object.entries(SQUADRE).find(([, v]) => v[0].toLowerCase().endsWith(" " + ult) || v[0].toLowerCase().endsWith(" " + k.split(" ").slice(-2).join(" ")));
  return trovato ? trovato[0] : null;
};
export const chiaveGara = (casa, trasf) => `${casa}|${trasf}`;

async function chiedi(path, params, key) {
  const u = new URL(BASE + path);
  u.searchParams.set("apiKey", key);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  const r = await fetch(u.toString(), { headers: { Accept: "application/json" } });
  const restanti = r.headers.get("x-requests-remaining"), usati = r.headers.get("x-requests-used");
  if (!r.ok) throw new Error(`Odds API ${r.status} ${(await r.text()).slice(0, 100)}`);
  return { json: await r.json(), restanti: restanti != null ? +restanti : null, usati: usati != null ? +usati : null };
}

const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;
// Probabilità dell'over senza il margine del bookmaker
const senzaMargine = (po, pu) => (1 / po) / (1 / po + 1 / pu);

// raccoglie per ogni linea le probabilità dei vari libri; sceglie la linea offerta da più libri (a parità la più vicina al 50%)
function scegliLinea(righe) {
  // righe: [{b, linea, p (probabilità del lato "over"/casa), o, u}]
  const gruppi = new Map();
  for (const r of righe) { const k = String(r.linea); if (!gruppi.has(k)) gruppi.set(k, []); gruppi.get(k).push(r); }
  let best = null;
  for (const g of gruppi.values()) {
    const p = media(g.map((x) => x.p));
    if (!best || g.length > best.g.length || (g.length === best.g.length && Math.abs(p - 0.5) < Math.abs(best.p - 0.5))) best = { g, p };
  }
  if (!best) return null;
  return { linea: best.g[0].linea, pOver: best.p, n: best.g.length, libri: best.g.slice(0, 6).map((x) => ({ b: x.b, o: x.o, u: x.u })) };
}

// totali e spread di tutte le partite: { "CASA|TRASF": { tot:{linea,pOver,n,libri}, spr:{linea,pCasa,n,libri} } }
export function leggiGiochi(eventi) {
  const out = {};
  for (const ev of eventi || []) {
    const casa = sigla(ev.home_team), trasf = sigla(ev.away_team); if (!casa || !trasf) continue;
    const tot = [], spr = [];
    for (const bk of ev.bookmakers || []) for (const m of bk.markets || []) {
      const oc = m.outcomes || [];
      if (m.key === "totals") {
        const o = oc.find((x) => /over/i.test(x.name)), u = oc.find((x) => /under/i.test(x.name));
        if (o && u && o.point != null && o.price > 1 && u.price > 1) tot.push({ b: bk.title, linea: o.point, p: senzaMargine(o.price, u.price), o: o.price, u: u.price });
      } else if (m.key === "spreads") {
        const h = oc.find((x) => x.name === ev.home_team), a = oc.find((x) => x.name === ev.away_team);
        if (h && a && h.point != null && h.price > 1 && a.price > 1) spr.push({ b: bk.title, linea: h.point, p: senzaMargine(h.price, a.price), o: h.price, u: a.price });
      }
    }
    const t = scegliLinea(tot), s = scegliLinea(spr);
    out[chiaveGara(casa, trasf)] = { id: ev.id, inizio: ev.commence_time, tot: t, spr: s ? { linea: s.linea, pCasa: s.pOver, n: s.n, libri: s.libri } : null };
  }
  return out;
}

// quote sui giocatori di una partita: { "nome normalizzato|pts": {linea,pOver,n,libri} }
export function leggiProps(ev) {
  const per = {};
  for (const bk of ev.bookmakers || []) for (const m of bk.markets || []) {
    const k = MAPPA_PROPS[m.key]; if (!k) continue;
    const coppie = {};
    for (const o of m.outcomes || []) {
      if (!o.description || o.point == null) continue;
      const c = (coppie[`${o.description}|${o.point}`] ||= { nome: o.description, linea: o.point });
      if (/over/i.test(o.name)) c.o = o.price; else if (/under/i.test(o.name)) c.u = o.price;
    }
    for (const c of Object.values(coppie)) {
      if (!(c.o > 1 && c.u > 1)) continue;
      (per[`${normNome(c.nome)}|${k}`] ||= []).push({ b: bk.title, linea: c.linea, p: senzaMargine(c.o, c.u), o: c.o, u: c.u });
    }
  }
  const out = {};
  for (const [k, righe] of Object.entries(per)) { const s = scegliLinea(righe); if (s) out[k] = s; }
  return out;
}

const MIN = 60000;
// Aggiorna la cache delle quote. stato = riga "_quote" già salvata ({t, giochi, props, crediti}); partite = partite di oggi e domani (con iso e stato).
// Ritorna il nuovo stato, oppure null se non c'è nulla da aggiornare.
export async function aggiornaQuote(env, stato, partite, forza = false) {
  const key = env.ODDS_API_KEY; if (!key) return null;
  const adesso = Date.now(), regioni = env.ODDS_REGIONS || "us";
  const mercatiProps = (env.ODDS_PROPS || "player_points").split(",").map((x) => x.trim()).filter(Boolean);
  const oggi = new Date(adesso + 3600e3).toISOString().slice(0, 10), tetto = parseInt(env.ODDS_BUDGET_DAY) || 14; // crediti massimi al giorno: 14 x 30 giorni = 420 su 500
  const speso0 = stato?.giornoSpeso === oggi ? stato.speso || 0 : 0;
  const nreg = Math.max(1, regioni.split(",").length);
  const nuovo = { giornoSpeso: oggi, speso: speso0, t: stato?.t || null, tProps: stato?.tProps || {}, giochi: stato?.giochi || {}, props: stato?.props || {}, crediti: stato?.crediti ?? null, errore: null, chiamate: 0 };
  const restanti = nuovo.crediti;
  if (restanti != null && restanti < 15) { nuovo.errore = "crediti quasi finiti: aggiornamento sospeso"; return nuovo; }
  const lenti = restanti != null && restanti < 100 ? 4 : restanti != null && restanti < 300 ? 2 : 1; // meno aggiornamenti quando i crediti calano

  const prossime = partite.filter((p) => p.stato === "pre" && Date.parse(p.iso) - adesso < 14 * 3600e3);
  const inCorso = partite.filter((p) => p.stato === "in");
  const eta = nuovo.t ? (adesso - Date.parse(nuovo.t)) / MIN : 1e9;
  const serve = forza ? eta > 10 : (inCorso.length ? eta >= 180 * lenti : prossime.length ? eta >= 240 * lenti : false);
  const costoGiochi = 2 * nreg, costoProps = mercatiProps.length * nreg, puoSpendere = (c) => nuovo.speso + c <= tetto;
  try {
    if (serve && puoSpendere(costoGiochi)) {
      nuovo.speso += costoGiochi;
      const r = await chiedi("/odds", { regions: regioni, markets: "totals,spreads", oddsFormat: "decimal" }, key);
      nuovo.giochi = leggiGiochi(r.json); nuovo.t = new Date().toISOString(); nuovo.crediti = r.restanti; nuovo.chiamate++;
    }
    // quote dei giocatori: una volta per partita, nelle 4 ore prima dell'inizio (e di nuovo se più vecchie di 3 ore)
    const daFare = prossime.filter((p) => Date.parse(p.iso) - adesso < 4 * 3600e3 && (!nuovo.tProps[chiaveGara(p.casa, p.trasf)] || adesso - Date.parse(nuovo.tProps[chiaveGara(p.casa, p.trasf)]) > 3 * 3600e3 * lenti));
    if (mercatiProps.length && daFare.length && (nuovo.crediti == null || nuovo.crediti > 40)) {
      for (const p of daFare.slice(0, 4)) {
        if (!puoSpendere(costoProps)) { nuovo.errore = "tetto giornaliero di crediti raggiunto"; break; }
        const g = nuovo.giochi[chiaveGara(p.casa, p.trasf)]; if (!g || !g.id) continue;
        try {
          nuovo.speso += costoProps;
          const r = await chiedi(`/events/${g.id}/odds`, { regions: regioni, markets: mercatiProps.join(","), oddsFormat: "decimal" }, key);
          nuovo.props[chiaveGara(p.casa, p.trasf)] = leggiProps(r.json); nuovo.tProps[chiaveGara(p.casa, p.trasf)] = new Date().toISOString(); nuovo.crediti = r.restanti ?? nuovo.crediti; nuovo.chiamate++;
        } catch (e) { nuovo.errore = e.message; }
      }
    }
    // pulizia: tiene solo le partite recenti
    for (const k of Object.keys(nuovo.props)) if (!partite.some((p) => chiaveGara(p.casa, p.trasf) === k)) delete nuovo.props[k];
  } catch (e) { nuovo.errore = e.message; }
  return nuovo.chiamate || nuovo.errore ? nuovo : null;
}
