import { nome } from "./squadre.js";

export const HOME_ADV = 1.5, MIN_MINUTI = 20, PESO_FORMA = 0.6, B2B_PUNTI = 1.2;
export const STD = { Totale: 17, Spread: 12, Squadra: 12 };
export const PROB_MIN = 0.70;
export const MERCATI = {
  Punti: { k: "pts", unita: "pt", cv: 0.30, stdMin: 3.0, minimo: 14.5, scalini: [9.5, 12.5, 14.5, 17.5, 19.5, 22.5, 24.5, 27.5, 29.5, 32.5, 34.5, 39.5] },
  Rimbalzi: { k: "reb", unita: "rimb.", cv: 0.40, stdMin: 1.5, minimo: 5.5, scalini: [2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5] },
  Assist: { k: "ast", unita: "ass.", cv: 0.45, stdMin: 1.3, minimo: 4.5, scalini: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5] },
};

function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
export const stdGiocatore = (val, minuti, m) => Math.max(val * MERCATI[m].cv * (1 + 0.02 * Math.max(0, 34 - minuti)), MERCATI[m].stdMin);
export const probOver = (val, soglia, sd) => 1 - phi((soglia - val) / sd);
const r1 = (x) => Math.round(x * 10) / 10;

// ---------- Confronto con il mercato dei bookmaker
export const W_MODELLO = 0.4; // peso del nostro modello nella media finale (il resto è il mercato)
export const normNome = (n) => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
export function qnorm(p) { let lo = -8, hi = 8; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (phi(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; }
// media implicita nel mercato: da una linea e dalla probabilità di over (senza margine del bookmaker)
export const muMercato = (linea, pOver, sd) => linea - sd * qnorm(1 - Math.min(0.97, Math.max(0.03, pOver)));
// Unisce la stima del modello con quella del mercato. q = {linea, pOver, n, libri}
export function combina(muMod, sd, q) {
  if (!q || q.linea == null || q.pOver == null) return { mu: muMod, mk: null };
  const muMk = muMercato(q.linea, q.pOver, sd), diff = (muMod - muMk) / sd;
  // il mercato è di solito meglio calibrato: se il modello è lontano più di 1.5 deviazioni, lo si avvicina prima di unire
  const muModC = Math.min(muMk + 1.5 * sd, Math.max(muMk - 1.5 * sd, muMod)), mu = W_MODELLO * muModC + (1 - W_MODELLO) * muMk;
  return { mu, mk: { linea: q.linea, n: q.n || 1, libri: q.libri || [], pMk: q.pOver, pMod: 1 - phi((q.linea - muMod) / sd), pFin: 1 - phi((q.linea - mu) / sd), muMod, muMk, diff, div: Math.abs(diff) > 0.75 ? "alta" : Math.abs(diff) > 0.4 ? "media" : "bassa" } };
}

export function proiettaPartita(casa, trasf, teams, b2b = [], quote = null) {
  const T = teams, pace = 100;
  const offCasa = (T[casa].pf + T[trasf].pa) / 2, offTr = (T[trasf].pf + T[casa].pa) / 2;
  let ptCasa = offCasa * pace / 100 + HOME_ADV / 2 - (b2b.includes(casa) ? B2B_PUNTI : 0);
  let ptTr = offTr * pace / 100 - HOME_ADV / 2 - (b2b.includes(trasf) ? B2B_PUNTI : 0);
  const out = { ptCasa, ptTr, totale: ptCasa + ptTr, margine: ptCasa - ptTr };
  if (!quote) return out;
  // totale: linea del bookmaker; spread: linea della squadra di casa (negativa se favorita) -> margine = -linea
  const ct = combina(out.totale, STD.Totale, quote.tot);
  const sp = quote.spr ? combina(out.margine, STD.Spread, { linea: -quote.spr.linea, pOver: quote.spr.pCasa, n: quote.spr.n, libri: quote.spr.libri }) : { mu: out.margine, mk: null };
  if (!ct.mk && !sp.mk) return out;
  const tot = ct.mu, mar = sp.mu;
  return { ptCasa: (tot + mar) / 2, ptTr: (tot - mar) / 2, totale: tot, margine: mar, mk: { tot: ct.mk, spr: sp.mk, totaleModello: out.totale, margineModello: out.margine } };
}

// Minuti attesi: nelle partite molto sbilanciate i titolari giocano meno (circa -0.8% ogni punto oltre 8 di margine, max -8%)
export const fattoreMinuti = (margine) => { const m = Math.abs(margine); return m >= 8 ? 1 - Math.min(0.08, 0.008 * (m - 8)) : 1; };

export function proiettaGiocatori(sig, avv, teams, players, infortuni = {}, forma = {}, margine = 0, props = null) {
  const lega = Object.values(teams).reduce((a, t) => a + t.pa, 0) / Object.keys(teams).length;
  const fDif = teams[avv].pa / lega;
  const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  // assenti (out) della squadra: una parte dei loro punti, rimbalzi e assist passa ai compagni, in proporzione al loro peso
  const stOut = (p) => (infortuni[p.nome.trim().toLowerCase()] || {}).stato === "out";
  const sqPl = players.filter((p) => p.sq === sig && p.min >= MIN_MINUTI);
  const usciti = sqPl.filter(stOut), sani = sqPl.filter((p) => !stOut(p));
  const persi = { pts: usciti.reduce((a, p) => a + p.pts, 0), reb: usciti.reduce((a, p) => a + p.reb, 0), ast: usciti.reduce((a, p) => a + p.ast, 0) };
  const somma = { pts: sani.reduce((a, p) => a + p.pts, 0) || 1, reb: sani.reduce((a, p) => a + p.reb, 0) || 1, ast: sani.reduce((a, p) => a + p.ast, 0) || 1 };
  return players
    .filter((p) => p.sq === sig && p.min >= MIN_MINUTI && (infortuni[p.nome.trim().toLowerCase()] || {}).stato !== "out")
    .map((p) => {
      const inf = (infortuni[p.nome.trim().toLowerCase()] || {}).stato || "";
      const f = forma[p.pid], ok = f && f.pts && f.pts.length >= 5;
      const l10 = ok ? { pts: media(f.pts), reb: media(f.reb), ast: media(f.ast), min: media(f.min) } : null;
      // minuti attesi: mix tra ultime 10 e stagione, ridotti se la partita rischia di essere decisa presto
      const min0 = l10 && l10.min > 0 ? 0.5 * l10.min + 0.5 * p.min : p.min;
      const blow = Math.max(0, Math.abs(margine) - 8);
      const minAtt = p.min >= 26 ? min0 * (1 - Math.min(0.10, 0.008 * blow)) : min0;
      const tasso = (v10, vSt) => (l10 ? PESO_FORMA * (v10 / Math.max(l10.min, 1)) + (1 - PESO_FORMA) * (vSt / p.min) : vSt / p.min);
      const val = { Punti: tasso(l10 && l10.pts, p.pts) * minAtt * fDif, Rimbalzi: tasso(l10 && l10.reb, p.reb) * minAtt, Assist: tasso(l10 && l10.ast, p.ast) * minAtt };
      // più la forma recente già riflette l'assenza, meno si aggiunge
      const rid = l10 ? 0.25 : 0.45, bo = (k) => (usciti.length ? Math.min(0.2 * p[k], rid * persi[k] * p[k] / somma[k]) : 0);
      const boost = { pts: bo("pts"), reb: bo("reb"), ast: bo("ast") };
      val.Punti += boost.pts; val.Rimbalzi += boost.reb; val.Assist += boost.ast;
      const o = { nome: p.nome, pid: p.pid, sq: sig, min: r1(minAtt), assenze: usciti.length ? usciti.slice(0, 3).map((u) => u.nome) : null, boost: usciti.length ? { pts: r1(boost.pts), reb: r1(boost.reb), ast: r1(boost.ast) } : null, inf, forma: r1(l10 ? l10.pts : p.pts), stagione: r1(p.pts), conForma: !!l10,
        ult: ok ? { pts: [...f.pts].reverse(), reb: [...f.reb].reverse(), ast: [...f.ast].reverse() } : null };
      for (const [m, c] of Object.entries(MERCATI)) {
        const q = props && props[`${normNome(p.nome)}|${c.k}`];
        const cb = q ? combina(val[m], stdGiocatore(val[m], minAtt, m), q) : null;
        const v = r1(cb && cb.mk ? cb.mu : val[m]);
        const sd = stdGiocatore(v, minAtt, m);
        const lad = c.scalini.map((t) => ({ t, p: probOver(v, t, sd) })).filter((x) => x.p >= 0.2 && x.p <= 0.97);
        const buone = lad.filter((x) => x.p >= PROB_MIN);
        o[c.k] = { v, vModello: r1(val[m]), mk: cb && cb.mk ? { ...cb.mk, pFin: probOver(v, cb.mk.linea, sd) } : null, sd: r1(sd * 100) / 100, media: r1(m === "Punti" ? p.pts : m === "Rimbalzi" ? p.reb : p.ast), lad: lad.map((x) => [x.t, Math.round(x.p * 1000) / 1000]),
                   rec: buone.length ? Math.max(...buone.map((x) => x.t)) : null };
      }
      return o;
    })
    .sort((a, b) => b.pts.v - a.pts.v);
}

export function consigli(partite) {
  // partite: [{id, casa, trasf, r, giocatori}] -> lista di giocate ordinate per probabilità
  const out = [];
  for (const g of partite) {
    const { casa, trasf, r } = g, part = `${nome(trasf, true)} @ ${nome(casa, true)}`;
    const base = { g: g.id, partita: part };
    const pw = phi(Math.abs(r.margine) / STD.Spread), fav = r.margine > 0 ? casa : trasf;
    if (pw >= 0.60) out.push({ ...base, id: `win_${g.id}`, tipo: "Vincente", squadra: fav, testo: `${nome(fav, true)} vince`, stima: `+${Math.abs(r.margine).toFixed(1)}`, prob: pw,
      motivo: `Margine stimato di ${Math.abs(r.margine).toFixed(1)} punti a favore di ${nome(fav, true)}: probabilità di vittoria circa ${Math.round(pw * 100)}%.` });
    for (const [sq, pt] of [[casa, r.ptCasa], [trasf, r.ptTr]]) {
      const buoni = Array.from({ length: 26 }, (_, i) => 84.5 + 2 * i).filter((x) => 1 - phi((x - pt) / STD.Squadra) >= PROB_MIN);
      if (buoni.length) { const x = Math.max(...buoni), pr = 1 - phi((x - pt) / STD.Squadra);
        out.push({ ...base, id: `sq_${g.id}_${sq}`, tipo: "Squadra", squadra: sq, testo: `${nome(sq, true)} over ${x} punti`, stima: pt.toFixed(1), prob: pr,
          motivo: `Stima ${pt.toFixed(1)} punti per ${nome(sq, true)}: la probabilità di superare ${x} è circa ${Math.round(pr * 100)}%.` }); }
    }
    const scal = Array.from({ length: 36 }, (_, i) => 190.5 + 2 * i);
    const ov = scal.filter((x) => 1 - phi((x - r.totale) / STD.Totale) >= PROB_MIN);
    if (ov.length) { const x = Math.max(...ov), pr = 1 - phi((x - r.totale) / STD.Totale);
      out.push({ ...base, id: `tov_${g.id}`, tipo: "Totale", squadra: null, testo: `Totale over ${x}`, stima: r.totale.toFixed(1), prob: pr,
        motivo: `Stima ${r.totale.toFixed(1)} punti totali${r.mk && r.mk.tot ? ` (modello ${r.mk.totaleModello.toFixed(1)}, bookmaker linea ${r.mk.tot.linea})` : ""}: probabilità di superare ${x} circa ${Math.round(pr * 100)}%.` }); }
    const un = scal.filter((x) => phi((x - r.totale) / STD.Totale) >= PROB_MIN);
    if (un.length) { const x = Math.min(...un), pr = phi((x - r.totale) / STD.Totale);
      out.push({ ...base, id: `tun_${g.id}`, tipo: "Totale", squadra: null, testo: `Totale under ${x}`, stima: r.totale.toFixed(1), prob: pr,
        motivo: `Stima ${r.totale.toFixed(1)} punti totali${r.mk && r.mk.tot ? ` (modello ${r.mk.totaleModello.toFixed(1)}, bookmaker linea ${r.mk.tot.linea})` : ""}: probabilità di restare sotto ${x} circa ${Math.round(pr * 100)}%.` }); }
    for (const sq of [casa, trasf]) {
      const ds = g.giocatori.filter((p) => p.sq === sq);
      for (const [m, c] of Object.entries(MERCATI)) {
        for (const p of [...ds].sort((a, b) => b[c.k].v - a[c.k].v).slice(0, 3)) {
          const o = p[c.k];
          if (o.rec === null || o.rec < c.minimo) continue;
          const pr = probOver(o.v, o.rec, o.sd), mk = o.mk;
          const motivo = mk
            ? `Bookmaker: linea ${mk.linea}, over ${Math.round(mk.pMk * 100)}% (${mk.n} ${mk.n === 1 ? "libro" : "libri"}). Il nostro modello da solo stimava ${o.vModello.toFixed(1)} ${c.unita}; unito al mercato la stima è ${o.v.toFixed(1)} e la probabilità di superare ${o.rec} è circa ${Math.round(pr * 100)}%.`
            : `Stima ${o.v.toFixed(1)} ${c.unita} (media stagione ${o.media.toFixed(1)}, ${Math.round(p.min)} min). Con la variabilità tipica, la probabilità di superare ${o.rec} è circa ${Math.round(pr * 100)}%. Senza quote dei bookmaker: controlla la linea offerta.`;
          out.push({ ...base, id: `${c.k}_${g.id}_${p.pid || p.nome}`, tipo: m, squadra: sq, pid: p.pid, testo: `${p.nome} over ${o.rec} ${c.unita}`, stima: o.v.toFixed(1), prob: pr, motivo,
            mercato: mk ? { linea: mk.linea, pMk: mk.pMk, pMod: mk.pMod, pFin: mk.pFin, div: mk.div } : null });
        }
      }
    }
  }
  return out.sort((a, b) => b.prob - a.prob);
}

// Valuta una giocata con il risultato reale. 1 azzeccata, 0 sbagliata, 2 non valida
export function valuta(x, g, box) {
  const { ptCasa: pc, ptTr: pt } = g;
  if (pc == null || pt == null) return [2, "punteggio non disponibile"];
  if (x.tipo === "Vincente") return [(pc > pt ? g.casa : g.trasf) === x.squadra ? 1 : 0, `finale ${pt}-${pc}`];
  const m = /(over|under) (\d+(?:\.\d+)?)/.exec(x.testo);
  if (!m) return [2, "giocata non valutabile"];
  const lato = m[1], soglia = parseFloat(m[2]);
  let val;
  if (x.tipo === "Squadra") val = x.squadra === g.casa ? pc : pt;
  else if (x.tipo === "Totale") val = pc + pt;
  else if (MERCATI[x.tipo]) {
    if (!box) return [2, "tabellino non disponibile"];
    const nomeG = x.testo.split(" over")[0].trim().toLowerCase();
    val = (box[nomeG] || {})[MERCATI[x.tipo].k];
    if (val == null) return [2, "non ha giocato"];
  } else return [2, "giocata non valutabile"];
  const ok = lato === "over" ? val > soglia : val < soglia;
  return [ok ? 1 : 0, `fatto ${val}`];
}

// ---------- LIVE
export function frazioneGara(periodo, orologio) {
  const m = /^(\d+):(\d+)/.exec(orologio || "") || /^(\d+)(?:\.\d+)?$/.exec(orologio || "");
  let rem = 0;
  if (m) rem = m[2] !== undefined && /:/.test(orologio) ? parseInt(m[1]) + parseInt(m[2]) / 60 : parseFloat(orologio);
  const rimasto = periodo <= 4 ? (4 - periodo) * 12 + rem : rem;
  return Math.max(0, Math.min(0.995, 1 - rimasto / 48));
}

// Probabilità aggiornata di una giocata a partita in corso. gara: {casa,trasf,ptCasa,ptTr,r,f,finita}; box: boxscore live
export function probLive(x, gara, box, giocatori) {
  const { casa, trasf, ptCasa, ptTr, r, f, finita } = gara, rest = Math.max(0, 1 - f);
  const sdR = (sd) => Math.max(sd * Math.sqrt(rest), finita ? 0.01 : 0.6);
  const m = /(over|under) (\d+(?:\.\d+)?)/.exec(x.testo);
  const lato = m && m[1], T = m && parseFloat(m[2]);
  if (x.tipo === "Vincente") {
    const media = ptCasa - ptTr + r.margine * rest, pc = phi(media / sdR(STD.Spread));
    return { adesso: `${ptCasa - ptTr > 0 ? casa : trasf} +${Math.abs(ptCasa - ptTr)}`, p: x.squadra === casa ? pc : 1 - pc };
  }
  if (!m) return null;
  let cur, exp, sd;
  if (x.tipo === "Squadra") { const sq = x.squadra === casa; cur = sq ? ptCasa : ptTr; exp = cur + (sq ? r.ptCasa : r.ptTr) * rest; sd = sdR(STD.Squadra); }
  else if (x.tipo === "Totale") { cur = ptCasa + ptTr; exp = stimaTotale(cur, f, r.totale); sd = sdR(STD.Totale); }
  else if (MERCATI[x.tipo]) {
    const k = MERCATI[x.tipo].k, pl = giocatori.find((q) => (q.pid && q.pid === x.pid) || q.nome === x.testo.split(" over")[0].trim());
    if (!pl) return null;
    const o = pl[k], b = (box || {})[pl.nome.trim().toLowerCase()];
    const mp = b && b.min != null ? b.min : 0, c = b && b[k] != null ? b[k] : 0;
    const restoMin = finita ? 0 : Math.max(pl.min - mp, 2);
    const pm = o.v / pl.min, w = mp / (mp + 12), ritmo = mp > 0 ? c / mp : pm;
    cur = c; exp = c + restoMin * (pm * (1 - w) + ritmo * w); sd = Math.max(o.sd * Math.sqrt(restoMin / pl.min), finita ? 0.01 : 0.6);
    const out = lato === "over" ? (cur > T ? 1 : 1 - phi((T - exp) / sd)) : (cur > T ? 0 : phi((T - exp) / sd));
    return { adesso: `${cur} ${MERCATI[x.tipo].unita} (${Math.round(mp)} min)`, p: out, cur, exp, mp };
  } else return null;
  const out = lato === "over" ? (cur > T ? 1 : 1 - phi((T - exp) / sd)) : (cur > T ? 0 : phi((T - exp) / sd));
  return { adesso: String(cur), p: out, cur, exp };
}

// Stima del totale finale: punti già fatti + resto del tempo, mescolando il ritmo previsto e quello visto in campo
export function stimaTotale(cur, f, preTot) {
  const rest = Math.max(0, 1 - f), ritmo = f > 0.1 ? cur / f : preTot, w = Math.min(f, 0.6);
  return cur + rest * (ritmo * w + preTot * (1 - w));
}

// Segnali nati durante la partita: soglie con probabilità >= 70% in base a punteggio, tempo e minuti giocati
export function segnaliLive(gara, box, giocatori) {
  const { casa, trasf, ptCasa, ptTr, r, f } = gara, rest = Math.max(0, 1 - f), out = [];
  if (rest < 0.03) return out;
  const part = `${nome(trasf, true)} @ ${nome(casa, true)}`, MIN_P = 0.70;
  const cur = ptCasa + ptTr, exp = stimaTotale(cur, f, r.totale), sd = Math.max(STD.Totale * Math.sqrt(rest), 0.6);
  const tt = []; for (let T = Math.floor(exp - 6 * sd) + 0.5; T <= exp + 6 * sd; T += 1) if (T > cur) tt.push(T);
  const ov = tt.filter((T) => 1 - phi((T - exp) / sd) >= MIN_P), un = tt.filter((T) => phi((T - exp) / sd) >= MIN_P);
  if (ov.length) { const T = Math.max(...ov); out.push({ tipo: "Totale", testo: `Totale over ${T}`, adesso: `${cur} ora`, stima: exp.toFixed(0), prob: 1 - phi((T - exp) / sd), motivo: `Con ${cur} punti e il ${Math.round(f * 100)}% giocato, la stima finale è ${exp.toFixed(0)}.` }); }
  if (un.length) { const T = Math.min(...un); out.push({ tipo: "Totale", testo: `Totale under ${T}`, adesso: `${cur} ora`, stima: exp.toFixed(0), prob: phi((T - exp) / sd), motivo: `Con ${cur} punti e il ${Math.round(f * 100)}% giocato, la stima finale è ${exp.toFixed(0)}.` }); }
  const media = ptCasa - ptTr + r.margine * rest, pc = phi(media / Math.max(STD.Spread * Math.sqrt(rest), 0.6));
  if (Math.max(pc, 1 - pc) >= 0.75) { const sq = pc >= 0.5 ? casa : trasf; out.push({ tipo: "Vincente", testo: `${nome(sq, true)} vince`, adesso: `${ptCasa}-${ptTr}`, stima: `${media >= 0 ? "+" : ""}${media.toFixed(0)}`, prob: Math.max(pc, 1 - pc), motivo: `Margine atteso a fine partita di circa ${Math.abs(media).toFixed(0)} punti.` }); }
  const minimi = { Punti: 9.5, Rimbalzi: 3.5, Assist: 2.5 };
  for (const pl of giocatori) {
    const b = (box || {})[pl.nome.trim().toLowerCase()];
    if (!b || !b.min || b.min < 4) continue;
    for (const [m, c] of Object.entries(MERCATI)) {
      const o = pl[c.k], c0 = b[c.k] != null ? b[c.k] : 0, mp = b.min;
      const restoMin = Math.max(pl.min - mp, 2), pm = o.v / pl.min, w = mp / (mp + 12), ritmo = c0 / mp;
      const e = c0 + restoMin * (pm * (1 - w) + ritmo * w), sdp = Math.max(o.sd * Math.sqrt(restoMin / pl.min), 0.6);
      const buoni = []; for (let T = Math.floor(c0) + 1.5; T <= e + 4 * sdp; T += 1) if (T >= minimi[m] && 1 - phi((T - e) / sdp) >= MIN_P) buoni.push(T);
      if (!buoni.length) continue;
      const T = Math.max(...buoni), pr = 1 - phi((T - e) / sdp);
      out.push({ tipo: m, pid: pl.pid, sq: pl.sq, testo: `${pl.nome} over ${T} ${c.unita}`, adesso: `${c0} ${c.unita} in ${Math.round(mp)} min`, stima: e.toFixed(1), prob: pr,
        motivo: `Ora ${c0} ${c.unita} in ${Math.round(mp)} minuti: ritmo e minuti rimasti portano la stima finale a ${e.toFixed(1)} (prima della gara ${o.v.toFixed(1)}).` });
    }
  }
  return out.sort((a, b) => b.prob - a.prob);
}

// ---------- PROPOSTE DI SCHEDINA
// Una sola giocata per partita (le giocate della stessa partita sono legate tra loro). Probabilità unita = prodotto delle singole.
export function proposte(picks, gare) {
  const pre = new Map(gare.filter((g) => g.stato === "pre").map((g) => [g.id, g]));
  const valide = picks.filter((x) => pre.has(x.g) && !["Squadra"].includes(x.tipo));
  const migliorePerPartita = (soglia, escludi = []) => {
    const m = new Map();
    for (const x of valide) {
      if (x.prob < soglia || escludi.includes(x.tipo)) continue;
      const k = x.g, cur = m.get(k);
      if (!cur || x.prob > cur.prob) m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.prob - a.prob);
  };
  const costruisciSchedina = (id, nomeS, sotto, n, soglia, tono) => {
    let legs = migliorePerPartita(soglia).slice(0, n);
    if (legs.length < 2) legs = valide.filter((x) => x.prob >= soglia).slice(0, Math.min(n, 3));
    if (legs.length < 2) return null;
    const p = legs.reduce((a, x) => a * x.prob, 1);
    const prima = legs.map((x) => pre.get(x.g).ora).sort()[0];
    return { id, nome: nomeS, sotto, tono, prob: p, quotaEqua: 1 / p, legs: legs.map((x) => ({ g: x.g, testo: x.testo, tipo: x.tipo, partita: x.partita, prob: x.prob, pid: x.pid || null, squadra: x.squadra || null, stima: x.stima, ora: pre.get(x.g).ora })), prima,
      stessaPartita: new Set(legs.map((x) => x.g)).size < legs.length };
  };
  const out = [
    costruisciSchedina("sicura", "La sicura", "Poche giocate, le più solide del giorno", 3, 0.78, "ok"),
    costruisciSchedina("equilibrata", "L'equilibrata", "Più giocate, ancora tutte sopra il 72%", 4, 0.72, "mid"),
    costruisciSchedina("ambiziosa", "L'ambiziosa", "Tante giocate: paga di più, ma è molto più difficile", 6, 0.70, "alta"),
  ].filter(Boolean);
  // giocatori: solo punti/rimbalzi/assist di giocatori in partite diverse
  const gioc = [...pre.values()].length ? (() => {
    const m = new Map();
    for (const x of valide) { if (!["Punti", "Rimbalzi", "Assist"].includes(x.tipo) || x.prob < 0.72) continue; const cur = m.get(x.g); if (!cur || x.prob > cur.prob) m.set(x.g, x); }
    const legs = [...m.values()].sort((a, b) => b.prob - a.prob).slice(0, 4);
    if (legs.length < 2) return null;
    const p = legs.reduce((a, x) => a * x.prob, 1);
    return { id: "giocatori", nome: "Solo giocatori", sotto: "Punti, rimbalzi e assist dei migliori in campo", tono: "mid", prob: p, quotaEqua: 1 / p, prima: legs.map((x) => pre.get(x.g).ora).sort()[0], stessaPartita: false,
      legs: legs.map((x) => ({ g: x.g, testo: x.testo, tipo: x.tipo, partita: x.partita, prob: x.prob, pid: x.pid || null, squadra: x.squadra || null, stima: x.stima, ora: pre.get(x.g).ora })) };
  })() : null;
  if (gioc) out.push(gioc);
  // evita proposte identiche
  const viste = new Set();
  return out.filter((s) => { const k = s.legs.map((l) => l.testo).join("|"); if (viste.has(k)) return false; viste.add(k); return true; });
}
