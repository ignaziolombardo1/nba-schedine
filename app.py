"""NBA Schedine - v2 (stile scuro sportivo).
Sezioni: Consigli (giocate ordinate per forza, con motivazione) e Studio partita.
Dati: nba_api (gratuita). Se non risponde parte la modalità DEMO.
Le linee dei bookmaker si inseriscono a mano (per ora).
Avvio:  streamlit run app.py
"""
import base64
import html
import os
import re
from datetime import datetime

import pandas as pd
import requests
import streamlit as st
import streamlit.components.v1 as components

ICON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.png")
try:
    from PIL import Image

    _icona = Image.open(ICON_PATH)
except Exception:
    _icona = "🏀"

st.set_page_config(page_title="NBA Schedine", page_icon=_icona, layout="centered")


def inietta_icona():
    """Prova a impostare l'icona per la schermata Home del telefono (apple-touch-icon)."""
    try:
        with open(ICON_PATH, "rb") as f:
            uri = "data:image/png;base64," + base64.b64encode(f.read()).decode()
    except Exception:
        return
    components.html(
        f"""<script>
        try {{
          const d = window.parent.document;
          d.querySelectorAll('link[rel="apple-touch-icon"], link[rel="icon"], link[rel="shortcut icon"]').forEach(e => e.remove());
          for (const rel of ['apple-touch-icon', 'icon']) {{
            const l = d.createElement('link'); l.rel = rel; l.href = '{uri}';
            if (rel === 'apple-touch-icon') l.setAttribute('sizes', '180x180'); else l.type = 'image/png';
            d.head.appendChild(l);
          }}
          if (!d.querySelector('meta[name="apple-mobile-web-app-title"]')) {{
            const m = d.createElement('meta'); m.name = 'apple-mobile-web-app-title'; m.content = 'NBA Schedine'; d.head.appendChild(m);
          }}
        }} catch (e) {{}}
        </script>""",
        height=0,
    )


inietta_icona()

HOME_ADV = 1.5      # vantaggio casa in punti (metà a testa)
MIN_MINUTI = 20     # giocatori con meno minuti medi vengono ignorati
PESO_FORMA = 0.6    # peso delle ultime 10 partite rispetto alla stagione
# Deviazioni tipiche (punti) per confrontare giocate di tipo diverso
STD = {"Totale": 17.0, "Spread": 11.0, "Giocatore": 6.0}

ARANCIO, VERDE, GRIGIO = "#ff7a1a", "#3ddc84", "#9aa0aa"

# ------------------------------------------------------------------ STILE
st.markdown(
    f"""
<style>
.stApp {{ background:#0f1115; color:#f2f2f2; }}
h1,h2,h3 {{ color:{ARANCIO}; }}
.card {{ background:#1b1f27; border-radius:12px; padding:12px 14px; margin-bottom:10px;
         display:flex; justify-content:space-between; align-items:center; gap:10px; }}
.card .s {{ font-size:12px; color:{GRIGIO}; }}
.card .t {{ font-size:16px; font-weight:600; }}
.card .v {{ font-size:18px; font-weight:700; text-align:right; white-space:nowrap; }}
.card .e {{ font-size:11px; text-align:right; color:{GRIGIO}; }}
.box {{ background:#2a2218; border-radius:12px; padding:12px 14px; margin:8px 0; }}
.card2 {{ background:#1b1f27; border-radius:12px; padding:12px 14px; margin-bottom:6px; }}
.riga {{ display:flex; justify-content:space-between; align-items:center; gap:8px; }}
.s {{ font-size:12px; color:{GRIGIO}; }}
.grande {{ font-size:28px; font-weight:600; }}
.pill {{ background:#0f1115; padding:3px 9px; border-radius:6px; font-size:11px; }}
button[role="tab"] {{ color:#f2f2f2; }}
button[role="tab"][aria-selected="true"] {{ color:{ARANCIO}; }}
</style>
""",
    unsafe_allow_html=True,
)


def card(sopra, titolo, valore, etichetta, colore=ARANCIO):
    st.markdown(
        f'<div class="card"><div><div class="s">{sopra}</div><div class="t">{titolo}</div></div>'
        f'<div><div class="v" style="color:{colore}">{valore}</div><div class="e">{etichetta}</div></div></div>',
        unsafe_allow_html=True,
    )


# ------------------------------------------------------------------- DATI
@st.cache_data(ttl=3600, show_spinner="Scarico i dati NBA...")
def carica_dati_live():
    from nba_api.live.nba.endpoints import scoreboard
    from nba_api.stats.endpoints import leaguedashplayerstats, leaguedashteamstats

    games = scoreboard.ScoreBoard(timeout=15).get_dict()["scoreboard"]["games"]
    partite = pd.DataFrame(
        [
            {
                "casa": g["homeTeam"]["teamTricode"],
                "trasf": g["awayTeam"]["teamTricode"],
                "ora": g.get("gameStatusText", ""),
            }
            for g in games
        ]
    )
    t = leaguedashteamstats.LeagueDashTeamStats(
        measure_type_detailed_defense="Advanced", per_mode_detailed="PerGame", timeout=20
    ).get_data_frames()[0]
    p_season = leaguedashplayerstats.LeagueDashPlayerStats(
        per_mode_detailed="PerGame", timeout=20
    ).get_data_frames()[0]
    p_form = leaguedashplayerstats.LeagueDashPlayerStats(
        per_mode_detailed="PerGame", last_n_games=10, timeout=20
    ).get_data_frames()[0]

    sigle = p_season[["TEAM_ID", "TEAM_ABBREVIATION"]].drop_duplicates()
    teams = t.merge(sigle, on="TEAM_ID")[
        ["TEAM_ABBREVIATION", "PACE", "OFF_RATING", "DEF_RATING"]
    ].set_index("TEAM_ABBREVIATION")
    players = p_season[["PLAYER_NAME", "TEAM_ABBREVIATION", "MIN", "PTS"]].merge(
        p_form[["PLAYER_NAME", "PTS"]], on="PLAYER_NAME", suffixes=("_ST", "_L10")
    )
    return partite, teams, players


def dati_demo():
    partite = pd.DataFrame(
        [
            {"casa": "BOS", "trasf": "LAL", "ora": "01:00"},
            {"casa": "DEN", "trasf": "GSW", "ora": "03:30"},
        ]
    )
    teams = pd.DataFrame(
        {
            "PACE": [98.5, 99.8, 97.9, 100.4],
            "OFF_RATING": [118.0, 114.5, 116.2, 115.0],
            "DEF_RATING": [110.5, 114.0, 111.8, 113.5],
        },
        index=["BOS", "LAL", "DEN", "GSW"],
    )
    players = pd.DataFrame(
        {
            "PLAYER_NAME": ["J. Tatum", "L. James", "N. Jokic", "S. Curry"],
            "TEAM_ABBREVIATION": ["BOS", "LAL", "DEN", "GSW"],
            "MIN": [36.0, 35.0, 34.5, 33.0],
            "PTS_ST": [27.0, 25.0, 26.5, 24.0],
            "PTS_L10": [29.0, 23.0, 28.0, 26.0],
        }
    )
    return partite, teams, players


# ------------------------------------------------------------------ ESPN
ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
ESPN_V2 = "https://site.api.espn.com/apis/v2/sports/basketball/nba"
ESPN_ATL = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete"


def _get(url, params=None):
    r = requests.get(url, params=params, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    return r.json()


def _entries(node):
    """Trova ricorsivamente le righe di classifica (ognuna ha 'team' e 'stats')."""
    if isinstance(node, dict):
        if isinstance(node.get("entries"), list):
            yield from node["entries"]
        for v in node.values():
            yield from _entries(v)
    elif isinstance(node, list):
        for v in node:
            yield from _entries(v)


@st.cache_data(ttl=1800, show_spinner="Scarico i dati NBA (ESPN)...")
def carica_espn():
    diag = []
    # 1) partite di oggi + linee dei bookmaker (se ESPN le fornisce)
    try:
        sb = _get(f"{ESPN}/scoreboard")
    except Exception as e:
        raise RuntimeError(f"ESPN partite: {type(e).__name__}")
    righe, linee = [], {}
    for ev in sb.get("events", []):
        comp = ev["competitions"][0]
        casa = next(c for c in comp["competitors"] if c["homeAway"] == "home")["team"]["abbreviation"]
        trasf = next(c for c in comp["competitors"] if c["homeAway"] == "away")["team"]["abbreviation"]
        stato = ev.get("status", {}).get("type", {})
        if stato.get("state") == "pre":
            ora = pd.to_datetime(ev["date"], utc=True).tz_convert("Europe/Rome").strftime("%d/%m %H:%M")
        else:
            ora = stato.get("shortDetail", "")
        righe.append({"casa": casa, "trasf": trasf, "ora": ora})
        for o in comp.get("odds", [])[:1]:
            if o.get("overUnder"):
                linee[f"tot_{casa}"] = float(o["overUnder"])
            m = re.match(r"^([A-Z]{2,4})\s+([+-]?\d+(?:\.\d+)?)$", str(o.get("details", "")).strip())
            if m:
                n = float(m.group(2))
                linee[f"spr_{casa}"] = n if m.group(1) == casa else -n
    partite = pd.DataFrame(righe, columns=["casa", "trasf", "ora"])
    diag.append(f"partite: {len(partite)}, linee trovate: {len(linee)}")

    # 2) punti fatti e subiti per squadra
    try:
        cl = _get(f"{ESPN_V2}/standings")
    except Exception as e:
        raise RuntimeError(f"ESPN squadre: {type(e).__name__}")
    righe_t, nomi, visti = [], {}, set()
    for en in _entries(cl):
        team = en.get("team", {})
        s = {x.get("name"): x.get("value") for x in en.get("stats", []) if isinstance(x, dict)}
        visti.update(s.keys())
        pf, pa = s.get("avgPointsFor"), s.get("avgPointsAgainst")
        if pf is None and s.get("pointsFor") and s.get("gamesPlayed"):
            pf, pa = s["pointsFor"] / s["gamesPlayed"], s["pointsAgainst"] / s["gamesPlayed"]
        if pf is None or pa is None or not team.get("abbreviation"):
            continue
        ab = team["abbreviation"]
        # PACE fisso a 100: il modello usa direttamente i punti medi fatti/subiti
        righe_t.append({"TEAM_ABBREVIATION": ab, "PACE": 100.0, "OFF_RATING": float(pf), "DEF_RATING": float(pa)})
        for k in ("abbreviation", "shortDisplayName", "name", "displayName", "location"):
            if team.get(k):
                nomi[str(team[k]).lower()] = ab
        if team.get("id"):
            nomi["id:" + str(team["id"])] = ab
    if not righe_t:
        raise RuntimeError("ESPN squadre: statistiche non trovate (nomi visti: " + ", ".join(sorted(map(str, visti)))[:200] + ")")
    teams = pd.DataFrame(righe_t).drop_duplicates("TEAM_ABBREVIATION").set_index("TEAM_ABBREVIATION")
    diag.append(f"squadre: {len(teams)}")

    # 3) punti e minuti dei giocatori (sperimentale: se fallisce, restano squadre e totale)
    cols = ["PLAYER_NAME", "TEAM_ABBREVIATION", "MIN", "PTS_ST", "PTS_L10"]
    righe_p = []
    try:
        oggi = datetime.now()
        stagione = oggi.year + 1 if oggi.month >= 10 else oggi.year
        pj = _get(ESPN_ATL, {"region": "us", "lang": "en", "contentorigin": "espn", "isqualified": "false",
                             "page": 1, "limit": 200, "sort": "offensive.avgPoints:desc",
                             "season": stagione, "seasontype": 2})
        nomi_col = {c.get("name"): c.get("names", []) for c in pj.get("categories", [])}
        for a in pj.get("athletes", []):
            v = {}
            for c in a.get("categories", []):
                for n, x in zip(nomi_col.get(c.get("name"), []), c.get("values", [])):
                    v[n] = x
            info = a.get("athlete", {})
            ab = (nomi.get("id:" + str(info.get("teamId")))
                  or nomi.get(str(info.get("teamShortName", "")).lower())
                  or nomi.get(str(info.get("teamName", "")).lower()))
            if ab and v.get("avgPoints") is not None and v.get("avgMinutes") is not None:
                righe_p.append({"PLAYER_NAME": info.get("displayName"), "TEAM_ABBREVIATION": ab,
                                "MIN": float(v["avgMinutes"]), "PTS_ST": float(v["avgPoints"]),
                                "PTS_L10": float(v["avgPoints"])})
        diag.append(f"giocatori: {len(righe_p)} (su {len(pj.get('athletes', []))} ricevuti)")
    except Exception as e:
        diag.append(f"giocatori: ERRORE {type(e).__name__}")
    players = pd.DataFrame(righe_p, columns=cols)
    return partite, teams, players, linee, diag


def carica_tutto():
    """Prova ESPN, poi nba_api, poi dati di esempio."""
    errori = []
    try:
        p, t, pl, linee, diag = carica_espn()
        return p, t, pl, linee, diag, "LIVE (ESPN)", errori
    except Exception as e:
        errori.append(str(e)[:200])
    try:
        p, t, pl = carica_dati_live()
        return p, t, pl, {}, [], "LIVE (nba_api)", errori
    except Exception as e:
        errori.append(f"nba_api: {type(e).__name__}")
    p, t, pl = dati_demo()
    return p, t, pl, {}, [], "DEMO", errori


# ---------------------------------------------------------------- MODELLO
def proietta_partita(casa, trasf, teams):
    lega_pace = teams["PACE"].mean()
    pace = (teams.loc[casa, "PACE"] + teams.loc[trasf, "PACE"]) / 2
    off_casa = (teams.loc[casa, "OFF_RATING"] + teams.loc[trasf, "DEF_RATING"]) / 2
    off_trasf = (teams.loc[trasf, "OFF_RATING"] + teams.loc[casa, "DEF_RATING"]) / 2
    pt_casa = off_casa * pace / 100 + HOME_ADV / 2
    pt_trasf = off_trasf * pace / 100 - HOME_ADV / 2
    return {
        "pt_casa": pt_casa,
        "pt_trasf": pt_trasf,
        "totale": pt_casa + pt_trasf,
        "margine_casa": pt_casa - pt_trasf,
        "fattore_pace": pace / lega_pace,
    }


def proietta_giocatori(sigla, avversaria, fattore_pace, teams, players, esclusi):
    lega_def = teams["DEF_RATING"].mean()
    f_dif = teams.loc[avversaria, "DEF_RATING"] / lega_def
    df = players[
        (players["TEAM_ABBREVIATION"] == sigla)
        & (players["MIN"] >= MIN_MINUTI)
        & (~players["PLAYER_NAME"].isin(esclusi))
    ].copy()
    base = PESO_FORMA * df["PTS_L10"] + (1 - PESO_FORMA) * df["PTS_ST"]
    df["atteso"] = (base * f_dif * fattore_pace).round(1)
    df["forma"] = df["PTS_L10"].round(1)
    df["stagione"] = df["PTS_ST"].round(1)
    df["minuti"] = df["MIN"].round(1)
    df["dif"] = f_dif
    return df[["PLAYER_NAME", "atteso", "forma", "stagione", "minuti", "dif"]].rename(
        columns={"PLAYER_NAME": "giocatore"}
    ).sort_values("atteso", ascending=False)


def forza(z):
    if z >= 0.4:
        return "Forte", VERDE
    if z >= 0.2:
        return "Media", ARANCIO
    return "Debole", GRIGIO


def segno(x):
    return f"{x:+g}"


def giocate_da_linee(proiezioni, gioc_df, linee):
    """Confronta stime e linee inserite. Ritorna lista di giocate ordinate per forza."""
    out = []
    for (casa, trasf), r in proiezioni.items():
        lt = linee.get(f"tot_{casa}")
        if lt:
            diff = r["totale"] - lt
            lato = "Over" if diff > 0 else "Under"
            out.append(
                dict(id=f"tot_{casa}", partita=f"{trasf} @ {casa}", tipo="Totale",
                     testo=f"{lato} {lt:g}", atteso=f"{r['totale']:.1f}",
                     diff=abs(diff), z=abs(diff) / STD["Totale"],
                     motivo=(f"Stima {r['totale']:.1f} punti ({casa} {r['pt_casa']:.1f} + {trasf} {r['pt_trasf']:.1f}), "
                             f"{abs(diff):.1f} {'sopra' if diff > 0 else 'sotto'} la linea {lt:g}."))
            )
        ls = linee.get(f"spr_{casa}")
        if ls is not None:
            # ls = handicap della squadra di casa (es. -4.5). Casa copre se margine + ls > 0
            diff = r["margine_casa"] + ls
            if diff > 0:
                testo = f"{casa} {segno(ls)}"
            else:
                testo = f"{trasf} {segno(-ls)}"
            out.append(
                dict(id=f"spr_{casa}", partita=f"{trasf} @ {casa}", tipo="Spread",
                     testo=testo, atteso=f"margine {casa} {r['margine_casa']:+.1f}",
                     diff=abs(diff), z=abs(diff) / STD["Spread"],
                     motivo=(f"Margine stimato {casa} {r['margine_casa']:+.1f}. Con handicap {casa} {segno(ls)} "
                             f"il segnale è di {abs(diff):.1f} punti a favore di: {testo}."))
            )
    for (casa, trasf), df in gioc_df.items():
        for _, p in df.iterrows():
            lp = linee.get(f"pl_{p['giocatore']}")
            if lp:
                diff = p["atteso"] - lp
                lato = "over" if diff > 0 else "under"
                out.append(
                    dict(id=f"pl_{p['giocatore']}", partita=f"{trasf} @ {casa}", tipo="Giocatore",
                         testo=f"{p['giocatore']} {lato} {lp:g} pt", atteso=f"{p['atteso']:.1f}",
                         diff=abs(diff), z=abs(diff) / STD["Giocatore"],
                         motivo=(f"Stima {p['atteso']:.1f} punti (stagione {p['stagione']:.1f}, forma {p['forma']:.1f}, "
                                 f"{p['minuti']:.0f} min), {abs(diff):.1f} {'sopra' if diff > 0 else 'sotto'} la linea {lp:g}. "
                                 f"Difesa avversaria {'più permeabile' if p['dif'] > 1 else 'più solida'} della media."))
                )
    return sorted(out, key=lambda g: g["z"], reverse=True)


# ------------------------------------------------------------------ STATO
if "linee" not in st.session_state:
    st.session_state.linee = {}
if "esclusi" not in st.session_state:
    st.session_state.esclusi = []


def campo_linea(chiave, etichetta, minimo=0.0, segnaposto=None):
    """Campo numerico (con + e -) che ricorda il valore anche quando cambi partita."""
    w = "w_" + chiave
    if w not in st.session_state and st.session_state.linee.get(chiave) is not None:
        st.session_state[w] = st.session_state.linee[chiave]

    def salva():
        st.session_state.linee[chiave] = st.session_state[w]

    st.number_input(etichetta, min_value=minimo, max_value=400.0, value=None, step=0.5,
                    key=w, on_change=salva, placeholder=segnaposto,
                    label_visibility="collapsed" if segnaposto else "visible")


# ------------------------------------------------------------------- DATI
st.title("🏀 NBA Schedine")

partite, teams, players, linee_auto, diag, modo, errori = carica_tutto()
if modo == "DEMO":
    st.warning("Dati live non disponibili: " + " | ".join(errori) + ". Uso dati di esempio.")
for k, v in linee_auto.items():
    st.session_state.linee.setdefault(k, v)

st.caption(f"Dati: {modo} · Strumento di supporto, non garantisce vincite.")
if linee_auto:
    st.caption("Alcune linee sono precompilate da ESPN: controllale sul tuo bookmaker prima di giocare.")

if partite.empty:
    st.info("Nessuna partita in programma oggi.")
    st.stop()

proiezioni, gioc_df = {}, {}
for _, g in partite.iterrows():
    casa, trasf = g["casa"], g["trasf"]
    if casa in teams.index and trasf in teams.index:
        r = proietta_partita(casa, trasf, teams)
        proiezioni[(casa, trasf)] = r
        esc = st.session_state.esclusi
        d = pd.concat(
            [
                proietta_giocatori(casa, trasf, r["fattore_pace"], teams, players, esc),
                proietta_giocatori(trasf, casa, r["fattore_pace"], teams, players, esc),
            ]
        )
        gioc_df[(casa, trasf)] = d
ore = {(g["casa"], g["trasf"]): g["ora"] for _, g in partite.iterrows()}

giocate = giocate_da_linee(proiezioni, gioc_df, st.session_state.linee)

# ---------------------------------------------------------------- GRAFICI
def esc(x):
    return html.escape(str(x))


def gauge(stima, linea):
    """Barra con la stima (pallino arancio) e la linea del bookmaker (lineetta bianca)."""
    lo, hi = stima - 20, stima + 20

    def p(v):
        return max(0, min(100, (v - lo) / (hi - lo) * 100))

    marcatore = ""
    testo = f"Stima {stima:.1f}"
    if linea:
        marcatore = f'<div style="position:absolute;left:{p(linea)}%;top:-4px;width:2px;height:18px;background:#f2f2f2"></div>'
        testo = f"Linea {linea:g} · Stima {stima:.1f}"
    return (
        f'<div style="position:relative;height:10px;background:#2a2f3a;border-radius:5px;margin:14px 0 6px">{marcatore}'
        f'<div style="position:absolute;left:calc({p(stima)}% - 6px);top:-1px;width:12px;height:12px;'
        f'border-radius:50%;background:{ARANCIO}"></div></div><div class="s">{testo}</div>'
    )


def pillola(z):
    et, col = forza(z)
    return f'<span class="pill" style="color:{col}">{et}</span>'


def scheda_partita(casa, trasf, r, ora, miglior):
    lt = st.session_state.linee.get(f"tot_{casa}")
    h = f'<div class="card2"><div class="riga"><b>{esc(trasf)} @ {esc(casa)}</b><span class="s">{esc(ora)}</span></div>'
    h += gauge(r["totale"], lt)
    if miglior:
        h += f'<div class="riga" style="margin-top:8px"><span>{esc(miglior["testo"])}</span>{pillola(miglior["z"])}</div>'
    else:
        h += '<div class="s" style="margin-top:8px">Nessuna linea inserita</div>'
    return h + "</div>"


def barra_giocatore(p, lp):
    scala = max(40.0, p["atteso"] * 1.3, (lp or 0) * 1.3)
    marcatore = ""
    if lp:
        marcatore = f'<div style="position:absolute;left:{lp / scala * 100}%;top:-3px;width:2px;height:14px;background:#f2f2f2"></div>'
    return (
        f'<div class="card2"><div class="riga"><b>{esc(p["giocatore"])}</b>'
        f'<span class="s">{p["minuti"]:.0f} min</span></div>'
        f'<div style="position:relative;height:8px;background:#2a2f3a;border-radius:4px;margin:12px 0 6px">'
        f'<div style="width:{p["atteso"] / scala * 100}%;height:8px;background:{ARANCIO};border-radius:4px"></div>{marcatore}</div>'
        f'<div class="riga"><span class="s">Stima {p["atteso"]:.1f} · forma {p["forma"]:.1f} · stagione {p["stagione"]:.1f}</span></div></div>'
    )


def elenco_consigli(giocate):
    gruppi = {"Forte": [], "Media": [], "Debole": []}
    for gi in giocate:
        gruppi[forza(gi["z"])[0]].append(gi)
    for nome, titolo in (("Forte", "Segnali forti"), ("Media", "Segnali medi"), ("Debole", "Segnali deboli")):
        if not gruppi[nome]:
            continue
        contenitore = st.expander(f"{titolo} ({len(gruppi[nome])})") if nome == "Debole" else st.container()
        with contenitore:
            if nome != "Debole":
                st.markdown(f"**{titolo}**")
            for gi in gruppi[nome]:
                card(f"{gi['partita']} · {gi['tipo']}", gi["testo"], f"{gi['diff']:.1f} pt",
                     f"stima {gi['atteso']}", forza(gi["z"])[1])
                st.caption(gi["motivo"])


# ------------------------------------------------------------- NAVIGAZIONE
per_id = {g["id"]: g for g in giocate}
miglior = {}
for gi in giocate:
    miglior.setdefault(gi["partita"], gi)

if "vista" not in st.session_state:
    st.session_state.vista = "Giornata"


def vai_studio(etichetta):
    st.session_state.partita = etichetta
    st.session_state.vista = "Studio partita"


vista = st.segmented_control("Vista", ["Giornata", "Studio partita"], key="vista",
                             label_visibility="collapsed") or "Giornata"

# ---------------------------------------------------------------- GIORNATA
if vista == "Giornata":
    forti = sum(1 for g in giocate if forza(g["z"])[0] == "Forte")
    st.caption(f"{len(proiezioni)} partite · {forti} segnali forti · {len(giocate)} giocate analizzate")
    for (casa, trasf), r in proiezioni.items():
        st.markdown(scheda_partita(casa, trasf, r, ore.get((casa, trasf), ""),
                                   miglior.get(f"{trasf} @ {casa}")), unsafe_allow_html=True)
        st.button("Studia questa partita", key=f"vai_{casa}", on_click=vai_studio,
                  args=(f"{trasf} @ {casa}",), use_container_width=True)
    st.markdown("### Consigli ordinati")
    if giocate:
        st.caption("Ogni consiglio confronta la stima dell'app con la linea del bookmaker. "
                   "Più la distanza è grande, più il segnale è forte. È un'indicazione, non una certezza.")
        elenco_consigli(giocate)
    else:
        st.info("Nessun consiglio ancora: apri «Studio partita» e inserisci le linee "
                "(se ESPN le ha trovate, sono già compilate).")

# ----------------------------------------------------------- STUDIO PARTITA
else:
    opzioni = [f"{t} @ {c}" for (c, t) in proiezioni]
    if st.session_state.get("partita") not in opzioni:
        st.session_state.partita = opzioni[0]
    scelta = st.pills("Partita", opzioni, key="partita", label_visibility="collapsed") or opzioni[0]
    trasf, casa = [x.strip() for x in scelta.split("@")]
    r = proiezioni[(casa, trasf)]
    d = gioc_df[(casa, trasf)]
    marg = r["margine_casa"]
    fav = casa if marg > 0 else trasf
    quota_casa = r["pt_casa"] / (r["pt_casa"] + r["pt_trasf"]) * 100

    st.markdown(
        f'<div class="card2"><div class="riga" style="align-items:flex-end">'
        f'<div><div class="s">{esc(casa)} casa</div><div class="grande">{r["pt_casa"]:.1f}</div></div>'
        f'<div class="s">{esc(ore.get((casa, trasf), ""))}</div>'
        f'<div style="text-align:right"><div class="s">{esc(trasf)}</div><div class="grande">{r["pt_trasf"]:.1f}</div></div></div>'
        f'<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;margin-top:10px">'
        f'<div style="width:{quota_casa}%;background:{ARANCIO}"></div><div style="flex:1;background:#4a5060"></div></div>'
        f'<div class="s" style="margin-top:6px">Favorita {esc(fav)} di {abs(marg):.1f} punti</div></div>',
        unsafe_allow_html=True,
    )

    st.markdown("### Totale e spread")
    gt = per_id.get(f"tot_{casa}")
    st.markdown(
        f'<div class="card2"><div class="riga"><span class="s">Over/Under</span>'
        f'{pillola(gt["z"]) if gt else ""}</div>'
        f'{gauge(r["totale"], st.session_state.linee.get(f"tot_{casa}"))}</div>',
        unsafe_allow_html=True,
    )
    c1, c2 = st.columns(2)
    with c1:
        campo_linea(f"tot_{casa}", "Linea Over/Under")
    with c2:
        campo_linea(f"spr_{casa}", f"Handicap {casa} (es. -4.5)", minimo=-60.0)
    trovati = [per_id[k] for k in (f"tot_{casa}", f"spr_{casa}") if k in per_id]
    for gi in trovati:
        card(gi["tipo"], gi["testo"], f"{gi['diff']:.1f} pt", f"stima {gi['atteso']}", forza(gi["z"])[1])
        st.caption(gi["motivo"])
    if not trovati:
        st.caption("Inserisci le linee per ricevere il consiglio.")

    st.markdown("### Giocatori")
    if players.empty:
        st.info("Statistiche dei giocatori non disponibili con questa fonte.")
    else:
        rosa = players[(players["TEAM_ABBREVIATION"].isin([casa, trasf])) & (players["MIN"] >= MIN_MINUTI)]
        tutti = sorted(set(rosa["PLAYER_NAME"]) | set(st.session_state.esclusi))
        st.pills("Tocca i giocatori che sono out", tutti, selection_mode="multi", key="esclusi")
        for _, p in d.iterrows():
            lp = st.session_state.linee.get(f"pl_{p['giocatore']}")
            st.markdown(barra_giocatore(p, lp), unsafe_allow_html=True)
            campo_linea(f"pl_{p['giocatore']}", "Linea punti", segnaposto=f"Linea punti (es. {round(p['atteso'] * 2) / 2:g})")
            gi = per_id.get(f"pl_{p['giocatore']}")
            if gi:
                st.caption(f"**{gi['testo']}** ({forza(gi['z'])[0]}). {gi['motivo']}")

    st.markdown("### Da controllare prima di decidere")
    note = ["Infortuni e formazioni: l'app non li legge ancora. Segna i giocatori out e controlla le "
            "ultime notizie poco prima della partita.",
            "Back-to-back e riposi: non sono considerati nel calcolo."]
    if "ESPN" in modo:
        note.append("Con la fonte ESPN la forma recente non è disponibile: le stime dei giocatori usano la media stagionale.")
    if abs(marg) >= 10:
        note.append("Margine stimato ampio: nei finali sbilanciati i titolari possono giocare meno minuti, "
                    "con rischio per gli over sui giocatori.")
    if abs(marg) < 3:
        note.append("Partita molto equilibrata: lo spread è poco affidabile, conta di più il totale.")
    for n in note:
        st.markdown("• " + n)

with st.expander("Diagnostica dati"):
    st.write(f"Fonte: **{modo}**")
    for riga in diag:
        st.write("• " + riga)
    for err in errori:
        st.write("• errore: " + err)
    st.write(f"Partite: {len(partite)} · Squadre: {len(teams)} · Giocatori: {len(players)}")
