const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { getPlayerById, getPlayers, loadPlayers } = require("./playerData");

const app = express();
app.use(cors());
app.use(express.json());
const PORT = Number(process.env.PORT) || 3000;
const dataDirectory =
  process.env.RENDER_DISK_PATH ||
  process.env.DATA_DIR ||
  __dirname;

const SERVER_VERSION = "v0.605";
const TEAM_SIZE_TARGET = 20;
const DEFAULT_SALARY_CAP = 1800;
const MAX_NEGOTIATION_ATTEMPTS = 3;
const RANDOM_EVENT_PROBABILITY = 0.2;

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
  if (mongoReady) {
    const user = await UserModel.findOne({ username }).lean();
    return user ? normalizeUser(user) : null;
  }

  const users = readUsers();
  return users.find((item) => item.username === username) || null;
};

const createStoredUser = async (username, passwordHash) => {
  if (mongoReady) {
    const createdUser = await UserModel.create({ username, password: passwordHash });
    return normalizeUser(createdUser.toObject());
  }

  const users = readUsers();
  const nextId = users.length === 0 ? 1 : Math.max(...users.map((item) => Number(item.id) || 0)) + 1;
  const nextUser = { id: nextId, username, password: passwordHash };
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

const getTeamPayload = (team) => ({
  ...team,
  salaryUsed: getTeamPayroll(team),
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

const syncStandingsWithTeams = (draft, lobby) => {
  if (!draft || !lobby) return;
  ensureCpuTeams(draft, lobby);

  const realTeams = lobby.players.map((owner) => ({
    key: owner,
    name: draft.teams[owner]?.name || owner,
    real: true,
  }));
  const size = getLeagueSize(lobby.format);
  const generatedTeams = lobby.fillCpuTeams
    ? (draft.cpuTeams || []).map((team) => ({ key: team.key, name: team.name, real: false }))
    : [];
  const allTeams = [...realTeams, ...generatedTeams].slice(
    0,
    lobby.fillCpuTeams ? size : realTeams.length
  );
  const championsLimit = lobby.champions ? Math.max(1, Math.floor(allTeams.length / 3)) : 0;
  const currentStandings = draft.standings || [];

  draft.standings = sortStandings(
    allTeams.map((team, index) => {
      const currentStanding = currentStandings.find((item) => item.key === team.key);

      return currentStanding
        ? {
            ...currentStanding,
            name: team.name,
            real: team.real,
            champions: lobby.champions && index < championsLimit,
          }
        : {
            key: team.key,
            name: team.name,
            real: team.real,
            champions: lobby.champions && index < championsLimit,
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

const appendSeasonWinnerIfNeeded = (draft) => {
  if (!draft?.standings?.length || draft.seasonWinnerAnnounced) return;

  const winner = sortStandings(draft.standings)[0];
  if (!winner) return;

  draft.seasonWinnerAnnounced = true;
  draft.news.unshift(`Liga UFL: ${winner.name} es campeon de la temporada`);
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

  const size = getLeagueSize(lobby.format);
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

const getVisibleRoundStart = (draft) => draft.visibleRoundStart || 1;

const maybeAdvanceFantasyRoundBlock = (draft, lobby) => {
  if (lobby.leagueType !== "Fantasia" || !draft.schedule?.length) return;

  const visibleRoundStart = getVisibleRoundStart(draft);
  const visibleRounds = draft.schedule.slice(visibleRoundStart - 1, visibleRoundStart + 4);
  const managerKeys = new Set(lobby.players);

  visibleRounds.forEach((roundMatches) => {
    roundMatches.forEach((match) => {
      const involvesManager =
        managerKeys.has(match.homeKey) || managerKeys.has(match.awayKey);

      if (!involvesManager && !match.played) {
        const homeName = getTeamNameByKey(draft, match.homeKey);
        const awayName = getTeamNameByKey(draft, match.awayKey);
        const simulated = simulateCpuMatchResult(homeName, awayName);
        applyStandingResult(draft, homeName, awayName, simulated.homeGoals, simulated.awayGoals);
        match.played = true;
        match.result = simulated;
        draft.leagueMatchCount = Number(draft.leagueMatchCount || 0) + 1;
        syncUnavailablePlayers(draft);
        maybeTriggerRandomEvent("fantasy-block", draft);
        draft.news.unshift(
          `Liga UFL: ${homeName} ${simulated.homeGoals}-${simulated.awayGoals} ${awayName}`
        );
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
};

const syncUnavailablePlayers = (draft) => {
  Object.values(draft.teams).forEach((team) => {
    team.squad = team.squad.map((player) => {
      if (
        player.unavailableUntilMatch &&
        Number(player.unavailableUntilMatch) <= Number(draft.leagueMatchCount || 0)
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

const maybeTriggerRandomEvent = (code, draft) => {
  if (!draft.randomEvents || Math.random() >= RANDOM_EVENT_PROBABILITY) return null;

  const teamsWithPlayers = Object.entries(draft.teams).filter(([, team]) => team.squad.length > 0);
  if (teamsWithPlayers.length === 0) return null;

  const [owner, team] = teamsWithPlayers[Math.floor(Math.random() * teamsWithPlayers.length)];
  const availablePlayers = team.squad.filter(
    (player) =>
      !player.unavailableUntilMatch ||
      Number(player.unavailableUntilMatch) <= Number(draft.leagueMatchCount || 0)
  );

  if (availablePlayers.length === 0) return null;

  const player = availablePlayers[Math.floor(Math.random() * availablePlayers.length)];
  const reason = randomEventTemplates[Math.floor(Math.random() * randomEventTemplates.length)];
  const unavailableUntilMatch = Number(draft.leagueMatchCount || 0) + 2;

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
    id: `event-${code}-${player.ID}-${Date.now()}`,
    title: `${player.Name} no estara disponible`,
    body: `${player.Name} ${reason}. Estara fuera por 2 partidos.`,
    matchUntil: unavailableUntilMatch,
    playerId: player.ID,
  };

  draft.inbox[owner].unshift(inboxItem);
  draft.news.unshift(
    `Fabrizio Romano: ${player.Name} ${reason} y sera baja de ${team.name} por 2 partidos`
  );

  return inboxItem;
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

const autoCompleteSquad = (draft, owner) => {
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
      draft.news.unshift(
        `Fabrizio Romano: ${team.name} completo plantilla con ${cheapestPlayer.Name} por ${cheapestPlayer.marketValue}M`
      );
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
    draft.news.unshift(
      `Liga UFL: ${team.name} libero a ${releasablePlayer.Name} para ajustar la plantilla`
    );
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
  if (lobby?.leagueType === "Fantasia") {
    maybeAdvanceFantasyRoundBlock(draft, lobby);
  }

  return {
    code,
    organizer: draft.organizer,
    phase: draft.phase,
    confirmedOwners: draft.confirmedOwners,
    auctionStage: draft.auctionStage,
    bidCounts: draft.bidCounts,
    teams: Object.fromEntries(
      Object.entries(draft.teams).map(([owner, team]) => [owner, getTeamPayload(team)])
    ),
    offers: draft.offers,
    pendingSignings: (draft.pendingSignings || []).map(getPendingSigningPayload),
    news: draft.news,
    leagueMatchCount: draft.leagueMatchCount || 0,
    inbox: draft.inbox || {},
    standings: draft.standings || [],
    schedule: draft.schedule || [],
    cpuTeams: draft.cpuTeams || [],
    visibleRoundStart: getVisibleRoundStart(draft),
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
      acc[owner] = {
        owner,
        name: owner,
        budget: lobby.money,
        salaryCap: lobby.salaryCap,
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
      randomEvents: lobby.randomEvents !== false,
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
      standings: [],
      schedule: [],
      visibleRoundStart: 1,
      seasonWinnerAnnounced: false,
      news: ["Seleccion principal iniciada"],
    });
  }

  syncStandingsWithTeams(drafts.get(code), lobby);
  syncFantasySchedule(drafts.get(code), lobby);
  return drafts.get(code);
};

app.get("/health", (req, res) => {
  res.json({ ok: true, version: SERVER_VERSION });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
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
  const { username, password } = req.body;

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

app.put("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;
  const storedUsers = await getStoredUsers();
  const currentUser = storedUsers.find((item) => String(item.id) === String(id));

  if (!currentUser) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }

  if (storedUsers.some((item) => item.username === username && String(item.id) !== String(id))) {
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
    money: Number(req.body.money) || 100,
    salaryCap,
    champions: Boolean(req.body.champions),
    fillCpuTeams: req.body.fillCpuTeams !== false,
    randomEvents: req.body.randomEvents !== false,
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

  res.json(getDraftPayload(code));
});

app.get("/drafts/:code/events", (req, res) => {
  const code = String(req.params.code).trim();
  const draft = ensureDraft(code);

  if (!draft) {
    return res.status(404).end();
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify(getDraftPayload(code))}\n\n`);

  const clients = draftClients.get(code) || [];
  clients.push(res);
  draftClients.set(code, clients);

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
    draft.news.unshift(`${username} confirmo su seleccion inicial`);
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
    draft.news.unshift("Todos confirmaron su seleccion. El organizador puede iniciar la subasta.");
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
  draft.news.unshift("El organizador inicio la subasta");
  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
});

app.post("/drafts/:code/bid", (req, res) => {
  const code = String(req.params.code).trim();
  const { username, playerId, amount } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);
  const player = getPlayerById(playerId);
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
  const { username, winners = [] } = req.body;
  const draft = ensureDraft(code);
  const lobby = lobbies.get(code);

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede pasar de etapa" });
  }

  winners.forEach((winner) => {
    draft.news.unshift(`Fabrizio Romano: ${winner.owner} gano a ${winner.playerName} por ${winner.amount}M`);
    const player = getPlayerById(winner.playerId);
    const team = draft.teams[winner.owner];
    if (
      player &&
      team &&
      !team.squad.some((item) => item.ID === player.ID) &&
      team.squad.length < TEAM_SIZE_TARGET
    ) {
      draft.pendingSignings.unshift({
        id: `auction-${winner.playerId}-${Date.now()}-${winner.owner}`,
        owner: winner.owner,
        type: "auction",
        player,
        amount: Number(winner.amount) || 0,
      });
      draft.news.unshift(`Liga UFL: ${team.name} debe negociar el sueldo de ${winner.playerName} para cerrar el fichaje`);
    } else if (team) {
      draft.news.unshift(`Liga UFL: ${team.name} no pudo cerrar a ${winner.playerName} por limite de plantilla`);
    }
  });

  draft.bids = [];
  draft.bidCounts = {};

  if (draft.auctionStage >= 5) {
    draft.transferWindowId += 1;
    draft.phase = "market";
    draft.news.unshift("Liga UFL: Subastas finalizadas. Mercado de transferencias abierto.");
  } else {
    draft.auctionStage += 1;
    draft.news.unshift(`Liga UFL: inicia la etapa ${draft.auctionStage + 1}/6 de subasta.`);
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

  const player = getPlayerById(playerId);
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
      if (pendingSigning?.type === "offer") {
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

        draft.pendingSignings = draft.pendingSignings.filter((signing) => signing.id !== pendingSigning.id);
        draft.news.unshift(
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
    if (pendingSigning.type === "offer") {
      const seller = draft.teams[pendingSigning.fromOwner];
      const buyer = draft.teams[pendingSigning.owner];
      const sellerOwns = seller?.squad.some((item) => item.ID === player.ID);

      if (!seller || !buyer || !sellerOwns) {
        draft.pendingSignings = draft.pendingSignings.filter((signing) => signing.id !== pendingSigning.id);
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
      draft.pendingSignings = draft.pendingSignings.filter((signing) => signing.id !== pendingSigning.id);
      draft.news.unshift(
        `Fabrizio Romano: ${player.Name} cambia de ${seller.name} a ${buyer.name} con sueldo de ${offeredSalary}k por temporada`
      );
      sendDraftUpdate(code);
      return res.json({ mode: "offer", ...getDraftPayload(code) });
    }

    if (!canAddPlayerToTeam(team, player, offeredSalary, transferAmount)) {
      return res.status(400).json({ error: "No puedes cerrar este contrato por presupuesto, masa salarial o plantilla" });
    }

    team.budget -= transferAmount;
    team.squad.push(clonePlayerForTeam(player, offeredSalary));
    draft.pendingSignings = draft.pendingSignings.filter((signing) => signing.id !== pendingSigning.id);
    draft.news.unshift(
      `Fabrizio Romano: ${team.name} cerro a ${player.Name} tras ganar la subasta, sueldo ${offeredSalary}k por temporada`
    );
    sendDraftUpdate(code);
    return res.json({ mode: "auction", ...getDraftPayload(code) });
  }

  if (!owner) {
    if (!canAddPlayerToTeam(team, player, offeredSalary, player.marketValue)) {
      return res.status(400).json({ error: "No puedes cerrar la compra por presupuesto, masa salarial o plantilla" });
    }

    team.budget -= player.marketValue;
    team.squad.push(clonePlayerForTeam(player, offeredSalary));
    draft.news.unshift(
      `Fabrizio Romano: ${team.name} cerro a ${player.Name} por ${player.marketValue}M con sueldo de ${offeredSalary}k`
    );
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

  const player = getPlayerById(playerId);
  const team = draft.teams[username];
  const alreadyOwned = findPlayerOwner(draft, playerId);

  if (!player || !team || alreadyOwned || !canAddPlayerToTeam(team, player, player.salary, player.marketValue)) {
    return res.status(400).json({ error: "No se puede comprar este jugador" });
  }

  team.budget -= player.marketValue;
  team.squad.push(clonePlayerForTeam(player, player.salary));
  draft.news.unshift(`Fabrizio Romano: ${team.name} compro a ${player.Name} por ${player.marketValue}M`);
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
  draft.news.unshift(
    `Fabrizio Romano: ${team.name} libero a ${player.Name} y recupero ${player.releaseValue || 0}M`
  );
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

  const player = getPlayerById(playerId);
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

  if (!buyer || buyer.budget < Number(amount) || buyer.squad.length >= TEAM_SIZE_TARGET) {
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
  draft.news.unshift(`Fabrizio Romano: ${from} envio oferta por ${player.Name}`);
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

    draft.news.unshift(
      `Fabrizio Romano: ${seller.name} acepto la oferta de ${buyer.name} por ${offer.player.Name}. Falta negociar el sueldo del jugador.`
    );
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
    return res.status(400).json({ error: "Todavia hay fichajes pendientes por negociar" });
  }

  Object.keys(draft.teams).forEach((owner) => {
    autoCompleteSquad(draft, owner);
  });

  draft.phase = "season";
  draft.seasonWinnerAnnounced = false;
  draft.news.unshift("Liga UFL: el periodo de transferencias termino y la liga comenzo.");
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
  syncUnavailablePlayers(draft);
  maybeTriggerRandomEvent(code, draft);
  draft.news.unshift(`Liga UFL: ${myTeamName} ${scoreA}-${scoreB} ${opponentName}`);

  teamScorers.forEach((row) => {
    draft.news.unshift(`Liga UFL: ${row.name} anoto ${row.goals} gol(es) para ${myTeamName}`);
  });
  opponentScorers.forEach((row) => {
    draft.news.unshift(`Liga UFL: ${row.name} anoto ${row.goals} gol(es) para ${opponentName}`);
  });
  draft.news.unshift(`Liga UFL: tarjetas ${myTeamName} ${teamCards} - ${opponentCards} ${opponentName}`);

  if (mvpPlayerName) {
    draft.news.unshift(`Liga UFL: jugador del partido ${mvpPlayerName}`);
  }

  const myStanding = draft.standings.find((team) => team.name === myTeamName);
  const opponentStanding = draft.standings.find((team) => team.name === opponentName);
  if (myStanding && opponentStanding) {
    markScheduleMatchPlayed(draft, myStanding.key, opponentStanding.key, {
      homeGoals: scoreA,
      awayGoals: scoreB,
    });
  }

  maybeAdvanceFantasyRoundBlock(draft, lobby);

  const totalMatches =
    lobby.leagueType === "Fantasia"
      ? draft.standings.length * Math.max(draft.standings.length - 1, 0)
      : getLeagueSize(lobby.format) * 2;

  if (draft.leagueMatchCount >= totalMatches) {
    appendSeasonWinnerIfNeeded(draft);
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

  draft.standings = sortStandings(
    draft.standings.map((team) => {
      if (team.name === cpuTeamA) {
        return { ...team, pts: team.pts + Number(cpuPointsA), played: team.played + 1 };
      }
      if (team.name === cpuTeamB) {
        return { ...team, pts: team.pts + Number(cpuPointsB), played: team.played + 1 };
      }
      return team;
    })
  );

  draft.leagueMatchCount = Number(draft.leagueMatchCount || 0) + 1;
  syncUnavailablePlayers(draft);
  maybeTriggerRandomEvent(code, draft);
  draft.news.unshift(`Liga UFL: resultado CPU cargado para ${cpuTeamA} y ${cpuTeamB}`);

  const totalMatches =
    lobby.leagueType === "Fantasia"
      ? draft.standings.length * Math.max(draft.standings.length - 1, 0)
      : getLeagueSize(lobby.format) * 2;

  if (draft.leagueMatchCount >= totalMatches) {
    appendSeasonWinnerIfNeeded(draft);
  }

  const cpuTeamAStanding = draft.standings.find((team) => team.name === cpuTeamA);
  const cpuTeamBStanding = draft.standings.find((team) => team.name === cpuTeamB);
  const derivedResult =
    Number(cpuPointsA) === Number(cpuPointsB)
      ? { homeGoals: 1, awayGoals: 1 }
      : Number(cpuPointsA) > Number(cpuPointsB)
        ? { homeGoals: 1, awayGoals: 0 }
        : { homeGoals: 0, awayGoals: 1 };

  if (cpuTeamAStanding && cpuTeamBStanding) {
    markScheduleMatchPlayed(draft, cpuTeamAStanding.key, cpuTeamBStanding.key, derivedResult);
  }

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
  draft.news.unshift(`Liga UFL: el organizador renombro un equipo CPU a ${trimmedName}`);
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
