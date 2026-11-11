// sigla: [nome completo, nome breve, colore]
export const SQUADRE = {
  ATL: ["Atlanta Hawks", "Hawks", "#E03A3E"], BOS: ["Boston Celtics", "Celtics", "#2a9d5c"],
  BKN: ["Brooklyn Nets", "Nets", "#8a8f98"], CHA: ["Charlotte Hornets", "Hornets", "#1D9BB4"],
  CHI: ["Chicago Bulls", "Bulls", "#CE1141"], CLE: ["Cleveland Cavaliers", "Cavaliers", "#B0305A"],
  DAL: ["Dallas Mavericks", "Mavericks", "#2a7fc1"], DEN: ["Denver Nuggets", "Nuggets", "#FEC524"],
  DET: ["Detroit Pistons", "Pistons", "#C8102E"], GSW: ["Golden State Warriors", "Warriors", "#FFC72C"],
  GS: ["Golden State Warriors", "Warriors", "#FFC72C"], HOU: ["Houston Rockets", "Rockets", "#CE1141"],
  IND: ["Indiana Pacers", "Pacers", "#FDBB30"], LAC: ["Los Angeles Clippers", "Clippers", "#C8102E"],
  LAL: ["Los Angeles Lakers", "Lakers", "#FDB927"], MEM: ["Memphis Grizzlies", "Grizzlies", "#5D76A9"],
  MIA: ["Miami Heat", "Heat", "#C4163F"], MIL: ["Milwaukee Bucks", "Bucks", "#2a8a4a"],
  MIN: ["Minnesota Timberwolves", "Timberwolves", "#4b8fd0"], NOP: ["New Orleans Pelicans", "Pelicans", "#B49C6A"],
  NO: ["New Orleans Pelicans", "Pelicans", "#B49C6A"], NYK: ["New York Knicks", "Knicks", "#F58426"],
  NY: ["New York Knicks", "Knicks", "#F58426"], OKC: ["Oklahoma City Thunder", "Thunder", "#007AC1"],
  ORL: ["Orlando Magic", "Magic", "#0077C0"], PHI: ["Philadelphia 76ers", "76ers", "#2a7fd0"],
  PHX: ["Phoenix Suns", "Suns", "#E56020"], POR: ["Portland Trail Blazers", "Trail Blazers", "#E03A3E"],
  SAC: ["Sacramento Kings", "Kings", "#8e5cc2"], SAS: ["San Antonio Spurs", "Spurs", "#C4CED4"],
  SA: ["San Antonio Spurs", "Spurs", "#C4CED4"], TOR: ["Toronto Raptors", "Raptors", "#CE1141"],
  UTA: ["Utah Jazz", "Jazz", "#F9A01B"], UTAH: ["Utah Jazz", "Jazz", "#F9A01B"],
  WAS: ["Washington Wizards", "Wizards", "#E31837"], WSH: ["Washington Wizards", "Wizards", "#E31837"],
};
export const nome = (ab, breve = false) => { const t = SQUADRE[ab]; return t ? (breve ? t[1] : t[0]) : ab; };
export const info = (ab) => ({ n: nome(ab), b: nome(ab, true), c: (SQUADRE[ab] || [])[2] || "#4a5060" });
