const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const ESPN_V2 = "https://site.api.espn.com/apis/v2/sports/basketball/nba";
const ESPN_ATL = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete";

export async function get(url, params = {}, ttl = 60) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, v);
  const r = await fetch(u.toString(), { headers: { "User-Agent": "Mozilla/5.0" }, cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!r.ok) throw new Error(`ESPN HTTP ${r.status}`);
  return r.json();
}

const fmtRoma = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
export const oraRoma = (iso) => { try { return fmtRoma.format(new Date(iso)).replace(",", ""); } catch { return ""; } };
const fmtUS = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export function dataUS(offset = 0) {
  const base = new Date(Date.now() + offset * 86400000);
  return fmtUS.format(base).replaceAll("-", "");
}
const punti = (x) => { const n = parseInt(parseFloat(x)); return Number.isFinite(n) ? n : null; };

export function leggiScoreboard(sb) {
  const partite = [], linee = {};
  for (const ev of sb.events || []) {
    const comp = (ev.competitions || [])[0]; if (!comp) continue;
    const cc = comp.competitors.find((c) => c.homeAway === "home"), ct = comp.competitors.find((c) => c.homeAway === "away");
    if (!cc || !ct) continue;
    const casa = cc.team.abbreviation, trasf = ct.team.abbreviation;
    const tipo = (ev.status || {}).type || {}, stato = tipo.state;
    partite.push({ id: String(ev.id), casa, trasf, ora: oraRoma(ev.date), iso: ev.date, stato, dettaglio: tipo.shortDetail || "",
      ptCasa: stato !== "pre" ? punti(cc.score) : null, ptTr: stato !== "pre" ? punti(ct.score) : null,
      periodo: (ev.status || {}).period || 0, orologio: String((ev.status || {}).displayClock || "") });
    for (const o of (comp.odds || []).slice(0, 1)) {
      if (o.overUnder) linee[`tot_${casa}`] = parseFloat(o.overUnder);
      const m = /^([A-Z]{2,4})\s+([+-]?\d+(?:\.\d+)?)$/.exec(String(o.details || "").trim());
      if (m) { const n = parseFloat(m[2]); linee[`spr_${casa}`] = m[1] === casa ? n : -n; }
    }
  }
  return { partite, linee };
}

function* entries(node) {
  if (Array.isArray(node)) { for (const v of node) yield* entries(v); }
  else if (node && typeof node === "object") {
    if (Array.isArray(node.entries)) yield* node.entries;
    for (const v of Object.values(node)) yield* entries(v);
  }
}

export async function caricaStatistiche() {
  const cl = await get(`${ESPN_V2}/standings`, {}, 1800);
  const teams = {}, nomi = {};
  for (const en of entries(cl)) {
    const team = en.team || {};
    const s = {}; for (const x of en.stats || []) if (x && typeof x === "object") s[x.name] = x.value;
    let pf = s.avgPointsFor, pa = s.avgPointsAgainst;
    if (pf == null && s.pointsFor && s.gamesPlayed) { pf = s.pointsFor / s.gamesPlayed; pa = s.pointsAgainst / s.gamesPlayed; }
    if (pf == null || pa == null || !team.abbreviation) continue;
    teams[team.abbreviation] = { pf: +pf, pa: +pa };
    for (const k of ["abbreviation", "shortDisplayName", "name", "displayName", "location"]) if (team[k]) nomi[String(team[k]).toLowerCase()] = team.abbreviation;
    if (team.id) nomi["id:" + team.id] = team.abbreviation;
  }
  if (!Object.keys(teams).length) throw new Error("statistiche squadre non trovate");
  const players = []; let ricevuti = 0, errGioc = null;
  try {
    const now = new Date(), stagione = now.getUTCMonth() + 1 >= 10 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
    const pj = await get(ESPN_ATL, { region: "us", lang: "en", contentorigin: "espn", isqualified: "false", page: 1, limit: 200,
      sort: "offensive.avgPoints:desc", season: stagione, seasontype: 2 }, 1800);
    const nomiCol = {}; for (const c of pj.categories || []) nomiCol[c.name] = c.names || [];
    ricevuti = (pj.athletes || []).length;
    for (const a of pj.athletes || []) {
      const v = {};
      for (const c of a.categories || []) (nomiCol[c.name] || []).forEach((n, i) => { v[n] = (c.values || [])[i]; });
      const info = a.athlete || {};
      const ab = nomi["id:" + info.teamId] || nomi[String(info.teamShortName || "").toLowerCase()] || nomi[String(info.teamName || "").toLowerCase()];
      if (ab && v.avgPoints != null && v.avgMinutes != null)
        players.push({ nome: info.displayName, pid: String(info.id || ""), sq: ab, min: +v.avgMinutes, pts: +v.avgPoints, reb: +(v.avgRebounds || 0), ast: +(v.avgAssists || 0) });
    }
  } catch (e) { errGioc = e.message; }
  return { teams, players, diag: [`squadre: ${Object.keys(teams).length}`, `giocatori: ${players.length} (su ${ricevuti})`, ...(errGioc ? [`giocatori: ERRORE ${errGioc}`] : [])] };
}

export async function caricaInfortuni() {
  const d = await get(`${ESPN}/injuries`, {}, 600), out = {};
  for (const t of d.injuries || []) for (const i of t.injuries || []) {
    const n = (i.athlete || {}).displayName; const stato = String(i.status || "").toLowerCase();
    if (n) out[n.trim().toLowerCase()] = { stato: stato.includes("out") ? "out" : "dubbio", dettaglio: i.shortComment || i.status || "" };
  }
  return out;
}

export function aggiungiGiorni(yyyymmdd, n) {
  const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)) + n * 86400000);
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

export const romaYMD = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)).replaceAll("-", "");

// Giorno secondo il calendario italiano: una partita appartiene al giorno in cui INIZIA in Italia.
export async function caricaGiorno(offset, data = null) {
  const D = data || romaYMD(Date.now() + offset * 86400000);
  const Dieri = aggiungiGiorni(D, -1);
  const chiedi = (d, ttl) => get(`${ESPN}/scoreboard`, { dates: d }, ttl).then(leggiScoreboard);
  const [pri, ora, prev] = await Promise.all([
    chiedi(aggiungiGiorni(D, -1), 60), chiedi(D, 60), chiedi(aggiungiGiorni(D, -2), 300).catch(() => ({ partite: [], linee: {} })),
  ]);
  const tutte = new Map(), linee = {};
  for (const r of [prev, pri, ora]) {
    for (const p of r.partite) { p.giornoRoma = romaYMD(Date.parse(p.iso)); tutte.set(p.id, p); }
    Object.assign(linee, r.linee);
  }
  const lista = [...tutte.values()];
  const partite = lista.filter((p) => p.giornoRoma === D).sort((x, y) => (x.iso < y.iso ? -1 : 1));
  const ieri = lista.filter((p) => p.giornoRoma === Dieri && p.stato === "post");
  return { partite, linee, ieri };
}

export async function caricaBoxscore(eventId, ttl = 600) {
  const d = await get(`${ESPN}/summary`, { event: eventId }, ttl), out = {};
  for (const team of (d.boxscore || {}).players || []) for (const blocco of team.statistics || []) {
    const labels = blocco.labels || blocco.names || [], idx = {};
    labels.forEach((l, i) => { idx[String(l).toUpperCase()] = i; });
    for (const a of blocco.athletes || []) {
      const n = (a.athlete || {}).displayName, st = a.stats || [];
      if (!n || !st.length) continue;
      const v = (k) => { const i = idx[k]; const x = i != null ? parseFloat(st[i]) : NaN; return Number.isFinite(x) ? x : null; };
      out[n.trim().toLowerCase()] = { nome: n, sq: (team.team || {}).abbreviation, pts: v("PTS"), reb: v("REB"), ast: v("AST"), min: v("MIN") };
    }
  }
  return out;
}

export async function caricaUltime(sigla, n = 5) {
  const d = await get(`${ESPN}/teams/${sigla.toLowerCase()}/schedule`, {}, 1800), out = [];
  for (const ev of d.events || []) {
    const comp = (ev.competitions || [{}])[0], stt = ((comp.status || ev.status || {}).type) || {};
    if (!stt.completed) continue;
    let mie = null, loro = null;
    for (const c of comp.competitors || []) {
      let sc = c.score; if (sc && typeof sc === "object") sc = sc.value ?? sc.displayValue;
      sc = punti(sc);
      const ab = (c.team || {}).abbreviation || "";
      const riga = { ab, pt: sc, casa: c.homeAway === "home" };
      if (ab.toUpperCase() === sigla.toUpperCase()) mie = riga; else loro = riga;
    }
    if (!mie || !loro || mie.pt == null || loro.pt == null) continue;
    out.push({ data: String(ev.date || "").slice(0, 10), avv: loro.ab, casa: mie.casa, pf: mie.pt, pa: loro.pt, vinta: mie.pt > loro.pt });
  }
  return out.sort((a, b) => (a.data < b.data ? -1 : 1)).slice(-n).reverse();
}
