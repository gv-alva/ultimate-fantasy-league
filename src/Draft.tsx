import { type ReactNode, useEffect, useMemo, useState } from "react";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "");
const TEAM_SIZE_TARGET = 20;

type Tab = "Inicio" | "Club" | "Tabla de liga" | "Transferencia";
type DraftPhase = "initial" | "auction" | "market";
type ServerPhase = "selection" | "dashboard" | "auction" | "market" | "season";
type PositionGroup = "POR" | "DEF" | "MED" | "EXT" | "DEL";

type Player = {
  ID: number;
  Name: string;
  OVR: number;
  Position: string;
  Age: number;
  Nation: string;
  League: string;
  PAC: number;
  SHO: number;
  PAS: number;
  DRI: number;
  DEF: number;
  PHY: number;
  marketValue: number;
  minBid: number;
  salary: number;
  salaryMin?: number;
  salaryMax?: number;
  releaseValue?: number;
  unavailableUntilMatch?: number;
  unavailableReason?: string;
  card?: string;
  [key: string]: string | number | boolean | null | undefined;
};

type Sponsor = {
  name: string;
  values: Record<string, number>;
};

type TeamState = {
  owner: string;
  name: string;
  budget: number;
  salaryCap: number;
  salaryUsed?: number;
  protectedPlayerIds?: number[];
  sponsor?: Sponsor;
  squad: Player[];
};

type CpuTeam = {
  key: string;
  name: string;
};

type ScheduleMatch = {
  id: string;
  round: number;
  homeKey: string;
  awayKey: string;
  played: boolean;
  result?: {
    homeGoals: number;
    awayGoals: number;
  } | null;
};

type Offer = {
  id: string;
  from: string;
  to: string;
  player: Player;
  amount: number;
  salary?: number;
  status: "pending" | "accepted" | "rejected";
};

type PendingSigning = {
  id: string;
  owner: string;
  type: "auction" | "offer" | "clause";
  fromOwner?: string;
  fromClub?: string;
  buyerClub?: string;
  player: Player;
  amount: number;
};

type Standing = {
  key: string;
  name: string;
  real: boolean;
  champions: boolean;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  pts: number;
};

type LeagueSettings = {
  format: string;
  leagueType: string;
  money: number;
  salaryCap: number;
  champions: boolean;
  fillCpuTeams: boolean;
  randomEvents?: boolean;
};

type InboxItem = {
  id: string;
  title: string;
  body: string;
  matchUntil?: number;
  playerId?: number;
};

type GoalEntry = {
  playerId: string;
  goals: string;
};

type Bid = {
  owner: string;
  playerId: number;
  amount: number;
};

type Props = {
  leagueCode: string;
  players: string[];
  currentUser: string;
  settings: LeagueSettings;
  onLogout: () => void;
};

type DraftEvent = {
  code: string;
  deleted?: boolean;
  organizer: string;
  phase: ServerPhase;
  confirmedOwners: string[];
  auctionStage: number;
  bidCounts: Record<string, number>;
  teams: Record<string, TeamState>;
  offers: Offer[];
  pendingSignings: PendingSigning[];
  news: string[];
  leagueMatchCount: number;
  inbox: Record<string, InboxItem[]>;
  standings: Standing[];
  schedule: ScheduleMatch[][];
  cpuTeams: CpuTeam[];
  visibleRoundStart: number;
};

const tabs: Tab[] = ["Inicio", "Club", "Tabla de liga", "Transferencia"];
const groups: PositionGroup[] = ["POR", "DEF", "MED", "EXT", "DEL"];

const groupLabels: Record<PositionGroup, string> = {
  POR: "Portero",
  DEF: "Defensa",
  MED: "Mediocampo",
  EXT: "Extremo",
  DEL: "Delantero",
};

const emptyStanding = (
  team: Pick<Standing, "key" | "name" | "real" | "champions">
): Standing => ({
  key: team.key,
  name: team.name,
  real: team.real,
  champions: team.champions,
  played: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  gf: 0,
  ga: 0,
  pts: 0,
});

const applyScheduleResultToStanding = (
  table: Map<string, Standing>,
  teamKey: string,
  goalsFor: number,
  goalsAgainst: number
) => {
  const team = table.get(teamKey);
  if (!team) return;

  const win = goalsFor > goalsAgainst ? 1 : 0;
  const draw = goalsFor === goalsAgainst ? 1 : 0;
  const loss = goalsFor < goalsAgainst ? 1 : 0;

  table.set(teamKey, {
    ...team,
    played: team.played + 1,
    wins: team.wins + win,
    draws: team.draws + draw,
    losses: team.losses + loss,
    gf: team.gf + goalsFor,
    ga: team.ga + goalsAgainst,
    pts: team.pts + (win ? 3 : draw ? 1 : 0),
  });
};

const sortLeagueStandings = (table: Standing[]) =>
  [...table].sort(
    (leftTeam, rightTeam) =>
      rightTeam.pts - leftTeam.pts ||
      (rightTeam.gf - rightTeam.ga) - (leftTeam.gf - leftTeam.ga) ||
      rightTeam.gf - leftTeam.gf ||
      leftTeam.name.localeCompare(rightTeam.name)
  );

const sponsorNames = ["Naiq", "Adibas", "Pumma", "Under Armoury", "Jordyn"];
const sponsorCategories = [
  "Ingreso por ganar",
  "Ingreso por empatar",
  "Ingreso por perder",
  "Maximo Goleador",
  "Maximo MVP",
  "Tarjetas",
];

const generatedClubNames = [
  "Atlético Prisma",
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

const visibleDetails = [
  "OVR",
  "Position",
  "Age",
  "Nation",
  "League",
  "PAC",
  "SHO",
  "PAS",
  "DRI",
  "DEF",
  "PHY",
  "Weak foot",
  "Skill moves",
  "Preferred foot",
  "Height",
  "Weight",
  "Alternative positions",
  "play style",
];

const getPlayerGroup = (position = ""): PositionGroup => {
  if (position.includes("GK")) return "POR";
  if (/(CB|LB|RB|LWB|RWB)/.test(position)) return "DEF";
  if (/(CDM|CM|CAM)/.test(position)) return "MED";
  if (/(LW|RW|LM|RM)/.test(position)) return "EXT";
  if (/(ST|CF)/.test(position)) return "DEL";
  return "MED";
};

const money = (value: number) => `${Math.round(value * 10) / 10}M`;
const salary = (value: number) => `${Math.round(value)}k`;
const salaryRange = (player: Player) => `${salary(player.salaryMin || player.salary)} a ${salary(player.salaryMax || player.salary)}`;
const clauseValue = (player: Player) => Math.round((Number(player.marketValue || 0) * 2) * 10) / 10;
const getTrainingCost = (overall: number) => {
  if (overall < 75) return 1;
  if (overall <= 80) return 2;
  if (overall <= 85) return 4;
  if (overall <= 90) return 7;
  if (overall <= 95) return 12;
  return 20;
};

const getNewsAuthor = (item: string) =>
  item.startsWith("Fabrizio Romano") ? "Fabrizio Romano" : "Liga UFL";

const getNewsText = (item: string) =>
  item.startsWith("Fabrizio Romano: ") ? item.replace("Fabrizio Romano: ", "") : item;

const getEngagement = (item: string, index: number) => ({
  likes: ((item.length * 13 + index * 17) % 900) + 80,
  reposts: ((item.length * 7 + index * 11) % 240) + 20,
});

const createSponsor = (owner: string, index: number): Sponsor => {
  const name = sponsorNames[index % sponsorNames.length];
  const winBase = 6 + ((owner.length + index) % 5);
  const drawBase = Math.max(2, winBase - (2 + (index % 2)));
  const loseBase = Math.max(1, drawBase - 2);
  const values = sponsorCategories.reduce<Record<string, number>>((acc, category, categoryIndex) => {
    if (category === "Ingreso por ganar") acc[category] = winBase;
    else if (category === "Ingreso por empatar") acc[category] = drawBase;
    else if (category === "Ingreso por perder") acc[category] = loseBase;
    else {
      const base = ((owner.length + index * 3 + categoryIndex * 2) % 7) + 1;
      acc[category] = category === "Tarjetas" ? -base : base;
    }
    return acc;
  }, {});

  return { name, values };
};

const hashNumber = (value: number) => {
  let hash = value >>> 0;
  hash ^= hash << 13;
  hash ^= hash >>> 17;
  hash ^= hash << 5;
  return hash >>> 0;
};

const hashText = (value: string) => {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash >>> 0;
};

const getPlayerWeight = (player: Player, mode: "initial" | "auction" = "initial") => {
  const overall = player.OVR;

  if (mode === "auction") {
    if (overall >= 90) return 1;
    if (overall >= 88) return 2;
    if (overall >= 85) return 4;
    if (overall >= 83) return 7;
    if (overall >= 81) return 14;
    if (overall >= 78) return 32;
    return 50;
  }

  if (overall >= 90) return 1;
  if (overall >= 88) return 2;
  if (overall >= 85) return 4;
  if (overall >= 83) return 8;
  if (overall >= 81) return 14;
  if (overall >= 78) return 28;
  return 40;
};

const weightedPick = (
  items: Player[],
  used: Set<number>,
  offset: number,
  mode: "initial" | "auction" = "initial"
) => {
  const candidates = items
    .filter((player) => !used.has(player.ID))
    .sort((leftPlayer, rightPlayer) => {
      const leftHash = hashNumber(leftPlayer.ID + offset * 31);
      const rightHash = hashNumber(rightPlayer.ID + offset * 31);
      return leftHash - rightHash;
    });

  if (candidates.length === 0) return null;

  const totalWeight = candidates.reduce((sum, player) => sum + getPlayerWeight(player, mode), 0);
  let target = (hashNumber(offset * 997 + candidates.length * 17) % Math.max(totalWeight, 1)) + 1;

  for (const player of candidates) {
    target -= getPlayerWeight(player, mode);
    if (target <= 0) {
      return player;
    }
  }

  return candidates[candidates.length - 1];
};

const fillSlots = (
  candidates: Player[],
  used: Set<number>,
  count: number,
  offset: number,
  mode: "initial" | "auction" = "initial"
) => {
  const picked: Player[] = [];

  while (picked.length < count) {
    const nextPlayer = weightedPick(candidates, used, offset + picked.length * 11, mode);
    if (!nextPlayer) break;
    picked.push(nextPlayer);
    used.add(nextPlayer.ID);
  }

  return picked;
};

const pickUltraRarePlayer = (
  items: Player[],
  used: Set<number>,
  seed: string
) => {
  const candidates = items.filter((player) => !used.has(player.ID));

  if (candidates.length === 0) return null;

  const sortedCandidates = [...candidates].sort((leftPlayer, rightPlayer) => {
    const leftHash = hashNumber(leftPlayer.ID + hashText(`${seed}:${leftPlayer.Position}`));
    const rightHash = hashNumber(rightPlayer.ID + hashText(`${seed}:${rightPlayer.Position}`));
    return leftHash - rightHash;
  });
  const index = hashText(seed) % sortedCandidates.length;
  return sortedCandidates[index] || sortedCandidates[0] || null;
};

const buildInitialPicks = (
  pool: Player[],
  owners: string[],
  leagueSeed: string
): Record<string, Record<PositionGroup, Player[]>> => {
  const eligiblePool = pool.filter((player) => player.OVR >= 75);
  const used = new Set<number>();
  const nextPicks: Record<string, Record<PositionGroup, Player[]>> = {};

  owners.forEach((owner, ownerIndex) => {
    nextPicks[owner] = {} as Record<PositionGroup, Player[]>;
    const ultraRarePlayer = pickUltraRarePlayer(
      eligiblePool.filter((player) => player.OVR >= 88),
      used,
      `${leagueSeed}:${owner}:${ownerIndex}:ultra`
    );
    if (ultraRarePlayer) used.add(ultraRarePlayer.ID);
    const ultraRareGroup = ultraRarePlayer ? getPlayerGroup(ultraRarePlayer.Position) : null;

    groups.forEach((group, groupIndex) => {
      const baseCandidates = eligiblePool.filter(
        (player) =>
          getPlayerGroup(player.Position) === group &&
          !used.has(player.ID) &&
          player.OVR <= 84
      );
      const nextGroupPicks = fillSlots(
        baseCandidates,
        used,
        3,
        hashText(`${leagueSeed}:${owner}:${group}:${groupIndex}`),
        "initial"
      );
      const shouldInjectUltraRare =
        ultraRarePlayer &&
        group === ultraRareGroup &&
        nextGroupPicks.length > 0;

      if (shouldInjectUltraRare) {
        nextGroupPicks.pop();
        nextGroupPicks.unshift(ultraRarePlayer);
      }
      nextPicks[owner][group] = nextGroupPicks;
    });
  });

  return nextPicks;
};

const buildAuctionStages = (pool: Player[], leagueSeed: string) => {
  const eligiblePool = pool.filter((player) => player.OVR >= 75);
  const used = new Set<number>();

  return Array.from({ length: 6 }, (_, stageIndex) => {
    const highCandidates = eligiblePool.filter(
      (player) => !used.has(player.ID) && player.OVR >= 85
    );
    const lowCandidates = eligiblePool.filter(
      (player) => !used.has(player.ID) && player.OVR >= 80 && player.OVR <= 84
    );

    const highPlayers = fillSlots(
      highCandidates,
      used,
      3,
      hashText(`${leagueSeed}:auction-high:${stageIndex}`),
      "auction"
    );
    const lowPlayers = fillSlots(
      lowCandidates,
      used,
      7,
      hashText(`${leagueSeed}:auction-low:${stageIndex}`),
      "auction"
    );

    return [...highPlayers, ...lowPlayers].sort((leftPlayer, rightPlayer) => {
      const leftHash = hashNumber(leftPlayer.ID + hashText(`${leagueSeed}:${stageIndex}:mix`));
      const rightHash = hashNumber(rightPlayer.ID + hashText(`${leagueSeed}:${stageIndex}:mix`));
      return leftHash - rightHash;
    });
  });
};

const decorateTeams = (
  nextTeams: Record<string, TeamState>,
  owners: string[],
  moneyBudget: number,
  salaryCap: number
) =>
  owners.reduce<Record<string, TeamState>>((acc, owner, ownerIndex) => {
    const currentTeam = nextTeams[owner];

    acc[owner] = {
      owner,
      name: currentTeam?.name || owner,
      budget: currentTeam?.budget ?? moneyBudget,
      salaryCap: currentTeam?.salaryCap ?? salaryCap,
      salaryUsed:
        currentTeam?.salaryUsed ??
        currentTeam?.squad?.reduce((sum, player) => sum + (Number(player.salary) || 0), 0) ??
        0,
      sponsor: currentTeam?.sponsor || createSponsor(owner, ownerIndex),
      squad: currentTeam?.squad || [],
      protectedPlayerIds: currentTeam?.protectedPlayerIds || [],
    };

    return acc;
  }, {});

export default function Draft({ leagueCode, players, currentUser, settings, onLogout }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("Inicio");
  const [clubView, setClubView] = useState<"plantilla" | "training" | "sponsor">("plantilla");
  const [phase, setPhase] = useState<DraftPhase>("initial");
  const [serverPhase, setServerPhase] = useState<ServerPhase>("selection");
  const [organizer, setOrganizer] = useState("");
  const [pool, setPool] = useState<Player[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Player[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [initialPicks, setInitialPicks] = useState<Record<string, Record<PositionGroup, Player[]>>>({});
  const [selectionState, setSelectionState] = useState<Record<PositionGroup, number | null>>({
    POR: null,
    DEF: null,
    MED: null,
    EXT: null,
    DEL: null,
  });
  const [teams, setTeams] = useState<Record<string, TeamState>>({});
  const [confirmedOwners, setConfirmedOwners] = useState<string[]>([]);
  const [auctionStage, setAuctionStage] = useState(0);
  const [auctionOptions, setAuctionOptions] = useState<Player[][]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [bidCounts, setBidCounts] = useState<Record<string, number>>({});
  const [news, setNews] = useState<string[]>([]);
  const [offerView, setOfferView] = useState<"recibidas" | "enviadas">("recibidas");
  const [offers, setOffers] = useState<Offer[]>([]);
  const [pendingSignings, setPendingSignings] = useState<PendingSigning[]>([]);
  const [leagueMatchCount, setLeagueMatchCount] = useState(0);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [inbox, setInbox] = useState<Record<string, InboxItem[]>>({});
  const [showInbox, setShowInbox] = useState(false);
  const [showResultForm, setShowResultForm] = useState(false);
  const [showCpuForm, setShowCpuForm] = useState(false);
  const [showCpuRenameForm, setShowCpuRenameForm] = useState(false);
  const [clubName, setClubName] = useState("");
  const [opponentName, setOpponentName] = useState("");
  const [goalsFor, setGoalsFor] = useState("0");
  const [goalsAgainst, setGoalsAgainst] = useState("0");
  const [teamScorers, setTeamScorers] = useState<GoalEntry[]>([{ playerId: "", goals: "1" }]);
  const [opponentScorers, setOpponentScorers] = useState<GoalEntry[]>([{ playerId: "", goals: "1" }]);
  const [teamCards, setTeamCards] = useState("0");
  const [opponentCards, setOpponentCards] = useState("0");
  const [mvpPlayerId, setMvpPlayerId] = useState("");
  const [cpuTeamA, setCpuTeamA] = useState("");
  const [cpuTeamB, setCpuTeamB] = useState("");
  const [cpuPointsA, setCpuPointsA] = useState("3");
  const [cpuPointsB, setCpuPointsB] = useState("0");
  const [schedule, setSchedule] = useState<ScheduleMatch[][]>([]);
  const [cpuTeams, setCpuTeams] = useState<CpuTeam[]>([]);
  const [tableView, setTableView] = useState<"tabla" | "partidos">("tabla");
  const [visibleRoundStart, setVisibleRoundStart] = useState(1);

  useEffect(() => {
    setInitialPicks({});
    setAuctionOptions([]);
    setSelectedPlayer(null);
    setNews([]);
    setStandings([]);
    setSchedule([]);
    setInbox({});
    setTeams({});
    setOffers([]);
    setPendingSignings([]);
    setLeagueMatchCount(0);
    setActiveTab("Inicio");
    setClubView("plantilla");
    setOrganizer("");
    setServerPhase("selection");
    setConfirmedOwners([]);
    setShowCpuForm(false);
    setShowCpuRenameForm(false);
  }, [leagueCode]);

  useEffect(() => {
    let cancelled = false;
    const events = new EventSource(`${API_URL}/drafts/${leagueCode}/events`);

    events.onmessage = (event) => {
      const draft: DraftEvent = JSON.parse(event.data);

       if (cancelled || draft.code !== leagueCode) {
        return;
      }

      if (draft.deleted) {
        window.alert("La liga fue eliminada por el organizador");
        onLogout();
        return;
      }

      setServerPhase(draft.phase);
      setOrganizer(draft.organizer);
      setConfirmedOwners(draft.confirmedOwners || []);
      setAuctionStage(draft.auctionStage || 0);
      setBidCounts(draft.bidCounts || {});
      setTeams((currentTeams) => {
        const nextTeams = decorateTeams(draft.teams || {}, players, settings.money, settings.salaryCap);
        const incomingCurrentTeam = nextTeams[currentUser];
        const localCurrentTeam = currentTeams[currentUser];
        const currentUserConfirmed = (draft.confirmedOwners || []).includes(currentUser);

        if (
          !currentUserConfirmed &&
          localCurrentTeam &&
          localCurrentTeam.squad.length > 0 &&
          incomingCurrentTeam &&
          incomingCurrentTeam.squad.length === 0
        ) {
          nextTeams[currentUser] = {
            ...incomingCurrentTeam,
            name: localCurrentTeam.name,
            squad: localCurrentTeam.squad,
          };
        }

        return nextTeams;
      });
      setOffers(draft.offers || []);
      setPendingSignings(draft.pendingSignings || []);
      setNews(draft.news || []);
      setLeagueMatchCount(draft.leagueMatchCount || 0);
      setInbox(draft.inbox || {});
      setStandings(draft.standings || []);
      setSchedule(draft.schedule || []);
      setCpuTeams(draft.cpuTeams || []);
      setVisibleRoundStart(draft.visibleRoundStart || 1);

      if (draft.phase === "dashboard") {
        setPhase("initial");
        setActiveTab("Inicio");
      }

      if (draft.phase === "auction") {
        setPhase("auction");
        setActiveTab("Transferencia");
      }

      if (draft.phase === "market") {
        setPhase("market");
        setActiveTab("Transferencia");
      }

      if (draft.phase === "season") {
        setPhase("initial");
        setActiveTab("Inicio");
      }
    };

    events.onerror = () => {
      events.close();
    };

    return () => {
      cancelled = true;
      events.close();
    };
  }, [leagueCode, players, settings.money, currentUser]);

  useEffect(() => {
    const nextTeam = teams[currentUser];

    if (nextTeam?.name && nextTeam.name !== currentUser) {
      setClubName(nextTeam.name);
    }

    if (nextTeam) {
      setSelectionState({
        POR: nextTeam.squad.find((item) => getPlayerGroup(item.Position) === "POR")?.ID || null,
        DEF: nextTeam.squad.find((item) => getPlayerGroup(item.Position) === "DEF")?.ID || null,
        MED: nextTeam.squad.find((item) => getPlayerGroup(item.Position) === "MED")?.ID || null,
        EXT: nextTeam.squad.find((item) => getPlayerGroup(item.Position) === "EXT")?.ID || null,
        DEL: nextTeam.squad.find((item) => getPlayerGroup(item.Position) === "DEL")?.ID || null,
      });
    }
  }, [teams, currentUser]);

  useEffect(() => {
    fetch(`${API_URL}/players?limit=1200`)
      .then((res) => res.json())
      .then((data) => setPool(data.players || []))
      .catch(() => setPool([]));
  }, []);

  useEffect(() => {
    if (pool.length === 0 || players.length === 0) return;

    setInitialPicks((currentInitialPicks) => {
      if (players.every((owner) => currentInitialPicks[owner])) {
        return currentInitialPicks;
      }

      return buildInitialPicks(pool, players, leagueCode);
    });

    setTeams((currentTeams) => decorateTeams(currentTeams, players, settings.money, settings.salaryCap));
  }, [pool, players, settings.money, settings.salaryCap, leagueCode]);

  useEffect(() => {
    const query = search.trim();
    const leagueSize = settings.format === "Pequena" ? 8 : settings.format === "Corta" ? 10 : 20;
    const totalMatches = leagueSize * 2;
    const halfSeasonMatch = Math.floor(totalMatches / 2);
    const windowOpen = phase === "market" || leagueMatchCount === 0 || leagueMatchCount === halfSeasonMatch;

    if (!windowOpen || query.length < 2) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    fetch(`${API_URL}/players?search=${encodeURIComponent(query)}&limit=40`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data) => {
        const ownerMap = new Map<number, string>();
        Object.values(teams).forEach((team) => {
          team.squad.forEach((player) => ownerMap.set(player.ID, team.owner));
        });

        setResults((data.players || []).filter((player: Player) => ownerMap.get(player.ID) !== currentUser));
      })
      .catch(() => setResults([]));

    return () => controller.abort();
  }, [search, phase, teams, currentUser, leagueMatchCount, settings.format]);

  useEffect(() => {
    if (pool.length === 0 || auctionOptions.length > 0) return;

    setAuctionOptions(buildAuctionStages(pool, leagueCode));
  }, [pool, auctionOptions.length, leagueCode]);

  const leagueTeams = useMemo(() => {
    const realTeams = players.map((player) => ({
      key: player,
      name: teams[player]?.name || player,
      real: true,
    }));
    const size = settings.format === "Pequena" ? 8 : settings.format === "Corta" ? 10 : 20;
    const serverCpuTeams = cpuTeams.map((team) => ({
      key: team.key,
      name: team.name,
      real: false,
    }));
    const fallbackCpuTeams = generatedClubNames
      .filter((name) => !realTeams.some((team) => team.name === name))
      .slice(0, Math.max(size - realTeams.length, 0))
      .map((name, index) => ({ key: `cpu-${index + 1}`, name, real: false }));
    const generated = settings.fillCpuTeams
      ? (serverCpuTeams.length > 0 ? serverCpuTeams : fallbackCpuTeams)
      : [];
    const allTeams = [...realTeams, ...generated].slice(
      0,
      settings.fillCpuTeams ? size : realTeams.length
    );
    const championsLimit = Math.max(1, Math.floor(allTeams.length / 3));

    return allTeams.map((team, index) => ({
      ...team,
      champions: settings.champions && index < championsLimit,
    }));
  }, [cpuTeams, players, settings.champions, settings.fillCpuTeams, settings.format, teams]);

  useEffect(() => {
    if (leagueTeams.length === 0) return;

    setStandings((currentStandings) => {
      if (currentStandings.length === 0) {
        return leagueTeams.map((team) => ({
          key: team.key,
          name: team.name,
          real: team.real,
          champions: team.champions,
          played: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          gf: 0,
          ga: 0,
          pts: 0,
        }));
      }

      return leagueTeams.map((team) => {
        const currentStanding = currentStandings.find((item) => item.key === team.key);

        return currentStanding
          ? {
              ...currentStanding,
              name: team.name,
              real: team.real,
              champions: team.champions,
            }
          : {
              key: team.key,
              name: team.name,
              real: team.real,
              champions: team.champions,
              played: 0,
              wins: 0,
              draws: 0,
              losses: 0,
              gf: 0,
              ga: 0,
              pts: 0,
            };
      });
    });
  }, [leagueTeams]);

  const scheduleDerivedStandings = useMemo(() => {
    if (settings.leagueType !== "Fantasia" || leagueTeams.length === 0) {
      return standings;
    }

    const table = new Map<string, Standing>(
      leagueTeams.map((team) => [team.key, emptyStanding(team)])
    );

    schedule.flat().forEach((match) => {
      if (!match.played || !match.result) return;

      applyScheduleResultToStanding(
        table,
        match.homeKey,
        Number(match.result.homeGoals) || 0,
        Number(match.result.awayGoals) || 0
      );
      applyScheduleResultToStanding(
        table,
        match.awayKey,
        Number(match.result.awayGoals) || 0,
        Number(match.result.homeGoals) || 0
      );
    });

    return sortLeagueStandings([...table.values()]);
  }, [leagueTeams, schedule, settings.leagueType, standings]);

  const currentTeam = teams[currentUser];
  const hasConfirmed = confirmedOwners.includes(currentUser);
  const isOrganizer = currentUser === organizer;
  const currentAuctionPlayers = auctionOptions[auctionStage] || [];
  const displayStandings = settings.leagueType === "Fantasia" ? scheduleDerivedStandings : standings;
  const managerMatchCount = settings.leagueType === "Fantasia"
    ? schedule
        .flat()
        .filter(
          (match) =>
            match.played &&
            match.result &&
            (players.includes(match.homeKey) || players.includes(match.awayKey))
        ).length
    : leagueMatchCount;
  const totalSeasonMatches =
    settings.leagueType === "Fantasia"
      ? displayStandings.length * Math.max(displayStandings.length - 1, 0)
      : leagueTeams.length * 2;
  const midSeasonMatch = Math.floor(totalSeasonMatches / 2);
  const transferWindowOpen =
    phase === "market" || leagueMatchCount === 0 || leagueMatchCount === midSeasonMatch;
  const playerOwners = new Map<number, string>();
  Object.values(teams).forEach((team) => {
    team.squad.forEach((player) => playerOwners.set(player.ID, team.owner));
  });
  const isProtectedPlayer = (owner: string | undefined, playerId: number) =>
    owner ? (teams[owner]?.protectedPlayerIds || []).some((id) => Number(id) === Number(playerId)) : false;
  const protectedCount = (currentTeam?.protectedPlayerIds || []).length;
  const pendingReceived = offers.filter(
    (offer) => offer.to === currentUser && offer.status === "pending"
  ).length;
  const myPendingSignings = pendingSignings.filter((signing) => signing.owner === currentUser);
  const myInbox = inbox[currentUser] || [];
  const currentPayroll =
    currentTeam?.salaryUsed ??
    currentTeam?.squad.reduce((sum, player) => sum + (Number(player.salary) || 0), 0) ??
    0;
  const currentTeamPlayers = currentTeam?.squad || [];
  const opponentTeam = Object.values(teams).find((team) => team.name === opponentName);
  const opponentIsManager = Boolean(opponentTeam && players.includes(opponentTeam.owner));
  const opponentPlayers = opponentIsManager ? opponentTeam?.squad || [] : [];
  const mvpOptions = opponentIsManager
    ? [...currentTeamPlayers, ...opponentPlayers]
    : currentTeamPlayers;
  const standingsNameByKey = new Map(displayStandings.map((team) => [team.key, team.name]));
  cpuTeams.forEach((team) => standingsNameByKey.set(team.key, team.name));
  const visibleRounds = settings.leagueType === "Fantasia"
    ? schedule.slice(visibleRoundStart - 1, visibleRoundStart + 4)
    : [];

  const getPlayerStatusLabel = (player: Player) => {
    const owner = playerOwners.get(player.ID);
    const matchesRemaining = player.unavailableUntilMatch
      ? Math.max(0, Number(player.unavailableUntilMatch) - leagueMatchCount)
      : 0;

    if (matchesRemaining > 0) {
      return `No disponible ${matchesRemaining} partido(s)`;
    }

    if (!owner) return "Agente libre";
    if (owner === currentUser) return "Tu club";
    return `Club: ${teams[owner]?.name || owner}`;
  };

  const updateGoalRow = (
    team: "mine" | "opponent",
    index: number,
    field: "playerId" | "goals",
    value: string
  ) => {
    const setter = team === "mine" ? setTeamScorers : setOpponentScorers;
    setter((currentRows) =>
      currentRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row
      )
    );
  };

  const addGoalRow = (team: "mine" | "opponent") => {
    const setter = team === "mine" ? setTeamScorers : setOpponentScorers;
    setter((currentRows) => [...currentRows, { playerId: "", goals: "1" }]);
  };

  const removeGoalRow = (team: "mine" | "opponent", index: number) => {
    const setter = team === "mine" ? setTeamScorers : setOpponentScorers;
    setter((currentRows) =>
      currentRows.length === 1
        ? [{ playerId: "", goals: "1" }]
        : currentRows.filter((_, rowIndex) => rowIndex !== index)
    );
  };

  const normalizeGoalEntries = (rows: GoalEntry[], playerOptions: Player[]) =>
    rows
      .filter((row) => row.playerId)
      .map((row) => {
        const player = playerOptions.find((item) => String(item.ID) === String(row.playerId));
        return player
          ? {
              name: player.Name,
              goals: Math.max(1, Number(row.goals) || 1),
            }
          : null;
      })
      .filter(Boolean) as Array<{ name: string; goals: number }>;

  const negotiateSalaryWithPlayer = async (
    player: Player,
    transferAmount = 0,
    mode: "buy" | "offer" | "auction" | "clause" = "buy"
  ) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const offerText = window.prompt(
        `${player.Name} quiere escuchar tu propuesta. Sueldo aproximado por temporada entre ${salaryRange(player)}. Intento ${attempt}/3`
      );

      if (!offerText) return false;

      const offeredSalary = Number(offerText);

      if (Number.isNaN(offeredSalary) || offeredSalary <= 0) {
        alert("Escribe un salario valido");
        continue;
      }

      const response = await fetch(`${API_URL}/drafts/${leagueCode}/negotiate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: currentUser,
          playerId: player.ID,
          amount: transferAmount,
          salary: offeredSalary,
          mode,
        }),
      });

      if (response.ok) {
        return true;
      }

      const errorData = await response.json().catch(() => null);
      alert(errorData?.error || "No se pudo cerrar la negociacion");

      if (!errorData?.attemptsLeft) {
        return false;
      }
    }

    return false;
  };

  const pickInitialPlayer = (group: PositionGroup, player: Player) => {
    if (!currentTeam || hasConfirmed) return;

    setSelectionState((currentSelectionState) => ({
      ...currentSelectionState,
      [group]: player.ID,
    }));

    setTeams((currentTeams) => ({
      ...currentTeams,
      [currentUser]: {
        ...currentTeams[currentUser],
        squad: [
          ...currentTeams[currentUser].squad.filter((item) => getPlayerGroup(item.Position) !== group),
          { ...player, releaseValue: 0 },
        ],
      },
    }));
  };

  const removeInitialPlayer = (group: PositionGroup) => {
    if (!currentTeam || hasConfirmed) return;

    setSelectionState((currentSelectionState) => ({
      ...currentSelectionState,
      [group]: null,
    }));

    setTeams((currentTeams) => ({
      ...currentTeams,
      [currentUser]: {
        ...currentTeams[currentUser],
        squad: [
          ...currentTeams[currentUser].squad,
        ].filter((item) => getPlayerGroup(item.Position) !== group),
      },
    }));
  };

  const confirmTeam = async () => {
    if (!currentTeam || currentTeam.squad.length < groups.length) {
      alert("Elige una opcion por posicion antes de confirmar");
      return;
    }
    if (!clubName.trim()) {
      alert("Escribe el nombre de tu club");
      return;
    }

    const res = await fetch(`${API_URL}/drafts/${leagueCode}/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
        teamName: clubName.trim(),
        squad: currentTeam.squad.map((player) => player.ID),
      }),
    });

    if (!res.ok) {
      alert("No se pudo confirmar tu seleccion");
    }
  };

  const startAuction = async () => {
    const res = await fetch(`${API_URL}/drafts/${leagueCode}/start-auction`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: currentUser }),
    });

    if (!res.ok) {
      alert("Aun no se puede iniciar la subasta");
    }
  };

  const placeBid = async (player: Player) => {
    const amountText = window.prompt(`Puja minima: ${money(player.minBid)}. Escribe tu puja en millones:`);
    const amount = Number(amountText);

    if (!amountText) return;
    if (!currentTeam || amount > currentTeam.budget) {
      alert("No tienes suficiente presupuesto");
      return;
    }
    if (amount < player.minBid) {
      alert("La puja debe ser minimo la mitad del valor de mercado");
      return;
    }

    setBids((current) => [
      ...current.filter((bid) => !(bid.owner === currentUser && bid.playerId === player.ID)),
      { owner: currentUser, playerId: player.ID, amount },
    ]);

    const res = await fetch(`${API_URL}/drafts/${leagueCode}/bid`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
        playerId: player.ID,
        amount,
      }),
    });

    if (!res.ok) {
      alert("No se pudo registrar la puja");
    }
  };

  const resolveAuctionStage = async () => {
    const winners = currentAuctionPlayers.flatMap((player) => {
      const playerBids = bids
        .filter((bid) => bid.playerId === player.ID)
        .sort((a, b) => b.amount - a.amount);
      const winner = playerBids[0];
      return winner ? [{ player, winner }] : [];
    });

    setBids([]);

    const res = await fetch(`${API_URL}/drafts/${leagueCode}/next-stage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
        winners: winners.map(({ player, winner }) => ({
          owner: winner.owner,
          playerId: player.ID,
          playerName: player.Name,
          amount: winner.amount,
        })),
      }),
    });

    if (!res.ok) {
      alert("Solo el organizador puede pasar de etapa");
    }
  };

  const buyPlayer = async (player: Player) => {
    if (!currentTeam) return;
    if (currentTeam.budget < player.marketValue) {
      alert("No tienes suficiente presupuesto");
      return;
    }
    if ((currentTeam.squad?.length || 0) >= TEAM_SIZE_TARGET) {
      alert(`Tu plantilla ya llego al limite de ${TEAM_SIZE_TARGET} jugadores`);
      return;
    }
    const success = await negotiateSalaryWithPlayer(player, 0, "buy");
    if (success) setSelectedPlayer(null);
  };

  const releasePlayer = async (player: Player) => {
    const res = await fetch(`${API_URL}/drafts/${leagueCode}/release`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: currentUser, playerId: player.ID }),
    });

    if (!res.ok) {
      alert("No se pudo despedir este jugador");
    }
  };

  const sendOffer = async (player: Player) => {
    const owner = playerOwners.get(player.ID);

    if (!owner || owner === currentUser) return;

    const amountText = window.prompt("Escribe tu oferta en millones:");
    const amount = Number(amountText);

    if (!amountText) return;
    if (!currentTeam || amount <= 0 || amount > currentTeam.budget) {
      alert("Oferta invalida o sin presupuesto");
      return;
    }

    const res = await fetch(`${API_URL}/drafts/${leagueCode}/offers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: currentUser,
        playerId: player.ID,
        amount,
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      alert(errorData?.error || "No se pudo enviar la oferta");
      return;
    }

    alert("Oferta enviada al otro manager");
  };

  const payClause = async (player: Player) => {
    const owner = playerOwners.get(player.ID);

    if (!owner || owner === currentUser) return;
    if (!currentTeam || currentTeam.budget < clauseValue(player)) {
      alert("No tienes presupuesto para pagar la clausula");
      return;
    }
    if ((currentTeam.squad?.length || 0) >= TEAM_SIZE_TARGET) {
      alert(`Tu plantilla ya llego al limite de ${TEAM_SIZE_TARGET} jugadores`);
      return;
    }

    const res = await fetch(`${API_URL}/drafts/${leagueCode}/pay-clause`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
        playerId: player.ID,
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      alert(errorData?.error || "No se pudo pagar la clausula");
      return;
    }

    const success = await negotiateSalaryWithPlayer(player, clauseValue(player), "clause");
    if (success) setSelectedPlayer(null);
  };

  const toggleProtection = async (player: Player, protect: boolean) => {
    const res = await fetch(`${API_URL}/drafts/${leagueCode}/protection`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
        playerId: player.ID,
        action: protect ? "protect" : "unprotect",
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      alert(errorData?.error || "No se pudo actualizar el blindaje");
      return;
    }

    const payload = (await res.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      setTeams((currentTeams) => {
        const nextTeams = decorateTeams(payload.teams || {}, players, settings.money, settings.salaryCap);
        const incomingCurrentTeam = nextTeams[currentUser];
        const localCurrentTeam = currentTeams[currentUser];

        if (incomingCurrentTeam && localCurrentTeam?.name && !incomingCurrentTeam.name) {
          nextTeams[currentUser] = {
            ...incomingCurrentTeam,
            name: localCurrentTeam.name,
          };
        }

        return nextTeams;
      });
      setNews(payload.news || []);
      setInbox(payload.inbox || {});
      setPendingSignings(payload.pendingSignings || []);
      setOffers(payload.offers || []);
      return;
    }

    setTeams((currentTeams) => {
      const currentTeamState = currentTeams[currentUser];
      if (!currentTeamState) return currentTeams;

      const currentProtectedIds = currentTeamState.protectedPlayerIds || [];
      return {
        ...currentTeams,
        [currentUser]: {
          ...currentTeamState,
          protectedPlayerIds: protect
            ? [...currentProtectedIds.filter((id) => Number(id) !== Number(player.ID)), player.ID]
            : currentProtectedIds.filter((id) => Number(id) !== Number(player.ID)),
        },
      };
    });
  };

  const finishTransferWindow = async () => {
    const res = await fetch(`${API_URL}/drafts/${leagueCode}/start-season`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: currentUser }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      alert(errorData?.error || "No se pudo iniciar la liga");
    }
  };

  const handleOfferDecision = async (offerId: string, decision: "accepted" | "rejected") => {
    const res = await fetch(`${API_URL}/drafts/${leagueCode}/offers/${offerId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ decision }),
    });

    if (!res.ok) {
      alert("No se pudo procesar la oferta");
    }
  };

  const submitManagerResult = async () => {
    if (!opponentName) {
      alert("Selecciona rival");
      return;
    }

    const myGoals = Number(goalsFor) || 0;
    const rivalGoals = Number(goalsAgainst) || 0;
    const myGoalEntries = normalizeGoalEntries(teamScorers, currentTeamPlayers);
    const rivalGoalEntries = normalizeGoalEntries(opponentScorers, opponentPlayers);
    const myGoalCount = myGoalEntries.reduce((sum, row) => sum + row.goals, 0);
    const rivalGoalCount = rivalGoalEntries.reduce((sum, row) => sum + row.goals, 0);

    if (myGoalCount > myGoals) {
      alert("Tus goleadores no pueden sumar mas goles que tu marcador");
      return;
    }

    if (rivalGoalCount > rivalGoals) {
      alert("Los goleadores del rival no pueden sumar mas goles que su marcador");
      return;
    }

    if (myGoals === 0 && myGoalEntries.length > 0) {
      alert("Si el marcador es 0 no puedes agregar goleadores");
      return;
    }

    if (rivalGoals === 0 && rivalGoalEntries.length > 0) {
      alert("Si el rival hizo 0 no puedes agregar goleadores para ese lado");
      return;
    }

    const response = await fetch(`${API_URL}/drafts/${leagueCode}/results`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
        opponentName,
        goalsFor: myGoals,
        goalsAgainst: rivalGoals,
        teamScorers: myGoalEntries,
        opponentScorers: rivalGoalEntries,
        teamCards: Number(teamCards) || 0,
        opponentCards: Number(opponentCards) || 0,
        mvpPlayerName:
          mvpOptions.find((player) => String(player.ID) === String(mvpPlayerId))?.Name || "",
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      alert(errorData?.error || "No se pudo guardar el resultado");
      return;
    }

    setShowResultForm(false);
    setOpponentName("");
    setGoalsFor("0");
    setGoalsAgainst("0");
    setTeamScorers([{ playerId: "", goals: "1" }]);
    setOpponentScorers([{ playerId: "", goals: "1" }]);
    setTeamCards("0");
    setOpponentCards("0");
    setMvpPlayerId("");
  };

  const submitCpuResult = async () => {
    if (!cpuTeamA || !cpuTeamB || cpuTeamA === cpuTeamB) {
      alert("Selecciona dos equipos CPU distintos");
      return;
    }

    const response = await fetch(`${API_URL}/drafts/${leagueCode}/cpu-result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
        cpuTeamA,
        cpuTeamB,
        cpuPointsA: Number(cpuPointsA),
        cpuPointsB: Number(cpuPointsB),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      alert(errorData?.error || "No se pudo guardar el resultado CPU");
      return;
    }

    setShowCpuForm(false);
    setCpuTeamA("");
    setCpuTeamB("");
    setCpuPointsA("3");
    setCpuPointsB("0");
  };

  const renameCpuTeam = async (teamKey: string, currentName: string) => {
    const nextName = window.prompt("Nuevo nombre del equipo CPU:", currentName);

    if (!nextName || !nextName.trim()) return;

    const response = await fetch(`${API_URL}/drafts/${leagueCode}/cpu-team-name`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
        teamKey,
        name: nextName.trim(),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      alert(errorData?.error || "No se pudo renombrar el equipo CPU");
      return;
    }
  };

  const trainPlayer = async (player: Player) => {
    const response = await fetch(`${API_URL}/drafts/${leagueCode}/train`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
        playerId: player.ID,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      alert(errorData?.error || "No se pudo entrenar al jugador");
    }
  };

  const getTrainingLabel = (player: Player) => {
    if (Number(player.OVR) < 75) {
      return `Entrena hasta 75 por ${money(getTrainingCost(Number(player.OVR)))}`;
    }

    return `Sube +1 por ${money(getTrainingCost(Number(player.OVR)))}`;
  };

  const renderPlayerCard = (player: Player, action?: ReactNode) => (
    <article className={`mini-player-card ${isProtectedPlayer(playerOwners.get(player.ID), player.ID) ? "protected" : ""}`} key={player.ID} onClick={() => setSelectedPlayer(player)}>
      {player.card && <img src={player.card} alt={player.Name} />}
      <div className="mini-player-content">
        <div className="mini-player-topline">
          <strong>{player.Name}</strong>
          {isProtectedPlayer(playerOwners.get(player.ID), player.ID) && (
            <span className="player-protection-badge">Candado activo</span>
          )}
        </div>
        <span>{player.Position} | GLB {player.OVR}</span>
        <span>{getPlayerStatusLabel(player)}</span>
        <div className="mini-player-meta">
          <small>Valor: {money(player.marketValue)}</small>
          <small>Clausula: {money(clauseValue(player))}</small>
          <small>Sueldo aprox temporada: {salaryRange(player)}</small>
        </div>
        {player.unavailableUntilMatch && Math.max(0, Number(player.unavailableUntilMatch) - leagueMatchCount) > 0 && (
          <small>
            Baja {Math.max(0, Number(player.unavailableUntilMatch) - leagueMatchCount)} partido(s):{" "}
            {player.unavailableReason}
          </small>
        )}
        {action && (
          <div className="mini-player-actions" onClick={(event) => event.stopPropagation()}>
            {action}
          </div>
        )}
      </div>
    </article>
  );

  const renderSponsor = () => (
    currentTeam?.sponsor && (
      <div className="sponsor-card">
        <h3>Patrocinador: {currentTeam.sponsor.name}</h3>
        <div className="sponsor-grid">
          {Object.entries(currentTeam.sponsor.values).map(([category, value]) => (
            <div key={category}>
              <span>{category}</span>
              <strong>{money(value)}</strong>
            </div>
          ))}
        </div>
      </div>
    )
  );

  const renderSelection = () => (
    <main className="draft-shell selection-shell">
      <header className="draft-topbar">
        <div>
          <span className="form-kicker">Seleccion principal</span>
          <h1>Elige tu equipo inicial</h1>
        </div>
        <button className="logout-btn draft-logout" onClick={onLogout}>
          Cerrar sesion
        </button>
      </header>

      <section className="draft-panel">
        <p>
          {hasConfirmed
            ? `Esperando managers: ${confirmedOwners.length}/${players.length}`
            : "Elige una opcion por posicion. El 88+ ahora rota mas entre ligas y el resto sale mucho mas variado desde 75."}
        </p>

        <label className="field">
          <span>Nombre del club</span>
          <input
            className="input"
            placeholder="Real Gus FC"
            value={clubName}
            disabled={hasConfirmed}
            onChange={(event) => setClubName(event.target.value)}
          />
        </label>

        <div className="position-pick-grid">
          {groups.map((group) => {
            const selectedId = selectionState[group];

            return (
              <div key={group} className="pick-group">
                <h3>{groupLabels[group]}</h3>
                {(initialPicks[currentUser]?.[group] || []).map((player) => {
                  const isSelected = selectedId === player.ID;

                  return renderPlayerCard(
                    player,
                    <button
                      className={`small-action ${isSelected ? "danger" : ""}`}
                      disabled={hasConfirmed}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isSelected) removeInitialPlayer(group);
                        else pickInitialPlayer(group, player);
                      }}
                    >
                      {isSelected ? "Eliminar" : "Elegir"}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <button className="btn btn-login" disabled={hasConfirmed} onClick={confirmTeam}>
          {hasConfirmed ? "EQUIPO CONFIRMADO" : "CONFIRMAR EQUIPO"}
        </button>
      </section>
    </main>
  );

  const renderInicio = () => (
    <section className="draft-panel">
      <h2>Noticias de la liga</h2>
      <p>Liga {leagueCode} | Partidos manager {managerMatchCount}/{totalSeasonMatches}</p>

      {serverPhase === "dashboard" && (
        <button
          className="btn btn-login"
          disabled={!isOrganizer}
          onClick={startAuction}
        >
          {isOrganizer ? "INICIAR SUBASTA" : "ESPERANDO AL ORGANIZADOR"}
        </button>
      )}

      <div className="news-list">
        {news.length === 0 && <div className="draft-empty-state">Aun no hay noticias.</div>}
        {news.map((item, index) => {
          const engagement = getEngagement(item, index);
          return (
            <article key={`${item}-${index}`} className="news-item">
              <div className="news-avatar">{getNewsAuthor(item).slice(0, 1)}</div>
              <div>
                <strong>{getNewsAuthor(item)}</strong>
                <p>{getNewsText(item)}</p>
                <div className="news-meta">
                  <span>{engagement.likes} likes</span>
                  <span>{engagement.reposts} retweets</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );

  const renderClub = () => (
    <section className="draft-panel">
      <h2>Club</h2>
      <p>
        {currentTeam?.name || currentUser} | Presupuesto: {money(currentTeam?.budget || 0)} | Masa salarial:{" "}
        {salary(currentPayroll)}/{salary(currentTeam?.salaryCap || settings.salaryCap)} | Plantilla:{" "}
        {currentTeam?.squad.length || 0}/{TEAM_SIZE_TARGET}
      </p>
      <div className="offer-switch club-mode-switch">
        <button className={clubView === "plantilla" ? "active" : ""} onClick={() => setClubView("plantilla")}>
          Plantilla
        </button>
        <button className={clubView === "training" ? "active" : ""} onClick={() => setClubView("training")}>
          Entrenamiento
        </button>
        <button className={clubView === "sponsor" ? "active" : ""} onClick={() => setClubView("sponsor")}>
          Patrocinador
        </button>
      </div>
      {clubView === "plantilla" && (
        <div className="card-grid">
          {(currentTeam?.squad || []).map((player) =>
            renderPlayerCard(player, (
              <div className="offer-actions" onClick={(event) => event.stopPropagation()}>
                <button
                  className={`small-action ${isProtectedPlayer(currentUser, player.ID) ? "protected-action" : ""}`}
                  disabled={!isProtectedPlayer(currentUser, player.ID) && protectedCount >= 2}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleProtection(player, !isProtectedPlayer(currentUser, player.ID));
                  }}
                >
                  {isProtectedPlayer(currentUser, player.ID) ? "Blindado" : "Asegurar jugador"}
                </button>
                <button
                  className="small-action danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    releasePlayer(player);
                  }}
                >
                  Despedir
                </button>
              </div>
            ))
          )}
        </div>
      )}
      {clubView === "training" && (
        <div className="sponsor-card">
          <h3>Entrenamiento del club</h3>
          <div className="offers-panel">
            {(currentTeam?.squad || []).map((player) => (
              <article key={`training-${player.ID}`} className="offer-card">
                <strong>{player.Name}</strong>
                <span>Media actual: {player.OVR}</span>
                <small>{getTrainingLabel(player)}</small>
                <div className="offer-actions">
                  <button
                    className="small-action"
                    disabled={Number(player.OVR) >= 99}
                    onClick={() => trainPlayer(player)}
                  >
                    {Number(player.OVR) >= 99 ? "TOPE 99" : "MEJORAR JUGADOR"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      {clubView === "sponsor" && renderSponsor()}
    </section>
  );

  const renderTable = () => (
    <section className="draft-panel">
      <h2>Tabla de liga</h2>
      <div className="table-actions">
        <button
          className={`btn ${tableView === "tabla" ? "btn-login" : "btn-outline"} compact-btn`}
          onClick={() => setTableView("tabla")}
        >
          TABLA
        </button>
        <button
          className={`btn ${tableView === "partidos" ? "btn-login" : "btn-outline"} compact-btn`}
          onClick={() => setTableView("partidos")}
        >
          PARTIDOS
        </button>
        <button className="btn btn-login compact-btn" onClick={() => setShowResultForm(true)}>
          AGREGAR RESULTADO
        </button>
        {isOrganizer && settings.fillCpuTeams && settings.leagueType !== "Fantasia" && (
          <>
            <button className="btn btn-outline compact-btn" onClick={() => setShowCpuForm(true)}>
              RESULTADO AUTOMATICO
            </button>
            <button className="btn btn-outline compact-btn" onClick={() => setShowCpuRenameForm(true)}>
              RENOMBRAR CLUBES
            </button>
          </>
        )}
      </div>
      {tableView === "tabla" ? (
        <div className="league-table">
          {displayStandings.map((team, index) => (
            <div key={team.key} className="league-row rich">
              <span>{index + 1}</span>
              <strong>{team.name}</strong>
              <small>{team.played} PJ</small>
              <small>{team.wins} G</small>
              <small>{team.draws} E</small>
              <small>{team.losses} P</small>
              <em>{team.champions ? "Champions" : "Liga"}</em>
              <b>{team.pts} pts</b>
            </div>
          ))}
        </div>
      ) : settings.leagueType === "Fantasia" ? (
        <div className="draft-list">
          <div className="draft-list-item">
            <strong>
              Jornadas {visibleRoundStart}-{Math.min(visibleRoundStart + 4, schedule.length || 1)}
            </strong>
          </div>
          {visibleRounds.map((roundMatches, index) => (
            <div
              key={`round-${visibleRoundStart + index}`}
              className="draft-list-item current-round"
            >
              <strong>Jornada {visibleRoundStart + index}</strong>
              <div className="schedule-round">
                {roundMatches.map((match) => (
                  <div key={match.id} className="schedule-match">
                    <span>{standingsNameByKey.get(match.homeKey) || match.homeKey}</span>
                    <strong>
                      {match.played && match.result
                        ? `${match.result.homeGoals}-${match.result.awayGoals}`
                        : "vs"}
                    </strong>
                    <span>{standingsNameByKey.get(match.awayKey) || match.awayKey}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="draft-empty-state">
          El calendario por jornadas solo se muestra en ligas de fantasia.
        </div>
      )}
    </section>
  );

  const renderTransfer = () => (
    <section className="draft-panel transfer-panel">
      <div className="transfer-header">
        <div>
          <h2>{phase === "auction" ? `Subasta etapa ${auctionStage + 1}/6` : "Transferencias"}</h2>
          <p>
            {phase === "auction"
                ? "El organizador controla el paso entre etapas y la calidad ahora esta mas repartida."
              : transferWindowOpen
                ? `Ventana de mercado disponible | No puedes pasar de ${TEAM_SIZE_TARGET} jugadores ni de ${salary(settings.salaryCap)} por temporada`
                : `Mercado cerrado hasta la mitad de temporada (${midSeasonMatch})`}
          </p>
        </div>
      </div>

      {myPendingSignings.length > 0 && (
        <div className="offers-panel">
          {myPendingSignings.map((signing) => (
            <div key={signing.id} className="offer-card">
              <strong>{signing.player.Name}</strong>
              <span>
                {signing.type === "auction"
                  ? `Ganaste la subasta por ${money(signing.amount)}`
                  : signing.type === "clause"
                    ? `Activaste la clausula de ${signing.fromClub || signing.fromOwner} por ${money(signing.amount)}`
                    : `${signing.fromClub || signing.fromOwner} acepto tu oferta por ${money(signing.amount)}`}
              </span>
              <small>Sueldo aprox por temporada: {salaryRange(signing.player)}</small>
              <div className="offer-actions">
                <button
                  className="small-action"
                  onClick={() =>
                    negotiateSalaryWithPlayer(
                      signing.player,
                      signing.amount,
                      signing.type === "offer"
                        ? "offer"
                        : signing.type === "clause"
                          ? "clause"
                          : "auction"
                    )
                  }
                >
                  NEGOCIAR SUELDO
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {phase === "auction" && (
        <>
          <div className="card-grid">
            {currentAuctionPlayers.map((player) => {
              const bidCount = bidCounts[String(player.ID)] || 0;
              return renderPlayerCard(
                player,
                <button
                  className="small-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    placeBid(player);
                  }}
                >
                  {bidCount} pujando
                </button>
              );
            })}
          </div>
          {isOrganizer && (
            <button className="btn btn-login" onClick={resolveAuctionStage}>
              PASAR ETAPA
            </button>
          )}
        </>
      )}

      {phase === "market" && (
        <>
          {isOrganizer && (
            <button className="btn btn-login compact-btn" onClick={finishTransferWindow}>
              FINALIZAR PERIODO Y COMENZAR LIGA
            </button>
          )}
          <div className="offer-switch">
            <button className={offerView === "recibidas" ? "active" : ""} onClick={() => setOfferView("recibidas")}>
              Ofertas recibidas
            </button>
            <button className={offerView === "enviadas" ? "active" : ""} onClick={() => setOfferView("enviadas")}>
              Ofertas enviadas
            </button>
          </div>
          <div className="offers-panel">
            {(offerView === "recibidas"
              ? offers.filter((offer) => offer.to === currentUser)
              : offers.filter((offer) => offer.from === currentUser)
            ).map((offer) => (
              <div key={offer.id} className="offer-card">
                <strong>{offer.player.Name}</strong>
                <span>{offer.from} {"->"} {offer.to}</span>
                <small>
                  {money(offer.amount)} | sueldo {salary(offer.salary || offer.player.salary)} por temporada | {offer.status}
                </small>
                {offerView === "recibidas" && offer.status === "pending" && (
                  <div className="offer-actions">
                    <button className="small-action" onClick={() => handleOfferDecision(offer.id, "accepted")}>Aceptar</button>
                    <button className="small-action danger" onClick={() => handleOfferDecision(offer.id, "rejected")}>Rechazar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <input
            className="input transfer-search"
            placeholder="Buscar jugador"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="card-grid">
            {search.trim().length < 2 && <div className="draft-empty-state">Busca por nombre para comprar.</div>}
            {results.map((player) => {
              const owner = playerOwners.get(player.ID);
              const isOwnedByOther = owner && owner !== currentUser;
              const playerProtected = isProtectedPlayer(owner, player.ID);

              return renderPlayerCard(
                player,
                isOwnedByOther ? (
                  <div className="offer-actions" onClick={(event) => event.stopPropagation()}>
                    <button
                      className="small-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        sendOffer(player);
                      }}
                    >
                      Negociar con manager
                    </button>
                    <button
                      className={`small-action ${playerProtected ? "protected-action" : "muted"}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        payClause(player);
                      }}
                    >
                      Pagar clausula
                    </button>
                  </div>
                ) : (
                  <button
                    className="small-action"
                    onClick={(event) => {
                      event.stopPropagation();
                      buyPlayer(player);
                    }}
                  >
                    Comprar
                  </button>
                )
              );
            })}
          </div>
        </>
      )}

      {phase !== "auction" && phase !== "market" && !transferWindowOpen && (
        <div className="draft-empty-state">
          El mercado se abre al inicio y en la mitad de temporada.
        </div>
      )}
    </section>
  );

  const renderPanel = () => {
    if (activeTab === "Inicio") return renderInicio();
    if (activeTab === "Club") return renderClub();
    if (activeTab === "Tabla de liga") return renderTable();
    return renderTransfer();
  };

  if (serverPhase === "selection") {
    return renderSelection();
  }

  return (
    <main className="draft-shell">
      <header className="draft-topbar">
        <div>
          <span className="form-kicker">Draft en vivo</span>
          <h1>Ultimate Fantasy League</h1>
        </div>
        <div className="draft-toolbar">
          <button className="small-action inbox-btn" onClick={() => setShowInbox(true)}>
            Buzon
            {myInbox.length > 0 && <span className="notif-dot toolbar-dot"></span>}
          </button>
          <button className="logout-btn draft-logout" onClick={onLogout}>
            Cerrar sesion
          </button>
        </div>
      </header>

      <nav className="draft-tabs bottom-tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? "active" : ""}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
            {tab === "Transferencia" && pendingReceived > 0 && <span className="notif-dot"></span>}
          </button>
        ))}
      </nav>

      {renderPanel()}

      {showResultForm && (
        <div className="player-modal" onClick={() => setShowResultForm(false)}>
          <div className="player-modal-card" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowResultForm(false)}>Cerrar</button>
            <h2>Agregar resultado</h2>
            <div className="form-grid">
              <label className="field">
                <span>Tu equipo</span>
                <input className="input" value={currentTeam?.name || currentUser} disabled />
              </label>
              <label className="field">
                <span>Rival</span>
                <select className="input" value={opponentName} onChange={(e) => setOpponentName(e.target.value)}>
                  <option value="">Selecciona</option>
                  {displayStandings.filter((team) => team.name !== (currentTeam?.name || currentUser)).map((team) => (
                    <option key={team.name}>{team.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Marcador tuyo</span>
                <input className="input" value={goalsFor} onChange={(e) => setGoalsFor(e.target.value)} />
              </label>
              <label className="field">
                <span>Marcador rival</span>
                <input className="input" value={goalsAgainst} onChange={(e) => setGoalsAgainst(e.target.value)} />
              </label>
              <div className="field scorer-field">
                <span>Goleadores de tu club</span>
                <div className="scorer-list">
                  {teamScorers.map((row, index) => (
                    <div key={`team-scorer-${index}`} className="scorer-row">
                      <select
                        className="input"
                        value={row.playerId}
                        onChange={(e) => updateGoalRow("mine", index, "playerId", e.target.value)}
                      >
                        <option value="">Selecciona jugador</option>
                        {currentTeamPlayers.map((player) => (
                          <option key={player.ID} value={player.ID}>
                            {player.Name}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input scorer-goals"
                        value={row.goals}
                        onChange={(e) => updateGoalRow("mine", index, "goals", e.target.value)}
                      />
                      <button className="small-action danger scorer-remove" onClick={() => removeGoalRow("mine", index)}>
                        Quitar
                      </button>
                    </div>
                  ))}
                  <button className="small-action scorer-add" onClick={() => addGoalRow("mine")}>
                    Agregar goleador
                  </button>
                </div>
              </div>
              {opponentIsManager && (
                <div className="field scorer-field">
                  <span>Goleadores del rival</span>
                  <div className="scorer-list">
                    {opponentScorers.map((row, index) => (
                      <div key={`opp-scorer-${index}`} className="scorer-row">
                        <select
                          className="input"
                          value={row.playerId}
                          onChange={(e) => updateGoalRow("opponent", index, "playerId", e.target.value)}
                        >
                          <option value="">Selecciona jugador</option>
                          {opponentPlayers.map((player) => (
                            <option key={player.ID} value={player.ID}>
                              {player.Name}
                            </option>
                          ))}
                        </select>
                        <input
                          className="input scorer-goals"
                          value={row.goals}
                          onChange={(e) => updateGoalRow("opponent", index, "goals", e.target.value)}
                        />
                        <button className="small-action danger scorer-remove" onClick={() => removeGoalRow("opponent", index)}>
                          Quitar
                        </button>
                      </div>
                    ))}
                    <button className="small-action scorer-add" onClick={() => addGoalRow("opponent")}>
                      Agregar goleador rival
                    </button>
                  </div>
                </div>
              )}
              <label className="field">
                <span>Tarjetas de tu equipo</span>
                <input className="input" value={teamCards} onChange={(e) => setTeamCards(e.target.value)} />
              </label>
              <label className="field">
                <span>Tarjetas del rival</span>
                <input className="input" value={opponentCards} onChange={(e) => setOpponentCards(e.target.value)} />
              </label>
              <label className="field">
                <span>Jugador del partido</span>
                <select className="input" value={mvpPlayerId} onChange={(e) => setMvpPlayerId(e.target.value)}>
                  <option value="">Selecciona jugador</option>
                  {mvpOptions.map((player) => (
                    <option key={`mvp-${player.ID}`} value={player.ID}>
                      {player.Name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button className="btn btn-login" onClick={submitManagerResult}>GUARDAR RESULTADO</button>
          </div>
        </div>
      )}

      {showCpuForm && settings.leagueType !== "Fantasia" && (
        <div className="player-modal" onClick={() => setShowCpuForm(false)}>
          <div className="player-modal-card" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCpuForm(false)}>Cerrar</button>
            <h2>Resultado automatico</h2>
            <div className="form-grid">
              <label className="field">
                <span>Equipo A</span>
                <select className="input" value={cpuTeamA} onChange={(e) => setCpuTeamA(e.target.value)}>
                  <option value="">Selecciona</option>
                  {displayStandings.filter((team) => !team.real).map((team) => (
                    <option key={team.name}>{team.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Equipo B</span>
                <select className="input" value={cpuTeamB} onChange={(e) => setCpuTeamB(e.target.value)}>
                  <option value="">Selecciona</option>
                  {displayStandings.filter((team) => !team.real).map((team) => (
                    <option key={team.name}>{team.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Puntos A</span>
                <input className="input" value={cpuPointsA} onChange={(e) => setCpuPointsA(e.target.value)} />
              </label>
              <label className="field">
                <span>Puntos B</span>
                <input className="input" value={cpuPointsB} onChange={(e) => setCpuPointsB(e.target.value)} />
              </label>
            </div>
            <button className="btn btn-login" onClick={submitCpuResult}>GUARDAR</button>
          </div>
        </div>
      )}

      {showCpuRenameForm && settings.leagueType !== "Fantasia" && (
        <div className="player-modal" onClick={() => setShowCpuRenameForm(false)}>
          <div className="player-modal-card" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCpuRenameForm(false)}>Cerrar</button>
            <h2>Renombrar clubes generados</h2>
            <div className="offers-panel">
              {cpuTeams.length === 0 && <div className="draft-empty-state">No hay clubes generados en esta liga.</div>}
              {cpuTeams.map((team) => (
                <article key={team.key} className="offer-card">
                  <strong>{team.name}</strong>
                  <div className="offer-actions">
                    <button className="small-action" onClick={() => renameCpuTeam(team.key, team.name)}>
                      CAMBIAR NOMBRE
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedPlayer && (
        <div className="player-modal" onClick={() => setSelectedPlayer(null)}>
          <div className="player-modal-card" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedPlayer(null)}>Cerrar</button>
            {(() => {
              const selectedOwner = playerOwners.get(selectedPlayer.ID);
              const ownedByCurrentClub = selectedOwner === currentUser;
              const ownedByOtherClub = Boolean(selectedOwner && selectedOwner !== currentUser);
              const isProtected = isProtectedPlayer(selectedOwner, selectedPlayer.ID);
              const canProtectMore = ownedByCurrentClub && (isProtected || protectedCount < 2);

              return (
                <>
            <div className="player-hero">
              {selectedPlayer.card && <img src={selectedPlayer.card} alt={selectedPlayer.Name} />}
              <div>
                <span>{getPlayerStatusLabel(selectedPlayer)}</span>
                <h3>{selectedPlayer.Name}</h3>
                <strong>{selectedPlayer.OVR}</strong>
                <p>
                  Valor mercado: {money(selectedPlayer.marketValue)} | Puja minima: {money(selectedPlayer.minBid)} |
                  Clausula: {money(clauseValue(selectedPlayer))} | Sueldo aprox por temporada: {salaryRange(selectedPlayer)}
                </p>
                {isProtected && <p>Blindado por clausula</p>}
                {selectedPlayer.unavailableUntilMatch &&
                  Math.max(0, Number(selectedPlayer.unavailableUntilMatch) - leagueMatchCount) > 0 && (
                    <p>
                      Baja por {Math.max(0, Number(selectedPlayer.unavailableUntilMatch) - leagueMatchCount)} partido(s):{" "}
                      {selectedPlayer.unavailableReason}
                    </p>
                  )}
              </div>
            </div>
            <div className="offer-actions modal-player-actions" onClick={(event) => event.stopPropagation()}>
              {ownedByOtherClub && (
                <>
                  <button className="small-action" onClick={() => sendOffer(selectedPlayer)}>
                    Negociar con manager
                  </button>
                  <button
                    className={`small-action ${isProtected ? "protected-action" : "muted"}`}
                    onClick={() => payClause(selectedPlayer)}
                  >
                    Pagar clausula
                  </button>
                </>
              )}
              {!selectedOwner && (
                <button className="small-action" onClick={() => buyPlayer(selectedPlayer)}>
                  Comprar
                </button>
              )}
              {ownedByCurrentClub && (
                <button
                  className={`small-action ${isProtected ? "protected-action" : ""}`}
                  disabled={!canProtectMore}
                  onClick={() => toggleProtection(selectedPlayer, !isProtected)}
                >
                  {isProtected ? "Blindado" : "Asegurar jugador"}
                </button>
              )}
            </div>
            <div className="stat-grid">
              {visibleDetails.map((key) => (
                <div key={key} className="stat-card">
                  <span>{key}</span>
                  <strong>{selectedPlayer[key] ?? "-"}</strong>
                </div>
              ))}
            </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {showInbox && (
        <div className="player-modal" onClick={() => setShowInbox(false)}>
          <div className="player-modal-card" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowInbox(false)}>Cerrar</button>
            <h2>Buzon del club</h2>
            <div className="offers-panel">
              {myInbox.length === 0 && <div className="draft-empty-state">No tienes avisos nuevos.</div>}
              {myInbox.map((item) => (
                <article key={item.id} className="offer-card">
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                  {item.matchUntil && (
                    <small>Disponible otra vez desde la jornada {item.matchUntil}</small>
                  )}
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
