"""NBA Schedine - v2 (stile scuro sportivo).
Sezioni: Consigli (giocate ordinate per forza, con motivazione) e Studio partita.
Dati: nba_api (gratuita). Se non risponde parte la modalità DEMO.
Le linee dei bookmaker si inseriscono a mano (per ora).
Avvio:  streamlit run app.py
"""
import base64
import html
import math
import os
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import streamlit as st
import streamlit.components.v1 as components

def _trova_icona():
    """Usa icon.png se c'è, altrimenti la prima immagine .png accanto all'app (es. IMG_4957.png)."""
    cartella = os.path.dirname(os.path.abspath(__file__))
    preferita = os.path.join(cartella, "icon.png")
    if os.path.exists(preferita):
        return preferita
    try:
        png = sorted(f for f in os.listdir(cartella) if f.lower().endswith(".png"))
    except Exception:
        png = []
    return os.path.join(cartella, png[0]) if png else preferita


ICON_PATH = _trova_icona()
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
STD = {"Totale": 17.0, "Spread": 12.0, "Giocatore": 6.0, "Squadra": 12.0}

ARANCIO, VERDE, GRIGIO = "#ff7a1a", "#3ddc84", "#9aa0aa"

# ------------------------------------------------------------------ STILE
st.markdown(
    f"""
<style>
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap");
@import url("https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.3.0/dist/tabler-icons.min.css");
html, body, .stApp, [data-testid="stAppViewContainer"] {{ font-family:'Inter',-apple-system,sans-serif; }}
.stApp {{ background:#0b0d12; color:#f2f2f2; }}
h1,h2,h3 {{ color:#f2f2f2; font-weight:600; letter-spacing:-0.01em; }}
h3 {{ font-size:1.05rem; margin-top:0.8rem; }}
.testata {{ display:flex; align-items:center; gap:12px; margin-bottom:6px; }}
.logo {{ width:40px; height:40px; border-radius:12px; background:{ARANCIO}; display:flex; align-items:center;
         justify-content:center; font-size:22px; }}
.nome {{ font-size:18px; font-weight:600; }}
.card, .card2 {{ background:#14171f; border:1px solid #232836; border-radius:16px; padding:12px 14px; margin-bottom:8px; }}
.card {{ display:flex; justify-content:space-between; align-items:center; gap:10px; }}
.card .s {{ font-size:12px; color:{GRIGIO}; }}
.card .t {{ font-size:15px; font-weight:500; }}
.card .v {{ font-size:18px; font-weight:600; text-align:right; white-space:nowrap; }}
.card .e {{ font-size:11px; text-align:right; color:{GRIGIO}; }}
.box {{ background:#14171f; border:1px solid #232836; border-radius:16px; padding:12px 14px; margin:8px 0; }}
.riga {{ display:flex; justify-content:space-between; align-items:center; gap:8px; }}
.s {{ font-size:12px; color:{GRIGIO}; }}
.grande {{ font-size:28px; font-weight:600; }}
.pill {{ background:#0b0d12; border:1px solid #232836; padding:3px 10px; border-radius:999px; font-size:11px; }}
.badge {{ padding:2px 7px; border-radius:6px; font-size:11px; font-weight:600; margin-right:6px; }}
.tre {{ display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:10px; }}
.tile {{ background:#0b0d12; border-radius:10px; padding:6px; text-align:center; border:1px solid transparent; }}
.tile b {{ font-size:18px; }}
.tile span {{ display:block; font-size:11px; color:{GRIGIO}; }}
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
    players = p_season[["PLAYER_NAME", "TEAM_ABBREVIATION", "MIN", "PTS", "REB", "AST"]].merge(
        p_form[["PLAYER_NAME", "PTS", "REB", "AST"]], on="PLAYER_NAME", suffixes=("_ST", "_L10")
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
            "REB_ST": [8.5, 7.5, 12.4, 4.4],
            "REB_L10": [9.0, 7.0, 13.0, 4.0],
            "AST_ST": [4.9, 8.3, 9.0, 6.1],
            "AST_L10": [5.0, 8.0, 9.5, 6.5],
        }
    )
    return partite, teams, players


# ----------------------------------------------------------------- SQUADRE
# sigla: (nome completo, nome breve, colore)
SQUADRE = {
    "ATL": ("Atlanta Hawks", "Hawks", "#E03A3E"), "BOS": ("Boston Celtics", "Celtics", "#2a9d5c"),
    "BKN": ("Brooklyn Nets", "Nets", "#8a8f98"), "CHA": ("Charlotte Hornets", "Hornets", "#1D9BB4"),
    "CHI": ("Chicago Bulls", "Bulls", "#CE1141"), "CLE": ("Cleveland Cavaliers", "Cavaliers", "#B0305A"),
    "DAL": ("Dallas Mavericks", "Mavericks", "#2a7fc1"), "DEN": ("Denver Nuggets", "Nuggets", "#FEC524"),
    "DET": ("Detroit Pistons", "Pistons", "#C8102E"), "GSW": ("Golden State Warriors", "Warriors", "#FFC72C"),
    "GS": ("Golden State Warriors", "Warriors", "#FFC72C"), "HOU": ("Houston Rockets", "Rockets", "#CE1141"),
    "IND": ("Indiana Pacers", "Pacers", "#FDBB30"), "LAC": ("Los Angeles Clippers", "Clippers", "#C8102E"),
    "LAL": ("Los Angeles Lakers", "Lakers", "#FDB927"), "MEM": ("Memphis Grizzlies", "Grizzlies", "#5D76A9"),
    "MIA": ("Miami Heat", "Heat", "#C4163F"), "MIL": ("Milwaukee Bucks", "Bucks", "#2a8a4a"),
    "MIN": ("Minnesota Timberwolves", "Timberwolves", "#4b8fd0"), "NOP": ("New Orleans Pelicans", "Pelicans", "#B49C6A"),
    "NO": ("New Orleans Pelicans", "Pelicans", "#B49C6A"), "NYK": ("New York Knicks", "Knicks", "#F58426"),
    "NY": ("New York Knicks", "Knicks", "#F58426"), "OKC": ("Oklahoma City Thunder", "Thunder", "#007AC1"),
    "ORL": ("Orlando Magic", "Magic", "#0077C0"), "PHI": ("Philadelphia 76ers", "76ers", "#2a7fd0"),
    "PHX": ("Phoenix Suns", "Suns", "#E56020"), "POR": ("Portland Trail Blazers", "Trail Blazers", "#E03A3E"),
    "SAC": ("Sacramento Kings", "Kings", "#8e5cc2"), "SAS": ("San Antonio Spurs", "Spurs", "#C4CED4"),
    "SA": ("San Antonio Spurs", "Spurs", "#C4CED4"), "TOR": ("Toronto Raptors", "Raptors", "#CE1141"),
    "UTA": ("Utah Jazz", "Jazz", "#F9A01B"), "UTAH": ("Utah Jazz", "Jazz", "#F9A01B"),
    "WAS": ("Washington Wizards", "Wizards", "#E31837"), "WSH": ("Washington Wizards", "Wizards", "#E31837"),
}


def nome_squadra(ab, breve=False):
    t = SQUADRE.get(ab)
    return (t[1] if breve else t[0]) if t else ab


def etichetta(casa, trasf):
    return f"{nome_squadra(trasf, True)} @ {nome_squadra(casa, True)}"


def _testo_su(colore):
    r, g, b = (int(colore[i:i + 2], 16) for i in (1, 3, 5))
    return "#0f1115" if (0.299 * r + 0.587 * g + 0.114 * b) > 150 else "#ffffff"


def badge(ab):
    col = SQUADRE.get(ab, ("", "", "#4a5060"))[2]
    return f'<span class="badge" style="background:{col};color:{_testo_su(col)}">{html.escape(str(ab))}</span>'


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


EXTRA = ["id", "stato", "dettaglio", "pt_casa_reale", "pt_trasf_reale"]
COLONNE_PARTITE = ["casa", "trasf", "ora"] + EXTRA


def _completa(df):
    for c in COLONNE_PARTITE:
        if c not in df.columns:
            df[c] = None
    return df[COLONNE_PARTITE]


def _punti(x):
    try:
        return int(float(x))
    except Exception:
        return None


def _leggi_scoreboard(sb):
    """Da JSON ESPN a (righe partite, linee bookmaker)."""
    righe, linee = [], {}
    for ev in sb.get("events", []):
        comp = ev["competitions"][0]
        c_casa = next(c for c in comp["competitors"] if c["homeAway"] == "home")
        c_trasf = next(c for c in comp["competitors"] if c["homeAway"] == "away")
        casa, trasf = c_casa["team"]["abbreviation"], c_trasf["team"]["abbreviation"]
        tipo = ev.get("status", {}).get("type", {})
        stato = tipo.get("state")
        ora = pd.to_datetime(ev["date"], utc=True).tz_convert("Europe/Rome").strftime("%d/%m %H:%M")
        righe.append({
            "casa": casa, "trasf": trasf, "ora": ora, "id": ev.get("id"), "stato": stato, "dettaglio": tipo.get("shortDetail", ""),
            "pt_casa_reale": _punti(c_casa.get("score")) if stato != "pre" else None,
            "pt_trasf_reale": _punti(c_trasf.get("score")) if stato != "pre" else None,
        })
        for o in comp.get("odds", [])[:1]:
            if o.get("overUnder"):
                linee[f"tot_{casa}"] = float(o["overUnder"])
            m = re.match(r"^([A-Z]{2,4})\s+([+-]?\d+(?:\.\d+)?)$", str(o.get("details", "")).strip())
            if m:
                n = float(m.group(2))
                linee[f"spr_{casa}"] = n if m.group(1) == casa else -n
    return righe, linee


@st.cache_data(ttl=120, show_spinner="Aggiorno partite e punteggi...")
def carica_partite_espn(giorno=None):
    """Partite di oggi (con punteggi live/finali e linee) e risultati di ieri. Cache breve: 2 minuti."""
    try:
        sb = _get(f"{ESPN}/scoreboard", {"dates": giorno} if giorno else None)
    except Exception as e:
        raise RuntimeError(f"ESPN partite: {type(e).__name__}")
    righe, linee = _leggi_scoreboard(sb)
    partite = _completa(pd.DataFrame(righe, columns=COLONNE_PARTITE))
    ieri = _completa(pd.DataFrame(columns=COLONNE_PARTITE))
    try:
        try:
            ora_us = datetime.now(ZoneInfo("America/New_York"))
        except Exception:
            ora_us = datetime.utcnow() - timedelta(hours=5)
        base = datetime.strptime(giorno, "%Y%m%d") if giorno else ora_us
        g_ieri = (base - timedelta(days=1)).strftime("%Y%m%d")
        righe_ieri, _ = _leggi_scoreboard(_get(f"{ESPN}/scoreboard", {"dates": g_ieri}))
        ieri = _completa(pd.DataFrame([x for x in righe_ieri if x["stato"] == "post"], columns=COLONNE_PARTITE))
    except Exception:
        pass
    try:
        aggiornato = datetime.now(ZoneInfo("Europe/Rome")).strftime("%H:%M")
    except Exception:
        aggiornato = datetime.now().strftime("%H:%M")
    return partite, linee, ieri, aggiornato


@st.cache_data(ttl=1800, show_spinner="Scarico le statistiche NBA (ESPN)...")
def carica_statistiche_espn():
    """Statistiche di squadre e giocatori. Cache di 30 minuti."""
    diag = []
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

    cols = ["PLAYER_NAME", "PLAYER_ID", "TEAM_ABBREVIATION", "MIN", "PTS_ST", "PTS_L10", "REB_ST", "REB_L10", "AST_ST", "AST_L10"]
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
                reb = float(v.get("avgRebounds") or 0.0)
                ast = float(v.get("avgAssists") or 0.0)
                righe_p.append({"PLAYER_NAME": info.get("displayName"), "PLAYER_ID": str(info.get("id", "")), "TEAM_ABBREVIATION": ab,
                                "MIN": float(v["avgMinutes"]), "PTS_ST": float(v["avgPoints"]),
                                "PTS_L10": float(v["avgPoints"]), "REB_ST": reb, "REB_L10": reb,
                                "AST_ST": ast, "AST_L10": ast})
        diag.append(f"giocatori: {len(righe_p)} (su {len(pj.get('athletes', []))} ricevuti)")
    except Exception as e:
        diag.append(f"giocatori: ERRORE {type(e).__name__}")
    return teams, pd.DataFrame(righe_p, columns=cols), diag


def carica_tutto(giorno=None):
    """Prova ESPN, poi nba_api, poi dati di esempio."""
    errori = []
    try:
        partite, linee, ieri, agg = carica_partite_espn(giorno)
        teams, players, diag_s = carica_statistiche_espn()
        diag = [f"partite oggi: {len(partite)}, linee trovate: {len(linee)}, risultati di ieri: {len(ieri)}"] + diag_s
        return partite, teams, players, linee, diag, "LIVE (ESPN)", errori, ieri, agg
    except Exception as e:
        errori.append(str(e)[:200])
    vuoto = _completa(pd.DataFrame(columns=COLONNE_PARTITE))
    try:
        p, t, pl = carica_dati_live()
        return _completa(p), t, pl, {}, [], "LIVE (nba_api)", errori, vuoto, datetime.now().strftime("%H:%M")
    except Exception as e:
        errori.append(f"nba_api: {type(e).__name__}")
    p, t, pl = dati_demo()
    return _completa(p), t, pl, {}, [], "DEMO", errori, vuoto, datetime.now().strftime("%H:%M")


@st.cache_data(ttl=600, show_spinner=False)
def carica_infortuni():
    """Infortuni segnalati da ESPN: {nome minuscolo: {'stato': 'out' | 'dubbio', 'dettaglio': ...}}."""
    d = _get(f"{ESPN}/injuries")
    out = {}
    for t in d.get("injuries", []):
        for i in t.get("injuries", []):
            nome = i.get("athlete", {}).get("displayName")
            stato = str(i.get("status", "")).lower()
            if nome:
                out[nome.strip().lower()] = {
                    "stato": "out" if "out" in stato else "dubbio",
                    "dettaglio": i.get("shortComment") or i.get("status") or "",
                }
    return out


# ---------------------------------------------------------------- MODELLO
B2B_PUNTI = 1.2  # punti in meno stimati per una squadra che ha giocato ieri


def proietta_partita(casa, trasf, teams, b2b=()):
    lega_pace = teams["PACE"].mean()
    pace = (teams.loc[casa, "PACE"] + teams.loc[trasf, "PACE"]) / 2
    off_casa = (teams.loc[casa, "OFF_RATING"] + teams.loc[trasf, "DEF_RATING"]) / 2
    off_trasf = (teams.loc[trasf, "OFF_RATING"] + teams.loc[casa, "DEF_RATING"]) / 2
    pt_casa = off_casa * pace / 100 + HOME_ADV / 2 - (B2B_PUNTI if casa in b2b else 0.0)
    pt_trasf = off_trasf * pace / 100 - HOME_ADV / 2 - (B2B_PUNTI if trasf in b2b else 0.0)
    return {
        "pt_casa": pt_casa,
        "pt_trasf": pt_trasf,
        "totale": pt_casa + pt_trasf,
        "margine_casa": pt_casa - pt_trasf,
        "fattore_pace": pace / lega_pace,
    }


def proietta_giocatori(sigla, avversaria, fattore_pace, teams, players, esclusi, infortuni=None):
    lega_def = teams["DEF_RATING"].mean()
    f_dif = teams.loc[avversaria, "DEF_RATING"] / lega_def
    df = players[
        (players["TEAM_ABBREVIATION"] == sigla)
        & (players["MIN"] >= MIN_MINUTI)
        & (~players["PLAYER_NAME"].isin(esclusi))
    ].copy()
    inf = infortuni or {}
    df["inf"] = df["PLAYER_NAME"].str.strip().str.lower().map(lambda n: inf.get(n, {}).get("stato", ""))
    df = df[df["inf"] != "out"].copy()
    df["pid"] = df["PLAYER_ID"] if "PLAYER_ID" in df.columns else ""

    def mix(l10, st_):
        return PESO_FORMA * df[l10] + (1 - PESO_FORMA) * df[st_]

    df["atteso"] = (mix("PTS_L10", "PTS_ST") * f_dif * fattore_pace).round(1)
    df["reb"] = (mix("REB_L10", "REB_ST") * fattore_pace).round(1)
    df["ast"] = (mix("AST_L10", "AST_ST") * fattore_pace).round(1)
    df["forma"] = df["PTS_L10"].round(1)
    df["stagione"] = df["PTS_ST"].round(1)
    df["reb_st"] = df["REB_ST"].round(1)
    df["ast_st"] = df["AST_ST"].round(1)
    df["minuti"] = df["MIN"].round(1)
    df["dif"] = f_dif
    df["squadra"] = sigla
    return df[["PLAYER_NAME", "squadra", "atteso", "reb", "ast", "forma", "stagione", "reb_st", "ast_st",
               "minuti", "dif", "inf", "pid"]].rename(columns={"PLAYER_NAME": "giocatore"}).sort_values("atteso", ascending=False)


def forza(z):
    if z >= 0.4:
        return "Forte", VERDE
    if z >= 0.2:
        return "Media", ARANCIO
    return "Debole", GRIGIO


def segno(x):
    return f"{x:+g}"


# nome: (prefisso chiave linea, colonna stima, colonna media stagione, unità)
MERCATI = {
    "Punti": ("pl_", "atteso", "stagione", "pt"),
    "Rimbalzi": ("rb_", "reb", "reb_st", "rimb."),
    "Assist": ("as_", "ast", "ast_st", "ass."),
}
PROB_MIN = 0.70  # probabilità minima per consigliare una soglia
CV_MERCATO = {"Punti": 0.30, "Rimbalzi": 0.40, "Assist": 0.45}   # variabilità tipica (std / media)
STD_MIN = {"Punti": 3.0, "Rimbalzi": 1.5, "Assist": 1.3}
# soglie "over" disponibili e soglia minima interessante da consigliare
SCALINI = {
    "Punti": ([9.5, 12.5, 14.5, 17.5, 19.5, 22.5, 24.5, 27.5, 29.5, 32.5, 34.5, 39.5], 14.5),
    "Rimbalzi": ([2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5], 5.5),
    "Assist": ([1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5], 4.5),
}


def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def std_giocatore(val, minuti, mercato):
    """Variabilità attesa: più alta per chi gioca pochi minuti (rendimento meno stabile)."""
    cv = CV_MERCATO[mercato] * (1 + 0.02 * max(0.0, 34.0 - minuti))
    return max(val * cv, STD_MIN[mercato])


def prob_over(val, soglia, sd):
    return 1 - phi((soglia - val) / sd)


def consigli_automatici(proiezioni, gioc_df, n_top=3):
    """Giocate consigliate senza bisogno delle linee: soglie con probabilità >= 70% secondo il modello."""
    out = []
    for (casa, trasf), r in proiezioni.items():
        part = etichetta(casa, trasf)
        n0 = len(out)
        marg = r["margine_casa"]
        fav = casa if marg > 0 else trasf
        pw = phi(abs(marg) / STD["Spread"])
        if pw >= 0.60:
            out.append(dict(id=f"auto_win_{casa}", partita=part, tipo="Vincente", squadra=fav,
                            testo=f"{nome_squadra(fav, True)} vince", stima=f"+{abs(marg):.1f}", prob=pw,
                            motivo=(f"Margine stimato di {abs(marg):.1f} punti a favore di {nome_squadra(fav, True)}: "
                                    f"probabilità di vittoria circa {pw:.0%}.")))
        for sq, pt in ((casa, r["pt_casa"]), (trasf, r["pt_trasf"])):
            buoni = [x for x in (84.5 + 2 * i for i in range(26)) if 1 - phi((x - pt) / STD["Squadra"]) >= PROB_MIN]
            if buoni:
                x = max(buoni)
                pr = 1 - phi((x - pt) / STD["Squadra"])
                out.append(dict(id=f"auto_sq_{sq}", partita=part, tipo="Squadra", squadra=sq,
                                testo=f"{nome_squadra(sq, True)} over {x:g} punti", stima=f"{pt:.1f}", prob=pr,
                                motivo=(f"Stima {pt:.1f} punti per {nome_squadra(sq, True)}: la probabilità di superare "
                                        f"{x:g} è circa {pr:.0%}.")))
        scal_tot = [190.5 + 2 * i for i in range(36)]
        ov = [x for x in scal_tot if 1 - phi((x - r["totale"]) / STD["Totale"]) >= PROB_MIN]
        if ov:
            x = max(ov)
            pr = 1 - phi((x - r["totale"]) / STD["Totale"])
            out.append(dict(id=f"auto_tov_{casa}", partita=part, tipo="Totale", squadra=None,
                            testo=f"Totale over {x:g}", stima=f"{r['totale']:.1f}", prob=pr,
                            motivo=f"Stima {r['totale']:.1f} punti totali: probabilità di superare {x:g} circa {pr:.0%}."))
        un = [x for x in scal_tot if phi((x - r["totale"]) / STD["Totale"]) >= PROB_MIN]
        if un:
            x = min(un)
            pr = phi((x - r["totale"]) / STD["Totale"])
            out.append(dict(id=f"auto_tun_{casa}", partita=part, tipo="Totale", squadra=None,
                            testo=f"Totale under {x:g}", stima=f"{r['totale']:.1f}", prob=pr,
                            motivo=f"Stima {r['totale']:.1f} punti totali: probabilità di restare sotto {x:g} circa {pr:.0%}."))
        df = gioc_df[(casa, trasf)]
        for sq in (casa, trasf):
            ds = df[df["squadra"] == sq]
            for mercato, (pref, col, col_st, unita) in MERCATI.items():
                scalini, minimo = SCALINI[mercato]
                for _, pl in ds.nlargest(n_top, col).iterrows():
                    val = pl[col]
                    sd = std_giocatore(val, pl["minuti"], mercato)
                    buoni = [x for x in scalini if prob_over(val, x, sd) >= PROB_MIN]
                    if not buoni or max(buoni) < minimo:
                        continue
                    soglia = max(buoni)
                    pr = prob_over(val, soglia, sd)
                    out.append(dict(
                        id=f"auto_{pref}{pl['giocatore']}", partita=part, tipo=mercato, squadra=sq, pid=pl["pid"],
                        testo=f"{pl['giocatore']} over {soglia:g} {unita}", stima=f"{val:.1f}", prob=pr,
                        motivo=(f"Stima {val:.1f} {unita} (media stagione {pl[col_st]:.1f}, {pl['minuti']:.0f} min). "
                                f"Con la variabilità tipica, la probabilità di superare {soglia:g} è circa {pr:.0%}. "
                                f"Se il bookmaker offre una linea più bassa, c'è valore.")))
        for x in out[n0:]:
            x["gara"] = (casa, trasf)
    return sorted(out, key=lambda g: g["prob"], reverse=True)


def giocate_da_linee(proiezioni, gioc_df, linee):
    """Confronta stime e linee inserite. Ritorna lista di giocate ordinate per forza."""
    out = []
    for (casa, trasf), r in proiezioni.items():
        part = etichetta(casa, trasf)
        lt = linee.get(f"tot_{casa}")
        if lt:
            diff = r["totale"] - lt
            lato = "Over" if diff > 0 else "Under"
            pr = phi(abs(diff) / STD["Totale"])
            out.append(
                dict(id=f"tot_{casa}", partita=part, tipo="Totale", testo=f"{lato} {lt:g}",
                     stima=f"{r['totale']:.1f}", diff=abs(diff), z=abs(diff) / STD["Totale"],
                     motivo=(f"Stima {r['totale']:.1f} punti ({nome_squadra(casa, True)} {r['pt_casa']:.1f} + "
                             f"{nome_squadra(trasf, True)} {r['pt_trasf']:.1f}), "
                             f"{abs(diff):.1f} {'sopra' if diff > 0 else 'sotto'} la linea {lt:g}. "
                             f"Probabilità stimata: {pr:.0%}."))
            )
        ls = linee.get(f"spr_{casa}")
        if ls is not None:
            # ls = handicap della squadra di casa (es. -4.5). Casa copre se margine + ls > 0
            diff = r["margine_casa"] + ls
            if diff > 0:
                testo = f"{nome_squadra(casa, True)} {segno(ls)}"
            else:
                testo = f"{nome_squadra(trasf, True)} {segno(-ls)}"
            pr = phi(abs(diff) / STD["Spread"])
            out.append(
                dict(id=f"spr_{casa}", partita=part, tipo="Spread", testo=testo,
                     stima=f"{nome_squadra(casa, True)} {r['margine_casa']:+.1f}",
                     diff=abs(diff), z=abs(diff) / STD["Spread"],
                     motivo=(f"Margine stimato {nome_squadra(casa, True)} {r['margine_casa']:+.1f}. "
                             f"Con handicap {segno(ls)} per i padroni di casa il segnale è di {abs(diff):.1f} "
                             f"punti a favore di: {testo}. Probabilità stimata: {pr:.0%}."))
            )
    for (casa, trasf), df in gioc_df.items():
        part = etichetta(casa, trasf)
        for _, p in df.iterrows():
            for mercato, (pref, col, col_st, unita) in MERCATI.items():
                lp = linee.get(f"{pref}{p['giocatore']}")
                if not lp:
                    continue
                val = p[col]
                sd = std_giocatore(val, p["minuti"], mercato)
                diff = val - lp
                lato = "over" if diff > 0 else "under"
                pr = prob_over(val, lp, sd) if diff > 0 else 1 - prob_over(val, lp, sd)
                extra = ""
                if mercato == "Punti":
                    extra = f" Difesa avversaria {'più permeabile' if p['dif'] > 1 else 'più solida'} della media."
                out.append(
                    dict(id=f"{pref}{p['giocatore']}", partita=part, tipo=mercato,
                         testo=f"{p['giocatore']} {lato} {lp:g} {unita}", stima=f"{val:.1f}",
                         diff=abs(diff), z=abs(diff) / sd,
                         motivo=(f"Stima {val:.1f} {unita} (media stagione {p[col_st]:.1f}, {p['minuti']:.0f} min), "
                                 f"{abs(diff):.1f} {'sopra' if diff > 0 else 'sotto'} la linea {lp:g}. "
                                 f"Probabilità stimata: {pr:.0%}.{extra}"))
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
st.markdown('<div class="testata"><div class="logo">🏀</div><div><div class="nome">NBA Schedine</div>'
            '<div class="s">Studio e consigli di giornata</div></div></div>', unsafe_allow_html=True)

try:
    _adesso_us = datetime.now(ZoneInfo("America/New_York"))
except Exception:
    _adesso_us = datetime.utcnow() - timedelta(hours=5)
GIORNI = {"Ieri": (_adesso_us - timedelta(days=1)).strftime("%Y%m%d"), "Oggi": None,
          "Domani": (_adesso_us + timedelta(days=1)).strftime("%Y%m%d"),
          "Dopodomani": (_adesso_us + timedelta(days=2)).strftime("%Y%m%d")}
if st.session_state.get("giorno_sel") not in GIORNI:
    st.session_state.giorno_sel = "Oggi"
giorno_sel = st.segmented_control("Giorno", list(GIORNI), key="giorno_sel", label_visibility="collapsed") or "Oggi"
partite, teams, players, linee_auto, diag, modo, errori, ieri, aggiornato = carica_tutto(GIORNI[giorno_sel])
if modo == "DEMO":
    st.warning("Dati live non disponibili: " + " | ".join(errori) + ". Uso dati di esempio.")
for k, v in linee_auto.items():
    st.session_state.linee.setdefault(k, v)

st.caption(f"Dati: {modo} · Strumento di supporto, non garantisce vincite.")
if linee_auto:
    st.caption("Alcune linee sono precompilate da ESPN: controllale sul tuo bookmaker prima di giocare.")

if partite.empty:
    st.info(f"Nessuna partita trovata per «{giorno_sel}». Prova un altro giorno.")
    st.stop()

infortuni = {}
if modo == "LIVE (ESPN)":
    try:
        infortuni = carica_infortuni()
        diag.append(f"infortuni segnalati: {len(infortuni)}")
    except Exception as e:
        diag.append(f"infortuni: ERRORE {type(e).__name__}")
b2b_oggi = set(ieri["casa"]) | set(ieri["trasf"]) if not ieri.empty else set()
squadra_di = {}
if not players.empty:
    squadra_di = {str(n).strip().lower(): t for n, t in zip(players["PLAYER_NAME"], players["TEAM_ABBREVIATION"])}


def prepara(df_partite, b2b=None, usa_infortuni=True):
    """Stime di squadra e di giocatori per ogni partita di un elenco."""
    prz, gd = {}, {}
    for _, g in df_partite.iterrows():
        casa, trasf = g["casa"], g["trasf"]
        if casa in teams.index and trasf in teams.index:
            r = proietta_partita(casa, trasf, teams, b2b_oggi if b2b is None else b2b)
            prz[(casa, trasf)] = r
            fuori = st.session_state.esclusi
            inf = infortuni if usa_infortuni else None
            gd[(casa, trasf)] = pd.concat(
                [
                    proietta_giocatori(casa, trasf, r["fattore_pace"], teams, players, fuori, inf),
                    proietta_giocatori(trasf, casa, r["fattore_pace"], teams, players, fuori, inf),
                ]
            )
    return prz, gd


proiezioni, gioc_df = prepara(partite)
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


def logo(ab, size=24):
    url = f"https://a.espncdn.com/i/teamlogos/nba/500/{str(ab).lower()}.png"
    return (f'<span style="display:inline-block;width:{size}px;height:{size}px;margin-right:6px;vertical-align:middle;'
            f'background:url({url}) center/contain no-repeat"></span>')


def foto(pid, size=38):
    if not pid:
        return ""
    url = f"https://a.espncdn.com/i/headshots/nba/players/full/{pid}.png"
    return (f'<span style="display:inline-block;width:{size}px;height:{size}px;border-radius:50%;margin-right:8px;'
            f'flex-shrink:0;background:#232836 url({url}) center top/cover no-repeat"></span>')


def anello(p, colore, size=52):
    """Anello di probabilità (SVG) con la percentuale al centro."""
    r = size / 2 - 5
    L = 2 * math.pi * r
    c = size / 2
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" style="flex-shrink:0">'
            f'<circle cx="{c}" cy="{c}" r="{r}" fill="none" stroke="#232836" stroke-width="6"></circle>'
            f'<circle cx="{c}" cy="{c}" r="{r}" fill="none" stroke="{colore}" stroke-width="6" stroke-linecap="round" '
            f'stroke-dasharray="{L * p / 100:.1f} {L:.1f}" transform="rotate(-90 {c} {c})"></circle>'
            f'<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" fill="#f2f2f2" '
            f'font-size="{18 if size > 60 else 13}" font-weight="600">{p:.0f}%</text></svg>')


def pillola(z):
    et, col = forza(z)
    return f'<span class="pill" style="color:{col}">{et}</span>'


def intestazione(casa, trasf):
    return (f'{logo(trasf, 20)}{badge(trasf)}<b>{esc(nome_squadra(trasf, True))}</b> <span class="s">@</span> '
            f'{logo(casa, 20)}{badge(casa)}<b>{esc(nome_squadra(casa, True))}</b>')


def scheda_partita(casa, trasf, r, info, miglior):
    """Scheda partita con stato (finale/live/orario), punteggio reale e stima."""
    stato = info.get("stato")
    if stato == "post":
        chip, col = "Finale", VERDE
    elif stato == "in":
        chip, col = f"Live · {info.get('dettaglio', '')}", ARANCIO
    else:
        chip, col = info.get("ora", ""), GRIGIO

    def riga(ab, stima, reale):
        vuoto = reale is None or pd.isna(reale)
        punti = "–" if vuoto else f"{int(reale)}"
        stima_txt = f'<span class="s">stima {stima:.1f}</span>' if stima is not None else ""
        return (f'<div class="riga" style="padding:4px 0"><div style="display:flex;align-items:center">{logo(ab, 26)}{badge(ab)}<b>{esc(nome_squadra(ab, True))}</b></div>'
                f'<div style="display:flex;align-items:baseline;gap:10px">{stima_txt}'
                f'<b style="font-size:22px;min-width:40px;text-align:right">{punti}</b></div></div>')

    bordo = SQUADRE.get(casa, ("", "", "#4a5060"))[2]
    h = (f'<div class="card2" style="border-left:3px solid {bordo}"><span class="pill" style="color:{col}">{esc(chip)}</span>'
         f'<div style="height:6px"></div>')
    h += riga(trasf, r["pt_trasf"] if r else None, info.get("pt_trasf_reale"))
    h += riga(casa, r["pt_casa"] if r else None, info.get("pt_casa_reale"))
    pc, pt_ = info.get("pt_casa_reale"), info.get("pt_trasf_reale")
    if r and stato in ("post", "in") and pc is not None and pt_ is not None and not pd.isna(pc) and not pd.isna(pt_):
        h += f'<div class="s" style="margin-top:4px">Totale reale {int(pc) + int(pt_)} · stima {r["totale"]:.1f}</div>'
    if r:
        h += gauge(r["totale"], st.session_state.linee.get(f"tot_{casa}"))
        if miglior:
            h += (f'<div class="riga" style="margin-top:8px"><span>Gioca: <b>{esc(miglior["testo"])}</b> '
                  f'<span class="s">(stima {esc(miglior["stima"])})</span></span>{pillola(miglior["z"])}</div>')
        else:
            h += '<div class="s" style="margin-top:8px">Nessuna linea inserita</div>'
    return h + "</div>"


def scala_soglie(p, mercato):
    """Soglia consigliata (la più alta con probabilità >= 70%) e le altre soglie possibili con la loro probabilità."""
    pref, col, col_st, unita = MERCATI[mercato]
    val = p[col]
    sd = std_giocatore(val, p["minuti"], mercato)
    righe = [(t, prob_over(val, t, sd)) for t in SCALINI[mercato][0]]
    righe = [(t, pr) for t, pr in righe if 0.20 <= pr <= 0.97]
    buone = [t for t, pr in righe if pr >= PROB_MIN]
    rec = max(buone) if buone else None
    if rec is not None:
        testa = (f'<div style="margin-top:10px"><span class="s">CONSIGLIATO</span><div style="font-weight:600;color:{VERDE}">'
                 f'over {rec:g} {unita} · {dict(righe)[rec]:.0%}</div></div>')
    else:
        testa = '<div class="s" style="margin-top:10px">Nessuna soglia sopra il 70%: giocatore poco sicuro.</div>'
    chips = ""
    for t, pr in righe:
        c = VERDE if pr >= 0.70 else (ARANCIO if pr >= 0.50 else GRIGIO)
        bordo = f"border:1px solid {c};" if t == rec else ""
        chips += (f'<span class="pill" style="color:{c};{bordo}margin:0 6px 6px 0;display:inline-block">'
                  f'over {t:g} · {pr:.0%}</span>')
    return testa + (f'<div class="s" style="margin-top:8px">ALTRE SOGLIE POSSIBILI</div><div style="margin-top:4px">{chips}</div>' if chips else "")


def scheda_giocatore(p, mercato, lp):
    pref, col, col_st, unita = MERCATI[mercato]
    val = p[col]
    base = {"Punti": 40.0, "Rimbalzi": 16.0, "Assist": 12.0}[mercato]
    scala = max(base, val * 1.3, (lp or 0) * 1.3)
    marcatore = ""
    if lp:
        marcatore = f'<div style="position:absolute;left:{lp / scala * 100}%;top:-3px;width:2px;height:14px;background:#f2f2f2"></div>'

    def tile(nome, valore, attivo):
        bordo = f"border-color:{ARANCIO};" if attivo else ""
        return f'<div class="tile" style="{bordo}"><b>{valore:.1f}</b><span>{nome}</span></div>'

    nota = f"Stima {val:.1f} {unita}" + (f" · linea {lp:g}" if lp else "")
    dubbio = '<span class="pill" style="color:#ffb066;margin-left:6px">Dubbio</span>' if p.get("inf") == "dubbio" else ""
    return (
        f'<div class="card2"><div class="riga"><div style="display:flex;align-items:center">{foto(p.get("pid"))}{badge(p["squadra"])}<b>{esc(p["giocatore"])}</b>{dubbio}</div>'
        f'<span class="s">{p["minuti"]:.0f} min</span></div>'
        f'<div class="tre">{tile("Punti", p["atteso"], mercato == "Punti")}'
        f'{tile("Rimbalzi", p["reb"], mercato == "Rimbalzi")}{tile("Assist", p["ast"], mercato == "Assist")}</div>'
        f'<div style="position:relative;height:8px;background:#2a2f3a;border-radius:4px;margin:14px 0 6px">'
        f'<div style="width:{val / scala * 100}%;height:8px;background:{ARANCIO};border-radius:4px"></div>{marcatore}</div>'
        f'<div class="s">{nota}</div>{scala_soglie(p, mercato)}</div>'
    )


def elenco_auto(picks, limite=None):
    """Giocate consigliate in automatico, divise per probabilità."""
    mostra = picks if limite is None else picks[:limite]
    resto = [] if limite is None else picks[limite:]
    gruppi = (("Molto probabili (80% o più)", [x for x in mostra if x["prob"] >= 0.80], VERDE),
              ("Probabili (70-80%)", [x for x in mostra if 0.70 <= x["prob"] < 0.80], ARANCIO),
              ("Da valutare (sotto il 70%)", [x for x in mostra if x["prob"] < 0.70], GRIGIO))
    for titolo, lista, colore in gruppi:
        if not lista:
            continue
        st.markdown(f"**{titolo}**")
        for x in lista:
            card(f"{x['partita']} · {x['tipo']}", x["testo"], f"{x['prob']:.0%}", f"stima {x['stima']}", colore)
            st.caption(x["motivo"])
    if resto:
        with st.expander(f"Altre giocate ({len(resto)})"):
            for x in resto:
                card(f"{x['partita']} · {x['tipo']}", x["testo"], f"{x['prob']:.0%}", f"stima {x['stima']}", GRIGIO)


def blocco_migliori(df, titolo_html, n=3, mostra_squadra=False):
    """I migliori per punti, rimbalzi e assist in un gruppo di giocatori."""
    if df.empty:
        return ""
    h = f'<div class="card2"><div class="riga" style="margin-bottom:6px">{titolo_html}</div>'
    for mercato, (pref, col, col_st, unita) in MERCATI.items():
        h += f'<div class="s" style="margin-top:8px">{mercato.upper()}</div>'
        for i, (_, r) in enumerate(df.nlargest(n, col).iterrows(), 1):
            sq = badge(r["squadra"]) if mostra_squadra else ""
            h += (f'<div class="riga"><span>{i}. {sq}{esc(r["giocatore"])}</span>'
                  f'<b style="color:{ARANCIO if i == 1 else "#f2f2f2"}">{r[col]:.1f}</b></div>')
    return h + "</div>"


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
                card(f"{gi['partita']} · {gi['tipo']}", f"Gioca: {gi['testo']}", gi["stima"],
                     f"stima · {nome}", forza(gi["z"])[1])
                st.caption(gi["motivo"])


# ---------------------------------------------------------------- VERIFICA
STAT_MERCATO = {"Punti": "PTS", "Rimbalzi": "REB", "Assist": "AST"}


@st.cache_data(ttl=600, show_spinner="Scarico i tabellini...")
def carica_boxscore(event_id):
    """Statistiche reali dei giocatori di una partita finita: {nome minuscolo: {PTS, REB, AST}}."""
    d = _get(f"{ESPN}/summary", {"event": event_id})
    out = {}
    for team in d.get("boxscore", {}).get("players", []):
        for blocco in team.get("statistics", []):
            labels = blocco.get("labels") or blocco.get("names") or []
            idx = {str(l).upper(): i for i, l in enumerate(labels)}
            for a in blocco.get("athletes", []):
                nome = a.get("athlete", {}).get("displayName")
                stats = a.get("stats", [])
                if not nome or not stats:
                    continue

                def val(k):
                    i = idx.get(k)
                    try:
                        return float(stats[i]) if i is not None else None
                    except Exception:
                        return None

                out[nome.strip().lower()] = {"PTS": val("PTS"), "REB": val("REB"), "AST": val("AST")}
    return out


def valuta_giocata(x, g, box):
    """Confronta una giocata con il risultato reale. Ritorna (esito, dettaglio): 1 azzeccata, 0 sbagliata, 2 non valida."""
    pc, pt = g.get("pt_casa_reale"), g.get("pt_trasf_reale")
    if pc is None or pt is None or pd.isna(pc) or pd.isna(pt):
        return 2, "punteggio non disponibile"
    pc, pt = int(pc), int(pt)
    tipo, testo = x["tipo"], x["testo"]
    if tipo == "Vincente":
        vincente = g["casa"] if pc > pt else g["trasf"]
        return (1 if vincente == x["squadra"] else 0), f"finale {pt}-{pc}"
    m = re.search(r"(over|under) (\d+(?:\.\d+)?)", testo)
    if not m:
        return 2, "giocata non valutabile"
    lato, soglia = m.group(1), float(m.group(2))
    if tipo == "Squadra":
        val = pc if x["squadra"] == g["casa"] else pt
    elif tipo == "Totale":
        val = pc + pt
    elif tipo in STAT_MERCATO:
        if box is None:
            return 2, "tabellino non disponibile"
        nome = testo.split(" over")[0].strip().lower()
        val = box.get(nome, {}).get(STAT_MERCATO[tipo])
        if val is None:
            return 2, "non ha giocato"
    else:
        return 2, "giocata non valutabile"
    ok = val > soglia if lato == "over" else val < soglia
    return (1 if ok else 0), f"fatto {val:g}"


def verifica_giornata(finite, prz, gd):
    """Ricalcola i consigli per le partite finite e li confronta con i risultati reali."""
    righe = {(g["casa"], g["trasf"]): g for g in finite.to_dict("records")}
    box_cache, risultati = {}, []
    for x in consigli_automatici(prz, gd):
        g = righe.get(x.get("gara"))
        if g is None:
            continue
        box = None
        if x["tipo"] in STAT_MERCATO:
            k = x["gara"]
            if k not in box_cache:
                try:
                    box_cache[k] = carica_boxscore(g.get("id"))
                except Exception:
                    box_cache[k] = None
            box = box_cache[k]
        esito, det = valuta_giocata(x, g, box)
        risultati.append(dict(x, esito=esito, dettaglio=det))
    return risultati


def riga_esito(r):
    simbolo, col = {1: ("✓", VERDE), 0: ("✗", "#ff5d5d"), 2: ("–", GRIGIO)}[r["esito"]]
    return (
        f'<div class="card2" style="display:flex;align-items:center;gap:10px;padding:10px 12px">'
        f'<div style="width:28px;height:28px;border-radius:50%;background:{col}22;color:{col};display:flex;'
        f'align-items:center;justify-content:center;flex-shrink:0;font-weight:700">{simbolo}</div>'
        f'<div style="min-width:0;flex:1"><div style="font-weight:500">{esc(r["testo"])}</div>'
        f'<div class="s">{esc(r["partita"])} · {esc(r["dettaglio"])}</div></div>'
        f'<div class="s">{r["prob"]:.0%}</div></div>'
    )


@st.cache_data(ttl=1800, show_spinner=False)
def carica_ultime(sigla, n=5):
    """Ultime partite giocate da una squadra (calendario ESPN)."""
    d = _get(f"{ESPN}/teams/{sigla.lower()}/schedule")
    out = []
    for ev in d.get("events", []):
        comp = (ev.get("competitions") or [{}])[0]
        stt = (comp.get("status") or ev.get("status") or {}).get("type", {})
        if not stt.get("completed"):
            continue
        mie, loro = None, None
        for c in comp.get("competitors", []):
            sc = c.get("score")
            if isinstance(sc, dict):
                sc = sc.get("value", sc.get("displayValue"))
            try:
                sc = int(float(sc))
            except Exception:
                sc = None
            ab = (c.get("team") or {}).get("abbreviation", "")
            riga = dict(ab=ab, pt=sc, casa=c.get("homeAway") == "home", win=c.get("winner"))
            if ab.upper() == sigla.upper():
                mie = riga
            else:
                loro = riga
        if mie is None or loro is None or mie["pt"] is None or loro["pt"] is None:
            continue
        out.append(dict(data=str(ev.get("date", ""))[:10], avv=loro["ab"], casa=mie["casa"],
                        pf=mie["pt"], pa=loro["pt"], vinta=mie["pt"] > loro["pt"]))
    return sorted(out, key=lambda x: x["data"])[-n:][::-1]


def blocco_ultime(sigla):
    try:
        ul = carica_ultime(sigla)
    except Exception as e:
        st.caption(f"Ultimi incontri non disponibili ({type(e).__name__}).")
        return
    if not ul:
        st.caption("Nessun incontro recente trovato.")
        return
    forma = " ".join("V" if x["vinta"] else "S" for x in ul)
    medie = (f"Media ultime {len(ul)}: {sum(x['pf'] for x in ul) / len(ul):.1f} fatti, "
             f"{sum(x['pa'] for x in ul) / len(ul):.1f} subiti · totale {sum(x['pf'] + x['pa'] for x in ul) / len(ul):.1f}")
    h = f'<div class="s" style="margin-bottom:6px">{esc(medie)}</div>'
    for x in ul:
        col = VERDE if x["vinta"] else "#ff5d5d"
        h += (f'<div class="card2" style="display:flex;align-items:center;gap:10px;padding:8px 12px">'
              f'<div style="width:26px;height:26px;border-radius:50%;background:{col}22;color:{col};display:flex;'
              f'align-items:center;justify-content:center;font-weight:700;flex-shrink:0">{"V" if x["vinta"] else "S"}</div>'
              f'{logo(x["avv"], 24)}<div style="flex:1;min-width:0"><b>{"vs" if x["casa"] else "@"} {esc(nome_squadra(x["avv"], True))}</b>'
              f'<div class="s">{esc(x["data"])}</div></div><b>{x["pf"]}-{x["pa"]}</b></div>')
    st.markdown(h, unsafe_allow_html=True)
    return forma


# ---------------------------------------------------------------- REGISTRO
def db_conf():
    """Credenziali Supabase da st.secrets (None se non configurato)."""
    try:
        return str(st.secrets["SUPABASE_URL"]).rstrip("/"), str(st.secrets["SUPABASE_KEY"])
    except Exception:
        return None


def _db(metodo, params=None, corpo=None, prefer=None):
    u, k = db_conf()
    h = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    r = requests.request(metodo, f"{u}/rest/v1/consigli", headers=h, params=params, json=corpo, timeout=15)
    r.raise_for_status()
    return r.json() if r.text.strip() else []


def salva_consigli(picks, info, giorno):
    """Salva i consigli delle partite non ancora iniziate. Il primo salvataggio vince (non si sovrascrive)."""
    righe = {}
    for x in picks:
        g = info.get(x.get("gara"), {})
        if g.get("stato") != "pre" or not g.get("id"):
            continue
        chiave = f"{g['id']}|{x['tipo']}|{x.get('pid') or x.get('squadra') or ''}"
        righe[chiave] = dict(chiave=chiave, event_id=str(g["id"]), data=giorno, partita=x["partita"],
                             tipo=x["tipo"], testo=x["testo"], squadra=x.get("squadra"),
                             prob=float(x["prob"]), stima=str(x["stima"]))
    fatte = st.session_state.setdefault("registro_fatto", set())
    nuove = [r for k, r in righe.items() if k not in fatte]
    if not nuove:
        return 0
    _db("POST", params={"on_conflict": "chiave"}, corpo=nuove, prefer="resolution=ignore-duplicates")
    fatte.update(r["chiave"] for r in nuove)
    return len(nuove)


def aggiorna_esiti(righe, finite):
    """Valuta i consigli salvati le cui partite sono finite e scrive l'esito nel registro."""
    per_evento = {str(g["id"]): g for g in finite.to_dict("records")}
    box_cache, fatti = {}, 0
    for r in righe:
        if r.get("esito") is not None:
            continue
        g = per_evento.get(str(r["event_id"]))
        if g is None:
            continue
        box = None
        if r["tipo"] in STAT_MERCATO:
            if r["event_id"] not in box_cache:
                try:
                    box_cache[r["event_id"]] = carica_boxscore(r["event_id"])
                except Exception:
                    box_cache[r["event_id"]] = None
            box = box_cache[r["event_id"]]
        esito, det = valuta_giocata(r, g, box)
        if esito == 2 and r["tipo"] in STAT_MERCATO and box is None:
            continue  # riprova più tardi
        _db("PATCH", params={"chiave": f"eq.{r['chiave']}"}, corpo={"esito": esito, "dettaglio": det})
        r["esito"], r["dettaglio"] = esito, det
        fatti += 1
    return fatti


def percentuale_barra(titolo, k, n, atteso=None):
    perc = k / n * 100 if n else 0
    extra = f' · previsto {atteso:.0%}' if atteso is not None else ""
    return (f'<div class="card2" style="margin:0"><div class="s">{esc(titolo)}</div>'
            f'<div style="font-size:17px;font-weight:600">{k}/{n} <span class="s">({perc:.0f}%{extra})</span></div>'
            f'<div style="height:4px;background:#232836;border-radius:2px;margin-top:6px">'
            f'<div style="width:{perc:.0f}%;height:4px;background:{VERDE if perc >= 60 else "#ff5d5d"};'
            f'border-radius:2px"></div></div></div>')


# ------------------------------------------------------------- NAVIGAZIONE
per_id = {g["id"]: g for g in giocate}
auto = consigli_automatici(proiezioni, gioc_df)
miglior = {}
for gi in giocate:
    miglior.setdefault(gi["partita"], gi)
infop = {(g["casa"], g["trasf"]): g.to_dict() for _, g in partite.iterrows()}
GIORNO = datetime.now(ZoneInfo("Europe/Rome")).strftime("%Y-%m-%d")
registro_msg = None
if db_conf():
    try:
        n_salvati = salva_consigli(auto, infop, GIORNO)
        registro_msg = f"registro: {n_salvati} nuovi consigli salvati" if n_salvati else "registro: nulla di nuovo da salvare"
    except Exception as e:
        registro_msg = f"registro: ERRORE {type(e).__name__} {str(e)[:120]}"
else:
    registro_msg = "registro: non configurato (mancano i secrets Supabase)"

VISTE = ["Combo", "Partite", "Studio partita", "Fine giornata", "Storico"]
if st.session_state.get("vista") not in VISTE:
    st.session_state.vista = "Combo"


def vai_studio(etich):
    st.session_state.partita = etich
    st.session_state.vista = "Studio partita"


def aggiorna():
    st.cache_data.clear()


vista = st.segmented_control("Vista", VISTE, key="vista", label_visibility="collapsed") or "Combo"

SCATOLE = [
    ("Squadre e totali", "ti-chart-bar", ("Vincente", "Squadra", "Totale")),
    ("Punti", "ti-target", ("Punti",)),
    ("Assist", "ti-users", ("Assist",)),
    ("Rimbalzi", "ti-arrows-up-down", ("Rimbalzi",)),
]


def riga_scatola(x, ultima):
    col = VERDE if x["prob"] >= 0.80 else ARANCIO
    sq = badge(x["squadra"]) if x.get("squadra") else ""
    return (
        f'<div style="display:flex;align-items:center;gap:12px;margin-bottom:{0 if ultima else 12}px">'
        f'{anello(x["prob"] * 100, col, 48)}{foto(x.get("pid"), 34) if x.get("pid") else (logo(x["squadra"], 30) if x.get("squadra") else "")}<div style="min-width:0"><div style="font-weight:500">{esc(x["testo"])}</div>'
        f'<div class="s" style="margin-top:2px">{sq}{esc(x["partita"])}</div></div></div>'
    )


def scatola(titolo, icona, lista):
    top = lista[:3]
    return (
        f'<div class="card2" style="margin-bottom:10px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'
        f'<i class="ti {icona}" style="font-size:18px;color:{ARANCIO}"></i><b>{esc(titolo)}</b></div>'
        + "".join(riga_scatola(x, i == len(top) - 1) for i, x in enumerate(top)) + "</div>"
    )


# ------------------------------------------------------------------- COMBO
if vista == "Combo":
    st.caption(f"Aggiornato alle {aggiornato} · punteggi ogni 2 minuti, statistiche ogni 30")
    st.button("Aggiorna ora", on_click=aggiorna, use_container_width=True)
    gruppi, scelte = [], []
    for titolo, icona, tipi in SCATOLE:
        lista = [x for x in auto if x["tipo"] in tipi]
        gruppi.append((titolo, icona, lista))
        if lista:
            scelte.append(lista[0])
    if scelte:
        combinata = 1.0
        for x in scelte:
            combinata *= x["prob"]
        st.markdown(
            f'<div class="card2" style="display:flex;align-items:center;gap:14px">{anello(combinata * 100, ARANCIO, 76)}'
            f'<div><div class="s">I primi di ogni riquadro, insieme</div>'
            f'<div style="font-weight:500;font-size:15px">Meglio non esagerare</div>'
            f'<div class="s">Stima con eventi indipendenti: più giocate unisci, meno è probabile.</div></div></div>',
            unsafe_allow_html=True,
        )
    st.caption("Per ogni giocata l'app trova la soglia che si supera con probabilità di almeno il 70% secondo il modello. "
               "Le percentuali sono stime, non certezze.")
    if players.empty:
        st.info("Statistiche dei giocatori non disponibili con questa fonte: restano squadre e totali.")
    essenziale = st.toggle("Vista essenziale (solo le giocate più forti)", key="essenziale")
    if essenziale:
        forti_a = [x for x in auto if x["prob"] >= 0.78][:15]
        if not forti_a:
            st.info("Nessuna giocata sopra il 78% per ora.")
        for x in forti_a:
            visual = foto(x.get("pid"), 28) if x.get("pid") else (logo(x["squadra"], 24) if x.get("squadra") else "")
            st.markdown(
                f'<div class="card2" style="display:flex;align-items:center;gap:8px;padding:8px 12px">{visual}'
                f'<div style="flex:1;min-width:0"><b>{esc(x["testo"])}</b><div class="s">{esc(x["partita"])}</div></div>'
                f'<b style="color:{VERDE}">{x["prob"]:.0%}</b></div>', unsafe_allow_html=True)
    else:
        for titolo, icona, lista in gruppi:
            if not lista:
                continue
            st.markdown(scatola(titolo, icona, lista), unsafe_allow_html=True)
            if len(lista) > 3:
                with st.expander(f"Altre giocate: {titolo} ({len(lista) - 3})"):
                    for x in lista[3:]:
                        card(f"{x['partita']} · {x['tipo']}", x["testo"], f"{x['prob']:.0%}", f"stima {x['stima']}", GRIGIO)
        if not players.empty:
            st.markdown("### I migliori della giornata")
            st.markdown(blocco_migliori(pd.concat(gioc_df.values()), "<b>Tutte le partite di oggi</b>", n=5,
                                        mostra_squadra=True), unsafe_allow_html=True)

# ----------------------------------------------------------------- PARTITE
elif vista == "Partite":
    forti = sum(1 for g in giocate if forza(g["z"])[0] == "Forte")
    st.caption(f"Aggiornato alle {aggiornato} · {len(proiezioni)} partite · {forti} segnali forti")
    st.button("Aggiorna ora", key="agg2", on_click=aggiorna, use_container_width=True)
    for (casa, trasf), r in proiezioni.items():
        et = etichetta(casa, trasf)
        st.markdown(scheda_partita(casa, trasf, r, infop.get((casa, trasf), {}), miglior.get(et)),
                    unsafe_allow_html=True)
        st.button("Studia questa partita", key=f"vai_{casa}", on_click=vai_studio, args=(et,),
                  use_container_width=True)
    if not ieri.empty:
        st.markdown("### Risultati di ieri")
        for _, g in ieri.iterrows():
            c, t = g["casa"], g["trasf"]
            r2 = proietta_partita(c, t, teams) if c in teams.index and t in teams.index else None
            st.markdown(scheda_partita(c, t, r2, g.to_dict(), None), unsafe_allow_html=True)
    st.markdown("### Confronto con le linee del bookmaker")
    if giocate:
        st.caption("Qui l'app confronta la sua stima con le linee che hai inserito (o che ESPN ha trovato).")
        elenco_consigli(giocate)
    else:
        st.info("Nessuna linea inserita: apri «Studio partita» per aggiungerle e ottenere il confronto.")

# ------------------------------------------------------------ FINE GIORNATA
elif vista == "Fine giornata":
    finite = pd.concat([ieri, partite[partite["stato"] == "post"]], ignore_index=True)
    if finite.empty:
        st.info("Nessuna partita finita da verificare per ora. Torna a partite concluse.")
    else:
        prz_f, gd_f = prepara(finite, b2b=set(), usa_infortuni=False)
        ris = verifica_giornata(finite, prz_f, gd_f)
        valide = [x for x in ris if x["esito"] != 2]
        ok = sum(1 for x in valide if x["esito"] == 1)
        if valide:
            pc = ok / len(valide) * 100
            st.markdown(
                f'<div class="card2" style="display:flex;align-items:center;gap:14px">'
                f'{anello(pc, VERDE if pc >= 60 else ARANCIO, 76)}<div><div class="s">Consigli delle partite finite</div>'
                f'<div style="font-size:20px;font-weight:600">{ok} su {len(valide)} azzeccati</div>'
                f'<div class="s">{len(ris) - len(valide)} non validi (giocatore fermo o dato mancante)</div></div></div>',
                unsafe_allow_html=True,
            )
            celle = ""
            for titolo, icona, tipi in SCATOLE:
                v = [x for x in valide if x["tipo"] in tipi]
                if not v:
                    continue
                k = sum(1 for x in v if x["esito"] == 1)
                perc = k / len(v) * 100
                celle += (f'<div class="card2" style="margin:0"><div class="s">{esc(titolo)}</div>'
                          f'<div style="font-size:17px;font-weight:600">{k}/{len(v)}</div>'
                          f'<div style="height:4px;background:#232836;border-radius:2px;margin-top:6px">'
                          f'<div style="width:{perc:.0f}%;height:4px;background:{VERDE if perc >= 60 else "#ff5d5d"};'
                          f'border-radius:2px"></div></div></div>')
            st.markdown(f'<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:10px">{celle}</div>',
                        unsafe_allow_html=True)
            for titolo, codice in (("Azzeccati", 1), ("Sbagliati", 0)):
                lista = [x for x in valide if x["esito"] == codice]
                if lista:
                    st.markdown(f"### {titolo} ({len(lista)})")
                    st.markdown("".join(riga_esito(x) for x in lista), unsafe_allow_html=True)
            nulli = [x for x in ris if x["esito"] == 2]
            if nulli:
                with st.expander(f"Non validi ({len(nulli)})"):
                    st.markdown("".join(riga_esito(x) for x in nulli), unsafe_allow_html=True)
        else:
            st.info("Nessuna giocata valutabile per le partite finite.")
        st.caption("I consigli sono ricalcolati con le statistiche attuali, non salvati prima della partita. "
                   "Rimbalzi e assist reali arrivano dal tabellino di ESPN.")

# ----------------------------------------------------------------- STORICO
elif vista == "Storico":
    if not db_conf():
        st.info("Il registro non è ancora attivo: servono i secrets SUPABASE_URL e SUPABASE_KEY. "
                "Segui la guida e poi riavvia l'app.")
    else:
        try:
            righe = _db("GET", params={"select": "*", "order": "creato.desc", "limit": "3000"})
            finite_s = pd.concat([ieri, partite[partite["stato"] == "post"]], ignore_index=True)
            if not finite_s.empty and any(r.get("esito") is None for r in righe):
                if aggiorna_esiti(righe, finite_s):
                    st.caption("Esiti aggiornati con le partite finite.")
        except Exception as e:
            righe = []
            st.error(f"Registro non raggiungibile: {type(e).__name__}. {str(e)[:160]}")
        valide = [r for r in righe if r.get("esito") in (0, 1)]
        in_attesa = sum(1 for r in righe if r.get("esito") is None)
        if not valide:
            st.info(f"Nessun esito ancora: {len(righe)} consigli salvati, {in_attesa} in attesa che le partite finiscano. "
                    "Apri l'app ogni giorno: salva i consigli prima delle partite e li verifica dopo.")
        else:
            ok = sum(1 for r in valide if r["esito"] == 1)
            pc = ok / len(valide) * 100
            atteso = sum(r["prob"] for r in valide) / len(valide)
            st.markdown(
                f'<div class="card2" style="display:flex;align-items:center;gap:14px">'
                f'{anello(pc, VERDE if pc >= 60 else ARANCIO, 76)}<div><div class="s">Storico dei consigli salvati</div>'
                f'<div style="font-size:20px;font-weight:600">{ok} su {len(valide)} azzeccati</div>'
                f'<div class="s">Il modello prevedeva in media il {atteso:.0%} · {in_attesa} in attesa</div></div></div>',
                unsafe_allow_html=True)
            st.markdown("### Per categoria")
            celle = ""
            for titolo, icona, tipi in SCATOLE:
                v = [r for r in valide if r["tipo"] in tipi]
                if v:
                    celle += percentuale_barra(titolo, sum(1 for r in v if r["esito"] == 1), len(v),
                                               sum(r["prob"] for r in v) / len(v))
            st.markdown(f'<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:10px">{celle}</div>',
                        unsafe_allow_html=True)
            st.markdown("### Calibrazione: la probabilità dichiarata è onesta?")
            fasce = ((0.70, 0.75, "70-75%"), (0.75, 0.80, "75-80%"), (0.80, 0.85, "80-85%"), (0.85, 1.01, "85% e oltre"))
            celle = ""
            for lo, hi, nome in fasce:
                v = [r for r in valide if lo <= r["prob"] < hi]
                if v:
                    celle += percentuale_barra(nome, sum(1 for r in v if r["esito"] == 1), len(v),
                                               sum(r["prob"] for r in v) / len(v))
            st.markdown(f'<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:10px">{celle}</div>',
                        unsafe_allow_html=True)
            st.caption("Se in una fascia la percentuale reale è molto più bassa di quella prevista, il modello è troppo ottimista "
                       "lì. Servono almeno qualche decina di giocate per fidarsi dei numeri.")
            st.markdown("### Ultimi esiti")
            st.markdown("".join(riga_esito(dict(r, dettaglio=r.get("dettaglio") or "")) for r in valide[:30]),
                        unsafe_allow_html=True)

# ----------------------------------------------------------- STUDIO PARTITA
else:
    mappa = {etichetta(c, t): (c, t) for (c, t) in proiezioni}
    opzioni = list(mappa)
    if st.session_state.get("partita") not in opzioni:
        st.session_state.partita = opzioni[0]
    scelta = st.pills("Partita", opzioni, key="partita", label_visibility="collapsed") or opzioni[0]
    casa, trasf = mappa[scelta]
    r = proiezioni[(casa, trasf)]
    d = gioc_df[(casa, trasf)]
    marg = r["margine_casa"]
    fav = casa if marg > 0 else trasf
    quota_casa = r["pt_casa"] / (r["pt_casa"] + r["pt_trasf"]) * 100

    st.markdown(
        f'<div class="card2"><div class="riga" style="align-items:flex-end">'
        f'<div><div class="s">{badge(casa)}{esc(nome_squadra(casa))} · casa</div><div class="grande">{r["pt_casa"]:.1f}</div></div>'
        f'<div style="text-align:right"><div class="s">{esc(nome_squadra(trasf))}{badge(trasf).replace("margin-right:6px", "margin-left:6px")}</div>'
        f'<div class="grande">{r["pt_trasf"]:.1f}</div></div></div>'
        f'<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;margin-top:10px">'
        f'<div style="width:{quota_casa}%;background:{ARANCIO}"></div><div style="flex:1;background:#4a5060"></div></div>'
        f'<div class="s" style="margin-top:6px">{esc(ore.get((casa, trasf), ""))} · Favorita {esc(nome_squadra(fav, True))} '
        f'di {abs(marg):.1f} punti</div></div>',
        unsafe_allow_html=True,
    )

    st.markdown("### Ultimi incontri")
    for sq in (casa, trasf):
        with st.expander(f"{nome_squadra(sq)}: ultime 5 partite"):
            blocco_ultime(sq)

    st.markdown("### Giocate consigliate")
    auto_partita = [x for x in auto if x["partita"] == etichetta(casa, trasf)]
    if auto_partita:
        elenco_auto(auto_partita)
    st.markdown("### I migliori di ogni squadra")
    if players.empty:
        st.info("Statistiche dei giocatori non disponibili con questa fonte.")
    else:
        for sq in (casa, trasf):
            st.markdown(blocco_migliori(d[d["squadra"] == sq], f'<div style="display:flex;align-items:center">{logo(sq, 26)}{badge(sq)}<b>{esc(nome_squadra(sq))}</b></div>'),
                        unsafe_allow_html=True)

    st.markdown("### Totale e spread")
    gt = per_id.get(f"tot_{casa}")
    st.markdown(
        f'<div class="card2"><div class="riga"><span class="s">Over/Under (punti totali)</span>'
        f'{pillola(gt["z"]) if gt else ""}</div>'
        f'{gauge(r["totale"], st.session_state.linee.get(f"tot_{casa}"))}</div>',
        unsafe_allow_html=True,
    )
    c1, c2 = st.columns(2)
    with c1:
        campo_linea(f"tot_{casa}", "Linea Over/Under")
    with c2:
        campo_linea(f"spr_{casa}", f"Handicap {nome_squadra(casa, True)} (es. -4.5)", minimo=-60.0)
    trovati = [per_id[k] for k in (f"tot_{casa}", f"spr_{casa}") if k in per_id]
    for gi in trovati:
        card(gi["tipo"], f"Gioca: {gi['testo']}", gi["stima"], f"stima · {forza(gi['z'])[0]}", forza(gi["z"])[1])
        st.caption(gi["motivo"])
    if not trovati:
        st.caption(f"Senza linea: punti totali stimati {r['totale']:.1f}. Inserisci la linea per ricevere il consiglio.")

    st.markdown("### Giocatori")
    if players.empty:
        st.info("Statistiche dei giocatori non disponibili con questa fonte.")
    else:
        rilevanti = set(players[(players["TEAM_ABBREVIATION"].isin([casa, trasf])) & (players["MIN"] >= MIN_MINUTI)]
                        ["PLAYER_NAME"].str.strip().str.lower())
        segnalati = [(n, v) for n, v in infortuni.items() if n in rilevanti and squadra_di.get(n) in (casa, trasf)]
        if segnalati:
            st.markdown("**Infortuni segnalati**")
            for n, v in sorted(segnalati, key=lambda x: x[1]["stato"]):
                et = "Out, escluso dai calcoli" if v["stato"] == "out" else "Dubbio, ancora incluso"
                st.caption(f"{n.title()} ({nome_squadra(squadra_di[n], True)}): {et}. {v['dettaglio']}")
        rosa = players[(players["TEAM_ABBREVIATION"].isin([casa, trasf])) & (players["MIN"] >= MIN_MINUTI)]
        tutti = sorted(set(rosa["PLAYER_NAME"]) | set(st.session_state.esclusi))
        st.pills("Tocca i giocatori che sono out", tutti, selection_mode="multi", key="esclusi")
        if "mercato" not in st.session_state:
            st.session_state.mercato = "Punti"
        mercato = st.pills("Mercato su cui inserire la linea", list(MERCATI), key="mercato") or "Punti"
        pref, col, col_st, unita = MERCATI[mercato]
        for _, p in d.iterrows():
            chiave = f"{pref}{p['giocatore']}"
            st.markdown(scheda_giocatore(p, mercato, st.session_state.linee.get(chiave)), unsafe_allow_html=True)
            campo_linea(chiave, f"Linea {mercato.lower()}",
                        segnaposto=f"Linea {mercato.lower()} (es. {round(p[col] * 2) / 2:g})")
            gi = per_id.get(chiave)
            if gi:
                st.caption(f"**Gioca: {gi['testo']}** ({forza(gi['z'])[0]}). {gi['motivo']}")

    st.markdown("### Da controllare prima di decidere")
    note = ["Infortuni: l'app legge l'elenco di ESPN ed esclude chi è «out». Controlla comunque le ultime "
            "notizie e le formazioni poco prima della partita.",
            "Riposo: è considerato solo il back-to-back (squadra che ha giocato ieri, circa un punto in meno).",
            "Rimbalzi e assist: stima semplice basata sulla media e sul ritmo di gioco, meno precisa dei punti."]
    if "ESPN" in modo:
        note.append("Con la fonte ESPN la forma recente non è disponibile: le stime dei giocatori usano la media stagionale.")
    if abs(marg) >= 10:
        note.append("Margine stimato ampio: nei finali sbilanciati i titolari possono giocare meno minuti, "
                    "con rischio per gli over sui giocatori.")
    if abs(marg) < 3:
        note.append("Partita molto equilibrata: lo spread è poco affidabile, conta di più il totale.")
    for sq in (casa, trasf):
        if sq in b2b_oggi:
            note.append(f"{nome_squadra(sq, True)} ha giocato ieri: stima ridotta di circa {B2B_PUNTI:g} punti.")
    for n in note:
        st.markdown("• " + n)

with st.expander("Diagnostica dati"):
    st.write(f"Fonte: **{modo}**")
    for riga in diag:
        st.write("• " + riga)
    for err in errori:
        st.write("• errore: " + err)
    if registro_msg:
        st.write("• " + registro_msg)
    st.write(f"Partite: {len(partite)} · Squadre: {len(teams)} · Giocatori: {len(players)}")
