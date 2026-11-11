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

export function proiettaPartita(casa, trasf, teams, b2b = []) {
  const T = teams, pace = 100;
  const offCasa = (T[casa].pf + T[trasf].pa) / 2, offTr = (T[trasf].pf + T[casa].pa) / 2;
  const ptCasa = offCasa * pace / 100 + HOME_ADV / 2 - (b2b.includes(casa) ? B2B_PUNTI : 0);
  const ptTr = offTr * pace / 100 - HOME_ADV / 2 - (b2b.includes(trasf) ? B2B_PUNTI : 0);
  return { ptCasa, ptTr, totale: ptCasa + ptTr, margine: ptCasa - ptTr };
}

export function proiettaGiocatori(sig, avv, teams, players, infortuni = {}) {
  const lega = Object.values(teams).reduce((a, t) => a + t.pa, 0) / Object.keys(teams).length;
  const fDif = teams[avv].pa / lega;
  return players
    .filter((p) => p.sq === sig && p.min >= MIN_MINUTI && (infortuni[p.nome.trim().toLowerCase()] || {}).stato !== "out")
    .map((p) => {
      const inf = (infortuni[p.nome.trim().toLowerCase()] || {}).stato || "";
      const val = { Punti: p.pts * fDif, Rimbalzi: p.reb, Assist: p.ast };
      const o = { nome: p.nome, pid: p.pid, sq: sig, min: r1(p.min), inf, forma: r1(p.pts), stagione: r1(p.pts) };
      for (const [m, c] of Object.entries(MERCATI)) {
        const v = r1(val[m]);
        const sd = stdGiocatore(v, p.min, m);
        const lad = c.scalini.map((t) => ({ t, p: probOver(v, t, sd) })).filter((x) => x.p >= 0.2 && x.p <= 0.97);
        const buone = lad.filter((x) => x.p >= PROB_MIN);
        o[c.k] = { v, sd: r1(sd * 100) / 100, media: r1(m === "Punti" ? p.pts : m === "Rimbalzi" ? p.reb : p.ast), lad: lad.map((x) => [x.t, Math.round(x.p * 1000) / 1000]),
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
        motivo: `Stima ${r.totale.toFixed(1)} punti totali: probabilità di superare ${x} circa ${Math.round(pr * 100)}%.` }); }
    const un = scal.filter((x) => phi((x - r.totale) / STD.Totale) >= PROB_MIN);
    if (un.length) { const x = Math.min(...un), pr = phi((x - r.totale) / STD.Totale);
      out.push({ ...base, id: `tun_${g.id}`, tipo: "Totale", squadra: null, testo: `Totale under ${x}`, stima: r.totale.toFixed(1), prob: pr,
        motivo: `Stima ${r.totale.toFixed(1)} punti totali: probabilità di restare sotto ${x} circa ${Math.round(pr * 100)}%.` }); }
    for (const sq of [casa, trasf]) {
      const ds = g.giocatori.filter((p) => p.sq === sq);
      for (const [m, c] of Object.entries(MERCATI)) {
        for (const p of [...ds].sort((a, b) => b[c.k].v - a[c.k].v).slice(0, 3)) {
          const o = p[c.k];
          if (o.rec === null || o.rec < c.minimo) continue;
          const pr = probOver(o.v, o.rec, o.sd);
          out.push({ ...base, id: `${c.k}_${g.id}_${p.pid || p.nome}`, tipo: m, squadra: sq, pid: p.pid, testo: `${p.nome} over ${o.rec} ${c.unita}`, stima: o.v.toFixed(1), prob: pr,
            motivo: `Stima ${o.v.toFixed(1)} ${c.unita} (media stagione ${o.media.toFixed(1)}, ${Math.round(p.min)} min). Con la variabilità tipica, la probabilità di superare ${o.rec} è circa ${Math.round(pr * 100)}%. Se il bookmaker offre una linea più bassa, c'è valore.` });
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
