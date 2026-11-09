"""NBA Schedine - versione base.
Proiezioni: punti per squadra, totale partita, punti giocatori.
Dati: nba_api (gratuita). Se l'API non risponde, parte la modalità DEMO.
Avvio:  streamlit run app.py
"""
import pandas as pd
import streamlit as st

st.set_page_config(page_title="NBA Schedine", page_icon="🏀", layout="wide")

HOME_ADV = 1.5          # punti di vantaggio casa (metà a testa: +/-)
MIN_MINUTI = 20         # filtro giocatori: minuti medi minimi
PESO_FORMA = 0.6        # peso ultime 10 partite vs stagione


# ---------------------------------------------------------------- DATI
@st.cache_data(ttl=3600, show_spinner="Scarico i dati NBA...")
def carica_dati_live():
    from nba_api.live.nba.endpoints import scoreboard
    from nba_api.stats.endpoints import leaguedashteamstats, leaguedashplayerstats

    games = scoreboard.ScoreBoard().get_dict()["scoreboard"]["games"]
    partite = [
        {
            "casa": g["homeTeam"]["teamTricode"],
            "trasf": g["awayTeam"]["teamTricode"],
            "ora": g.get("gameStatusText", ""),
        }
        for g in games
    ]

    t = leaguedashteamstats.LeagueDashTeamStats(
        measure_type_detailed_defense="Advanced", per_mode_detailed="PerGame"
    ).get_data_frames()[0]
    # Serve la sigla: la ricaviamo dai giocatori (stessa chiamata sotto)
    p_season = leaguedashplayerstats.LeagueDashPlayerStats(
        per_mode_detailed="PerGame"
    ).get_data_frames()[0]
    p_form = leaguedashplayerstats.LeagueDashPlayerStats(
        per_mode_detailed="PerGame", last_n_games=10
    ).get_data_frames()[0]

    sigle = p_season[["TEAM_ID", "TEAM_ABBREVIATION"]].drop_duplicates()
    teams = t.merge(sigle, on="TEAM_ID")[
        ["TEAM_ABBREVIATION", "PACE", "OFF_RATING", "DEF_RATING"]
    ].set_index("TEAM_ABBREVIATION")

    players = p_season[["PLAYER_NAME", "TEAM_ABBREVIATION", "MIN", "PTS"]].merge(
        p_form[["PLAYER_NAME", "PTS"]], on="PLAYER_NAME", suffixes=("_ST", "_L10")
    )
    return pd.DataFrame(partite), teams, players


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


# ------------------------------------------------------------ MODELLO
def proietta_partita(casa, trasf, teams):
    lega_pace = teams["PACE"].mean()
    pace = (teams.loc[casa, "PACE"] + teams.loc[trasf, "PACE"]) / 2
    # punti per 100 possessi: attacco + difesa avversaria, mediati
    off_casa = (teams.loc[casa, "OFF_RATING"] + teams.loc[trasf, "DEF_RATING"]) / 2
    off_trasf = (teams.loc[trasf, "OFF_RATING"] + teams.loc[casa, "DEF_RATING"]) / 2
    pt_casa = off_casa * pace / 100 + HOME_ADV / 2
    pt_trasf = off_trasf * pace / 100 - HOME_ADV / 2
    return {
        "pt_casa": pt_casa,
        "pt_trasf": pt_trasf,
        "totale": pt_casa + pt_trasf,
        "spread": pt_trasf - pt_casa,
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
    df["Punti attesi"] = (base * f_dif * fattore_pace).round(1)
    df["Forma (L10)"] = df["PTS_L10"].round(1)
    df["Stagione"] = df["PTS_ST"].round(1)
    return df[["PLAYER_NAME", "Punti attesi", "Forma (L10)", "Stagione"]].rename(
        columns={"PLAYER_NAME": "Giocatore"}
    ).sort_values("Punti attesi", ascending=False)


# ----------------------------------------------------------------- UI
st.title("🏀 NBA Schedine")
st.caption("Proiezioni di punti per squadra, totale e giocatori. Strumento di supporto, non garantisce vincite.")

try:
    partite, teams, players = carica_dati_live()
    modo = "LIVE"
except Exception as e:
    partite, teams, players = dati_demo()
    modo = "DEMO"
    st.warning(f"Dati live non disponibili ({type(e).__name__}): modalità DEMO con dati di esempio.")

if partite.empty:
    st.info("Nessuna partita in programma oggi.")
    st.stop()

tab_partite, tab_giocatori = st.tabs(["Partite", "Giocatori"])

risultati = {}
with tab_partite:
    for _, g in partite.iterrows():
        casa, trasf = g["casa"], g["trasf"]
        if casa not in teams.index or trasf not in teams.index:
            continue
        r = proietta_partita(casa, trasf, teams)
        risultati[(casa, trasf)] = r
        with st.container(border=True):
            st.subheader(f"{trasf} @ {casa}  ·  {g['ora']}")
            c1, c2, c3, c4 = st.columns(4)
            c1.metric(f"Punti {casa}", f"{r['pt_casa']:.1f}")
            c2.metric(f"Punti {trasf}", f"{r['pt_trasf']:.1f}")
            c3.metric("Totale atteso", f"{r['totale']:.1f}")
            linea = c4.number_input("Linea Over/Under", 0.0, 400.0, 0.0, 0.5, key=f"l_{casa}")
            if linea > 0:
                diff = r["totale"] - linea
                st.write(f"Differenza vs linea: **{diff:+.1f}** → {'Over' if diff > 0 else 'Under'} (indicativo)")

with tab_giocatori:
    scelta = st.selectbox("Partita", [f"{t} @ {c}" for (c, t) in risultati])
    if scelta:
        trasf, casa = [x.strip() for x in scelta.split("@")]
        r = risultati[(casa, trasf)]
        esclusi = st.multiselect(
            "Giocatori out/infortunati (li escludo dal calcolo)",
            sorted(players[players["TEAM_ABBREVIATION"].isin([casa, trasf])]["PLAYER_NAME"]),
        )
        col1, col2 = st.columns(2)
        col1.markdown(f"**{casa}**")
        col1.dataframe(proietta_giocatori(casa, trasf, r["fattore_pace"], teams, players, esclusi), hide_index=True)
        col2.markdown(f"**{trasf}**")
        col2.dataframe(proietta_giocatori(trasf, casa, r["fattore_pace"], teams, players, esclusi), hide_index=True)

st.sidebar.write(f"Modalità dati: **{modo}**")
st.sidebar.caption("Infortuni: al momento da inserire a mano.")
