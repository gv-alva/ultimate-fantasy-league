const fs = require("fs");
const path = require("path");

const playersCsvPath = path.join(__dirname, "data", "EAFC26-Men.csv");

let cachedPlayers = null;

const parseCsvLine = (line) => {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
};

const normalizeValue = (value) => {
  if (value === "") return null;

  const numericValue = Number(value);
  if (!Number.isNaN(numericValue) && String(numericValue) === value.trim()) {
    return numericValue;
  }

  return value;
};

const getMarketValue = (overall) => {
  const ovr = Number(overall) || 50;
  let value;

  if (ovr >= 90) value = 135 + (ovr - 90) * 35;
  else if (ovr >= 85) value = 60 + (ovr - 85) * 14;
  else if (ovr >= 80) value = 26 + (ovr - 80) * 7;
  else if (ovr >= 75) value = 9 + (ovr - 75) * 3.4;
  else if (ovr >= 70) value = 2.5 + (ovr - 70) * 1.25;
  else value = Math.max(0.3, 0.35 + (ovr - 50) * 0.11);

  return Math.round(value * 10) / 10;
};

const getWeeklySalary = (overall) => {
  const ovr = Number(overall) || 50;
  let salary;

  if (ovr >= 95) salary = 230 + (ovr - 95) * 22;
  else if (ovr >= 91) salary = 160 + (ovr - 91) * 18;
  else if (ovr >= 88) salary = 110 + (ovr - 88) * 16;
  else if (ovr >= 85) salary = 72 + (ovr - 85) * 11;
  else if (ovr >= 82) salary = 42 + (ovr - 82) * 8;
  else if (ovr >= 78) salary = 20 + (ovr - 78) * 5;
  else if (ovr >= 75) salary = 9 + (ovr - 75) * 3;
  else salary = Math.max(4, 4 + (ovr - 70) * 1.2);

  return Math.round(salary);
};

const getReleaseValue = (marketValue) => {
  return Math.round(Math.max(0.5, marketValue * 0.35) * 10) / 10;
};

const enrichPlayer = (player) => {
  const marketValue = getMarketValue(player.OVR);
  const salary = getWeeklySalary(player.OVR);

  return {
    ...player,
    Team: null,
    Club: null,
    marketValue,
    minBid: Math.round((marketValue / 2) * 10) / 10,
    salary,
    releaseValue: getReleaseValue(marketValue),
    isFreeAgent: true,
  };
};

const loadPlayers = () => {
  if (cachedPlayers) return cachedPlayers;

  const csv = fs.readFileSync(playersCsvPath, "utf8");
  const [headerLine, ...lines] = csv.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(headerLine);

  cachedPlayers = lines.map((line) => {
    const values = parseCsvLine(line);

    const player = headers.reduce((currentPlayer, header, index) => {
      currentPlayer[header] = normalizeValue(values[index] || "");
      return currentPlayer;
    }, {});

    return enrichPlayer(player);
  });

  return cachedPlayers;
};

const getPlayers = ({ limit = 100, search = "" } = {}) => {
  const normalizedSearch = search.trim().toLowerCase();
  const players = loadPlayers();

  const filteredPlayers = normalizedSearch
    ? players.filter((player) =>
        String(player.Name || "").toLowerCase().includes(normalizedSearch)
      )
    : players;

  return filteredPlayers.slice(0, limit);
};

const getPlayerById = (id) => {
  return loadPlayers().find((player) => String(player.ID) === String(id));
};

module.exports = {
  getPlayerById,
  getPlayers,
  loadPlayers,
  playersCsvPath,
};
