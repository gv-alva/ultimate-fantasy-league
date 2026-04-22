const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { getPlayerById, getPlayers, loadPlayers } = require("./playerData");

const app = express();
app.use(cors());
app.use(express.json());
const PORT = Number(process.env.PORT) || 3000;

const SERVER_VERSION = "render-ready-v1";

const lobbies = new Map();
const lobbyClients = new Map();
const drafts = new Map();
const draftClients = new Map();
const usersFilePath = path.join(__dirname, "users.json");

const ensureUsersFile = () => {
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

const generateLobbyCode = () => {
  let code;

  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (lobbies.has(code));

  return code;
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
    champions: lobby.champions,
    fillCpuTeams: lobby.fillCpuTeams,
    bidTime: lobby.bidTime,
    marketTime: lobby.marketTime,
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
    teams: draft.teams,
    offers: draft.offers,
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
      teams,
      offers: [],
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
  const users = readUsers();
  const user = users.find((item) => item.username === username);

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
  const users = readUsers();

  if (!username || !password) {
    return res.status(400).json({ error: "Faltan datos del usuario" });
  }

  if (users.some((item) => item.username === username)) {
    return res.status(400).json({ error: "Usuario ya existe" });
  }

  const hash = await bcrypt.hash(password, 10);
  const nextId = users.length === 0 ? 1 : Math.max(...users.map((item) => item.id)) + 1;

  users.push({ id: nextId, username, password: hash });
  writeUsers(users);
  res.json({ message: "Usuario creado", id: nextId });
});

app.get("/users", (req, res) => {
  const users = readUsers().map(({ id, username }) => ({ id, username }));
  res.json(users);
});

app.put("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;
  const users = readUsers();
  const index = users.findIndex((item) => String(item.id) === String(id));

  if (index === -1) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }

  if (users.some((item, itemIndex) => item.username === username && itemIndex !== index)) {
    return res.status(400).json({ error: "Usuario ya existe" });
  }

  users[index].username = username;

  if (password) {
    users[index].password = await bcrypt.hash(password, 10);
  }

  writeUsers(users);
  res.json({ message: "Usuario actualizado" });
});

app.delete("/users/:id", (req, res) => {
  const { id } = req.params;
  const users = readUsers();
  const nextUsers = users.filter((item) => String(item.id) !== String(id));

  if (nextUsers.length === users.length) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }

  writeUsers(nextUsers);
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
  const bidTime = Number(req.body.bidTime) || 60;
  const marketTime = Number(req.body.marketTime) || 10;

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
    champions: Boolean(req.body.champions),
    fillCpuTeams: req.body.fillCpuTeams !== false,
    bidTime,
    marketTime,
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

  if (!draft || !lobby) {
    return res.status(404).json({ error: "Draft no encontrado" });
  }

  if (draft.phase !== "auction") {
    return res.status(400).json({ error: "La subasta no esta activa" });
  }

  if (!lobby.players.includes(username)) {
    return res.status(403).json({ error: "No perteneces a esta liga" });
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
    const player = getPlayers({ search: winner.playerName, limit: 1 })[0];
    const team = draft.teams[winner.owner];
    if (player && team && !team.squad.some((item) => item.ID === player.ID)) {
      team.squad.push(player);
      team.budget -= Number(winner.amount) || 0;
    }
  });

  draft.bids = [];
  draft.bidCounts = {};

  if (draft.auctionStage >= 5) {
    draft.phase = "market";
    draft.news.unshift("Liga UFL: Subastas finalizadas. Mercado de transferencias abierto.");
  } else {
    draft.auctionStage += 1;
    draft.news.unshift(`Liga UFL: inicia la etapa ${draft.auctionStage + 1}/6 de subasta.`);
  }

  sendDraftUpdate(code);
  res.json(getDraftPayload(code));
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
  const alreadyOwned = Object.values(draft.teams).some((item) =>
    item.squad.some((squadPlayer) => String(squadPlayer.ID) === String(playerId))
  );

  if (!player || !team || alreadyOwned || team.budget < player.marketValue) {
    return res.status(400).json({ error: "No se puede comprar este jugador" });
  }

  team.budget -= player.marketValue;
  team.squad.push(player);
  draft.news.unshift(`Fabrizio Romano: ${username} compro a ${player.Name} por ${player.marketValue}M`);
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
  draft.news.unshift(`Fabrizio Romano: ${player.Name} fue despedido y entro al mercado`);
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

  draft.offers.unshift({
    id: `${playerId}-${Date.now()}`,
    from,
    to,
    player,
    amount: Number(amount),
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

    if (!seller || !buyer || !sellerOwns || anotherTeamOwns || buyer.budget < offer.amount) {
      return res.status(400).json({ error: "No se pudo completar la oferta" });
    }

    seller.squad = seller.squad.filter((item) => item.ID !== offer.player.ID);
    seller.budget += offer.amount;
    buyer.squad.push(offer.player);
    buyer.budget -= offer.amount;
    draft.news.unshift(`Fabrizio Romano: ${offer.player.Name} cambia de ${offer.to} a ${offer.from} por ${offer.amount}M`);
  }

  offer.status = decision;
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

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
