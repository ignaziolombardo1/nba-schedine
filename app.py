"""NBA Schedine - v2 (stile scuro sportivo).
Sezioni: Top oggi, Totale e spread, Giocatori, Multipla.
Dati: nba_api (gratuita). Se non risponde parte la modalità DEMO.
Le linee dei bookmaker si inseriscono a mano (per ora).
Avvio:  streamlit run app.py
"""
import re
from datetime import datetime

import pandas as pd
import requests
import streamlit as st

st.set_page_config(page_title="NBA Schedine", page_icon="🏀", layout="centered")

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
    return df[["PLAYER_NAME", "atteso", "forma", "stagione"]].rename(
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
                     diff=abs(diff), z=abs(diff) / STD["Totale"])
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
                     diff=abs(diff), z=abs(diff) / STD["Spread"])
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
                         diff=abs(diff), z=abs(diff) / STD["Giocatore"])
                )
    return sorted(out, key=lambda g: g["z"], reverse=True)


# ------------------------------------------------------------------ STATO
if "linee" not in st.session_state:
    st.session_state.linee = {}
if "esclusi" not in st.session_state:
    st.session_state.esclusi = []


def campo_linea(chiave, etichetta, minimo=0.0):
    """Campo numerico che ricorda il valore anche quando cambi partita."""
    w = "w_" + chiave
    if w not in st.session_state and st.session_state.linee.get(chiave) is not None:
        st.session_state[w] = st.session_state.linee[chiave]

    def salva():
        st.session_state.linee[chiave] = st.session_state[w]

    st.number_input(etichetta, min_value=minimo, max_value=400.0, value=None,
                    step=0.5, key=w, on_change=salva)


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

# ------------------------------------------------------------------- TABS
t_top, t_tot, t_gio, t_mul = st.tabs(["Top oggi", "Totale e spread", "Giocatori", "Multipla"])

with t_top:
    if giocate:
        st.caption("Ordinate dalla più lontana dalla linea del bookmaker. È un'indicazione, non una certezza.")
        for gi in giocate[:15]:
            et, col = forza(gi["z"])
            card(f"{gi['partita']} · {gi['tipo']}", gi["testo"], f"{gi['diff']:.1f} pt",
                 f"{et} · stima {gi['atteso']}", col)
    else:
        st.info("Inserisci le linee dei bookmaker nelle altre schede: qui compariranno le giocate più interessanti.")
        top = pd.concat(gioc_df.values()).sort_values("atteso", ascending=False).head(8)
        if not top.empty:
            st.caption("Intanto, i giocatori con più punti attesi oggi:")
        for _, p in top.iterrows():
            card("Punti attesi", p["giocatore"], f"{p['atteso']:.1f}", f"forma {p['forma']:.1f}")

with t_tot:
    for (casa, trasf), r in proiezioni.items():
        st.subheader(f"{trasf} @ {casa}")
        st.caption(ore.get((casa, trasf), ""))
        card("Punti attesi", f"{casa} {r['pt_casa']:.1f} · {trasf} {r['pt_trasf']:.1f}",
             f"{r['totale']:.1f}", "totale atteso")
        c1, c2 = st.columns(2)
        with c1:
            campo_linea(f"tot_{casa}", "Linea Over/Under")
        with c2:
            campo_linea(f"spr_{casa}", f"Handicap {casa} (es. -4.5)", minimo=-60.0)
        for gi in giocate:
            if gi["id"] in (f"tot_{casa}", f"spr_{casa}"):
                et, col = forza(gi["z"])
                card(gi["tipo"], gi["testo"], f"{gi['diff']:.1f} pt", f"{et} · {gi['atteso']}", col)

with t_gio:
    if players.empty:
        st.info("Statistiche dei giocatori non disponibili con questa fonte: restano partite, squadre, totale e spread.")
    scelta = st.selectbox("Partita", [f"{t} @ {c}" for (c, t) in proiezioni])
    if scelta:
        trasf, casa = [x.strip() for x in scelta.split("@")]
        d = gioc_df[(casa, trasf)]
        tutti = sorted(
            set(players[players["TEAM_ABBREVIATION"].isin([casa, trasf])]["PLAYER_NAME"])
            | set(st.session_state.esclusi)
        )
        st.multiselect("Giocatori out (esclusi dal calcolo)", tutti, key="esclusi")
        st.caption("Scrivi la linea punti del bookmaker accanto al giocatore.")
        for _, p in d.iterrows():
            a, b = st.columns([3, 2])
            with a:
                card(f"forma {p['forma']:.1f} · stagione {p['stagione']:.1f}", p["giocatore"],
                     f"{p['atteso']:.1f}", "punti attesi")
            with b:
                campo_linea(f"pl_{p['giocatore']}", "Linea")

with t_mul:
    if not giocate:
        st.info("Prima inserisci qualche linea: le giocate compaiono qui e le puoi aggiungere alla schedina.")
    else:
        st.caption("Spunta le giocate e scrivi la quota di ognuna.")
        scelte = []
        for gi in giocate:
            a, b = st.columns([3, 2])
            with a:
                sel = st.checkbox(f"{gi['testo']} ({gi['partita']})", key="m_" + gi["id"])
            with b:
                q = st.number_input("Quota", min_value=1.0, max_value=100.0, value=None,
                                    step=0.01, key="q_" + gi["id"], label_visibility="collapsed",
                                    placeholder="Quota")
            if sel:
                scelte.append((gi, q))
        if scelte:
            senza = [g["testo"] for g, q in scelte if not q]
            tot = 1.0
            for g, q in scelte:
                if q:
                    tot *= q
            puntata = st.number_input("Puntata (€)", min_value=0.0, value=5.0, step=1.0)
            st.markdown(
                f'<div class="box">Eventi: <b>{len(scelte)}</b><br>'
                f'Quota totale: <b>{tot:.2f}</b><br>'
                f'Vincita potenziale: <b>{tot * puntata:.2f} €</b></div>',
                unsafe_allow_html=True,
            )
            if senza:
                st.warning("Manca la quota per: " + ", ".join(senza))
            if len(scelte) > 4:
                st.caption("Più eventi metti, più è difficile vincerle tutte.")

with st.expander("Diagnostica dati"):
    st.write(f"Fonte: **{modo}**")
    for riga in diag:
        st.write("• " + riga)
    for err in errori:
        st.write("• errore: " + err)
    st.write(f"Partite: {len(partite)} · Squadre: {len(teams)} · Giocatori: {len(players)}")
