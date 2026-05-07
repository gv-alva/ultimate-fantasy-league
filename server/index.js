const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { getPlayerById, getPlayers, loadPlayers } = require("./playerData");

const app = express();
app.use(cors());
app.use(express.json({ limit: "12mb" }));
const PORT = Number(process.env.PORT) || 3000;
const dataDirectory =
  process.env.RENDER_DISK_PATH ||
  process.env.DATA_DIR ||
  __dirname;

const SERVER_VERSION = "v1.9.2";
const TEAM_SIZE_TARGET = 20;
const DEFAULT_SALARY_CAP = 1500;
const MAX_NEGOTIATION_ATTEMPTS = 3;
const RANDOM_EVENT_PROBABILITY = 0.2;
const REAL_MATCHES_PER_CLUB = 40;
const CHAMPIONS_TABLE_SIZE = 36;
const CHAMPIONS_MATCHES_PER_CLUB = 8;
const DEFAULT_LEAGUE_PRIZE = 50;
const DEFAULT_PLAYOFF_PRIZES = {
  first: 30,
  second: 20,
  third: 10,
  fourth: 10,
};
const DEFAULT_QUICK_TOURNAMENT_PRIZE = 10;
const DEFAULT_QUICK_TOURNAMENT_RUNNER_UP_PRIZE = 5;
const SEASON_SALARY_CAP_BONUS = 250;

const randomEventTemplates = [
  "se fue de fiesta antes del partido",
  "amanecio con fiebre",
  "tuvo una molestia muscular",
  "llego tarde al entrenamiento",
  "discutio con el cuerpo tecnico",
  "arrastro una sobrecarga en la pierna",
  "se resintio de una entrada fuerte",
  "quedo afectado por un problema familiar",
  "se torcio el tobillo en casa",
  "se intoxico con comida en mal estado",
  "recibio descanso obligatorio por estres",
  "tuvo un cuadro viral inesperado",
  "salio golpeado de una practica",
  "quedo tocado por una gripe fuerte",
  "sufrio una contractura de ultimo minuto",
];

const injuryTemplates = [
  "sufrio una lesion muscular",
  "se resintio del tobillo",
  "termino con una sobrecarga fuerte",
  "salio lastimado de la rodilla",
  "recibio un golpe y quedo descartado",
];

const generatedClubNames = [
  "Atletico Prisma",
  "Racing Aurora",
  "Sporting Volcan",
  "Real Cobalto",
  "Inter Eclipse",
  "Union Titanes",
  "Deportivo Bruma",
  "Ciudad Halcones",
  "Estrella Norte",
  "Marina FC",
  "Olimpia Cosmos",
  "Club Centella",
  "Toros Capital",
  "Ferrovia Azul",
  "Lobos Solar",
  "Academia Delta",
  "Dynamo Plata",
  "Valle Dorado",
  "Nexus United",
  "Puerto Atlas",
  "Cronos FC",
  "Furia Metropolitana",
  "Aurora Imperial",
  "Monte Real",
  "Titan Azul",
  "Costa Magna",
  "Solaris Club",
  "Argentum FC",
  "Academia Boreal",
  "Trueno Negro",
  "Imperio Verde",
  "Capital Rojo",
  "Oceano Blanco",
  "Distrito Gold",
  "Centurion FC",
  "Legado Sur",
  "Olympus 26",
  "Dorsal Prime",
  "Mirage United",
  "Pico Norte",
];

const sponsorPresets = [
  {
    name: "Nike",
    values: {
      "Ingreso por ganar": 5,
      "Ingreso por empatar": 2.5,
      "Ingreso por perder": 1,
      "Maximo Goleador": 5,
      "Maximo MVP": 4,
      Tarjetas: -3,
    },
  },
  {
    name: "Adidas",
    values: {
      "Ingreso por ganar": 4.5,
      "Ingreso por empatar": 2,
      "Ingreso por perder": 1,
      "Maximo Goleador": 4,
      "Maximo MVP": 4,
      Tarjetas: -2.5,
    },
  },
  {
    name: "Puma",
    values: {
      "Ingreso por ganar": 4,
      "Ingreso por empatar": 2,
      "Ingreso por perder": 1,
      "Maximo Goleador": 4,
      "Maximo MVP": 3,
      Tarjetas: -2,
    },
  },
  {
    name: "Under Armour",
    values: {
      "Ingreso por ganar": 3.5,
      "Ingreso por empatar": 1.5,
      "Ingreso por perder": 0.5,
      "Maximo Goleador": 3,
      "Maximo MVP": 3,
      Tarjetas: -1.5,
    },
  },
  {
    name: "Jordan",
    values: {
      "Ingreso por ganar": 3,
      "Ingreso por empatar": 1,
      "Ingreso por perder": 0.5,
      "Maximo Goleador": 2.5,
      "Maximo MVP": 2.5,
      Tarjetas: -1,
    },
  },
];

const lobbies = new Map();
const lobbyClients = new Map();
const drafts = new Map();
const draftClients = new Map();
const usersFilePath = path.join(dataDirectory, "users.json");
const mongoUri = process.env.MONGO_URI || "";
let mongoReady = false;

const ensureUsersFile = () => {
  fs.mkdirSync(path.dirname(usersFilePath), { recursive: true });
  if (!fs.existsSync(usersFilePath)) {
    fs.writeFileSync(usersFilePath, "[]", "utf8");
  }
};

const readUsers = () => {
  ensureUsersFile();
  return JSON.parse(fs.readFileSync(usersFilePath, "utf8"));
};

const writeUsers = (users) => {
  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), "utf8");
};

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
  },
  { versionKey: false, timestamps: true }
);

const UserModel = mongoose.models.UflUser || mongoose.model("UflUser", userSchema);
const leagueStateSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    lobby: { type: mongoose.Schema.Types.Mixed, default: null },
    draft: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { versionKey: false, timestamps: true }
);
const LeagueStateModel =
  mongoose.models.UflLeagueState || mongoose.model("UflLeagueState", leagueStateSchema);

const normalizeUser = (user) => ({
  id: String(user._id || user.id),
  username: user.username,
  password: user.password,
});

const normalizeUsernameInput = (username) => String(username || "").trim();

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const connectMongo = async () => {
  if (!mongoUri || mongoReady) return;

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    mongoReady = true;
    console.log("MongoDB conectado para usuarios.");
    const leagueStates = await LeagueStateModel.find({}).lean();
    leagueStates.forEach((state) => {
      if (state.lobby) {
        lobbies.set(state.code, state.lobby);
      }
      if (state.draft) {
        drafts.set(state.code, state.draft);
      }
    });
  } catch (error) {
    console.warn("MongoDB no disponible, se usara users.json.", error.message);
  }
};

const saveLeagueState = async (code) => {
  if (!mongoReady) return;

  await LeagueStateModel.findOneAndUpdate(
    { code },
    {
      code,
      lobby: lobbies.get(code) || null,
      draft: drafts.get(code) || null,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
};

const deleteLeagueState = async (code) => {
  if (!mongoReady) return;
  await LeagueStateModel.findOneAndDelete({ code });
};

const getStoredUsers = async () => {
  if (mongoReady) {
    const users = await UserModel.find({}, { username: 1, password: 1 }).lean();
    return users.map(normalizeUser);
  }

  return readUsers();
};

const findStoredUserByUsername = async (username) => {
  const normalizedUsername = normalizeUsernameInput(username);
  if (!normalizedUsername) return null;

  if (mongoReady) {
    const user = await UserModel.findOne({
      username: { $regex: `^${escapeRegex(normalizedUsername)}$`, $options: "i" },
    }).lean();
    return user ? normalizeUser(user) : null;
  }

  const users = readUsers();
  return (
    users.find(
      (item) => normalizeUsernameInput(item.username).toLowerCase() === normalizedUsername.toLowerCase()
    ) || null
  );
};

const createStoredUser = async (username, passwordHash) => {
  const normalizedUsername = normalizeUsernameInput(username);

  if (mongoReady) {
    const createdUser = await UserModel.create({ username: normalizedUsername, password: passwordHash });
    return normalizeUser(createdUser.toObject());
  }

  const users = readUsers();
  const nextId = users.length === 0 ? 1 : Math.max(...users.map((item) => Number(item.id) || 0)) + 1;
  const nextUser = { id: nextId, username: normalizedUsername, password: passwordHash };
  users.push(nextUser);
  writeUsers(users);
  return nextUser;
};

const updateStoredUser = async (id, updates) => {
  if (mongoReady) {
    const nextUser = await UserModel.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    }).lean();
    return nextUser ? normalizeUser(nextUser) : null;
  }

  const users = readUsers();
  const index = users.findIndex((item) => String(item.id) === String(id));
  if (index === -1) return null;
  users[index] = { ...users[index], ...updates };
  writeUsers(users);
  return users[index];
};

const deleteStoredUser = async (id) => {
  if (mongoReady) {
    const deletedUser = await UserModel.findByIdAndDelete(id).lean();
    return deletedUser ? normalizeUser(deletedUser) : null;
  }

  const users = readUsers();
  const index = users.findIndex((item) => String(item.id) === String(id));
  if (index === -1) return null;
  const [deletedUser] = users.splice(index, 1);
  writeUsers(users);
  return deletedUser;
};

const generateLobbyCode = () => {
  let code;

  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (lobbies.has(code));

  return code;
};

const hashString = (value) => {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash >>> 0;
};

const getTeamPayroll = (team) =>
  team.squad.reduce((sum, player) => sum + (Number(player.salary) || 0), 0);

const formatMoney = (value) => `${Math.round(Number(value || 0) * 10) / 10}M`;

const createSponsor = (index = 0) => {
  const preset = sponsorPresets[index % sponsorPresets.length] || sponsorPresets[0];
  return {
    name: preset.name,
    values: { ...preset.values },
  };
};

const getRandomSponsor = (currentName = "") => {
  const options = sponsorPresets.filter((preset) => preset.name !== currentName);
  const pool = options.length > 0 ? options : sponsorPresets;
  const picked = pool[Math.floor(Math.random() * pool.length)] || sponsorPresets[0];
  return {
    name: picked.name,
    values: { ...picked.values },
  };
};

const getLeagueRegularSeasonTotals = (lobby, draft) => {
  if (lobby?.competitionMode === "champions") {
    return {
      totalMatches: Math.floor((CHAMPIONS_TABLE_SIZE * CHAMPIONS_MATCHES_PER_CLUB) / 2),
      matchesPerClub: CHAMPIONS_MATCHES_PER_CLUB,
    };
  }

  if (lobby?.leagueType === "Fantasia") {
    const teamCount = Math.max((draft?.standings || []).length, 0);
    return {
      totalMatches: teamCount * Math.max(teamCount - 1, 0),
      matchesPerClub: Math.max(teamCount - 1, 0) * 2,
    };
  }

  const realTeamCount = Math.max(
    (draft?.standings || []).length,
    (draft?.cpuTeams || []).length + (lobby?.players || []).length,
    getLeagueSize(lobby?.format),
    1
  );
  const totalMatches = Math.floor((realTeamCount * REAL_MATCHES_PER_CLUB) / 2);
  return {
    totalMatches,
    matchesPerClub: REAL_MATCHES_PER_CLUB,
  };
};

const isRegularSeasonComplete = (draft, lobby) => {
  const { matchesPerClub, totalMatches } = getLeagueRegularSeasonTotals(lobby, draft);

  if (lobby?.leagueType === "Fantasia") {
    const playedMatches = (draft?.schedule || [])
      .flat()
      .filter((match) => match.played && match.result)
      .length;
    return playedMatches >= totalMatches;
  }

  const standings = draft?.standings || [];
  if (standings.length === 0) return false;
  return standings.every((team) => Number(team.played || 0) >= matchesPerClub);
};

const getLobbyPrizeConfig = (lobby = {}) => ({
  leaguePrize: Number(lobby.leaguePrize) || DEFAULT_LEAGUE_PRIZE,
  playoffPrize1: Number(lobby.playoffPrize1) || DEFAULT_PLAYOFF_PRIZES.first,
  playoffPrize2: Number(lobby.playoffPrize2) || DEFAULT_PLAYOFF_PRIZES.second,
  playoffPrize3: Number(lobby.playoffPrize3) || DEFAULT_PLAYOFF_PRIZES.third,
  playoffPrize4: Number(lobby.playoffPrize4) || DEFAULT_PLAYOFF_PRIZES.fourth,
});

const getDefaultChampionsPhaseLabels = () => ({
  playoff: "Repechaje",
  round16: "Octavos",
  quarterfinal: "Cuartos",
  semifinal: "Semifinal",
  final: "Final",
});

const getReleaseClauseValue = (player) => Math.round((Number(player.marketValue || 0) * 2) * 10) / 10;

const getProtectedPlayerIds = (team) => team?.protectedPlayerIds || [];

const isPlayerProtected = (team, playerId) =>
  getProtectedPlayerIds(team).some((id) => String(id) === String(playerId));

const getTrainingCost = (overall) => {
  if (overall < 75) return 1;
  if (overall <= 80) return 2;
  if (overall <= 85) return 4;
  if (overall <= 90) return 10;
  if (overall <= 95) return 15;
  return 25;
};

const TRAINABLE_STAT_KEYS = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];

const getTeamPayload = (team) => ({
  ...team,
  salaryUsed: getTeamPayroll(team),
  protectedPlayerIds: getProtectedPlayerIds(team),
});

const getPendingSigningPayload = (signing) => ({
  ...signing,
});

const findPlayerOwner = (draft, playerId) =>
  Object.keys(draft.teams).find((owner) =>
    draft.teams[owner].squad.some((player) => String(player.ID) === String(playerId))
  );

const teamOwnsPlayer = (team, playerId) =>
  team.squad.some((player) => String(player.ID) === String(playerId));

const clonePlayerForTeam = (player, salary = player.salary) => ({
  ...player,
  salary: Number(salary) || player.salary || 0,
});

const getLeagueSize = (format) => {
  if (format === "Pequena") return 8;
  if (format === "Corta") return 10;
  return 20;
};

const sortStandings = (standings = []) =>
  [...standings].sort(
    (leftTeam, rightTeam) =>
      rightTeam.pts - leftTeam.pts ||
      (rightTeam.gf - rightTeam.ga) - (leftTeam.gf - leftTeam.ga) ||
      rightTeam.gf - leftTeam.gf
  );

const addNews = (draft, code, text) => {
  if (!draft.news) {
    draft.news = [];
  }
  draft.news.unshift({ code, text, createdAt: Date.now() });
};

const pickRandom = (items = []) => items[Math.floor(Math.random() * items.length)] || "";

const addRomanoComment = (draft, code, type, context = {}) => {
  const subject = context.subject || context.player || context.team || context.winner || "el movimiento";
  const target = context.loser || context.rival || context.fromClub || "el rival";
  const amount = context.amount ? `${context.amount}M` : "una cifra seria";
  const commentsByType = {
    result: [
      `Fabrizio Romano: ${subject} dejo sensaciones muy serias. El rival ${target} tendra que responder en la siguiente jornada.`,
      `Fabrizio Romano: Resultado confirmado, ${subject} golpeo en el momento justo y ${target} se va con preguntas.`,
      `Fabrizio Romano: Ojo con ${subject}, hoy mando un mensaje fuerte a toda la liga.`,
      `Fabrizio Romano: Partido cerrado. ${subject} saco ventaja real y la tabla ya lo siente.`,
    ],
    transfer: [
      `Fabrizio Romano: ${subject} mueve el mercado y la operacion ya genera ruido en varios clubes.`,
      `Fabrizio Romano: ${subject} entra en el foco, acuerdo importante por ${amount}.`,
      `Fabrizio Romano: Negocio serio en la liga. ${subject} cambia el panorama del mercado.`,
      `Fabrizio Romano: Lo de ${subject} ya repercute en toda la liga, y apenas empieza el ruido.`,
    ],
    clause: [
      `Fabrizio Romano: Clausula ejecutada por ${subject}. El club golpeado fue ${target} y el mercado no para.`,
      `Fabrizio Romano: ${subject} salio por clausula y esto deja a ${target} contra las cuerdas.`,
      `Fabrizio Romano: Movimiento relampago con clausula. ${subject} cambia de destino y deja huella.`,
      `Fabrizio Romano: Clausula confirmada. ${subject} ya tiene nuevo rumbo y ${target} perdio una pieza clave.`,
    ],
  };

  addNews(draft, code, pickRandom(commentsByType[type] || commentsByType.transfer));
};

const addLeagueComment = (draft, code, type, context = {}) => {
  const home = context.home || context.team || context.winner || "Un club";
  const away = context.away || context.rival || context.loser || "otro club";
  const player = context.player || "un jugador";
  const commentsByType = {
    result: [
      `Liga UFL: la jornada sigue caliente. ${home} y ${away} dejaron movimiento en la tabla.`,
      `Liga UFL: se movieron posiciones tras el duelo entre ${home} y ${away}.`,
      `Liga UFL: otro resultado oficial registrado. ${home} y ${away} ya modifican la pelea por puestos.`,
      `Liga UFL: la tabla aprieta. ${home} y ${away} dejaron consecuencias directas en la clasificacion.`,
    ],
    training: [
      `Liga UFL: ${player} termino una mejora individual y su club espera impacto inmediato.`,
      `Liga UFL: sesion completada para ${player}. El desarrollo del plantel sigue avanzando.`,
      `Liga UFL: ${player} elevo su nivel dentro de esta liga y ya hay reacciones en los rivales.`,
      `Liga UFL: entrenamiento confirmado para ${player}. El club apuesta fuerte por su crecimiento.`,
    ],
    transfer: [
      `Liga UFL: el mercado vuelve a moverse y varios clubes ya revisan sus cuentas.`,
      `Liga UFL: nueva operacion registrada. El equilibrio del mercado sigue cambiando.`,
      `Liga UFL: otro movimiento oficial en la liga. Nadie quiere quedarse atras.`,
      `Liga UFL: la ventana de transferencias sigue activa y los despachos no descansan.`,
    ],
  };

  addNews(draft, code, pickRandom(commentsByType[type] || commentsByType.transfer));
};

const addFaunaComment = (draft, code, type, context = {}) => {
  if (type !== "offerRejected" && Math.random() > 0.5) {
    return;
  }

  const winner = context.winner || "Ese club";
  const loser = context.loser || context.rival || "el rival";
  const player = context.player || "ese jugador";
  const faunaFragments = {
    result: {
      opener: [
        `Fabritzio Fauna: ${winner} le paso por encima a ${loser}.`,
        `Fabritzio Fauna: Partido terminado y ${loser} quedo retratado.`,
        `Fabritzio Fauna: ${winner} se paseo a ${loser} sin pedir permiso.`,
        `Fabritzio Fauna: ${loser} salio a competir y termino haciendo bulto frente a ${winner}.`,
        `Fabritzio Fauna: Resultado firmado y ${loser} quedo viendo como ${winner} le pintaba la cara.`,
      ],
      middle: [
        `${loser} defendio como puerta de cantina.`,
        `${loser} jugo con la intensidad de una siesta mal tomada.`,
        `${loser} parecia armado con conos y buena fe.`,
        `${loser} ofrecio una actuacion para esconder el video.`,
        `${loser} dejo claro que el balon no era su amigo hoy.`,
        `${loser} tuvo reflejos de estatua y criterio de semaforo fundido.`,
      ],
      closer: [
        `Que no revisen menciones por unas horas.`,
        `Si entrenaron para esto, mejor pidan reembolso.`,
        `Hoy no perdieron un partido, perdieron la poca verguenza competitiva.`,
        `Eso ya no fue derrota, fue auditoria futbolistica.`,
        `Lo mejor que puede hacer ${loser} es apagar notificaciones.`,
      ],
    },
    transfer: {
      opener: [
        `Fabritzio Fauna: ${player} cambio de aires y el mercado volvió a arder.`,
        `Fabritzio Fauna: Operacion cerrada con ${player} y varios directivos ya tiemblan.`,
        `Fabritzio Fauna: ${winner} se movio por ${player} y dejó a media liga mascando coraje.`,
        `Fabritzio Fauna: Mercado encendido, ${player} ya no duerme en el mismo escudo.`,
      ],
      middle: [
        `En un club celebran y en otro cuentan monedas con lagrimas.`,
        `El despacho que lo perdio negocio como si tuviera sueno.`,
        `Se nota quien trabaja el mercado y quien firma con los ojos cerrados.`,
        `Al vendedor le vieron la cara bonito y encima sonrio para la foto.`,
        `Esto huele a drama, humo y egos rotos, justo como nos gusta.`,
      ],
      closer: [
        `Si sale mal, al que autorizo eso lo van a esconder debajo del escritorio.`,
        `Varios directivos acaban de quedar como cajeros descompuestos.`,
        `La operacion es oficial y el ridiculo de algunos tambien.`,
        `Unos pescan tiburones y otros se ahogan en un charco.`,
      ],
    },
    clause: {
      opener: [
        `Fabritzio Fauna: HACHAZO total con ${player}.`,
        `Fabritzio Fauna: Clausulazo brutal por ${player}.`,
        `Fabritzio Fauna: Le arrancaron a ${player} al rival con un hachazo limpio.`,
        `Fabritzio Fauna: Sono la caja y ${player} salio por clausula.`,
      ],
      middle: [
        `${loser} quedo viendo al techo con cara de velorio.`,
        `Al exclub le dejaron puro eco en el vestidor.`,
        `Eso no fue mercado, fue atraco con recibo y firma.`,
        `El rival ni metio las manos y encima salio peinado.`,
        `Le quitaron el plato de la mesa a ${loser} y ni cuenta se dio.`,
      ],
      closer: [
        `Papelon consumado para el otro lado.`,
        `Que no se hagan los ofendidos, los desarmaron bonito.`,
        `Desde la otra conferencia se escucho el berrinche.`,
        `Lo de hoy fue robo elegante con aplausos.`,
      ],
    },
    training: {
      opener: [
        `Fabritzio Fauna: ${player} entreno y subio de nivel.`,
        `Fabritzio Fauna: Mejoraron a ${player} y ahora mete mas respeto.`,
        `Fabritzio Fauna: ${winner} se puso serio y pulio a ${player}.`,
      ],
      middle: [
        `Mientras unos trabajan, media liga sigue entrenando con tutoriales rotos.`,
        `Hay clubes afinando talento y otros coleccionando excusas.`,
        `Se nota cuando un equipo entrena de verdad y no por compromiso.`,
      ],
      closer: [
        `Ojo, porque varios rivales siguen dormidos.`,
        `Luego no lloren cuando el mejorado les pinte la cara.`,
        `La diferencia entre proyecto y circo se empieza a notar.`,
      ],
    },
    offerRejected: {
      opener: [
        `Fabritzio Fauna: ${loser} fue por ${player} y salio bateado.`,
        `Fabritzio Fauna: Rechazaron a ${loser} sin anestesia.`,
        `Fabritzio Fauna: ${loser} quiso negociar a ${player} y termino haciendo fila para el ridiculo.`,
        `Fabritzio Fauna: A ${loser} le cerraron la puerta en la cara por ${player}.`,
      ],
      middle: [
        `Lo mandaron de vuelta con las manos vacias y el orgullo arrugado.`,
        `Parecia que habia llegado con billetes del Monopoly.`,
        `La oferta dio más pena que miedo.`,
        `El otro club apenas vio los números y casi se ríe en su cara.`,
        `Eso no fue negociación, fue una invitación al rechazo.`,
      ],
      closer: [
        `Mercado cruel, pero merecido.`,
        `Que vaya a practicar antes de volver a tocar esa puerta.`,
        `Hoy no compraron a nadie, pero sí compraron pena ajena.`,
        `Si eso era una oferta seria, mejor que entreguen la calculadora.`,
      ],
    },
    budget: {
      opener: [
        `Fabritzio Fauna: ${winner} le abrio la llave del dinero a la liga.`,
        `Fabritzio Fauna: Cayo presupuesto extra y varios clubes ya se sienten magnates de juguete.`,
        `Fabritzio Fauna: El organizador tiro billetes al mercado y ahora todos se creen tiburones.`,
      ],
      middle: [
        `Con ${player} extra por club, mas de uno ya va a salir a fichar como si supiera negociar.`,
        `Ahora veremos quien compra talento y quien vuelve a pagar de mas por puro humo.`,
        `Les dieron caja nueva; falta ver si la usan para reforzarse o para hacer el ridiculo con corbata.`,
        `Dinero fresco para todos, aunque varios siguen teniendo criterio de carrito descompuesto.`,
      ],
      closer: [
        `Que no se emocionen tanto, que dinero no arregla un cerebro tactico fundido.`,
        `A algunos les dieron presupuesto; lastima que no venden neuronas en el mercado.`,
        `Ahora ya no tendran excusa economica, solo deportiva.`,
        `Si vuelven a fichar mal con esto, mejor que cierren la oficina.`,
      ],
    },
  };

  const family = faunaFragments[type] || faunaFragments.transfer;
  const line = [pickRandom(family.opener), pickRandom(family.middle), pickRandom(family.closer)]
    .filter(Boolean)
    .join(" ");
  addNews(draft, code, line);
};

const getDraftPlayerById = (draft, playerId) => {
  for (const team of Object.values(draft?.teams || {})) {
    const foundPlayer = team.squad.find((player) => String(player.ID) === String(playerId));
    if (foundPlayer) {
      return foundPlayer;
    }
  }

  return getPlayerById(playerId);
};

const getLeaguePlayers = (draft, { limit = 100, search = "" } = {}) => {
  const normalizedSearch = String(search || "").trim().toLowerCase();
  const overrides = new Map();

  Object.values(draft?.teams || {}).forEach((team) => {
    team.squad.forEach((player) => {
      overrides.set(String(player.ID), player);
    });
  });

  const mergedPlayers = loadPlayers().map((player) => ({
    ...player,
    ...(overrides.get(String(player.ID)) || {}),
  }));

  const filteredPlayers = normalizedSearch
    ? mergedPlayers.filter((player) =>
        String(player.Name || "").toLowerCase().includes(normalizedSearch)
      )
    : mergedPlayers;

  return filteredPlayers.slice(0, Math.min(Number(limit) || 100, 2000));
};

const isCpuVsCpuNews = (draft, text) => {
  if (typeof text !== "string" || !text.startsWith("Liga UFL:")) return false;

  const cpuNames = (draft.cpuTeams || []).map((team) => team.name);
  const managerNames = Object.values(draft.teams || {}).map((team) => team.name);
  const cpuMatches = cpuNames.filter((name) => text.includes(name)).length;
  const managerMatches = managerNames.filter((name) => text.includes(name)).length;

  return cpuMatches >= 2 && managerMatches === 0;
};

const getNewsPayload = (draft, code) =>
  (draft.news || [])
    .filter((item) => item && typeof item === "object" && item.code === code)
    .filter((item) => !isCpuVsCpuNews(draft, item.text))
    .map((item) => ({ text: item.text, createdAt: item.createdAt }))
    .slice(0, 30);

const syncStandingsWithTeams = (draft, lobby) => {
  if (!draft || !lobby) return;
  ensureCpuTeams(draft, lobby);

  const realTeams = lobby.players.map((owner) => ({
    key: owner,
    name: draft.teams[owner]?.name || owner,
    real: true,
  }));
  const size = lobby.competitionMode === "champions" ? CHAMPIONS_TABLE_SIZE : getLeagueSize(lobby.format);
  const generatedTeams = lobby.fillCpuTeams
    ? (draft.cpuTeams || []).map((team) => ({ key: team.key, name: team.name, real: false }))
    : [];
  const allTeams = [...realTeams, ...generatedTeams].slice(
    0,
    lobby.fillCpuTeams ? size : realTeams.length
  );
  const championsLimit =
    lobby.competitionMode === "champions"
      ? allTeams.length
      : lobby.champions
        ? Math.max(1, Math.floor(allTeams.length / 3))
        : 0;
  const currentStandings = draft.standings || [];

  draft.standings = sortStandings(
    allTeams.map((team, index) => {
      const currentStanding = currentStandings.find((item) => item.key === team.key);

      return currentStanding
        ? {
            ...currentStanding,
            name: team.name,
            real: team.real,
            champions: index < championsLimit,
          }
        : {
            key: team.key,
            name: team.name,
            real: team.real,
            champions: index < championsLimit,
            played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            gf: 0,
            ga: 0,
            pts: 0,
          };
    })
  );
};

const awardLeaguePrizeIfNeeded = (draft, lobby, code) => {
  if (!draft?.standings?.length || draft.seasonLeaguePrizePaid) return;

  const { leaguePrize } = getLobbyPrizeConfig(lobby);
  const realTeams = sortStandings(draft.standings).filter((team) => team.real);
  if (leaguePrize <= 0 || realTeams.length === 0) {
    draft.seasonLeaguePrizePaid = true;
    return;
  }

  realTeams.forEach((standing) => {
    const team = draft.teams[standing.key];
    if (team) {
      team.budget = Number(team.budget || 0) + leaguePrize;
    }
  });

  draft.seasonLeaguePrizePaid = true;
  addNews(draft, code, `Liga UFL: se repartieron ${formatMoney(leaguePrize)} por club real como premio base de liga`);
};

const appendSeasonWinnerIfNeeded = (draft, lobby, code) => {
  if (!draft?.standings?.length || draft.seasonWinnerAnnounced) return;

  draft.regularSeasonComplete = true;
  draft.seasonWinnerAnnounced = true;
  awardLeaguePrizeIfNeeded(draft, lobby, code);

  if (lobby?.competitionMode === "champions") {
    draft.seasonChampionKey = "";
    draft.seasonChampionName = "";
    draft.championCelebrationId = "";
    draft.championsKnockout = buildChampionsKnockout(draft, lobby);
    addNews(draft, code, "Liga UFL: se completo la fase de liga de Champions. La fase final ya esta habilitada.");
    return;
  }

  const winner = sortStandings(draft.standings)[0];
  if (!winner) return;

  draft.seasonChampionKey = winner.key;
  draft.seasonChampionName = winner.name;
  draft.championCelebrationId = `season-${code}-${winner.key}-${Date.now()}`;
  addNews(draft, code, `Liga UFL: ${winner.name} es campeon de la temporada`);
  addNews(draft, code, "Liga UFL: se completo la liga regular. La liguilla ya esta habilitada.");
};

const awardPlayoffPrizesIfNeeded = (draft, lobby, code) => {
  if (!draft?.playoff?.championKey || draft.playoffPrizePaid) return;

  const { playoffPrize1, playoffPrize2, playoffPrize3, playoffPrize4 } = getLobbyPrizeConfig(lobby);
  const finalMatch = draft.playoff.final;
  const championKey = draft.playoff.championKey;
  const runnerUpKey =
    finalMatch.homeKey === championKey ? finalMatch.awayKey : finalMatch.homeKey;
  const semifinalLosers = [draft.playoff.semifinal1, draft.playoff.semifinal2]
    .map((match) => (match.homeKey === match.winnerKey ? match.awayKey : match.homeKey))
    .filter(Boolean);
  const standingOrder = sortStandings(draft.standings || []).map((team) => team.key);
  semifinalLosers.sort(
    (leftKey, rightKey) => standingOrder.indexOf(leftKey) - standingOrder.indexOf(rightKey)
  );

  const rewards = [
    { key: championKey, amount: playoffPrize1, label: "campeon de liguilla" },
    { key: runnerUpKey, amount: playoffPrize2, label: "subcampeon de liguilla" },
    { key: semifinalLosers[0], amount: playoffPrize3, label: "tercer lugar de liguilla" },
    { key: semifinalLosers[1], amount: playoffPrize4, label: "cuarto lugar de liguilla" },
  ];

  rewards.forEach(({ key, amount, label }) => {
    if (!key || amount <= 0) return;
    const team = draft.teams[key];
    const teamName = getTeamNameByKey(draft, key);
    if (team) {
      team.budget = Number(team.budget || 0) + amount;
    }
    addNews(draft, code, `Liga UFL: ${teamName} cobro ${formatMoney(amount)} por ${label}`);
  });

  draft.playoffPrizePaid = true;
};

const awardQuickTournamentPrizeIfNeeded = (draft, code) => {
  if (!draft?.quickTournament?.championKey || draft.quickTournament.prizePaid) return;

  const amount = Number(draft.quickTournament.prize || 0);
  const runnerUpAmount = Number(draft.quickTournament.runnerUpPrize || 0);
  const championKey = draft.quickTournament.championKey;
  const championTeam = draft.teams[championKey];
  const finalRound = draft.quickTournament.rounds?.[draft.quickTournament.rounds.length - 1];
  const finalMatch = finalRound?.matches?.[0];
  const runnerUpKey =
    finalMatch && finalMatch.homeKey && finalMatch.awayKey
      ? (finalMatch.homeKey === championKey ? finalMatch.awayKey : finalMatch.homeKey)
      : "";
  if (championTeam && amount > 0) {
    championTeam.budget = Number(championTeam.budget || 0) + amount;
    addNews(draft, code, `Liga UFL: ${championTeam.name} cobro ${formatMoney(amount)} por ganar el torneo rapido`);
  }
  if (runnerUpKey && draft.teams[runnerUpKey] && runnerUpAmount > 0) {
    draft.teams[runnerUpKey].budget = Number(draft.teams[runnerUpKey].budget || 0) + runnerUpAmount;
    addNews(draft, code, `Liga UFL: ${draft.teams[runnerUpKey].name} cobro ${formatMoney(runnerUpAmount)} por ser subcampeon del torneo rapido`);
  }
  draft.quickTournament.prizePaid = true;
};

const buildChampionsKnockout = (draft, lobby) => {
  const labels = {
    ...getDefaultChampionsPhaseLabels(),
    ...(lobby?.championsPhaseLabels || {}),
  };
  const rankedTeams = sortStandings(draft.standings || []);
  const topEight = rankedTeams.slice(0, 8);
  const playoffTeams = rankedTeams.slice(8, 24);
  if (rankedTeams.length < 2) return null;

  const createEmptyMatch = (roundIndex, matchIndex) => ({
    id: `champions-${roundIndex}-${matchIndex + 1}`,
    homeKey: "",
    awayKey: "",
    homeName: "",
    awayName: "",
    played: false,
    result: null,
    winnerKey: "",
  });

  const seededPlayoff = Array.from({ length: 8 }, (_, index) => {
    const home = playoffTeams[index];
    const away = playoffTeams[playoffTeams.length - 1 - index];
    return {
      id: `champions-0-${index + 1}`,
      homeKey: home?.key || "",
      awayKey: away?.key || "",
      homeName: home?.name || "",
      awayName: away?.name || "",
      played: false,
      result: null,
      winnerKey: "",
    };
  });

  return {
    active: true,
    labels,
    rounds: [
      {
        name: labels.playoff || "",
        matches: seededPlayoff,
      },
      {
        name: labels.round16 || "",
        matches: Array.from({ length: 8 }, (_, index) => ({
          ...createEmptyMatch(1, index),
        })),
      },
      {
        name: labels.quarterfinal || "",
        matches: Array.from({ length: 4 }, (_, index) => ({
          ...createEmptyMatch(2, index),
        })),
      },
      {
        name: labels.semifinal || "",
        matches: Array.from({ length: 2 }, (_, index) => ({
          ...createEmptyMatch(3, index),
        })),
      },
      {
        name: labels.final || "",
        matches: [{ ...createEmptyMatch(4, 0) }],
      },
    ],
    championKey: "",
    qualifiedKeys: topEight.map((team) => team.key),
  };
};

const syncChampionsKnockout = (draft, lobby) => {
  if (lobby?.competitionMode !== "champions" || !draft.regularSeasonComplete) {
    draft.championsKnockout = null;
    return;
  }

  if (!draft.championsKnockout?.active) {
    draft.championsKnockout = buildChampionsKnockout(draft, lobby);
  }

  const bracket = draft.championsKnockout;
  if (!bracket?.rounds?.length) return;

  const rankedTeams = sortStandings(draft.standings || []);
  const teamByKey = new Map(rankedTeams.map((team) => [team.key, team]));
  const topEight = rankedTeams.slice(0, 8);
  bracket.qualifiedKeys = topEight.map((team) => team.key);
  const playoffRound = bracket.rounds[0];
  const round16Round = bracket.rounds[1];
  const quarterRound = bracket.rounds[2];
  const semiRound = bracket.rounds[3];
  const finalRound = bracket.rounds[4];

  if (playoffRound) {
    const playoffTeams = rankedTeams.slice(8, 24);
    playoffRound.matches.forEach((match, index) => {
      if (match.played) return;
      if (!match.homeKey || !match.awayKey) {
        const home = playoffTeams[index];
        const away = playoffTeams[playoffTeams.length - 1 - index];
        match.homeKey = match.homeKey || home?.key || "";
        match.awayKey = match.awayKey || away?.key || "";
        match.homeName = match.homeName || home?.name || "";
        match.awayName = match.awayName || away?.name || "";
      }
    });
  }

  if (round16Round) {
    round16Round.matches.forEach((match, index) => {
      if (match.played) return;
      const seeded = topEight[index];
      if (!match.homeKey) {
        match.homeKey = seeded?.key || "";
        match.homeName = seeded?.name || "";
      }
      if (!match.homeName && match.homeKey) {
        match.homeName = teamByKey.get(match.homeKey)?.name || match.homeName || "";
      }
      if (!match.awayName && match.awayKey) {
        match.awayName = teamByKey.get(match.awayKey)?.name || match.awayName || "";
      }
    });
  }

  const wireNextRound = (fromRound, toRound) => {
    if (!fromRound || !toRound) return;
    toRound.matches.forEach((match, index) => {
      const homeSource = fromRound.matches[index * 2];
      const awaySource = fromRound.matches[index * 2 + 1];
      if (homeSource?.winnerKey && !match.homeKey) {
        const homeWinner = teamByKey.get(homeSource.winnerKey);
        match.homeKey = homeSource.winnerKey;
        match.homeName = homeWinner?.name || homeSource.homeName || "";
      }
      if (awaySource?.winnerKey && !match.awayKey) {
        const awayWinner = teamByKey.get(awaySource.winnerKey);
        match.awayKey = awaySource.winnerKey;
        match.awayName = awayWinner?.name || awaySource.awayName || awaySource.homeName || "";
      }
    });
  };

  wireNextRound(playoffRound, round16Round);
  wireNextRound(round16Round, quarterRound);
  wireNextRound(quarterRound, semiRound);
  wireNextRound(semiRound, finalRound);

  if (finalRound?.matches?.[0]?.winnerKey) {
    bracket.championKey = finalRound.matches[0].winnerKey;
  }
};

const awardChampionsPrizesIfNeeded = (draft, lobby, code) => {
  if (!draft?.championsKnockout?.championKey || draft.playoffPrizePaid) return;

  const { playoffPrize1, playoffPrize2, playoffPrize3, playoffPrize4 } = getLobbyPrizeConfig(lobby);
  const rounds = draft.championsKnockout.rounds || [];
  const finalRound = rounds[rounds.length - 1];
  const semiRound = rounds[rounds.length - 2];
  const finalMatch = finalRound?.matches?.[0];
  const championKey = draft.championsKnockout.championKey;
  const runnerUpKey =
    finalMatch?.homeKey === championKey ? finalMatch?.awayKey : finalMatch?.homeKey;
  const semifinalLosers = (semiRound?.matches || [])
    .map((match) => (match.homeKey === match.winnerKey ? match.awayKey : match.homeKey))
    .filter(Boolean);

  [
    { key: championKey, amount: playoffPrize1, label: "campeon de Champions" },
    { key: runnerUpKey, amount: playoffPrize2, label: "subcampeon de Champions" },
    { key: semifinalLosers[0], amount: playoffPrize3, label: "semifinalista de Champions" },
    { key: semifinalLosers[1], amount: playoffPrize4, label: "semifinalista de Champions" },
  ].forEach(({ key, amount, label }) => {
    if (!key || amount <= 0) return;
    const team = draft.teams[key];
    const teamName = getTeamNameByKey(draft, key);
    if (team) {
      team.budget = Number(team.budget || 0) + amount;
    }
    addNews(draft, code, `Liga UFL: ${teamName} cobro ${formatMoney(amount)} por ${label}`);
  });

  draft.playoffPrizePaid = true;
};

const emptyPlayoffMatch = (stage, label) => ({
  stage,
  label,
  homeKey: "",
  awayKey: "",
  homeName: "",
  awayName: "",
  played: false,
  result: null,
  winnerKey: "",
});

const ensurePlayoff = (draft) => {
  if (!draft.playoff) {
    draft.playoff = {
      semifinal1: emptyPlayoffMatch("semifinal1", "Semifinal 1"),
      semifinal2: emptyPlayoffMatch("semifinal2", "Semifinal 2"),
      final: emptyPlayoffMatch("final", "Final"),
      championKey: "",
    };
  }

  const sorted = sortStandings(draft.standings || []).slice(0, 4);
  const semi1 = draft.playoff.semifinal1;
  const semi2 = draft.playoff.semifinal2;
  const finalMatch = draft.playoff.final;

  if (!semi1.played && sorted[0] && sorted[3]) {
    semi1.homeKey = sorted[0].key;
    semi1.awayKey = sorted[3].key;
    semi1.homeName = sorted[0].name;
    semi1.awayName = sorted[3].name;
  }

  if (!semi2.played && sorted[1] && sorted[2]) {
    semi2.homeKey = sorted[1].key;
    semi2.awayKey = sorted[2].key;
    semi2.homeName = sorted[1].name;
    semi2.awayName = sorted[2].name;
  }

  if (semi1.winnerKey && semi2.winnerKey) {
    finalMatch.homeKey = semi1.winnerKey;
    finalMatch.awayKey = semi2.winnerKey;
    finalMatch.homeName = getTeamNameByKey(draft, semi1.winnerKey);
    finalMatch.awayName = getTeamNameByKey(draft, semi2.winnerKey);
  }
};

const applySponsorIncome = (team, goalsFor, goalsAgainst, cards = 0) => {
  if (!team?.sponsor?.values) return 0;

  const values = team.sponsor.values;
  let income = 0;

  if (goalsFor > goalsAgainst) income += Number(values["Ingreso por ganar"] || 0);
  else if (goalsFor === goalsAgainst) income += Number(values["Ingreso por empatar"] || 0);
  else income += Number(values["Ingreso por perder"] || 0);

  income += Number(values["Tarjetas"] || 0) * Number(cards || 0);
  team.budget = Number(team.budget || 0) + income;
  return income;
};

const resetLeagueForNewSeason = (draft, lobby) => {
  draft.phase = "auction";
  draft.auctionStage = 0;
  draft.bids = [];
  draft.bidCounts = {};
  draft.offers = [];
  draft.pendingSignings = [];
  draft.negotiations = {};
  draft.blockedNegotiations = {};
  draft.transferWindowId = Number(draft.transferWindowId || 0) + 1;
  draft.leagueMatchCount = 0;
  draft.regularSeasonComplete = false;
  draft.lastInjuryTriggerMatch = 0;
  draft.lastInjuryTriggerMatchByTeam = {};
  draft.lastScheduledInjuryMatchByTeam = {};
  draft.visibleRoundStart = 1;
  draft.seasonWinnerAnnounced = false;
  draft.seasonChampionKey = "";
  draft.seasonChampionName = "";
  draft.championCelebrationId = "";
  draft.seasonLeaguePrizePaid = false;
  draft.playoffPrizePaid = false;
  draft.playoff = null;
  draft.championsKnockout = null;
  draft.standings = (draft.standings || []).map((team) => ({
    ...team,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    pts: 0,
  }));

  Object.values(draft.teams || {}).forEach((team) => {
    team.sponsorChangedThisSeason = false;
    team.salaryCap = Number(team.salaryCap || DEFAULT_SALARY_CAP) + SEASON_SALARY_CAP_BONUS;
  });

  if (lobby) {
    lobby.salaryCap = Number(lobby.salaryCap || DEFAULT_SALARY_CAP) + SEASON_SALARY_CAP_BONUS;
  }

  if (lobby?.leagueType === "Fantasia") {
    draft.schedule = (draft.schedule || []).map((roundMatches) =>
      roundMatches.map((match) => ({
        ...match,
        played: false,
        result: null,
      }))
    );
  }
};

const QUICK_TOURNAMENT_ROUND_NAMES = {
  2: "Final",
  4: "Semifinales",
  8: "Cuartos",
  16: "Octavos",
};

const nextPowerOfTwo = (value) => {
  let size = 1;
  while (size < value) size *= 2;
  return size;
};

const shuffleList = (items = [], seed = Date.now()) => {
  const list = [...items];
  let currentSeed = Number(seed) || 1;
  for (let index = list.length - 1; index > 0; index -= 1) {
    currentSeed = (currentSeed * 1664525 + 1013904223) >>> 0;
    const swapIndex = currentSeed % (index + 1);
    [list[index], list[swapIndex]] = [list[swapIndex], list[index]];
  }
  return list;
};

const createQuickTournament = (
  draft,
  selectedTeams = [],
  prize = DEFAULT_QUICK_TOURNAMENT_PRIZE,
  runnerUpPrize = DEFAULT_QUICK_TOURNAMENT_RUNNER_UP_PRIZE
) => {
  const bracketSize = Math.max(2, nextPowerOfTwo(selectedTeams.length));
  const participants = [...selectedTeams];
  while (participants.length < bracketSize) {
    const cpuIndex = participants.length - selectedTeams.length + 1;
    participants.push({
      key: `quick-cpu-${cpuIndex}`,
      name: `CPU ${cpuIndex}`,
      real: false,
    });
  }

  const shuffledParticipants = shuffleList(participants, `${Date.now()}${selectedTeams.map((team) => team.key).join("")}`.length);
  const rounds = [];
  let currentParticipants = shuffledParticipants;
  let roundSize = bracketSize;
  let roundIndex = 0;

  while (roundSize >= 2) {
    const roundName = QUICK_TOURNAMENT_ROUND_NAMES[roundSize] || `Ronda ${roundIndex + 1}`;
    const matches = [];

    for (let index = 0; index < currentParticipants.length; index += 2) {
      const home = currentParticipants[index];
      const away = currentParticipants[index + 1];
      matches.push({
        id: `quick-${roundIndex + 1}-${index / 2 + 1}-${Date.now()}`,
        homeKey: home?.key || "",
        awayKey: away?.key || "",
        homeName: home?.name || "",
        awayName: away?.name || "",
        played: false,
        result: null,
        winnerKey: "",
      });
    }

    rounds.push({ name: roundName, matches });
    currentParticipants = Array.from({ length: matches.length / 2 }, (_, index) => ({
      key: `winner-${roundIndex + 1}-${index + 1}`,
      name: "Pendiente",
      real: false,
    }));
    roundSize /= 2;
    roundIndex += 1;
  }

  draft.quickTournament = {
    active: true,
    rounds,
    championKey: "",
    prize: Number(prize) || 0,
    runnerUpPrize: Number(runnerUpPrize) || 0,
    prizePaid: false,
  };
};

const progressQuickTournament = (draft) => {
  if (!draft.quickTournament?.rounds?.length) return;

  const rounds = draft.quickTournament.rounds;
  for (let roundIndex = 0; roundIndex < rounds.length - 1; roundIndex += 1) {
    const currentRound = rounds[roundIndex];
    const nextRound = rounds[roundIndex + 1];
    if (!currentRound.matches.every((match) => match.played && match.winnerKey)) {
      break;
    }

    nextRound.matches = nextRound.matches.map((match, matchIndex) => {
      const homeWinner = currentRound.matches[matchIndex * 2];
      const awayWinner = currentRound.matches[matchIndex * 2 + 1];
      return {
        ...match,
        homeKey: homeWinner?.winnerKey || "",
        awayKey: awayWinner?.winnerKey || "",
        homeName: getTeamNameByKey(draft, homeWinner?.winnerKey || ""),
        awayName: getTeamNameByKey(draft, awayWinner?.winnerKey || ""),
      };
    });
  }

  const finalRound = rounds[rounds.length - 1];
  if (finalRound?.matches?.[0]?.played && finalRound.matches[0].winnerKey) {
    draft.quickTournament.championKey = finalRound.matches[0].winnerKey;
  }
};

const buildFantasySchedule = (teamKeys = []) => {
  const workingKeys = [...teamKeys];
  const isOdd = workingKeys.length % 2 !== 0;

  if (isOdd) {
    workingKeys.push("__BYE__");
  }

  const rounds = [];
  let rotation = [...workingKeys];
  const halfRounds = rotation.length - 1;

  for (let roundIndex = 0; roundIndex < halfRounds; roundIndex += 1) {
    const roundMatches = [];

    for (let matchIndex = 0; matchIndex < rotation.length / 2; matchIndex += 1) {
      const homeKey = rotation[matchIndex];
      const awayKey = rotation[rotation.length - 1 - matchIndex];

      if (homeKey !== "__BYE__" && awayKey !== "__BYE__") {
        roundMatches.push({
          id: `round-${roundIndex + 1}-${homeKey}-${awayKey}`,
          round: roundIndex + 1,
          homeKey,
          awayKey,
          played: false,
          result: null,
        });
      }
    }

    rounds.push(roundMatches);
    rotation = [
      rotation[0],
      rotation[rotation.length - 1],
      ...rotation.slice(1, rotation.length - 1),
    ];
  }

  const reverseRounds = rounds.map((roundMatches, roundIndex) =>
    roundMatches.map((match) => ({
      ...match,
      id: `round-${halfRounds + roundIndex + 1}-${match.awayKey}-${match.homeKey}`,
      round: halfRounds + roundIndex + 1,
      homeKey: match.awayKey,
      awayKey: match.homeKey,
      played: false,
      result: null,
    }))
  );

  return [...rounds, ...reverseRounds];
};

const ensureCpuTeams = (draft, lobby) => {
  if (!lobby.fillCpuTeams) {
    draft.cpuTeams = [];
    return;
  }

  const size = lobby.competitionMode === "champions" ? CHAMPIONS_TABLE_SIZE : getLeagueSize(lobby.format);
  const requiredCpuTeams = Math.max(size - lobby.players.length, 0);
  const currentCpuTeams = draft.cpuTeams || [];

  if (currentCpuTeams.length === requiredCpuTeams) return;

  draft.cpuTeams = Array.from({ length: requiredCpuTeams }, (_, index) => ({
    key: currentCpuTeams[index]?.key || `cpu-${index + 1}`,
    name: currentCpuTeams[index]?.name || generatedClubNames[index] || `CPU ${index + 1}`,
  }));
};

const syncFantasySchedule = (draft, lobby) => {
  if (lobby.leagueType !== "Fantasia") {
    draft.schedule = [];
    return;
  }

  ensureCpuTeams(draft, lobby);
  const teamKeys = [
    ...lobby.players,
    ...(draft.cpuTeams || []).map((team) => team.key),
  ];

  if (!draft.schedule || draft.schedule.length === 0) {
    draft.schedule = buildFantasySchedule(teamKeys);
    draft.visibleRoundStart = 1;
    return;
  }

  const existingMatches = new Map(
    draft.schedule
      .flat()
      .map((match) => [`${match.round}:${match.homeKey}:${match.awayKey}`, match])
  );
  const freshSchedule = buildFantasySchedule(teamKeys);
  draft.schedule = freshSchedule.map((roundMatches) =>
    roundMatches.map((match) => existingMatches.get(`${match.round}:${match.homeKey}:${match.awayKey}`) || match)
  );
  if (!draft.visibleRoundStart) {
    draft.visibleRoundStart = 1;
  }
};

const getTeamNameByKey = (draft, key) => {
  if (draft.teams[key]) return draft.teams[key].name || key;
  return draft.cpuTeams?.find((team) => team.key === key)?.name || key;
};

const markScheduleMatchPlayed = (draft, homeKey, awayKey, result) => {
  if (!draft.schedule?.length) return;

  for (const roundMatches of draft.schedule) {
    const nextMatch = roundMatches.find(
      (match) =>
        !match.played &&
        ((match.homeKey === homeKey && match.awayKey === awayKey) ||
          (match.homeKey === awayKey && match.awayKey === homeKey))
    );

    if (nextMatch) {
      nextMatch.played = true;
      nextMatch.result =
        nextMatch.homeKey === homeKey
          ? result
          : {
              homeGoals: result.awayGoals,
              awayGoals: result.homeGoals,
            };
      return;
    }
  }
};

const simulateCpuMatchResult = (homeName, awayName) => {
  const homeSeed = hashString(`${homeName}:${awayName}:home`);
  const awaySeed = hashString(`${awayName}:${homeName}:away`);
  let homeGoals = homeSeed % 4;
  let awayGoals = awaySeed % 4;

  if (homeGoals === 0 && awayGoals === 0) {
    if (homeSeed % 2 === 0) homeGoals = 1;
    else awayGoals = 1;
  }

  return { homeGoals, awayGoals };
};

const applyStandingResult = (draft, teamAName, teamBName, scoreA, scoreB) => {
  draft.standings = sortStandings(
    draft.standings.map((team) => {
      if (team.name !== teamAName && team.name !== teamBName) return team;

      const isTeamA = team.name === teamAName;
      const goalsForValue = isTeamA ? scoreA : scoreB;
      const goalsAgainstValue = isTeamA ? scoreB : scoreA;
      const win = goalsForValue > goalsAgainstValue ? 1 : 0;
      const draw = goalsForValue === goalsAgainstValue ? 1 : 0;
      const loss = goalsForValue < goalsAgainstValue ? 1 : 0;

      return {
        ...team,
        played: team.played + 1,
        wins: team.wins + win,
        draws: team.draws + draw,
        losses: team.losses + loss,
        gf: team.gf + goalsForValue,
        ga: team.ga + goalsAgainstValue,
        pts: team.pts + (win ? 3 : draw ? 1 : 0),
      };
    })
  );
};

const applyStandingResultByKeys = (draft, teamAKey, teamBKey, scoreA, scoreB) => {
  draft.standings = sortStandings(
    draft.standings.map((team) => {
      if (team.key !== teamAKey && team.key !== teamBKey) return team;

      const isTeamA = team.key === teamAKey;
      const goalsForValue = isTeamA ? scoreA : scoreB;
      const goalsAgainstValue = isTeamA ? scoreB : scoreA;
      const win = goalsForValue > goalsAgainstValue ? 1 : 0;
      const draw = goalsForValue === goalsAgainstValue ? 1 : 0;
      const loss = goalsForValue < goalsAgainstValue ? 1 : 0;

      return {
        ...team,
        played: team.played + 1,
        wins: team.wins + win,
        draws: team.draws + draw,
        losses: team.losses + loss,
        gf: team.gf + goalsForValue,
        ga: team.ga + goalsAgainstValue,
        pts: team.pts + (win ? 3 : draw ? 1 : 0),
      };
    })
  );
};

const resetStandingStats = (team) => ({
  ...team,
  played: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  gf: 0,
  ga: 0,
  pts: 0,
});

const rebuildFantasyStandingsFromSchedule = (draft, lobby) => {
  if (lobby?.leagueType !== "Fantasia" || !draft.schedule?.length || !draft.standings?.length) {
    return;
  }

  draft.standings = draft.standings.map(resetStandingStats);

  draft.schedule.flat().forEach((match) => {
    if (!match.played) return;

    if (!match.result) {
      const simulated = simulateCpuMatchResult(
        getTeamNameByKey(draft, match.homeKey),
        getTeamNameByKey(draft, match.awayKey)
      );
      match.result = simulated;
    }

    applyStandingResultByKeys(
      draft,
      match.homeKey,
      match.awayKey,
      Number(match.result.homeGoals) || 0,
      Number(match.result.awayGoals) || 0
    );
  });

  const playedMatches = draft.schedule.flat().filter((match) => match.played && match.result).length;
  draft.leagueMatchCount = playedMatches;
};

const getVisibleRoundStart = (draft) => draft.visibleRoundStart || 1;

const maybeAdvanceFantasyRoundBlock = (draft, lobby, code) => {
  if (lobby.leagueType !== "Fantasia" || !draft.schedule?.length) return 0;

  const visibleRoundStart = getVisibleRoundStart(draft);
  const visibleRounds = draft.schedule.slice(visibleRoundStart - 1, visibleRoundStart + 4);
  const managerKeys = new Set(lobby.players);
  let simulatedMatches = 0;

  visibleRounds.forEach((roundMatches) => {
    roundMatches.forEach((match) => {
      const involvesManager =
        managerKeys.has(match.homeKey) || managerKeys.has(match.awayKey);

      if (!involvesManager && !match.played) {
        const homeName = getTeamNameByKey(draft, match.homeKey);
        const awayName = getTeamNameByKey(draft, match.awayKey);
        const simulated = simulateCpuMatchResult(homeName, awayName);
        applyStandingResultByKeys(
          draft,
          match.homeKey,
          match.awayKey,
          simulated.homeGoals,
          simulated.awayGoals
        );
        match.played = true;
        match.result = simulated;
        draft.leagueMatchCount = Number(draft.leagueMatchCount || 0) + 1;
        simulatedMatches += 1;
        syncUnavailablePlayers(draft);
        maybeTriggerRandomEvent(code, draft);
      }
    });
  });

  const blockCompleted = visibleRounds.every((roundMatches) =>
    roundMatches.every((match) => match.played)
  );

  if (blockCompleted) {
    const nextStart = visibleRoundStart + 5;
    if (nextStart <= draft.schedule.length) {
      draft.visibleRoundStart = nextStart;
    }
  }

  return simulatedMatches;
};

const syncUnavailablePlayers = (draft) => {
  const standingsMap = new Map((draft.standings || []).map((team) => [team.key, Number(team.played || 0)]));

  Object.entries(draft.teams).forEach(([owner, team]) => {
    const teamPlayed = standingsMap.get(owner) || 0;
    team.squad = team.squad.map((player) => {
      if (
        player.unavailableUntilMatch &&
        Number(player.unavailableUntilMatch) <= teamPlayed
      ) {
        const nextPlayer = { ...player };
        delete nextPlayer.unavailableUntilMatch;
        delete nextPlayer.unavailableReason;
        return nextPlayer;
      }

      return player;
    });
  });
};

const applyUnavailablePlayerToTeam = (draft, code, owner, reason, source = "event") => {
  const team = draft.teams?.[owner];
  if (!team?.squad?.length) return null;
  const standingsMap = new Map((draft.standings || []).map((team) => [team.key, Number(team.played || 0)]));
  const teamPlayed = standingsMap.get(owner) || 0;
  const availablePlayers = team.squad.filter(
    (player) => !player.unavailableUntilMatch || Number(player.unavailableUntilMatch) <= teamPlayed
  );

  if (availablePlayers.length === 0) return null;

  const player = availablePlayers[Math.floor(Math.random() * availablePlayers.length)];
  const unavailableUntilMatch = teamPlayed + 2;

  team.squad = team.squad.map((item) =>
    item.ID === player.ID
      ? {
          ...item,
          unavailableUntilMatch,
          unavailableReason: reason,
        }
      : item
  );

  if (!draft.inbox[owner]) {
    draft.inbox[owner] = [];
  }

  const inboxItem = {
    id: `${source}-${code}-${owner}-${player.ID}-${teamPlayed}-${Date.now()}`,
    title: `${player.Name} no estara disponible`,
    body: `${player.Name} ${reason}. Estara fuera por 2 partidos de ${team.name}.`,
    matchUntil: unavailableUntilMatch,
    playerId: player.ID,
  };

  draft.inbox[owner].unshift(inboxItem);
  addNews(draft, code, `Fabrizio Romano: ${player.Name} ${reason} y sera baja de ${team.name} por 2 partidos`);
  return inboxItem;
};

const maybeTriggerScheduledInjuries = (code, draft, owners = []) => {
  if (!draft.lastScheduledInjuryMatchByTeam) {
    draft.lastScheduledInjuryMatchByTeam = {};
  }

  const standingsMap = new Map((draft.standings || []).map((team) => [team.key, Number(team.played || 0)]));
  const inboxItems = [];

  owners.forEach((owner) => {
    const team = draft.teams?.[owner];
    const teamPlayed = standingsMap.get(owner) || 0;
    if (!team || teamPlayed === 0 || teamPlayed % 2 !== 0) return;
    if (Number(draft.lastScheduledInjuryMatchByTeam[owner] || 0) >= teamPlayed) return;

    const reason = injuryTemplates[Math.floor(Math.random() * injuryTemplates.length)];
    const inboxItem = applyUnavailablePlayerToTeam(draft, code, owner, reason, "injury");
    if (inboxItem) {
      draft.lastScheduledInjuryMatchByTeam[owner] = teamPlayed;
      inboxItems.push(inboxItem);
    }
  });

  return inboxItems;
};

const maybeTriggerRandomEvent = (code, draft, owners = []) => {
  if (!draft.randomEvents || Math.random() > RANDOM_EVENT_PROBABILITY) return null;

  const eligibleOwners = owners.filter((owner) => draft.teams?.[owner]?.squad?.length);
  if (eligibleOwners.length === 0) return null;

  const owner = eligibleOwners[Math.floor(Math.random() * eligibleOwners.length)];
  const reason = randomEventTemplates[Math.floor(Math.random() * randomEventTemplates.length)];
  const inboxItem = applyUnavailablePlayerToTeam(draft, code, owner, reason, "event");
  return inboxItem ? [inboxItem] : null;
};

const canAddPlayerToTeam = (team, player, salary = player.salary, amount = player.marketValue) => {
  if (!team || !player) return false;
  if (team.squad.length >= TEAM_SIZE_TARGET) return false;
  if (teamOwnsPlayer(team, player.ID)) return false;
  if (team.budget < Number(amount || 0)) return false;

  const salaryAfter = getTeamPayroll(team) + (Number(salary) || 0);
  return salaryAfter <= (Number(team.salaryCap) || DEFAULT_SALARY_CAP);
};

const getNegotiationKey = (username, playerId) => `${username}:${playerId}`;
const getBlockedNegotiationWindow = (draft, username, playerId) =>
  draft.blockedNegotiations?.[getNegotiationKey(username, playerId)] || 0;

const getNegotiationBlockedMessage = (playerName) =>
  `${playerName} no quiere negociar contigo este periodo de transferencias`;

const clearPendingSigningByPlayer = (draft, playerId) => {
  if (!draft?.pendingSignings) return;
  draft.pendingSignings = draft.pendingSignings.filter(
    (signing) => String(signing.player?.ID) !== String(playerId)
  );
};

const getNegotiationTarget = (code, username, player) => {
  const minSalary = Number(player.salaryMin) || Number(player.salary) || 10;
  const maxSalary = Number(player.salaryMax) || Math.max(minSalary + 10, Number(player.salary) || 20);
  const seed = hashString(`${code}:${username}:${player.ID}`);
  const spread = Math.max(1, maxSalary - minSalary + 1);
  return minSalary + (seed % spread);
};

const getAvailablePlayers = (draft) => {
  const ownedIds = new Set();

  Object.values(draft.teams).forEach((team) => {
    team.squad.forEach((player) => ownedIds.add(String(player.ID)));
  });

  return loadPlayers()
    .filter((player) => !ownedIds.has(String(player.ID)))
    .sort((leftPlayer, rightPlayer) =>
      leftPlayer.marketValue - rightPlayer.marketValue ||
      leftPlayer.salary - rightPlayer.salary ||
      leftPlayer.OVR - rightPlayer.OVR
    );
};

const autoCompleteSquad = (draft, owner, code) => {
  const team = draft.teams[owner];
  let guard = 0;

  while (team && team.squad.length < TEAM_SIZE_TARGET && guard < 400) {
    guard += 1;
    const cheapestPlayer = getAvailablePlayers(draft).find((player) =>
      canAddPlayerToTeam(team, player, player.salary, player.marketValue)
    );

    if (cheapestPlayer) {
      team.budget -= cheapestPlayer.marketValue;
      team.squad.push(clonePlayerForTeam(cheapestPlayer, cheapestPlayer.salary));
      addNews(draft, code, `Fabrizio Romano: ${team.name} completo plantilla con ${cheapestPlayer.Name} por ${cheapestPlayer.marketValue}M`);
      continue;
    }

    const releasablePlayer = [...team.squad]
      .filter((player) => Number(player.releaseValue) > 0)
      .sort(
        (leftPlayer, rightPlayer) =>
          (Number(rightPlayer.salary) || 0) - (Number(leftPlayer.salary) || 0) ||
          rightPlayer.marketValue - leftPlayer.marketValue
      )[0];

    if (!releasablePlayer) break;

    team.squad = team.squad.filter((player) => String(player.ID) !== String(releasablePlayer.ID));
    team.budget += Number(releasablePlayer.releaseValue) || 0;
    addNews(draft, code, `Liga UFL: ${team.name} libero a ${releasablePlayer.Name} para ajustar la plantilla`);
  }
};

const getLobbyPayload = (code) => {
  const lobby = lobbies.get(code);

  if (!lobby) return null;

  return {
    code,
    leagueName: lobby.leagueName,
    creator: lobby.creator,
    maxManagers: lobby.maxManagers,
    managers: lobby.maxManagers,
    format: lobby.format,
    leagueType: lobby.leagueType,
    money: lobby.money,
    salaryCap: lobby.salaryCap,
    champions: lobby.champions,
    fillCpuTeams: lobby.fillCpuTeams,
    randomEvents: lobby.randomEvents,
    competitionMode: lobby.competitionMode || "league",
    championsPhaseLabels: lobby.championsPhaseLabels || getDefaultChampionsPhaseLabels(),
    leaguePrize: Number(lobby.leaguePrize) || DEFAULT_LEAGUE_PRIZE,
    playoffPrize1: Number(lobby.playoffPrize1) || DEFAULT_PLAYOFF_PRIZES.first,
    playoffPrize2: Number(lobby.playoffPrize2) || DEFAULT_PLAYOFF_PRIZES.second,
    playoffPrize3: Number(lobby.playoffPrize3) || DEFAULT_PLAYOFF_PRIZES.third,
    playoffPrize4: Number(lobby.playoffPrize4) || DEFAULT_PLAYOFF_PRIZES.fourth,
    players: lobby.players,
    status: lobby.status,
  };
};

const sendLobbyUpdate = (code) => {
  const payload = getLobbyPayload(code);
  const clients = lobbyClients.get(code) || [];

  Promise.resolve(saveLeagueState(code)).catch((error) => {
    console.error("No se pudo guardar el lobby", error.message);
  });

  clients.forEach((client) => {
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
  });
};

const getDraftPayload = (code) => {
  const draft = drafts.get(code);
  const lobby = lobbies.get(code);

  if (!draft) return null;

  syncStandingsWithTeams(draft, lobby);
  syncFantasySchedule(draft, lobby);
  ensurePlayoff(draft);
  syncChampionsKnockout(draft, lobby);
  rebuildFantasyStandingsFromSchedule(draft, lobby);
  if (lobby?.leagueType === "Fantasia") {
    const simulatedMatches = maybeAdvanceFantasyRoundBlock(draft, lobby, code);
    if (simulatedMatches > 0) {
      rebuildFantasyStandingsFromSchedule(draft, lobby);
      draft.needsBroadcast = true;
    }
  }

  if (draft.needsBroadcast) {
    Promise.resolve(saveLeagueState(code)).catch((error) => {
      console.error("No se pudo guardar la tabla reconstruida", error.message);
    });
  }

  if (draft.seasonWinnerAnnounced && !draft.seasonChampionKey && draft.standings?.length) {
    const winner = sortStandings(draft.standings)[0];
    if (winner) {
      draft.seasonChampionKey = winner.key;
      draft.seasonChampionName = winner.name;
      draft.championCelebrationId = draft.championCelebrationId || `season-${code}-${winner.key}`;
    }
  }

  return {
    code,
    organizer: draft.organizer,
    competitionMode: lobby?.competitionMode || "league",
    championsPhaseLabels: lobby?.championsPhaseLabels || getDefaultChampionsPhaseLabels(),
    phase: draft.phase,
    confirmedOwners: draft.confirmedOwners,
    auctionStage: draft.auctionStage,
    bidCounts: draft.bidCounts,
    teams: Object.fromEntries(
      Object.entries(draft.teams).map(([owner, team]) => [owner, getTeamPayload(team)])
    ),
    offers: draft.offers,
      pendingSignings: (draft.pendingSignings || []).map(getPendingSigningPayload),
      blockedNegotiations: draft.blockedNegotiations || {},
      news: getNewsPayload(draft, code),
    leagueMatchCount: draft.leagueMatchCount || 0,
    regularSeasonComplete: Boolean(draft.regularSeasonComplete),
    seasonChampionKey: draft.seasonChampionKey || "",
    seasonChampionName: draft.seasonChampionName || "",
    championCelebrationId: draft.championCelebrationId || "",
    inbox: draft.inbox || {},
    standings: draft.standings || [],
    schedule: draft.schedule || [],
    cpuTeams: draft.cpuTeams || [],
    visibleRoundStart: getVisibleRoundStart(draft),
    playoff: draft.playoff || null,
    championsKnockout: draft.championsKnockout || null,
    quickTournament: draft.quickTournament || null,
  };
};

const sendDraftUpdate = (code) => {
  const payload = getDraftPayload(code);
  const clients = draftClients.get(code) || [];

  Promise.resolve(saveLeagueState(code)).catch((error) => {
    console.error("No se pudo guardar el draft", error.message);
  });

  clients.forEach((client) => {
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
  });
};

const sendLeagueDeleted = (code) => {
  const payload = JSON.stringify({ code, deleted: true });

  (lobbyClients.get(code) || []).forEach((client) => {
    client.write(`data: ${payload}\n\n`);
    client.end();
  });

  (draftClients.get(code) || []).forEach((client) => {
    client.write(`data: ${payload}\n\n`);
    client.end();
  });
};

const ensureDraft = (code) => {
  const lobby = lobbies.get(code);
  if (!lobby) return null;

  if (!drafts.has(code)) {
    const teams = lobby.players.reduce((acc, owner) => {
      const ownerIndex = lobby.players.indexOf(owner);
      acc[owner] = {
        owner,
        name: owner,
        budget: lobby.money,
        salaryCap: lobby.salaryCap,
        sponsor: createSponsor(ownerIndex),
        sponsorChangedThisSeason: false,
        protectedPlayerIds: [],
        squad: [],
      };
      return acc;
    }, {});

    drafts.set(code, {
      organizer: lobby.creator,
      phase: "selection",
      confirmedOwners: [],
      auctionStage: 0,
      bids: [],
      bidCounts: {},
      transferWindowId: 0,
      leagueMatchCount: 0,
      regularSeasonComplete: false,
      randomEvents: lobby.randomEvents !== false,
      competitionMode: lobby.competitionMode || "league",
      teams,
      cpuTeams: [],
      offers: [],
      pendingSignings: [],
      negotiations: {},
      blockedNegotiations: {},
      inbox: lobby.players.reduce((acc, owner) => {
        acc[owner] = [];
        return acc;
      }, {}),
      lastInjuryTriggerMatch: 0,
      lastInjuryTriggerMatchByTeam: {},
      lastScheduledInjuryMatchByTeam: {},
      standings: [],
      schedule: [],
      playoff: null,
      championsKnockout: null,
      quickTournament: null,
      visibleRoundStart: 1,
      seasonWinnerAnnounced: false,
      seasonChampionKey: "",
      seasonChampionName: "",
      championCelebrationId: "",
      seasonLeaguePrizePaid: false,
      playoffPrizePaid: false,
      news: [{ code, text: "Seleccion principal iniciada", createdAt: Date.now() }],
    });
  }

  lobby.players.forEach((owner, ownerIndex) => {
    const team = drafts.get(code)?.teams?.[owner];
    if (team && !team.sponsor) {
      team.sponsor = createSponsor(ownerIndex);
    }
    if (team && typeof team.sponsorChangedThisSeason !== "boolean") {
      team.sponsorChangedThisSeason = false;
    }
  });

  syncStandingsWithTeams(drafts.get(code), lobby);
  syncFantasySchedule(drafts.get(code), lobby);
  return drafts.get(code);
};

app.get("/health", (req, res) => {
  res.json({ ok: true, version: SERVER_VERSION });
});

app.post("/login", async (req, res) => {
  const username = normalizeUsernameInput(req.body.username);
  const password = String(req.body.password || "");
  const user = await findStoredUserByUsername(username);

  if (!user) {
    return res.status(400).json({ error: "Usuario no existe" });
  }

  const valid = await bcrypt.compare(password, user.password);

  if (!valid) {
    return res.status(400).json({ error: "Contrasena incorrecta" });
  }

  res.json({ message: "Login exitoso", user: user.username });
});

app.post("/users", async (req, res) => {
  const username = normalizeUsernameInput(req.body.username);
  const password = String(req.body.password || "");

  if (!username || !password) {
    return res.status(400).json({ error: "Faltan datos del usuario" });
  }

  const existingUser = await findStoredUserByUsername(username);

  if (existingUser) {
    return res.status(400).json({ error: "Usuario ya existe" });
  }

  const hash = await bcrypt.hash(password, 10);
  const nextUser = await createStoredUser(username, hash);
  res.json({ message: "Usuario creado", id: nextUser.id });
});

app.get("/users", async (req, res) => {
  const users = (await getStoredUsers()).map(({ id, username }) => ({ id, username }));
  res.json(users);
});

app.get("/users/:username/leagues", (req, res) => {
  const username = normalizeUsernameInput(req.params.username);

  if (!username) {
    return res.status(400).json({ error: "Falta el usuario" });
  }

  const leagues = Array.from(lobbies.entries())
    .filter(([, lobby]) => Array.isArray(lobby.players) && lobby.players.includes(username))
    .map(([code, lobby]) => ({
      code,
      leagueName: lobby.leagueName,
      creator: lobby.creator,
      status: lobby.status || "waiting",
      updatedAt: Date.now(),
    }));

  res.json({ leagues });
});

app.put("/users/:id", async (req, res) => {
  const { id } = req.params;
  const username = normalizeUsernameInput(req.body.username);
  const password = String(req.body.password || "");
  const storedUsers = await getStoredUsers();
  const currentUser = storedUsers.find((item) => String(item.id) === String(id));

  if (!currentUser) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }

  if (
    storedUsers.some(
      (item) =>
        normalizeUsernameInput(item.username).toLowerCase() === username.toLowerCase() &&
        String(item.id) !== String(id)
    )
  ) {
    return res.status(400).json({ error: "Usuario ya existe" });
  }

  const updates = { username };

  if (password) {
    updates.password = await bcrypt.hash(password, 10);
  }

  await updateStoredUser(id, updates);
  res.json({ message: "Usuario actualizado" });
});

app.delete("/users/:id", async (req, res) => {
  const { id } = req.params;
  const deletedUser = await deleteStoredUser(id);

  if (!deletedUser) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }

  res.json({ message: "Usuario eliminado" });
});

app.get("/players", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 2000);
  const search = String(req.query.search || "");

  res.json({
    total: loadPlayers().length,
    players: getPlayers({ limit, search }),
  });
});

app.get("/players/:id", (req, res) => {
  const player = getPlayerById(req.params.id);

  if (!player) {
    return res.status(404).json({ error: "Jugador no encontrado" });
  }

  res.json(player);
});

app.get("/drafts/:code/players", (req, res) => {
  const code = String(req.params.code).trim();
  const draft = ensureDraft(code);

  if (!draft) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  const limit = Math.min(Number(req.query.limit) || 100, 2000);
  const search = String(req.query.search || "");
  const players = getLeaguePlayers(draft, { limit, search });

  res.json({
    total: players.length,
    players,
  });
});

app.post("/lobbies", async (req, res) => {
  const { leagueName, username } = req.body;
  const maxManagers = Number(req.body.managers) || 4;
  const salaryCap = Number(req.body.salaryCap) || DEFAULT_SALARY_CAP;

  if (!leagueName || !username) {
    return res.status(400).json({ error: "Faltan datos para crear la liga" });
  }

  if (maxManagers < 2 || maxManagers > 20) {
    return res.status(400).json({ error: "El numero de jugadores no es valido" });
  }

  const code = generateLobbyCode();

  lobbies.set(code, {
    leagueName,
    creator: username,
    maxManagers,
    managers: maxManagers,
    format: req.body.format || "Normal",
    leagueType: req.body.leagueType || "Real",
    money: Number(req.body.money) || 220,
    salaryCap,
    champions: Boolean(req.body.champions),
    fillCpuTeams: req.body.fillCpuTeams !== false,
    randomEvents: req.body.randomEvents !== false,
    competitionMode: req.body.competitionMode === "champions" ? "champions" : "league",
    championsPhaseLabels: getDefaultChampionsPhaseLabels(),
    leaguePrize: Number(req.body.leaguePrize) || DEFAULT_LEAGUE_PRIZE,
    playoffPrize1: Number(req.body.playoffPrize1) || DEFAULT_PLAYOFF_PRIZES.first,
    playoffPrize2: Number(req.body.playoffPrize2) || DEFAULT_PLAYOFF_PRIZES.second,
    playoffPrize3: Number(req.body.playoffPrize3) || DEFAULT_PLAYOFF_PRIZES.third,
    playoffPrize4: Number(req.body.playoffPrize4) || DEFAULT_PLAYOFF_PRIZES.fourth,
    players: [username],
    status: "waiting",
  });

  await saveLeagueState(code);

  res.json(getLobbyPayload(code));
});

app.post("/lobbies/:code/join", (req, res) => {
  const code = String(req.params.code).trim();
  const { username } = req.body;
  const lobby = lobbies.get(code);

  if (!/^\d{4}$/.test(code)) {
    return res.status(400).json({ error: "El codigo debe tener 4 numeros" });
  }

  if (!username) {
    return res.status(400).json({ error: "Falta el usuario" });
  }

  if (!lobby) {
    return res.status(404).json({ error: "Liga no encontrada" });
  }

  if (lobby.players.length >= lobby.maxManagers && !lobby.players.includes(username)) {
    return res.status(400).json({ error: "La liga ya esta llena" });
  }

  if (!lobby.players.includes(username)) {
    lobby.players.push(username);
    const draft = drafts.get(code);
    if (draft && !draft.inbox[username]) {
      draft.inbox[username] = [];
    }
  }

  sendLobbyUpdate(code);
  res.json(getLobbyPayload(code));
});

app.post("/lobbies/:code/start", (req, res) => {
  const code = String(req.params.code).trim();
  const { username } = req.body;
  const lobby = lobbies.get(code);

  if (!lobby) {
    return res.status(404).json({ error: "Liga no encontrada" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el creador puede iniciar la liga" });
  }

  if (lobby.players.length < lobby.maxManagers) {
    return res.status(400).json({ error: "Faltan jugadores para iniciar" });
  }

  lobby.status = "started";
  ensureDraft(code);
  sendLobbyUpdate(code);
  sendDraftUpdate(code);
  res.json(getLobbyPayload(code));
});

app.get("/drafts/:code", (req, res) => {
  const code = String(req.params.code).trim();
  const draft = ensureDraft(code);

  if (!draft) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  ensurePlayoff(draft);

  const payload = getDraftPayload(code);
  res.json(payload);

  if (draft.needsBroadcast) {
    draft.needsBroadcast = false;
    setTimeout(() => sendDraftUpdate(code), 0);
  }
});

app.get("/drafts/:code/events", (req, res) => {
  const code = String(req.params.code).trim();
  const draft = ensureDraft(code);

  if (!draft) {
    return res.status(404).end();
  }

  ensurePlayoff(draft);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const payload = getDraftPayload(code);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);

  const clients = draftClients.get(code) || [];
  clients.push(res);
  draftClients.set(code, clients);

  if (draft.needsBroadcast) {
    draft.needsBroadcast = false;
    setTimeout(() => sendDraftUpdate(code), 0);
  }

  req.on("close", () => {
    const activeClients = draftClients.get(code) || [];
    draftClients.set(
      code,
      activeClients.filter((client) => client !== res)
    );
  });
});

app.post("/drafts/:code/confirm", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, squad = [], teamName } = req.body;
  const lobby = lobbies.get(code);
  const draft = ensureDraft(code);

  if (!lobby || !draft) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (!lobby.players.includes(username)) {
    return res.status(403).json({ error: "No perteneces a este draft" });
  }

  if (!draft.confirmedOwners.includes(username)) {
    draft.confirmedOwners.push(username);
    addNews(draft, code, `${username} confirmo su seleccion inicial`);
  }

  const players = squad
    .map((id) => getPlayerById(id))
    .filter(Boolean)
    .map((player) => ({ ...player, releaseValue: 0 }));

  draft.teams[username] = {
    ...draft.teams[username],
    name: String(teamName || draft.teams[username]?.name || username).trim() || username,
    squad: players,
  };
  syncStandingsWithTeams(draft, lobby);

  if (draft.confirmedOwners.length === lobby.players.length) {
    draft.phase = "dashboard";
    addNews(draft, code, "Todos confirmaron su seleccion. El organizador puede iniciar la subasta.");
  }

  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/start-auction", (req, res) => {
  const code = String(req.params.code).trim();
  const { username } = req.body;
  const lobby = lobbies.get(code);
  const draft = ensureDraft(code);

  if (!lobby || !draft) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede iniciar la subasta" });
  }

  if (draft.confirmedOwners.length < lobby.players.length) {
    return res.status(400).json({ error: "Faltan managers por confirmar" });
  }

  draft.phase = "auction";
  draft.auctionStage = 0;
  draft.bids = [];
  draft.bidCounts = {};
  addNews(draft, code, "El organizador inicio la subasta");
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/bid", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, playerId, amount } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);
  const player = getDraftPlayerById(draft, playerId);
  const team = draft?.teams[username];

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (draft.phase !== "auction") {
    return res.status(400).json({ error: "La subasta no esta activa" });
  }

  if (!lobby.players.includes(username)) {
    return res.status(403).json({ error: "No perteneces a esta liga" });
  }

  if (!player || !team) {
    return res.status(404).json({ error: "Jugador no encontrado" });
  }

  if (!canAddPlayerToTeam(team, player, player.salary, amount)) {
    return res.status(400).json({ error: "Tu plantilla ya no soporta esta puja por presupuesto o masa salarial" });
  }

  draft.bids = draft.bids.filter(
    (bid) => !(bid.owner === username && String(bid.playerId) === String(playerId))
  );
  draft.bids.push({ owner: username, playerId, amount: Number(amount) });

  const uniqueOwners = new Set(
    draft.bids
      .filter((bid) => String(bid.playerId) === String(playerId))
      .map((bid) => bid.owner)
  );
  draft.bidCounts[String(playerId)] = uniqueOwners.size;

  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/next-stage", (req, res) => {
  const code = String(req.params.code).trim();
  const { username } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede pasar de etapa" });
  }

  const winners = Object.values(
    (draft.bids || []).reduce((acc, bid) => {
      const currentWinner = acc[String(bid.playerId)];
      if (!currentWinner || Number(bid.amount) > Number(currentWinner.amount)) {
        acc[String(bid.playerId)] = bid;
      }
      return acc;
      }, {})
    );

  draft.pendingSignings = (draft.pendingSignings || []).filter((signing) => signing.type !== "auction");

  winners.forEach((winner) => {
      const player = getDraftPlayerById(draft, winner.playerId);
      const team = draft.teams[winner.owner];
      const playerAlreadyPending = (draft.pendingSignings || []).some(
        (signing) => String(signing.player?.ID) === String(winner.playerId)
      );
      addNews(draft, code, `Fabrizio Romano: ${winner.owner} gano a ${player?.Name || winner.playerId} por ${winner.amount}M`);
      if (
        player &&
        team &&
        !team.squad.some((item) => item.ID === player.ID) &&
        team.squad.length < TEAM_SIZE_TARGET &&
        !playerAlreadyPending
      ) {
        draft.pendingSignings.unshift({
          id: `auction-${winner.playerId}-${Date.now()}-${winner.owner}`,
          owner: winner.owner,
        type: "auction",
        player,
        amount: Number(winner.amount) || 0,
      });
      addNews(draft, code, `Liga UFL: ${team.name} debe negociar el sueldo de ${player.Name} para cerrar el fichaje`);
    } else if (team) {
      addNews(draft, code, `Liga UFL: ${team.name} no pudo cerrar a ${player?.Name || winner.playerName} por limite de plantilla`);
    }
  });

  draft.bids = [];
  draft.bidCounts = {};

  if (draft.auctionStage >= 5) {
    draft.transferWindowId += 1;
    draft.phase = "market";
    addNews(draft, code, "Liga UFL: Subastas finalizadas. Mercado de transferencias abierto.");
  } else {
    draft.auctionStage += 1;
    addNews(draft, code, `Liga UFL: inicia la etapa ${draft.auctionStage + 1}/6 de subasta.`);
  }

  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/negotiate", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, playerId, amount, salary } = req.body;
  const draft = ensureDraft(code);

  if (!draft) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  const player = getDraftPlayerById(draft, playerId);
  const team = draft.teams[username];
  const owner = findPlayerOwner(draft, playerId);
  const pendingSigning = (draft.pendingSignings || []).find(
    (signing) => signing.owner === username && String(signing.player.ID) === String(playerId)
  );
  const blockedUntilWindow = getBlockedNegotiationWindow(draft, username, playerId);
  const targetSalary = getNegotiationTarget(code, username, player || {});
  const negotiationKey = getNegotiationKey(username, playerId);
  const offeredSalary = Number(salary) || 0;
  const transferAmount = pendingSigning ? Number(pendingSigning.amount) || 0 : Number(amount) || 0;

  if (!player || !team) {
    return res.status(400).json({ error: "No se puede negociar este jugador" });
  }

  if (draft.transferWindowId < blockedUntilWindow) {
    return res.status(400).json({
      error: getNegotiationBlockedMessage(player.Name),
      attemptsLeft: 0,
    });
  }

  if (owner === username || teamOwnsPlayer(team, playerId)) {
    return res.status(400).json({ error: "Ese jugador ya pertenece a tu club" });
  }

  if (team.squad.length >= TEAM_SIZE_TARGET) {
    return res.status(400).json({ error: `Tu plantilla ya tiene ${TEAM_SIZE_TARGET} jugadores` });
  }

  if (offeredSalary <= 0) {
    return res.status(400).json({ error: "Debes proponer un salario por temporada" });
  }

  if (owner && transferAmount <= 0) {
    return res.status(400).json({ error: "Debes enviar una oferta de transferencia al club" });
  }

  const negotiation = draft.negotiations[negotiationKey] || {
    attempts: 0,
    targetSalary,
  };

  if (offeredSalary < negotiation.targetSalary) {
    negotiation.attempts += 1;
      if (negotiation.attempts >= MAX_NEGOTIATION_ATTEMPTS) {
        delete draft.negotiations[negotiationKey];
        draft.blockedNegotiations[negotiationKey] = draft.transferWindowId + 1;
        clearPendingSigningByPlayer(draft, playerId);
        if (pendingSigning?.type === "offer" || pendingSigning?.type === "clause") {
          const buyer = draft.teams[pendingSigning.owner];
          const seller = draft.teams[pendingSigning.fromOwner];
          const heldAmount = Number(pendingSigning.heldAmount || transferAmount) || 0;
        const refund = Math.round((heldAmount * 0.7) * 10) / 10;
        const sellerPenalty = Math.round((heldAmount - refund) * 10) / 10;

        if (buyer) {
          buyer.budget += refund;
        }
          if (seller) {
            seller.budget += sellerPenalty;
          }
          addNews(
            draft,
            code,
          `Fabrizio Romano: ${player.Name} rechazo a ${pendingSigning.buyerClub || pendingSigning.owner}. La operacion se cayo, regresaron ${refund}M al comprador y ${sellerPenalty}M quedaron para ${pendingSigning.fromClub || pendingSigning.fromOwner}`
        );
        sendDraftUpdate(code);
      }

      return res.status(400).json({
        error: `${player.Name} rechazo la negociacion salarial y te bloqueo hasta la siguiente fecha de transferencias`,
        attemptsLeft: 0,
      });
    }

    draft.negotiations[negotiationKey] = negotiation;
    return res.status(400).json({
      error: `${player.Name} quiere un mejor salario. Te quedan ${MAX_NEGOTIATION_ATTEMPTS - negotiation.attempts} intentos`,
      attemptsLeft: MAX_NEGOTIATION_ATTEMPTS - negotiation.attempts,
    });
  }

  delete draft.negotiations[negotiationKey];

  if (pendingSigning) {
      if (pendingSigning.type === "offer" || pendingSigning.type === "clause") {
        const seller = draft.teams[pendingSigning.fromOwner];
        const buyer = draft.teams[pendingSigning.owner];
        const sellerOwns = seller?.squad.some((item) => item.ID === player.ID);

        if (!seller || !buyer || !sellerOwns) {
          clearPendingSigningByPlayer(draft, playerId);
          return res.status(400).json({ error: "La transferencia ya no esta disponible" });
        }

      const salaryAfter = getTeamPayroll(buyer) + (Number(offeredSalary) || 0);

      if (
        buyer.squad.length >= TEAM_SIZE_TARGET ||
        teamOwnsPlayer(buyer, player.ID) ||
        salaryAfter > (Number(buyer.salaryCap) || DEFAULT_SALARY_CAP)
      ) {
        return res.status(400).json({ error: "No puedes cerrar este contrato por presupuesto, masa salarial o plantilla" });
      }

        seller.squad = seller.squad.filter((item) => item.ID !== player.ID);
        seller.budget += Number(pendingSigning.heldAmount || transferAmount) || 0;
        buyer.squad.push(clonePlayerForTeam(player, offeredSalary));
        clearPendingSigningByPlayer(draft, playerId);
        addNews(
          draft,
          code,
        pendingSigning.type === "clause"
          ? `Fabrizio Romano: ${player.Name} deja ${seller.name} por clausula y firma con ${buyer.name} con sueldo de ${offeredSalary}k por temporada`
          : `Fabrizio Romano: ${player.Name} cambia de ${seller.name} a ${buyer.name} con sueldo de ${offeredSalary}k por temporada`
      );
      addFaunaComment(draft, code, pendingSigning.type === "clause" ? "clause" : "transfer", {
        player: player.Name,
        winner: buyer.name,
      });
      sendDraftUpdate(code);
      return res.json({ mode: pendingSigning.type, ...getDraftPayload(code) });
    }

    if (!canAddPlayerToTeam(team, player, offeredSalary, transferAmount)) {
      return res.status(400).json({ error: "No puedes cerrar este contrato por presupuesto, masa salarial o plantilla" });
      }

      team.budget -= transferAmount;
      team.squad.push(clonePlayerForTeam(player, offeredSalary));
      clearPendingSigningByPlayer(draft, playerId);
      addNews(draft, code, `Fabrizio Romano: ${team.name} cerro a ${player.Name} tras ganar la subasta, sueldo ${offeredSalary}k por temporada`);
      addFaunaComment(draft, code, "transfer", { player: player.Name, winner: team.name });
      sendDraftUpdate(code);
    return res.json({ mode: "auction", ...getDraftPayload(code) });
  }

  if (!owner) {
    if (!canAddPlayerToTeam(team, player, offeredSalary, player.marketValue)) {
      return res.status(400).json({ error: "No puedes cerrar la compra por presupuesto, masa salarial o plantilla" });
    }

    team.budget -= player.marketValue;
    team.squad.push(clonePlayerForTeam(player, offeredSalary));
    addNews(draft, code, `Fabrizio Romano: ${team.name} cerro a ${player.Name} por ${player.marketValue}M con sueldo de ${offeredSalary}k`);
    addFaunaComment(draft, code, "transfer", { player: player.Name, winner: team.name });
    sendDraftUpdate(code);
    return res.json({ mode: "buy", ...getDraftPayload(code) });
  }

  return res.status(400).json({ error: "Primero debes enviar oferta al club y esperar aceptacion" });
});

app.post("/drafts/:code/buy", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, playerId } = req.body;
  const draft = ensureDraft(code);

  if (!draft) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  const player = getDraftPlayerById(draft, playerId);
  const team = draft.teams[username];
  const alreadyOwned = findPlayerOwner(draft, playerId);

  if (!player || !team || alreadyOwned || !canAddPlayerToTeam(team, player, player.salary, player.marketValue)) {
    return res.status(400).json({ error: "No se puede comprar este jugador" });
  }

  team.budget -= player.marketValue;
  team.squad.push(clonePlayerForTeam(player, player.salary));
  addNews(draft, code, `Fabrizio Romano: ${team.name} compro a ${player.Name} por ${player.marketValue}M`);
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/release", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, playerId } = req.body;
  const draft = ensureDraft(code);

  if (!draft) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  const team = draft.teams[username];
  const player = team?.squad.find((item) => String(item.ID) === String(playerId));

  if (!team || !player) {
    return res.status(400).json({ error: "No puedes despedir este jugador" });
  }

  team.squad = team.squad.filter((item) => String(item.ID) !== String(playerId));
  team.budget += Number(player.releaseValue) || 0;
  addNews(draft, code, `Fabrizio Romano: ${team.name} libero a ${player.Name} y recupero ${player.releaseValue || 0}M`);
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/train", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, playerId } = req.body;
  const draft = ensureDraft(code);

  if (!draft) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  const team = draft.teams[username];
  const playerIndex = team?.squad.findIndex((item) => String(item.ID) === String(playerId)) ?? -1;

  if (!team || playerIndex === -1) {
    return res.status(404).json({ error: "Jugador no encontrado en tu club" });
  }

  const player = team.squad[playerIndex];
  if (Number(player.OVR) >= 99) {
    return res.status(400).json({ error: "Este jugador ya no puede subir mas" });
  }

  const cost = getTrainingCost(Number(player.OVR));
  if (Number(team.budget) < cost) {
    return res.status(400).json({ error: "No tienes presupuesto para este entrenamiento" });
  }

  const nextOverall = Number(player.OVR) < 75 ? 75 : Number(player.OVR) + 1;
  const trainedPlayer = {
    ...player,
    OVR: nextOverall,
    marketValue: Number(player.marketValue || 0) + cost,
  };

  TRAINABLE_STAT_KEYS.forEach((key) => {
    trainedPlayer[key] = Math.min(99, (Number(player[key]) || 0) + 1);
  });

  team.budget -= cost;
  team.squad[playerIndex] = trainedPlayer;
  if (draft.organizer) {
    if (!draft.inbox[draft.organizer]) {
      draft.inbox[draft.organizer] = [];
    }
    draft.inbox[draft.organizer].unshift({
      id: `training-${code}-${player.ID}-${Date.now()}`,
      title: `${team.name} completo un entrenamiento`,
      body: `${player.Name} subio a ${nextOverall} de media en ${team.name}.`,
      playerId: player.ID,
    });
  }
  addNews(draft, code, `Liga UFL: ${team.name} mejoro a ${player.Name} a ${nextOverall} de media`);
  addLeagueComment(draft, code, "training", { player: player.Name, team: team.name });
  addFaunaComment(draft, code, "training", { player: player.Name, winner: team.name });
  sendDraftUpdate(code);
  res.json({ playerName: player.Name, nextOverall, ...getDraftPayload(code) });
});

app.post("/drafts/:code/change-sponsor", (req, res) => {
  const code = String(req.params.code).trim();
  const { username } = req.body;
  const draft = ensureDraft(code);

  if (!draft) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  const team = draft.teams[username];
  if (!team) {
    return res.status(404).json({ error: "Club no encontrado" });
  }

  if (team.sponsorChangedThisSeason) {
    return res.status(400).json({ error: "Ya cambiaste patrocinador esta temporada" });
  }

  const previousSponsor = team.sponsor?.name || "";
  team.sponsor = getRandomSponsor(previousSponsor);
  team.sponsorChangedThisSeason = true;

  addNews(
    draft,
    code,
    `Liga UFL: ${team.name} cambio de patrocinador. Sale ${previousSponsor || "anterior"} y entra ${team.sponsor.name}`
  );
  addFaunaComment(draft, code, "transfer", { winner: team.name, player: team.sponsor.name });
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/offers", (req, res) => {
  const code = String(req.params.code).trim();
  const { from, playerId, amount } = req.body;
  const draft = ensureDraft(code);

  if (!draft) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  const player = getDraftPlayerById(draft, playerId);
  const to = Object.keys(draft.teams).find((owner) =>
    draft.teams[owner].squad.some((item) => String(item.ID) === String(playerId))
  );
  const blockedUntilWindow = getBlockedNegotiationWindow(draft, from, playerId);

  if (!player || !to || to === from) {
    return res.status(400).json({ error: "No se puede ofertar por este jugador" });
  }

  if (draft.transferWindowId < blockedUntilWindow) {
    return res.status(409).json({ error: getNegotiationBlockedMessage(player.Name) });
  }

  const existingPendingOffer = draft.offers.find(
    (offer) =>
      offer.from === from &&
      offer.to === to &&
      String(offer.player.ID) === String(playerId) &&
      offer.status === "pending"
  );

  if (existingPendingOffer) {
    return res.status(409).json({ error: "Ya se envio una oferta y sigue pendiente de respuesta" });
  }

  const existingPendingSigning = draft.pendingSignings.find(
    (signing) =>
      signing.owner === from &&
      String(signing.player.ID) === String(playerId)
  );

  if (existingPendingSigning) {
    return res.status(409).json({ error: "Ese fichaje ya esta pendiente de negociacion salarial" });
  }

  const buyer = draft.teams[from];
  const seller = to ? draft.teams[to] : null;

  if (!buyer || !seller || buyer.budget < Number(amount) || buyer.squad.length >= TEAM_SIZE_TARGET) {
    return res.status(400).json({ error: "No puedes enviar esta oferta por presupuesto o plantilla" });
  }

  draft.offers.unshift({
    id: `${playerId}-${Date.now()}`,
    from,
    to,
    player,
    amount: Number(amount),
    salary: Number(player.salary) || 0,
    status: "pending",
  });
  addNews(draft, code, `Fabrizio Romano: ${from} envio oferta por ${player.Name}`);
  addRomanoComment(draft, code, "transfer", { player: player.Name, amount: Number(amount), team: from, fromClub: seller.name });
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/pay-clause", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, playerId } = req.body;
  const draft = ensureDraft(code);

  if (!draft) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  const player = getDraftPlayerById(draft, playerId);
  const buyer = draft.teams[username];
  const owner = findPlayerOwner(draft, playerId);
  const seller = owner ? draft.teams[owner] : null;

  if (!player || !buyer || !owner || owner === username || !seller) {
    return res.status(400).json({ error: "No se puede ejecutar la clausula de este jugador" });
  }

  const clauseAmount = getReleaseClauseValue(player);
  const blockedUntilWindow = getBlockedNegotiationWindow(draft, username, playerId);

  if (draft.transferWindowId < blockedUntilWindow) {
    return res.status(409).json({ error: getNegotiationBlockedMessage(player.Name) });
  }

  if (isPlayerProtected(seller, playerId)) {
    return res.status(400).json({ error: `${player.Name} esta blindado y no puedes pagar su clausula` });
  }

  if (
    buyer.budget < clauseAmount ||
    buyer.squad.length >= TEAM_SIZE_TARGET ||
    draft.pendingSignings.some(
      (signing) => signing.owner === username && String(signing.player.ID) === String(playerId)
    )
  ) {
    return res.status(400).json({ error: "No puedes pagar la clausula por presupuesto o plantilla" });
  }

  buyer.budget -= clauseAmount;
  draft.pendingSignings.unshift({
    id: `clause-${player.ID}-${Date.now()}-${username}`,
    owner: username,
    type: "clause",
    fromOwner: owner,
    fromClub: seller.name,
    buyerClub: buyer.name,
    player,
    amount: clauseAmount,
    heldAmount: clauseAmount,
  });
  addNews(draft, code, `Fabrizio Romano: ${buyer.name} activo la clausula de ${player.Name} por ${clauseAmount}M`);
  addRomanoComment(draft, code, "clause", { player: player.Name, winner: buyer.name, loser: seller.name, amount: clauseAmount });
  addFaunaComment(draft, code, "clause", { player: player.Name, winner: buyer.name });
  sendDraftUpdate(code);
  res.json({ mode: "clause", ...getDraftPayload(code) });
});

app.post("/drafts/:code/protection", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, playerId, action } = req.body;
  const draft = ensureDraft(code);

  if (!draft) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  const team = draft.teams[username];
  const player = team?.squad.find((item) => String(item.ID) === String(playerId));

  if (!team || !player) {
    return res.status(404).json({ error: "Jugador no encontrado en tu club" });
  }

  const protectedIds = getProtectedPlayerIds(team);
  const alreadyProtected = isPlayerProtected(team, playerId);

  if (action === "protect") {
    if (!alreadyProtected && protectedIds.length >= 2) {
      return res.status(400).json({ error: "Solo puedes blindar a 2 jugadores" });
    }

    team.protectedPlayerIds = alreadyProtected
      ? protectedIds
      : [...protectedIds, player.ID];
    addNews(draft, code, `Liga UFL: ${team.name} activo la clausula de rescision de ${player.Name}`);
  } else {
    team.protectedPlayerIds = protectedIds.filter((id) => String(id) !== String(playerId));
    addNews(draft, code, `Liga UFL: ${team.name} retiro la clausula de rescision de ${player.Name}`);
  }

  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/offers/:offerId", (req, res) => {
  const code = String(req.params.code).trim();
  const { decision } = req.body;
  const draft = ensureDraft(code);

  if (!draft) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  const offer = draft.offers.find((item) => item.id === req.params.offerId);
  if (!offer || offer.status !== "pending") {
    return res.status(400).json({ error: "Oferta invalida" });
  }

  if (decision === "accepted") {
    const seller = draft.teams[offer.to];
    const buyer = draft.teams[offer.from];
    const sellerOwns = seller?.squad.some((item) => item.ID === offer.player.ID);
    const anotherTeamOwns = Object.values(draft.teams).some(
      (team) => team.owner !== offer.to && team.squad.some((item) => item.ID === offer.player.ID)
    );

    if (
      !seller ||
      !buyer ||
      !sellerOwns ||
      anotherTeamOwns ||
      buyer.budget < offer.amount ||
      buyer.squad.length >= TEAM_SIZE_TARGET ||
      draft.pendingSignings.some(
        (signing) =>
          signing.owner === offer.from &&
          String(signing.player.ID) === String(offer.player.ID)
      )
    ) {
      return res.status(400).json({ error: "No se pudo completar la oferta" });
    }

    addNews(draft, code, `Fabrizio Romano: ${seller.name} acepto la oferta de ${buyer.name} por ${offer.player.Name}. Falta negociar el sueldo del jugador.`);
    addLeagueComment(draft, code, "transfer", { player: offer.player.Name, team: buyer.name });
    buyer.budget -= offer.amount;
    draft.pendingSignings.unshift({
      id: `offer-${offer.player.ID}-${Date.now()}-${offer.from}`,
      owner: offer.from,
      buyerClub: buyer.name,
      fromOwner: offer.to,
      fromClub: seller.name,
      type: "offer",
      player: offer.player,
      amount: offer.amount,
      heldAmount: offer.amount,
    });
    if (!draft.inbox[offer.from]) {
      draft.inbox[offer.from] = [];
    }
    draft.inbox[offer.from].unshift({
      id: `offer-accepted-${offer.id}-${Date.now()}`,
      title: "Oferta aceptada",
      body: `${seller.name} acepto tu oferta por ${offer.player.Name}. Ya puedes negociar el sueldo del jugador.`,
      playerId: offer.player.ID,
    });
  } else if (decision === "rejected") {
    if (!draft.inbox[offer.from]) {
      draft.inbox[offer.from] = [];
    }
    draft.inbox[offer.from].unshift({
      id: `offer-rejected-${offer.id}-${Date.now()}`,
      title: "Oferta rechazada",
      body: `${draft.teams[offer.to]?.name || offer.to} rechazo tu oferta por ${offer.player.Name}.`,
      playerId: offer.player.ID,
    });
    addFaunaComment(draft, code, "offerRejected", {
      loser: draft.teams[offer.from]?.name || offer.from,
      player: offer.player.Name,
    });
  }

  offer.status = decision;
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/start-season", (req, res) => {
  const code = String(req.params.code).trim();
  const { username } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede iniciar la liga" });
  }

  if (draft.phase !== "market") {
    return res.status(400).json({ error: "El mercado no esta activo" });
  }

  if ((draft.pendingSignings || []).length > 0) {
    (draft.pendingSignings || []).forEach((signing) => {
      if (!signing?.owner || !signing?.player?.Name) return;
      if (!draft.inbox[signing.owner]) {
        draft.inbox[signing.owner] = [];
      }
      draft.inbox[signing.owner].unshift({
        id: `market-close-${signing.id}-${Date.now()}`,
        title: "Negociacion cancelada",
        body: `La negociacion salarial de ${signing.player.Name} fue cancelada porque el organizador cerro el mercado.`,
        playerId: signing.player.ID,
      });
    });
    draft.pendingSignings = [];
  }

  Object.keys(draft.teams).forEach((owner) => {
    autoCompleteSquad(draft, owner, code);
  });

  draft.phase = "season";
  draft.regularSeasonComplete = false;
  draft.seasonWinnerAnnounced = false;
  addNews(draft, code, "Liga UFL: el periodo de transferencias termino y la liga comenzo.");
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/reopen-market", (req, res) => {
  const code = String(req.params.code).trim();
  const { username } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede habilitar transferencias" });
  }

  if (draft.regularSeasonComplete) {
    return res.status(400).json({ error: "La liga regular ya termino. Solo queda cerrar la liguilla" });
  }

  draft.phase = "market";
  draft.transferWindowId = Number(draft.transferWindowId || 0) + 1;
  addNews(draft, code, "Liga UFL: el organizador reactivo manualmente el mercado de transferencias.");
  addLeagueComment(draft, code, "transfer", { team: lobby.creator });
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/news-message", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, message } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (!lobby.players.includes(username)) {
    return res.status(403).json({ error: "No perteneces a esta liga" });
  }

  const team = draft.teams[username];
  const cleanMessage = String(message || "").trim();

  if (!team || !cleanMessage) {
    return res.status(400).json({ error: "Escribe un mensaje valido" });
  }

  addNews(draft, code, `Club ${team.name}: ${cleanMessage.slice(0, 220)}`);
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/results", (req, res) => {
  const code = String(req.params.code).trim();
  const {
    username,
    opponentName,
    goalsFor,
    goalsAgainst,
    teamScorers = [],
    opponentScorers = [],
    teamCards = 0,
    opponentCards = 0,
    mvpPlayerName = "",
  } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  syncStandingsWithTeams(draft, lobby);

  const currentTeam = draft.teams[username];
  const myTeamName = currentTeam?.name || username;
  const scoreA = Number(goalsFor);
  const scoreB = Number(goalsAgainst);

  if (!currentTeam || !opponentName) {
    return res.status(400).json({ error: "Faltan datos del resultado" });
  }

  const hasOpponent = draft.standings.some((team) => team.name === opponentName);
  if (!hasOpponent || opponentName === myTeamName) {
    return res.status(400).json({ error: "Selecciona un rival valido" });
  }

  draft.standings = sortStandings(
    draft.standings.map((team) => {
      if (team.name !== myTeamName && team.name !== opponentName) return team;

      const isHome = team.name === myTeamName;
      const teamGoalsFor = isHome ? scoreA : scoreB;
      const teamGoalsAgainst = isHome ? scoreB : scoreA;
      const win = teamGoalsFor > teamGoalsAgainst ? 1 : 0;
      const draw = teamGoalsFor === teamGoalsAgainst ? 1 : 0;
      const loss = teamGoalsFor < teamGoalsAgainst ? 1 : 0;

      return {
        ...team,
        played: team.played + 1,
        wins: team.wins + win,
        draws: team.draws + draw,
        losses: team.losses + loss,
        gf: team.gf + teamGoalsFor,
        ga: team.ga + teamGoalsAgainst,
        pts: team.pts + (win ? 3 : draw ? 1 : 0),
      };
    })
  );

  draft.leagueMatchCount = Number(draft.leagueMatchCount || 0) + 1;
  const mySponsorIncome = applySponsorIncome(currentTeam, scoreA, scoreB, Number(teamCards) || 0);
  const opponentManagedTeam = Object.values(draft.teams).find((team) => team.name === opponentName) || null;
  const opponentSponsorIncome = opponentManagedTeam
    ? applySponsorIncome(opponentManagedTeam, scoreB, scoreA, Number(opponentCards) || 0)
    : 0;
  syncUnavailablePlayers(draft);
  const affectedOwners = [username];
  if (opponentManagedTeam?.owner) {
    affectedOwners.push(opponentManagedTeam.owner);
  }
  maybeTriggerScheduledInjuries(code, draft, affectedOwners);
  maybeTriggerRandomEvent(code, draft, affectedOwners);
  addNews(draft, code, `Liga UFL: ${myTeamName} ${scoreA}-${scoreB} ${opponentName}`);
  addLeagueComment(draft, code, "result", { home: myTeamName, away: opponentName, winner: scoreA > scoreB ? myTeamName : opponentName, loser: scoreA > scoreB ? opponentName : myTeamName });
  addRomanoComment(draft, code, "result", { subject: scoreA > scoreB ? myTeamName : opponentName, rival: scoreA > scoreB ? opponentName : myTeamName });
  if (scoreA !== scoreB) {
    addFaunaComment(draft, code, "result", {
      winner: scoreA > scoreB ? myTeamName : opponentName,
      loser: scoreA > scoreB ? opponentName : myTeamName,
    });
  }

  const myStanding = draft.standings.find((team) => team.name === myTeamName);
  const opponentStanding = draft.standings.find((team) => team.name === opponentName);
  if (myStanding && opponentStanding) {
    markScheduleMatchPlayed(draft, myStanding.key, opponentStanding.key, {
      homeGoals: scoreA,
      awayGoals: scoreB,
    });
  }

  maybeAdvanceFantasyRoundBlock(draft, lobby, code);

  if (isRegularSeasonComplete(draft, lobby)) {
    appendSeasonWinnerIfNeeded(draft, lobby, code);
  }

  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/cpu-result", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, cpuTeamA, cpuTeamB, cpuPointsA = 3, cpuPointsB = 0 } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede cargar resultado CPU" });
  }

  syncStandingsWithTeams(draft, lobby);

  if (!cpuTeamA || !cpuTeamB || cpuTeamA === cpuTeamB) {
    return res.status(400).json({ error: "Selecciona dos equipos CPU distintos" });
  }

  const derivedResult =
    Number(cpuPointsA) === Number(cpuPointsB)
      ? { homeGoals: 1, awayGoals: 1 }
      : Number(cpuPointsA) > Number(cpuPointsB)
        ? { homeGoals: 2, awayGoals: 1 }
        : { homeGoals: 1, awayGoals: 2 };

  const cpuTeamAStanding = draft.standings.find((team) => team.name === cpuTeamA);
  const cpuTeamBStanding = draft.standings.find((team) => team.name === cpuTeamB);
  if (!cpuTeamAStanding || !cpuTeamBStanding) {
    return res.status(404).json({ error: "No se encontraron los equipos CPU en la tabla" });
  }

  applyStandingResultByKeys(
    draft,
    cpuTeamAStanding.key,
    cpuTeamBStanding.key,
    derivedResult.homeGoals,
    derivedResult.awayGoals
  );

  draft.leagueMatchCount = Number(draft.leagueMatchCount || 0) + 1;
  syncUnavailablePlayers(draft);
  maybeTriggerRandomEvent(code, draft);
  if (isRegularSeasonComplete(draft, lobby)) {
    appendSeasonWinnerIfNeeded(draft, lobby, code);
  }

  markScheduleMatchPlayed(draft, cpuTeamAStanding.key, cpuTeamBStanding.key, derivedResult);

  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/cpu-team-name", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, teamKey, name } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede renombrar equipos CPU" });
  }

  const trimmedName = String(name || "").trim();
  if (!trimmedName) {
    return res.status(400).json({ error: "Escribe un nombre valido" });
  }

  const cpuTeam = (draft.cpuTeams || []).find((team) => team.key === teamKey);
  if (!cpuTeam) {
    return res.status(404).json({ error: "Equipo CPU no encontrado" });
  }

  cpuTeam.name = trimmedName;
  syncStandingsWithTeams(draft, lobby);
  addNews(draft, code, `Liga UFL: el organizador renombro un equipo CPU a ${trimmedName}`);
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/edit-standing", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, teamKey, played, wins, draws, losses, gf, ga, pts } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede editar la tabla" });
  }

  const standing = (draft.standings || []).find((team) => team.key === teamKey);
  if (!standing) {
    return res.status(404).json({ error: "Equipo no encontrado en la tabla" });
  }

  standing.played = Number(played) || 0;
  standing.wins = Number(wins) || 0;
  standing.draws = Number(draws) || 0;
  standing.losses = Number(losses) || 0;
  standing.gf = Number(gf) || 0;
  standing.ga = Number(ga) || 0;
  standing.pts = Number(pts) || 0;
  draft.standings = sortStandings(draft.standings);
  if (isRegularSeasonComplete(draft, lobby)) {
    appendSeasonWinnerIfNeeded(draft, lobby, code);
  }
  addNews(draft, code, `Liga UFL: el organizador edito la tabla de ${standing.name}`);
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/admin-player-update", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, ownerKey, playerId, updates = {} } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede editar clubes" });
  }

  const team = draft.teams?.[ownerKey];
  const playerIndex = team?.squad?.findIndex((item) => String(item.ID) === String(playerId)) ?? -1;
  if (!team || playerIndex === -1) {
    return res.status(404).json({ error: "Jugador no encontrado en ese club" });
  }

  const currentPlayer = team.squad[playerIndex];
  const numericKeys = [
    "OVR",
    "PAC",
    "SHO",
    "PAS",
    "DRI",
    "DEF",
    "PHY",
    "Age",
    "marketValue",
    "salary",
    "salaryMin",
    "salaryMax",
    "releaseValue",
  ];
  const textKeys = ["Position", "Nation", "League", "Preferred foot", "Weak foot", "Skill moves", "card"];

  const nextPlayer = { ...currentPlayer };
  numericKeys.forEach((key) => {
    if (updates[key] !== undefined && updates[key] !== null && updates[key] !== "") {
      nextPlayer[key] = Number(updates[key]) || 0;
    }
  });
  textKeys.forEach((key) => {
    if (updates[key] !== undefined && updates[key] !== null) {
      nextPlayer[key] = String(updates[key]).trim();
    }
  });

  team.squad[playerIndex] = nextPlayer;
  addNews(draft, code, `Liga UFL: el organizador corrigio manualmente a ${currentPlayer.Name} en ${team.name}`);
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/admin-player-remove", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, ownerKey, playerId } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede editar clubes" });
  }

  const team = draft.teams?.[ownerKey];
  const player = team?.squad?.find((item) => String(item.ID) === String(playerId));
  if (!team || !player) {
    return res.status(404).json({ error: "Jugador no encontrado en ese club" });
  }

  team.squad = team.squad.filter((item) => String(item.ID) !== String(playerId));
  team.protectedPlayerIds = getProtectedPlayerIds(team).filter((id) => String(id) !== String(playerId));
  addNews(draft, code, `Liga UFL: el organizador elimino manualmente a ${player.Name} de ${team.name}`);
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/add-budget", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, amount } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede agregar presupuesto" });
  }

  const parsedAmount = Math.round((Number(amount) || 0) * 10) / 10;
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: "Escribe una cantidad valida en millones" });
  }

  lobby.players.forEach((owner) => {
    const team = draft.teams?.[owner];
    if (team) {
      team.budget = Math.round((Number(team.budget || 0) + parsedAmount) * 10) / 10;
    }
  });

  addNews(
    draft,
    code,
    `Liga UFL: el organizador agrego ${formatMoney(parsedAmount)} de presupuesto de transferencias a cada club real`
  );
  addFaunaComment(draft, code, "budget", {
    winner: "la liga",
    player: `${formatMoney(parsedAmount)}`,
  });
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/add-budget-club", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, ownerKey, amount } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede compensar presupuesto" });
  }

  const team = draft.teams?.[ownerKey];
  if (!team) {
    return res.status(404).json({ error: "Club no encontrado" });
  }

  const parsedAmount = Math.round((Number(amount) || 0) * 10) / 10;
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: "Escribe una cantidad valida en millones" });
  }

  team.budget = Math.round((Number(team.budget || 0) + parsedAmount) * 10) / 10;
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/toggle-competition-mode", (req, res) => {
  const code = String(req.params.code).trim();
  const { username } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede cambiar el modo de competencia" });
  }

  lobby.competitionMode = lobby.competitionMode === "champions" ? "league" : "champions";
  lobby.fillCpuTeams = true;
  draft.regularSeasonComplete = false;
  draft.seasonWinnerAnnounced = false;
  draft.seasonChampionKey = "";
  draft.seasonChampionName = "";
  draft.championCelebrationId = "";
  draft.seasonLeaguePrizePaid = false;
  draft.playoffPrizePaid = false;
  draft.playoff = null;
  draft.championsKnockout = null;
  draft.quickTournament = null;
  draft.leagueMatchCount = 0;
  draft.visibleRoundStart = 1;
  draft.schedule = [];
  syncStandingsWithTeams(draft, lobby);
  draft.standings = (draft.standings || []).map((team) => ({
    ...team,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    pts: 0,
  }));
  addNews(
    draft,
    code,
    `Liga UFL: el organizador cambio el modo de competencia a ${
      lobby.competitionMode === "champions" ? "Champions" : "Liga"
    }`
  );
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/champions-phase-config", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, labels = {} } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede configurar las fases" });
  }

  lobby.championsPhaseLabels = {
    ...getDefaultChampionsPhaseLabels(),
    ...(lobby.championsPhaseLabels || {}),
    playoff: String(labels.playoff ?? lobby.championsPhaseLabels?.playoff ?? getDefaultChampionsPhaseLabels().playoff ?? "").trim(),
    round16: String(labels.round16 ?? lobby.championsPhaseLabels?.round16 ?? getDefaultChampionsPhaseLabels().round16 ?? "").trim(),
    quarterfinal: String(labels.quarterfinal ?? lobby.championsPhaseLabels?.quarterfinal ?? getDefaultChampionsPhaseLabels().quarterfinal ?? "").trim(),
    semifinal: String(labels.semifinal ?? lobby.championsPhaseLabels?.semifinal ?? getDefaultChampionsPhaseLabels().semifinal ?? "").trim(),
    final: String(labels.final ?? lobby.championsPhaseLabels?.final ?? getDefaultChampionsPhaseLabels().final ?? "").trim(),
  };

  if (lobby.competitionMode === "champions" && draft.regularSeasonComplete) {
    if (draft.championsKnockout?.rounds?.length) {
      draft.championsKnockout.labels = {
        ...draft.championsKnockout.labels,
        ...lobby.championsPhaseLabels,
      };
      draft.championsKnockout.rounds = draft.championsKnockout.rounds.map((round, index) => ({
        ...round,
        name:
          index === 0
            ? lobby.championsPhaseLabels.playoff || ""
            : index === 1
              ? lobby.championsPhaseLabels.round16 || ""
              : index === 2
                ? lobby.championsPhaseLabels.quarterfinal || ""
                : index === 3
                  ? lobby.championsPhaseLabels.semifinal || ""
                  : lobby.championsPhaseLabels.final || "",
      }));
    } else {
      draft.championsKnockout = buildChampionsKnockout(draft, lobby);
    }
  }

  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/champions-assign-match", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, roundIndex, matchId, homeKey, awayKey } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby || lobby.competitionMode !== "champions" || !draft.championsKnockout?.active) {
    return res.status(404).json({ error: "Fase final de Champions no encontrada" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede asignar cruces de Champions" });
  }

  const round = draft.championsKnockout.rounds?.[Number(roundIndex)];
  const match = round?.matches?.find((item) => item.id === matchId);
  if (!round || !match) {
    return res.status(404).json({ error: "Partido no encontrado" });
  }

  const trimmedHomeKey = String(homeKey || "").trim();
  const trimmedAwayKey = String(awayKey || "").trim();
  if (!trimmedHomeKey || !trimmedAwayKey || trimmedHomeKey === trimmedAwayKey) {
    return res.status(400).json({ error: "Selecciona dos clubes distintos" });
  }

  const standingsMap = new Map((draft.standings || []).map((team) => [team.key, team]));
  const homeTeam = standingsMap.get(trimmedHomeKey);
  const awayTeam = standingsMap.get(trimmedAwayKey);
  if (!homeTeam || !awayTeam) {
    return res.status(404).json({ error: "No se encontraron esos clubes en la tabla" });
  }

  const usedKeys = new Set(
    round.matches
      .filter((item) => item.id !== match.id)
      .flatMap((item) => [item.homeKey, item.awayKey])
      .filter(Boolean)
  );
  if (usedKeys.has(trimmedHomeKey) || usedKeys.has(trimmedAwayKey)) {
    return res.status(400).json({ error: "Uno de esos clubes ya esta asignado en esta fase" });
  }

  match.homeKey = trimmedHomeKey;
  match.awayKey = trimmedAwayKey;
  match.homeName = homeTeam.name;
  match.awayName = awayTeam.name;
  match.played = false;
  match.result = null;
  match.winnerKey = "";

  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/champions-knockout-result", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, roundIndex, matchId, homeGoals, awayGoals } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby || lobby.competitionMode !== "champions" || !draft.championsKnockout?.active) {
    return res.status(404).json({ error: "Fase final de Champions no encontrada" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede registrar este resultado" });
  }

  const round = draft.championsKnockout.rounds?.[Number(roundIndex)];
  const match = round?.matches?.find((item) => item.id === matchId);
  if (!round || !match || !match.homeKey || !match.awayKey) {
    return res.status(404).json({ error: "Partido no encontrado" });
  }

  const goalsA = Number(homeGoals);
  const goalsB = Number(awayGoals);
  if (!Number.isFinite(goalsA) || !Number.isFinite(goalsB) || goalsA === goalsB) {
    return res.status(400).json({ error: "La fase final no permite empates" });
  }

  match.played = true;
  match.result = { homeGoals: goalsA, awayGoals: goalsB };
  match.winnerKey = goalsA > goalsB ? match.homeKey : match.awayKey;
  syncChampionsKnockout(draft, lobby);

  const finalRound = draft.championsKnockout.rounds[draft.championsKnockout.rounds.length - 1];
  if (finalRound?.matches?.[0]?.winnerKey) {
    const championKey = finalRound.matches[0].winnerKey;
    draft.championsKnockout.championKey = championKey;
    draft.seasonChampionKey = championKey;
    draft.seasonChampionName = getTeamNameByKey(draft, championKey);
    draft.championCelebrationId = `champions-${code}-${championKey}-${Date.now()}`;
    addNews(draft, code, `Liga UFL: ${draft.seasonChampionName} gano la Champions`);
  } else {
    addNews(
      draft,
      code,
      `Liga UFL: ${goalsA > goalsB ? match.homeName : match.awayName} avanzo en ${
        round.name || "la fase final"
      }`
    );
  }

  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/playoff-result", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, stage, homeGoals, awayGoals } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  ensurePlayoff(draft);
  const match = draft.playoff?.[stage];
  if (!match || !match.homeKey || !match.awayKey) {
    return res.status(400).json({ error: "No hay llave disponible para esta fase" });
  }

  const canManage = lobby.creator === username;

  if (!canManage) {
    return res.status(403).json({ error: "No puedes registrar este resultado" });
  }

  const goalsA = Number(homeGoals);
  const goalsB = Number(awayGoals);
  if (!Number.isFinite(goalsA) || !Number.isFinite(goalsB) || goalsA === goalsB) {
    return res.status(400).json({ error: "La liguilla no permite empates" });
  }

  match.played = true;
  match.result = { homeGoals: goalsA, awayGoals: goalsB };
  match.winnerKey = goalsA > goalsB ? match.homeKey : match.awayKey;
  ensurePlayoff(draft);

  if (stage === "final") {
    draft.playoff.championKey = match.winnerKey;
    addNews(draft, code, `Liga UFL: ${getTeamNameByKey(draft, match.winnerKey)} gano la liguilla`);
  } else {
    addNews(
      draft,
      code,
      `Liga UFL: ${goalsA > goalsB ? match.homeName : match.awayName} avanzo desde ${match.label.toLowerCase()}`
    );
  }

  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/finish-playoff", (req, res) => {
  const code = String(req.params.code).trim();
  const { username } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede cerrar la liguilla" });
  }

  awardLeaguePrizeIfNeeded(draft, lobby, code);
  if (lobby.competitionMode === "champions") {
    awardChampionsPrizesIfNeeded(draft, lobby, code);
  } else {
    awardPlayoffPrizesIfNeeded(draft, lobby, code);
  }
  awardQuickTournamentPrizeIfNeeded(draft, code);
  resetLeagueForNewSeason(draft, lobby);
  addNews(
    draft,
    code,
    lobby.competitionMode === "champions"
      ? "Liga UFL: termino la fase final de Champions y se reinicio el sistema de subastas y transferencias"
      : "Liga UFL: termino la liguilla y se reinicio el sistema de subastas y transferencias"
  );
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/finish-regular-season", (req, res) => {
  const code = String(req.params.code).trim();
  const { username } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede cerrar la liga regular" });
  }

  syncStandingsWithTeams(draft, lobby);

  if (!draft.standings?.length) {
    return res.status(400).json({ error: "Todavia no hay tabla disponible" });
  }

  appendSeasonWinnerIfNeeded(draft, lobby, code);
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/quick-tournament", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, teamKeys = [], prize, runnerUpPrize } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede crear torneo rapido" });
  }

  const selectedTeams = (draft.standings || []).filter((team) => team.real && teamKeys.includes(team.key));
  if (selectedTeams.length < 2) {
    return res.status(400).json({ error: "Selecciona al menos 2 clubes reales" });
  }

  createQuickTournament(
    draft,
    selectedTeams,
    Number(prize) || DEFAULT_QUICK_TOURNAMENT_PRIZE,
    Number(runnerUpPrize) || DEFAULT_QUICK_TOURNAMENT_RUNNER_UP_PRIZE
  );
  addNews(
    draft,
    code,
    `Liga UFL: el organizador creo un torneo rapido con ${selectedTeams.length} clubes reales | campeon ${formatMoney(Number(prize) || DEFAULT_QUICK_TOURNAMENT_PRIZE)} | subcampeon ${formatMoney(Number(runnerUpPrize) || DEFAULT_QUICK_TOURNAMENT_RUNNER_UP_PRIZE)}`
  );
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/quick-tournament-result", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, roundIndex, matchId, homeGoals, awayGoals } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby || !draft.quickTournament?.active) {
    return res.status(404).json({ error: "Torneo rapido no encontrado" });
  }

  const round = draft.quickTournament.rounds?.[Number(roundIndex)];
  const match = round?.matches?.find((item) => item.id === matchId);
  if (!round || !match) {
    return res.status(404).json({ error: "Partido no encontrado" });
  }

  const canManage =
    lobby.creator === username ||
    match.homeKey === username ||
    match.awayKey === username;

  if (!canManage) {
    return res.status(403).json({ error: "No puedes registrar este resultado" });
  }

  const goalsA = Number(homeGoals);
  const goalsB = Number(awayGoals);
  if (!Number.isFinite(goalsA) || !Number.isFinite(goalsB) || goalsA === goalsB) {
    return res.status(400).json({ error: "El torneo rapido no permite empates" });
  }

  match.played = true;
  match.result = { homeGoals: goalsA, awayGoals: goalsB };
  match.winnerKey = goalsA > goalsB ? match.homeKey : match.awayKey;
  progressQuickTournament(draft);
  awardQuickTournamentPrizeIfNeeded(draft, code);
  addNews(draft, code, `Liga UFL: ${goalsA > goalsB ? match.homeName : match.awayName} avanzo en torneo rapido`);
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/progress-match", (req, res) => {
  const code = String(req.params.code).trim();
  const { username } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (!lobby.players.includes(username)) {
    return res.status(403).json({ error: "No perteneces a esta liga" });
  }

  draft.leagueMatchCount = Number(draft.leagueMatchCount || 0) + 1;
  syncUnavailablePlayers(draft);
  maybeTriggerRandomEvent(code, draft);
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.get("/lobbies/:code", (req, res) => {
  const code = String(req.params.code).trim();
  const lobby = getLobbyPayload(code);

  if (!lobby) {
    return res.status(404).json({ error: "Liga no encontrada" });
  }

  res.json(lobby);
});

app.delete("/lobbies/:code", async (req, res) => {
  const code = String(req.params.code).trim();
  const { username } = req.body;
  const lobby = lobbies.get(code);

  if (!lobby) {
    return res.status(404).json({ error: "Liga no encontrada" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede eliminar la liga" });
  }

  sendLeagueDeleted(code);
  lobbies.delete(code);
  drafts.delete(code);
  lobbyClients.delete(code);
  draftClients.delete(code);
  await deleteLeagueState(code);

  res.json({ message: "Liga eliminada" });
});

app.get("/lobbies/:code/events", (req, res) => {
  const code = String(req.params.code).trim();
  const lobby = getLobbyPayload(code);

  if (!lobby) {
    return res.status(404).end();
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify(lobby)}\n\n`);

  const clients = lobbyClients.get(code) || [];
  clients.push(res);
  lobbyClients.set(code, clients);

  req.on("close", () => {
    const activeClients = lobbyClients.get(code) || [];
    lobbyClients.set(
      code,
      activeClients.filter((client) => client !== res)
    );
  });
});

connectMongo().finally(() => {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
});

