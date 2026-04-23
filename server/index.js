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

const SERVER_VERSION = "v0.502";
const TEAM_SIZE_TARGET = 20;
const DEFAULT_SALARY_CAP = 1800;
const MAX_NEGOTIATION_ATTEMPTS = 3;

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
  } catch (error) {
    console.warn("MongoDB no disponible, se usara users.json.", error.message);
  }
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
    money: lobby.money,
    salaryCap: lobby.salaryCap,
    champions: lobby.champions,
    fillCpuTeams: lobby.fillCpuTeams,
    players: lobby.players,
    status: lobby.status,
  };
};

const sendLobbyUpdate = (code) => {
  const payload = getLobbyPayload(code);
  const clients = lobbyClients.get(code) || [];

  clients.forEach((client) => {
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
  });
};

const getDraftPayload = (code) => {
  const draft = drafts.get(code);

  if (!draft) return null;

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
  };
};

const sendDraftUpdate = (code) => {
  const payload = getDraftPayload(code);
  const clients = draftClients.get(code) || [];

  clients.forEach((client) => {
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
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
      teams,
      offers: [],
      pendingSignings: [],
      negotiations: {},
      blockedNegotiations: {},
      news: ["Seleccion principal iniciada"],
    });
  }

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

app.post("/lobbies", (req, res) => {
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
    money: Number(req.body.money) || 100,
    salaryCap,
    champions: Boolean(req.body.champions),
    fillCpuTeams: req.body.fillCpuTeams !== false,
    players: [username],
    status: "waiting",
  });

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
      error: `${player.Name} bloqueo negociaciones contigo hasta la siguiente fecha de transferencias`,
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
    return res.status(400).json({ error: "Debes proponer un salario semanal" });
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

  const existingPendingOffer = draft.offers.find(
    (offer) =>
      offer.from === username &&
      offer.to === owner &&
      String(offer.player.ID) === String(playerId) &&
      offer.status === "pending"
  );

  if (existingPendingOffer) {
    return res.status(409).json({ error: "Ya se envio una oferta y sigue pendiente de respuesta" });
  }

  if (!canAddPlayerToTeam(team, player, offeredSalary, transferAmount)) {
    return res.status(400).json({ error: "No puedes enviar esa negociacion por presupuesto, masa salarial o plantilla" });
  }

  draft.offers.unshift({
    id: `${playerId}-${Date.now()}`,
    from: username,
    to: owner,
    player: clonePlayerForTeam(player, offeredSalary),
    amount: transferAmount,
    salary: offeredSalary,
    status: "pending",
  });
  draft.news.unshift(
    `Fabrizio Romano: ${team.name} acordo salario con ${player.Name} y envio oferta a ${draft.teams[owner]?.name || owner}`
  );
  sendDraftUpdate(code);
  res.json({ mode: "offer", ...getDraftPayload(code) });
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

  if (!player || !to || to === from) {
    return res.status(400).json({ error: "No se puede ofertar por este jugador" });
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
      !canAddPlayerToTeam(buyer, offer.player, offer.salary || offer.player.salary, offer.amount)
    ) {
      return res.status(400).json({ error: "No se pudo completar la oferta" });
    }

    seller.squad = seller.squad.filter((item) => item.ID !== offer.player.ID);
    seller.budget += offer.amount;
    buyer.squad.push(clonePlayerForTeam(offer.player, offer.salary || offer.player.salary));
    buyer.budget -= offer.amount;
    draft.news.unshift(
      `Fabrizio Romano: ${offer.player.Name} cambia de ${seller.name} a ${buyer.name} por ${offer.amount}M`
    );
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
    return res.status(400).json({ error: "Todavia hay fichajes de subasta pendientes por negociar" });
  }

  Object.keys(draft.teams).forEach((owner) => {
    autoCompleteSquad(draft, owner);
  });

  draft.phase = "season";
  draft.news.unshift("Liga UFL: el periodo de transferencias termino y la liga comenzo.");
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

app.delete("/lobbies/:code", (req, res) => {
  const code = String(req.params.code).trim();
  const { username } = req.body;
  const lobby = lobbies.get(code);

  if (!lobby) {
    return res.status(404).json({ error: "Liga no encontrada" });
  }

  if (lobby.creator !== username) {
    return res.status(403).json({ error: "Solo el organizador puede eliminar la liga" });
  }

  lobbies.delete(code);
  drafts.delete(code);
  lobbyClients.delete(code);
  draftClients.delete(code);

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
