import { type CSSProperties, type ReactNode, type TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import faunaAvatar from "./assets/fauna.webp";
import romanoAvatar from "./assets/romano.jpg";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "");
const UI_VERSION = "0.906";
const TEAM_SIZE_TARGET = 20;

type Tab = "Inicio" | "Club" | "Liga" | "Transferencia";
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
  sponsorChangedThisSeason?: boolean;
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
  leaguePrize: number;
  playoffPrize1: number;
  playoffPrize2: number;
  playoffPrize3: number;
  playoffPrize4: number;
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
  news: NewsEntry[];
  leagueMatchCount: number;
  regularSeasonComplete?: boolean;
  seasonChampionKey?: string;
  seasonChampionName?: string;
  championCelebrationId?: string;
  inbox: Record<string, InboxItem[]>;
  standings: Standing[];
  schedule: ScheduleMatch[][];
  cpuTeams: CpuTeam[];
  visibleRoundStart: number;
  playoff?: PlayoffState | null;
  quickTournament?: QuickTournamentState | null;
};

type ChampionOverlayState = {
  id: string;
  name: string;
};

type NewsEntry = {
  text: string;
  createdAt?: number;
};

type PlayoffMatch = {
  stage: "semifinal1" | "semifinal2" | "final";
  label: string;
  homeKey: string;
  awayKey: string;
  homeName: string;
  awayName: string;
  played: boolean;
  result?: {
    homeGoals: number;
    awayGoals: number;
  } | null;
  winnerKey?: string;
};

type PlayoffState = {
  semifinal1: PlayoffMatch;
  semifinal2: PlayoffMatch;
  final: PlayoffMatch;
  championKey?: string;
};

type QuickTournamentMatch = {
  id: string;
  homeKey: string;
  awayKey: string;
  homeName: string;
  awayName: string;
  played: boolean;
  result?: {
    homeGoals: number;
    awayGoals: number;
  } | null;
  winnerKey?: string;
};

type QuickTournamentRound = {
  name: string;
  matches: QuickTournamentMatch[];
};

type QuickTournamentState = {
  active: boolean;
  rounds: QuickTournamentRound[];
  championKey?: string;
  prize?: number;
};

type IconName =
  | "home"
  | "club"
  | "league"
  | "transfer"
  | "back"
  | "inbox"
  | "logout"
  | "table"
  | "clubs"
  | "playoff"
  | "quick"
  | "add"
  | "edit"
  | "rename"
  | "prize";

const tabs: Tab[] = ["Inicio", "Club", "Liga", "Transferencia"];
const groups: PositionGroup[] = ["POR", "DEF", "MED", "EXT", "DEL"];
const scoreOptions = Array.from({ length: 11 }, (_, index) => String(index));
const scorerGoalOptions = Array.from({ length: 10 }, (_, index) => String(index + 1));
const tabIcons: Record<Tab, IconName> = {
  Inicio: "home",
  Club: "club",
  Liga: "league",
  Transferencia: "transfer",
};

const groupLabels: Record<PositionGroup, string> = {
  POR: "Portero",
  DEF: "Defensa",
  MED: "Mediocampo",
  EXT: "Extremo",
  DEL: "Delantero",
};

const DraftIcon = ({ name }: { name: IconName }) => {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const icons: Record<IconName, ReactNode> = {
    home: <path {...common} d="M4.5 10.5 12 4l7.5 6.5V20h-5.5v-5H10v5H4.5z" />,
    club: <>
      <path {...common} d="M12 4l6.5 2.3v5.4c0 4.2-2.5 6.8-6.5 8.8-4-2-6.5-4.6-6.5-8.8V6.3z" />
    </>,
    league: <>
      <path {...common} d="M8 5h8v3h3v3c0 3.5-2.6 5.5-5.5 5.9A6 6 0 0 1 12 18a6 6 0 0 1-1.5-1.1C7.6 16.5 5 14.5 5 11V8h3z" />
      <path {...common} d="M9 21h6M10.5 18.5h3" />
    </>,
    transfer: <>
      <path {...common} d="M5 8h10" /><path {...common} d="m11 4 4 4-4 4" />
      <path {...common} d="M19 16H9" /><path {...common} d="m13 12-4 4 4 4" />
    </>,
    back: <>
      <path {...common} d="M19 12H7" /><path {...common} d="m11 7-5 5 5 5" />
    </>,
    inbox: <>
      <path {...common} d="M4.5 7.5h15v9h-4l-1.5 3h-4l-1.5-3h-4z" />
      <path {...common} d="M4.5 10.5h15" />
    </>,
    logout: <>
      <path {...common} d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10" />
      <path {...common} d="M14 8.5 18 12l-4 3.5" />
      <path {...common} d="M18 12H9" />
    </>,
    table: <>
      <path {...common} d="M6 18V10" /><path {...common} d="M12 18V6" /><path {...common} d="M18 18v-8" />
      <path {...common} d="M4.5 20h15" />
    </>,
    clubs: <>
      <path {...common} d="M12 4l6.5 2.3v5.4c0 4.2-2.5 6.8-6.5 8.8-4-2-6.5-4.6-6.5-8.8V6.3z" />
    </>,
    playoff: <>
      <path {...common} d="M8 5h8v3h3v3c0 3.5-2.6 5.5-5.5 5.9A6 6 0 0 1 12 18a6 6 0 0 1-1.5-1.1C7.6 16.5 5 14.5 5 11V8h3z" />
      <path {...common} d="M9 21h6" />
    </>,
    quick: <>
      <path {...common} d="M13 3 6.5 13h4l-1 8L17.5 11h-4z" />
    </>,
    add: <>
      <path {...common} d="M12 5v14" /><path {...common} d="M5 12h14" />
    </>,
    edit: <>
      <path {...common} d="m5 19 4.2-1 8.3-8.3a1.8 1.8 0 0 0 0-2.5l-.7-.7a1.8 1.8 0 0 0-2.5 0L6 14.8 5 19z" />
      <path {...common} d="M12.5 8.5 15.5 11.5" />
    </>,
    rename: <>
      <path {...common} d="M7.5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16.5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path {...common} d="M7.5 12V9a4.5 4.5 0 0 1 9 0v3" />
    </>,
    prize: <>
      <path {...common} d="M8 5h8v3h3v3c0 3.5-2.6 5.5-5.5 5.9A6 6 0 0 1 12 18a6 6 0 0 1-1.5-1.1C7.6 16.5 5 14.5 5 11V8h3z" />
      <path {...common} d="M9 21h6M10.5 18.5h3" />
    </>,
  };

  return (
    <svg className="draft-icon" viewBox="0 0 24 24" aria-hidden="true">
      {icons[name]}
    </svg>
  );
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

const sponsorCategories = [
  "Ingreso por ganar",
  "Ingreso por empatar",
  "Ingreso por perder",
  "Maximo Goleador",
  "Maximo MVP",
  "Tarjetas",
];

const sponsorPresets: Sponsor[] = [
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

type AppliedSearch = {
  query: string;
  minValue: string;
  maxValue: string;
  minOverall: string;
  maxOverall: string;
  position: string;
  nonce: number;
};

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

const getNewsAuthor = (item: NewsEntry) =>
  item.text.startsWith("Fabrizio Romano:")
    ? "Fabrizio Romano"
    : item.text.startsWith("Fabritzio Fauna:")
      ? "Fabritzio Fauna"
      : item.text.startsWith("Club ")
        ? item.text.slice(5).split(":")[0] || "Club"
      : "Liga UFL";

const getNewsTone = (item: NewsEntry) =>
  item.text.startsWith("Fabrizio Romano:")
    ? "romano"
    : item.text.startsWith("Fabritzio Fauna:")
      ? "fauna"
      : item.text.startsWith("Club ")
        ? "club"
      : "liga";

const getNewsText = (item: NewsEntry) =>
  item.text.startsWith("Club ")
    ? item.text.split(": ").slice(1).join(": ")
    : item.text
        .replace("Fabrizio Romano: ", "")
        .replace("Fabritzio Fauna: ", "")
        .replace(/Liga UFL: (.+?) es campeon de la temporada/, "Liga UFL: $1 ★ es campeon de la temporada");

const getNewsAvatarImage = (item: NewsEntry) =>
  item.text.startsWith("Fabrizio Romano:")
    ? romanoAvatar
    : item.text.startsWith("Fabritzio Fauna:")
      ? faunaAvatar
      : "";

const getNewsDayLabel = (item: NewsEntry) =>
  new Date(item.createdAt || Date.now()).toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

const getEngagement = (item: NewsEntry, index: number) => ({
  likes: ((item.text.length * 13 + index * 17) % 900) + 80,
  reposts: ((item.text.length * 7 + index * 11) % 240) + 20,
});

const createSponsor = (_owner: string, index: number): Sponsor => {
  const preset = sponsorPresets[index % sponsorPresets.length] || sponsorPresets[0];
  return {
    name: preset.name,
    values: sponsorCategories.reduce<Record<string, number>>((acc, category) => {
      acc[category] = Number(preset.values[category] || 0);
      return acc;
    }, {}),
  };
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
      sponsorChangedThisSeason: currentTeam?.sponsorChangedThisSeason ?? false,
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
  const [searchMinValue, setSearchMinValue] = useState("0");
  const [searchMaxValue, setSearchMaxValue] = useState("999");
  const [searchMinOverall, setSearchMinOverall] = useState("1");
  const [searchMaxOverall, setSearchMaxOverall] = useState("99");
  const [searchPosition, setSearchPosition] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [appliedSearch, setAppliedSearch] = useState<AppliedSearch>({
    query: "",
    minValue: "0",
    maxValue: "999",
    minOverall: "1",
    maxOverall: "99",
    position: "all",
    nonce: 0,
  });
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
  const [, setBids] = useState<Bid[]>([]);
  const [bidCounts, setBidCounts] = useState<Record<string, number>>({});
  const [news, setNews] = useState<NewsEntry[]>([]);
  const [offerView, setOfferView] = useState<"recibidas" | "enviadas">("recibidas");
  const [offers, setOffers] = useState<Offer[]>([]);
  const [pendingSignings, setPendingSignings] = useState<PendingSigning[]>([]);
  const [leagueMatchCount, setLeagueMatchCount] = useState(0);
  const [regularSeasonComplete, setRegularSeasonComplete] = useState(false);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [inbox, setInbox] = useState<Record<string, InboxItem[]>>({});
  const [showInbox, setShowInbox] = useState(false);
  const [showResultForm, setShowResultForm] = useState(false);
  const [showCpuForm, setShowCpuForm] = useState(false);
  const [showCpuRenameForm, setShowCpuRenameForm] = useState(false);
  const [showStandingEditForm, setShowStandingEditForm] = useState(false);
  const previousServerPhaseRef = useRef<ServerPhase | null>(null);
  const hasHydratedFromEventsRef = useRef(false);
  const shellTouchStartRef = useRef<{ x: number; y: number } | null>(null);
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
  const [tableView, setTableView] = useState<"tabla" | "partidos" | "clubes" | "liguilla" | "torneo">("tabla");
  const [visibleRoundStart, setVisibleRoundStart] = useState(1);
  const [selectedLeagueClub, setSelectedLeagueClub] = useState("");
  const [playoff, setPlayoff] = useState<PlayoffState | null>(null);
  const [quickTournament, setQuickTournament] = useState<QuickTournamentState | null>(null);
  const [showQuickTournamentForm, setShowQuickTournamentForm] = useState(false);
  const [selectedQuickTeams, setSelectedQuickTeams] = useState<string[]>([]);
  const [quickTournamentPrize, setQuickTournamentPrize] = useState("6");
  const [clubFeedMessage, setClubFeedMessage] = useState("");
  const [editStandingKey, setEditStandingKey] = useState("");
  const [editPlayed, setEditPlayed] = useState("0");
  const [editWins, setEditWins] = useState("0");
  const [editDraws, setEditDraws] = useState("0");
  const [editLosses, setEditLosses] = useState("0");
  const [editGf, setEditGf] = useState("0");
  const [editGa, setEditGa] = useState("0");
  const [editPts, setEditPts] = useState("0");
  const [seasonChampionKey, setSeasonChampionKey] = useState("");
  const [championOverlay, setChampionOverlay] = useState<ChampionOverlayState | null>(null);
  const seenChampionCelebrationRef = useRef("");

  const applyDraftPayload = (draft: DraftEvent) => {
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
    setRegularSeasonComplete(Boolean(draft.regularSeasonComplete));
    setSeasonChampionKey(draft.seasonChampionKey || "");
    setInbox(draft.inbox || {});
    setStandings(draft.standings || []);
    setSchedule(draft.schedule || []);
    setCpuTeams(draft.cpuTeams || []);
    setVisibleRoundStart(draft.visibleRoundStart || 1);
    setPlayoff(draft.playoff || null);
    setQuickTournament(draft.quickTournament || null);

    if (draft.phase === "dashboard") {
      setPhase("initial");
    }

    if (draft.phase === "auction") {
      setPhase("auction");
    }

    if (draft.phase === "market") {
      setPhase("market");
    }

    if (draft.phase === "season") {
      setPhase("initial");
    }

    if (
      draft.championCelebrationId &&
      draft.seasonChampionName &&
      seenChampionCelebrationRef.current !== draft.championCelebrationId
    ) {
      seenChampionCelebrationRef.current = draft.championCelebrationId;
      setChampionOverlay({
        id: draft.championCelebrationId,
        name: draft.seasonChampionName,
      });
    }

    previousServerPhaseRef.current = draft.phase;
    hasHydratedFromEventsRef.current = true;
  };

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
    setRegularSeasonComplete(false);
    setActiveTab("Inicio");
    setClubView("plantilla");
    setOrganizer("");
    setServerPhase("selection");
    setConfirmedOwners([]);
    setShowCpuForm(false);
    setShowCpuRenameForm(false);
    setShowStandingEditForm(false);
    setPlayoff(null);
    setQuickTournament(null);
    setShowQuickTournamentForm(false);
    setSelectedQuickTeams([]);
    setQuickTournamentPrize("6");
    setSeasonChampionKey("");
    setChampionOverlay(null);
    seenChampionCelebrationRef.current = "";
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
      applyDraftPayload(draft);
    };

    events.onerror = () => {};

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

  const runPlayerSearch = (queryOverride?: string) =>
    setAppliedSearch({
      query: typeof queryOverride === "string" ? queryOverride : search.trim(),
      minValue: searchMinValue || "0",
      maxValue: searchMaxValue || "999",
      minOverall: searchMinOverall || "1",
      maxOverall: searchMaxOverall || "99",
      position: searchPosition,
      nonce: Date.now(),
    });

  useEffect(() => {
    const fantasyProgress = schedule.flat().filter((match) => match.played && match.result).length;
    const realTeamCount = Math.max(standings.length, Object.keys(teams).length + cpuTeams.length, 1);
    const totalMatches =
      settings.leagueType === "Fantasia" ? realTeamCount * Math.max(realTeamCount - 1, 0) : realTeamCount * 40;
    const progress =
      settings.leagueType === "Fantasia"
        ? fantasyProgress
        : standings.reduce((sum, team) => sum + Number(team.played || 0), 0);
    const halfSeasonMatch = Math.floor(totalMatches / 2);
    const windowOpen =
      !regularSeasonComplete && (phase === "market" || progress === 0 || progress >= halfSeasonMatch);

    if (!windowOpen || appliedSearch.nonce === 0) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    fetch(`${API_URL}/drafts/${leagueCode}/players?search=${encodeURIComponent(appliedSearch.query)}&limit=5000`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data) => {
        const ownerMap = new Map<number, string>();
        Object.values(teams).forEach((team) => {
          team.squad.forEach((player) => ownerMap.set(player.ID, team.owner));
        });

        setResults(
          (data.players || []).filter((player: Player) => {
            if (ownerMap.get(player.ID) === currentUser) return false;
            if (appliedSearch.position !== "all" && getPlayerGroup(player.Position) !== appliedSearch.position) return false;
            if (Number(player.OVR) < Number(appliedSearch.minOverall || 1)) return false;
            if (Number(player.OVR) > Number(appliedSearch.maxOverall || 99)) return false;
            if (Number(player.marketValue) < Number(appliedSearch.minValue || 0)) return false;
            if (Number(player.marketValue) > Number(appliedSearch.maxValue || 999)) return false;
            return true;
          })
        );
      })
      .catch(() => setResults([]));

    return () => controller.abort();
  }, [appliedSearch, phase, teams, currentUser, leagueMatchCount, settings.format, leagueCode, settings.leagueType, schedule, standings, cpuTeams.length, regularSeasonComplete]);

  useEffect(() => {
    const fantasyProgress = schedule.flat().filter((match) => match.played && match.result).length;
    const realTeamCount = Math.max(standings.length, Object.keys(teams).length + cpuTeams.length, 1);
    const totalMatches =
      settings.leagueType === "Fantasia" ? realTeamCount * Math.max(realTeamCount - 1, 0) : realTeamCount * 40;
    const progress =
      settings.leagueType === "Fantasia"
        ? fantasyProgress
        : standings.reduce((sum, team) => sum + Number(team.played || 0), 0);
    const halfSeasonMatch = Math.floor(totalMatches / 2);
    const windowOpen =
      !regularSeasonComplete && (phase === "market" || progress === 0 || progress >= halfSeasonMatch);
    const trimmedSearch = search.trim();

    if (!windowOpen) {
      setResults([]);
      return;
    }

    if (!trimmedSearch) {
      return;
    }

    const timeout = window.setTimeout(() => {
      runPlayerSearch(trimmedSearch);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [search, phase, leagueMatchCount, settings.format, settings.leagueType, schedule, standings, cpuTeams.length, regularSeasonComplete]);

  useEffect(() => {
    if (pool.length === 0 || auctionOptions.length > 0) return;

    setAuctionOptions(buildAuctionStages(pool, leagueCode));
  }, [pool, auctionOptions.length, leagueCode]);

  useEffect(() => {
    if (settings.leagueType !== "Fantasia" && tableView === "partidos") {
      setTableView("tabla");
    }
  }, [settings.leagueType, tableView]);

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
  const displayStandings = useMemo(
    () => sortLeagueStandings(settings.leagueType === "Fantasia" ? scheduleDerivedStandings : standings),
    [scheduleDerivedStandings, settings.leagueType, standings]
  );
  const totalSeasonMatches =
    settings.leagueType === "Fantasia"
      ? displayStandings.length * Math.max(displayStandings.length - 1, 0)
      : displayStandings.length * 40;
  const matchesPerClub =
    settings.leagueType === "Fantasia"
      ? Math.max(displayStandings.length - 1, 0) * 2
      : 40;
  const currentClubStanding = displayStandings.find((team) => team.key === currentUser);
  const currentClubMatchCount = currentClubStanding?.played || 0;
  const globalLeagueMatchCount = settings.leagueType === "Fantasia"
    ? schedule
        .flat()
        .filter((match) => match.played && match.result)
        .length
    : displayStandings.reduce((sum, team) => sum + Number(team.played || 0), 0);
  const midSeasonMatch = Math.floor(totalSeasonMatches / 2);
  const activeTabIndex = Math.max(0, tabs.indexOf(activeTab));
  const transferWindowOpen =
    !regularSeasonComplete &&
    (phase === "market" || globalLeagueMatchCount === 0 || globalLeagueMatchCount >= midSeasonMatch);
  const playerOwners = new Map<number, string>();
  Object.values(teams).forEach((team) => {
    team.squad.forEach((player) => playerOwners.set(player.ID, team.owner));
  });
  const isProtectedPlayer = (owner: string | undefined, playerId: number) =>
    owner ? (teams[owner]?.protectedPlayerIds || []).some((id) => Number(id) === Number(playerId)) : false;
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
  const groupedNews = news.reduce<Array<{ day: string; items: NewsEntry[] }>>((groups, item) => {
    const day = getNewsDayLabel(item);
    const existingGroup = groups.find((group) => group.day === day);
    if (existingGroup) {
      existingGroup.items.push(item);
    } else {
      groups.push({ day, items: [item] });
    }
    return groups;
  }, []);
  const championLabel = (teamKey: string, name: string) =>
    seasonChampionKey && teamKey === seasonChampionKey ? `${name} ★` : name;
  const realLeagueClubs = displayStandings.filter((team) => team.real);
  const selectedLeagueClubStanding = realLeagueClubs.find((team) => team.key === selectedLeagueClub) || realLeagueClubs[0];
  const selectedLeagueClubTeam = selectedLeagueClubStanding ? teams[selectedLeagueClubStanding.key] : null;
  const liguillaTeams = displayStandings.slice(0, 4);
  const sponsorIncomePreview = (team: TeamState | undefined, goalsFor: number, goalsAgainst: number, cards: number) => {
    if (!team?.sponsor?.values) return 0;

    let income = 0;
    if (goalsFor > goalsAgainst) income += Number(team.sponsor.values["Ingreso por ganar"] || 0);
    else if (goalsFor === goalsAgainst) income += Number(team.sponsor.values["Ingreso por empatar"] || 0);
    else income += Number(team.sponsor.values["Ingreso por perder"] || 0);
    income += Number(team.sponsor.values["Tarjetas"] || 0) * cards;
    return income;
  };

  useEffect(() => {
    const realLeagueClub = displayStandings.find((team) => team.real);
    if (!selectedLeagueClub && realLeagueClub) {
      setSelectedLeagueClub(realLeagueClub.key);
    }
    if (selectedLeagueClub && !displayStandings.some((team) => team.key === selectedLeagueClub && team.real)) {
      setSelectedLeagueClub(realLeagueClub?.key || "");
    }
  }, [displayStandings, selectedLeagueClub]);

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
        const payload = (await response.json().catch(() => null)) as DraftEvent | null;
        if (payload?.teams) {
          applyDraftPayload(payload);
        }
        alert(`${player.Name} acepto el sueldo de ${offeredSalary}k por temporada`);
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
      const errorData = await res.json().catch(() => null);
      alert(errorData?.error || "Aun no se puede iniciar la subasta");
      return;
    }

    const payload = (await res.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
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
      const errorData = await res.json().catch(() => null);
      alert(errorData?.error || "No se pudo registrar la puja");
    }
  };

  const resolveAuctionStage = async () => {
    setBids([]);

    const res = await fetch(`${API_URL}/drafts/${leagueCode}/next-stage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      alert(errorData?.error || "Solo el organizador puede pasar de etapa");
      return;
    }

    const payload = (await res.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
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

    const payload = (await res.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
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

    const payload = (await res.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
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
      return;
    }

    const payload = (await res.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
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
      const errorData = await res.json().catch(() => null);
      alert(errorData?.error || "No se pudo procesar la oferta");
      return;
    }

    const payload = (await res.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
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

    const mySponsorIncome = sponsorIncomePreview(currentTeam, myGoals, rivalGoals, Number(teamCards) || 0);
    const rivalSponsorIncome = sponsorIncomePreview(opponentTeam, rivalGoals, myGoals, Number(opponentCards) || 0);

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

    const payload = (await response.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
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
    alert(
      opponentIsManager
        ? `Resultado guardado. Patrocinador: ${money(mySponsorIncome)} para tu club y ${money(rivalSponsorIncome)} para ${opponentName}.`
        : `Resultado guardado. Patrocinador de tu club: ${money(mySponsorIncome)}.`
    );
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

    const payload = (await response.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
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

    const payload = (await response.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
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
      return;
    }

    const data = (await response.json().catch(() => null)) as (DraftEvent & { playerName?: string; nextOverall?: number }) | null;
    if (data?.teams) {
      applyDraftPayload(data);
    }
    alert(`${data?.playerName || player.Name} subio a ${data?.nextOverall || player.OVR} de media`);
  };

  const getTrainingLabel = (player: Player) => {
    if (Number(player.OVR) < 75) {
      return `Entrena hasta 75 por ${money(getTrainingCost(Number(player.OVR)))}`;
    }

    return `Sube +1 por ${money(getTrainingCost(Number(player.OVR)))}`;
  };

  const openStandingEditor = () => {
    const firstTeam = displayStandings[0];
    if (!firstTeam) return;
    setEditStandingKey(firstTeam.key);
    setEditPlayed(String(firstTeam.played));
    setEditWins(String(firstTeam.wins));
    setEditDraws(String(firstTeam.draws));
    setEditLosses(String(firstTeam.losses));
    setEditGf(String(firstTeam.gf));
    setEditGa(String(firstTeam.ga));
    setEditPts(String(firstTeam.pts));
    setShowStandingEditForm(true);
  };

  const syncStandingFormWithTeam = (teamKey: string) => {
    const team = displayStandings.find((item) => item.key === teamKey);
    if (!team) return;
    setEditStandingKey(team.key);
    setEditPlayed(String(team.played));
    setEditWins(String(team.wins));
    setEditDraws(String(team.draws));
    setEditLosses(String(team.losses));
    setEditGf(String(team.gf));
    setEditGa(String(team.ga));
    setEditPts(String(team.pts));
  };

  const submitStandingEdit = async () => {
    const response = await fetch(`${API_URL}/drafts/${leagueCode}/edit-standing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
        teamKey: editStandingKey,
        played: Number(editPlayed) || 0,
        wins: Number(editWins) || 0,
        draws: Number(editDraws) || 0,
        losses: Number(editLosses) || 0,
        gf: Number(editGf) || 0,
        ga: Number(editGa) || 0,
        pts: Number(editPts) || 0,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      alert(errorData?.error || "No se pudo editar la tabla");
      return;
    }

    const payload = (await response.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
    }
    setShowStandingEditForm(false);
  };

  const canManagePlayoffMatch = (match?: PlayoffMatch | null) =>
    Boolean(
      match &&
      match.homeKey &&
      match.awayKey &&
      (isOrganizer || match.homeKey === currentUser || match.awayKey === currentUser)
    );

  const submitPlayoffResult = async (stage: "semifinal1" | "semifinal2" | "final") => {
    const match = playoff?.[stage];
    if (!match) return;
    const homeGoalsText = window.prompt(`Goles de ${match.homeName}:`, "1");
    if (homeGoalsText === null) return;
    const awayGoalsText = window.prompt(`Goles de ${match.awayName}:`, "0");
    if (awayGoalsText === null) return;

    const response = await fetch(`${API_URL}/drafts/${leagueCode}/playoff-result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
        stage,
        homeGoals: Number(homeGoalsText) || 0,
        awayGoals: Number(awayGoalsText) || 0,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      alert(errorData?.error || "No se pudo guardar el resultado de liguilla");
      return;
    }

    const payload = (await response.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
    }
  };

  const finishPlayoff = async () => {
    const response = await fetch(`${API_URL}/drafts/${leagueCode}/finish-playoff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: currentUser }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      alert(errorData?.error || "No se pudo cerrar la liguilla");
      return;
    }

    const payload = (await response.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
    }
  };

  const toggleQuickTournamentTeam = (teamKey: string) => {
    setSelectedQuickTeams((current) =>
      current.includes(teamKey) ? current.filter((item) => item !== teamKey) : [...current, teamKey]
    );
  };

  const createQuickTournament = async () => {
    const response = await fetch(`${API_URL}/drafts/${leagueCode}/quick-tournament`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
        teamKeys: selectedQuickTeams,
        prize: Number(quickTournamentPrize) || 0,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      alert(errorData?.error || "No se pudo crear torneo rapido");
      return;
    }

    const payload = (await response.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
    }
    setShowQuickTournamentForm(false);
    setQuickTournamentPrize("6");
  };

  const submitQuickTournamentResult = async (roundIndex: number, matchId: string, homeName: string, awayName: string) => {
    const homeGoalsText = window.prompt(`Goles de ${homeName}:`, "1");
    if (homeGoalsText === null) return;
    const awayGoalsText = window.prompt(`Goles de ${awayName}:`, "0");
    if (awayGoalsText === null) return;

    const response = await fetch(`${API_URL}/drafts/${leagueCode}/quick-tournament-result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
        roundIndex,
        matchId,
        homeGoals: Number(homeGoalsText) || 0,
        awayGoals: Number(awayGoalsText) || 0,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      alert(errorData?.error || "No se pudo guardar el resultado del torneo rapido");
      return;
    }

    const payload = (await response.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
    }
  };

  const sendClubFeedMessage = async () => {
    const message = clubFeedMessage.trim();
    if (!message) return;

    const response = await fetch(`${API_URL}/drafts/${leagueCode}/news-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
        message,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      alert(errorData?.error || "No se pudo publicar el mensaje");
      return;
    }

    const payload = (await response.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
    }
    setClubFeedMessage("");
  };

  const changeSponsor = async () => {
    const confirmed = window.confirm(
      "El cambio de patrocinador es aleatorio y solo se puede hacer una vez por temporada. ¿Quieres continuar?"
    );
    if (!confirmed) return;

    const response = await fetch(`${API_URL}/drafts/${leagueCode}/change-sponsor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: currentUser,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      alert(errorData?.error || "No se pudo cambiar el patrocinador");
      return;
    }

    const payload = (await response.json().catch(() => null)) as DraftEvent | null;
    if (payload?.teams) {
      applyDraftPayload(payload);
    }
    alert("Patrocinador cambiado. Este movimiento ya no se puede repetir hasta la siguiente temporada.");
  };

  const canManageQuickMatch = (match: QuickTournamentMatch) =>
    isOrganizer || match.homeKey === currentUser || match.awayKey === currentUser;

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
        <p className="sponsor-note">
          Puedes cambiar patrocinador una sola vez por temporada y el cambio sera aleatorio.
        </p>
        <div className="sponsor-grid">
          {Object.entries(currentTeam.sponsor.values).map(([category, value]) => (
            <div key={category}>
              <span>{category}</span>
              <strong>{money(value)}</strong>
            </div>
          ))}
        </div>
        <button
          className={`small-action ${currentTeam.sponsorChangedThisSeason ? "muted" : ""}`}
          disabled={Boolean(currentTeam.sponsorChangedThisSeason)}
          onClick={changeSponsor}
        >
          {currentTeam.sponsorChangedThisSeason ? "CAMBIO USADO ESTA TEMPORADA" : "CAMBIAR PATROCINADOR"}
        </button>
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
      <p>
        Liga {leagueCode} |{" "}
        {regularSeasonComplete
          ? "Liga regular finalizada | Solo sigue la liguilla"
          : isOrganizer
            ? `Partidos clubes ${globalLeagueMatchCount}/${totalSeasonMatches} | Restan ${Math.max(totalSeasonMatches - globalLeagueMatchCount, 0)}`
            : `${currentTeam?.name || currentUser} ${currentClubMatchCount}/${matchesPerClub} partidos`}
      </p>

      {serverPhase === "dashboard" && (
        <button
          className="btn btn-login"
          disabled={!isOrganizer}
          onClick={startAuction}
        >
          {isOrganizer ? "INICIAR SUBASTA" : "ESPERANDO AL ORGANIZADOR"}
        </button>
      )}

      <div className="club-feed-composer">
        <input
          className="input"
          maxLength={220}
          placeholder={`Mensaje del club ${currentTeam?.name || currentUser}`}
          value={clubFeedMessage}
          onChange={(event) => setClubFeedMessage(event.target.value)}
        />
        <button className="small-action" onClick={sendClubFeedMessage}>
          PUBLICAR
        </button>
      </div>

      <div className="news-list">
        {news.length === 0 && <div className="draft-empty-state">Aun no hay noticias.</div>}
        {groupedNews.map((group) => (
          <div key={group.day} className="news-day-group">
            <div className="news-day-label">{group.day}</div>
            {group.items.map((item, index) => {
              const engagement = getEngagement(item, index);
              const author = getNewsAuthor(item);
              const tone = getNewsTone(item);
              const avatarImage = getNewsAvatarImage(item);
              return (
                <article key={`${item.text}-${item.createdAt || index}`} className={`news-item news-item-${tone}`}>
                  <div className={`news-avatar news-avatar-${tone}`}>
                    {avatarImage ? <img src={avatarImage} alt={author} /> : author.slice(0, 1)}
                  </div>
                  <div>
                    <strong>{author}</strong>
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
        ))}
      </div>
    </section>
  );

  const renderLeagueActionButton = (
    label: string,
    icon: IconName,
    onClick: () => void,
    options?: { active?: boolean; wide?: boolean; admin?: boolean }
  ) => (
    <button
      className={[
        "league-action-card",
        options?.active ? "active" : "",
        options?.wide ? "wide" : "",
        options?.admin ? "admin" : "",
      ].filter(Boolean).join(" ")}
      onClick={onClick}
    >
      <span className="league-action-icon">
        <DraftIcon name={icon} />
      </span>
      <span className="league-action-label">{label}</span>
    </button>
  );

  const renderClubActionButton = (
    label: string,
    icon: IconName,
    onClick: () => void,
    active: boolean
  ) => (
    <button
      className={["league-action-card", "club-action-card", active ? "active" : ""].filter(Boolean).join(" ")}
      onClick={onClick}
    >
      <span className="league-action-icon">
        <DraftIcon name={icon} />
      </span>
      <span className="league-action-label">{label}</span>
    </button>
  );

  const renderClub = () => (
    <section className="draft-panel">
      <h2>Club</h2>
      <div className="club-summary-bar">
        <div className="club-summary-item club-summary-name">
          <span>Club</span>
          <strong>{currentTeam?.name || currentUser}</strong>
        </div>
        <div className="club-summary-item">
          <span>Presupuesto</span>
          <strong className="money-positive">{money(currentTeam?.budget || 0)}</strong>
        </div>
        <div className="club-summary-item">
          <span>Masa salarial</span>
          <strong className="money-positive">
            {salary(currentPayroll)}/{salary(currentTeam?.salaryCap || settings.salaryCap)}
          </strong>
        </div>
        <div className="club-summary-item">
          <span>Plantilla</span>
          <strong>{currentTeam?.squad.length || 0}/{TEAM_SIZE_TARGET}</strong>
        </div>
      </div>
      <div className="club-actions-shell">
        <div className="club-actions-grid">
          {renderClubActionButton("PLANTILLA", "club", () => setClubView("plantilla"), clubView === "plantilla")}
          {renderClubActionButton("ENTRENAMIENTO", "add", () => setClubView("training"), clubView === "training")}
          {renderClubActionButton("PATROCINADOR", "prize", () => setClubView("sponsor"), clubView === "sponsor")}
        </div>
      </div>
      {clubView === "plantilla" && (
        <div className="card-grid">
          {(currentTeam?.squad || []).map((player) =>
            renderPlayerCard(player, (
              <div className="offer-actions" onClick={(event) => event.stopPropagation()}>
                <button
                  className={`small-action ${isProtectedPlayer(currentUser, player.ID) ? "protected-action" : ""}`}
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
      <h2>Liga</h2>
      <div className="draft-list-item season-prize-card">
        <div className="season-prize-header">
          <span className="season-prize-icon">
            <DraftIcon name="prize" />
          </span>
          <strong>Premios de temporada</strong>
        </div>
        <p>Liga: {money(settings.leaguePrize || 0)} para cada club real</p>
        <small>
          Liguilla: 1ro {money(settings.playoffPrize1 || 0)} | 2do {money(settings.playoffPrize2 || 0)} | 3ro{" "}
          {money(settings.playoffPrize3 || 0)} | 4to {money(settings.playoffPrize4 || 0)}
        </small>
      </div>
      <div className="league-actions-shell">
        <div className="league-action-feature">
          {renderLeagueActionButton("AGREGAR RESULTADO", "add", () => setShowResultForm(true), { wide: true, active: true })}
        </div>
        <div className="league-actions-grid">
          {renderLeagueActionButton("TABLA", "table", () => setTableView("tabla"), { active: tableView === "tabla" })}
          {renderLeagueActionButton("CLUBES", "clubs", () => setTableView("clubes"), { active: tableView === "clubes" })}
          {renderLeagueActionButton("LIGUILLA", "playoff", () => setTableView("liguilla"), { active: tableView === "liguilla" })}
          {renderLeagueActionButton("TORNEO RAPIDO", "quick", () => setTableView("torneo"), { active: tableView === "torneo" })}
          {settings.leagueType === "Fantasia" &&
            renderLeagueActionButton("PARTIDOS", "league", () => setTableView("partidos"), { active: tableView === "partidos" })}
        </div>
        {isOrganizer && settings.fillCpuTeams && settings.leagueType !== "Fantasia" && (
          <div className="league-admin-block">
            <div className="league-admin-title">Administracion</div>
            <div className="league-admin-grid">
              {renderLeagueActionButton("EDITAR TABLA", "edit", openStandingEditor, { admin: true })}
              {renderLeagueActionButton("RENOMBRAR CLUBES", "rename", () => setShowCpuRenameForm(true), { admin: true })}
            </div>
          </div>
        )}
      </div>
      {tableView === "tabla" ? (
        <div className="league-table">
          {displayStandings.map((team, index) => (
            <div key={team.key} className="league-row rich">
              <span className="league-rank">{index + 1}</span>
              <div className="league-main">
                <strong className={seasonChampionKey === team.key ? "champion-name" : ""}>
                  {championLabel(team.key, team.name)}
                </strong>
                <em>{team.champions ? "Champions" : "Liga"}</em>
              </div>
              <div className="league-stats-grid">
                <small><b>{team.played}</b> PJ</small>
                <small><b>{team.wins}</b> G</small>
                <small><b>{team.draws}</b> E</small>
                <small><b>{team.losses}</b> P</small>
                <small><b>{team.gf}</b> GF</small>
                <small><b>{team.ga}</b> GC</small>
              </div>
              <b className="league-points">{team.pts} pts</b>
            </div>
          ))}
        </div>
      ) : tableView === "clubes" ? (
        <div className="clubs-view">
          <div className="club-chip-grid">
            {realLeagueClubs.map((team) => (
              <button
                key={team.key}
                className={`club-chip ${selectedLeagueClubStanding?.key === team.key ? "active" : ""}`}
                onClick={() => setSelectedLeagueClub(team.key)}
              >
                {championLabel(team.key, team.name)}
              </button>
            ))}
          </div>
          {selectedLeagueClubStanding && (
            <div className="clubs-panel">
              <div className="draft-list-item club-summary-card">
                <strong className={seasonChampionKey === selectedLeagueClubStanding.key ? "champion-name" : ""}>
                  {championLabel(selectedLeagueClubStanding.key, selectedLeagueClubStanding.name)}
                </strong>
                <div className="club-summary-stats">
                  <small><b>{selectedLeagueClubStanding.played}</b> PJ</small>
                  <small><b>{selectedLeagueClubStanding.wins}</b> G</small>
                  <small><b>{selectedLeagueClubStanding.draws}</b> E</small>
                  <small><b>{selectedLeagueClubStanding.losses}</b> P</small>
                  <small><b>{selectedLeagueClubStanding.gf}</b> GF</small>
                  <small><b>{selectedLeagueClubStanding.ga}</b> GC</small>
                </div>
              </div>
              <div className="card-grid">
                {(selectedLeagueClubTeam?.squad || []).map((player) => renderPlayerCard(player))}
              </div>
            </div>
          )}
        </div>
      ) : tableView === "liguilla" ? (
        <div className="playoff-grid">
          {liguillaTeams.length < 4 ? (
            <div className="draft-empty-state">Todavia no hay suficientes clubes para mostrar la liguilla.</div>
          ) : (
            <>
              <div className="draft-list-item">
                <strong>Semifinal 1</strong>
                <p>{playoff?.semifinal1.homeName || liguillaTeams[0]?.name} vs {playoff?.semifinal1.awayName || liguillaTeams[3]?.name}</p>
                {playoff?.semifinal1.result && (
                  <small>
                    {playoff.semifinal1.result.homeGoals}-{playoff.semifinal1.result.awayGoals} | Gana {playoff.semifinal1.result.homeGoals > playoff.semifinal1.result.awayGoals ? playoff.semifinal1.homeName : playoff.semifinal1.awayName}
                  </small>
                )}
                {canManagePlayoffMatch(playoff?.semifinal1) && (
                  <button className="small-action" onClick={() => submitPlayoffResult("semifinal1")}>
                    AGREGAR RESULTADO
                  </button>
                )}
              </div>
              <div className="draft-list-item">
                <strong>Semifinal 2</strong>
                <p>{playoff?.semifinal2.homeName || liguillaTeams[1]?.name} vs {playoff?.semifinal2.awayName || liguillaTeams[2]?.name}</p>
                {playoff?.semifinal2.result && (
                  <small>
                    {playoff.semifinal2.result.homeGoals}-{playoff.semifinal2.result.awayGoals} | Gana {playoff.semifinal2.result.homeGoals > playoff.semifinal2.result.awayGoals ? playoff.semifinal2.homeName : playoff.semifinal2.awayName}
                  </small>
                )}
                {canManagePlayoffMatch(playoff?.semifinal2) && (
                  <button className="small-action" onClick={() => submitPlayoffResult("semifinal2")}>
                    AGREGAR RESULTADO
                  </button>
                )}
              </div>
              <div className="draft-list-item current-round">
                <strong>Final</strong>
                <p>{playoff?.final.homeName || "Pendiente"} vs {playoff?.final.awayName || "Pendiente"}</p>
                {playoff?.final.result ? (
                  <small>
                    {playoff.final.result.homeGoals}-{playoff.final.result.awayGoals} | Campeon {playoff.final.result.homeGoals > playoff.final.result.awayGoals ? playoff.final.homeName : playoff.final.awayName}
                  </small>
                ) : (
                  <small>La final se habilita cuando se definan ambas semifinales.</small>
                )}
                {canManagePlayoffMatch(playoff?.final) && (
                  <button className="small-action" onClick={() => submitPlayoffResult("final")}>
                    AGREGAR RESULTADO FINAL
                  </button>
                )}
                {isOrganizer && (
                  <button className="small-action protected-action" onClick={finishPlayoff}>
                    TERMINAR LIGUILLA
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ) : tableView === "torneo" ? (
        <div className="playoff-grid">
          {!quickTournament?.active ? (
            isOrganizer ? (
              <>
                <div className="draft-list-item">
                  <strong>Crear torneo rapido</strong>
                  <p>Selecciona clubes reales, el orden sera aleatorio y se rellenara con CPU si hace falta.</p>
                  <small>Premio al campeon: {money(Number(quickTournamentPrize) || 0)}</small>
                </div>
                <button className="btn btn-login compact-btn" onClick={() => setShowQuickTournamentForm(true)}>
                  CREAR TORNEO RAPIDO
                </button>
              </>
            ) : (
              <div className="draft-empty-state">Por el momento no hay torneo rapido.</div>
            )
          ) : (
            <>
              <div className="draft-list-item">
                <strong>Bolsa del torneo rapido</strong>
                <p>{money(Number(quickTournament.prize || 0))} para el campeon</p>
              </div>
              {quickTournament.rounds.map((round, roundIndex) => (
                <div key={`quick-round-${round.name}`} className="draft-list-item current-round">
                  <strong>{round.name}</strong>
                  <div className="schedule-round">
                    {round.matches.map((match) => (
                      <div key={match.id} className="draft-list-item">
                        <p>{match.homeName || "Pendiente"} vs {match.awayName || "Pendiente"}</p>
                        {match.result ? (
                          <small>
                            {match.result.homeGoals}-{match.result.awayGoals} | Gana {match.result.homeGoals > match.result.awayGoals ? match.homeName : match.awayName}
                          </small>
                        ) : (
                          <small>Pendiente</small>
                        )}
                        {match.homeKey && match.awayKey && canManageQuickMatch(match) && !match.played && (
                          <button className="small-action" onClick={() => submitQuickTournamentResult(roundIndex, match.id, match.homeName, match.awayName)}>
                            AGREGAR RESULTADO
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {quickTournament.championKey && (
                <div className="draft-list-item">
                  <strong>Campeon</strong>
                  <p>
                    {championLabel(
                      quickTournament.championKey,
                      displayStandings.find((team) => team.key === quickTournament.championKey)?.name || quickTournament.championKey
                    )}
                  </p>
                </div>
              )}
            </>
          )}
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
              : regularSeasonComplete
                ? "La liga regular ya termino. En este momento solo queda jugar la liguilla."
              : transferWindowOpen
                ? `Ventana de mercado disponible | No puedes pasar de ${TEAM_SIZE_TARGET} jugadores ni de ${salary(settings.salaryCap)} por temporada`
                : `Mercado cerrado hasta la mitad de temporada (${midSeasonMatch})`}
          </p>
        </div>
      </div>

      {regularSeasonComplete && phase !== "auction" && phase !== "market" && (
        <div className="draft-empty-state">
          La temporada regular ya se cerro. Terminen la liguilla para reiniciar subastas y transferencias.
        </div>
      )}

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
          <div className="transfer-search-actions">
            <button
              className={`small-action ${showFilters ? "active-filter-toggle" : ""}`}
              onClick={() => setShowFilters((current) => !current)}
            >
              FILTROS
            </button>
            <button className="btn btn-login compact-btn" onClick={() => runPlayerSearch()}>
              BUSCAR
            </button>
          </div>
          {showFilters && (
            <div className="transfer-filters">
              <select className="input" value={searchPosition} onChange={(event) => setSearchPosition(event.target.value)}>
                <option value="all">Todas las posiciones</option>
                <option value="POR">Porteros</option>
                <option value="DEF">Defensas</option>
                <option value="MED">Mediocampo</option>
                <option value="EXT">Extremos</option>
                <option value="DEL">Delanteros</option>
              </select>
              <div className="range-filter">
                <input
                  className="input"
                  value={searchMinOverall}
                  onChange={(event) => setSearchMinOverall(event.target.value)}
                  inputMode="numeric"
                  placeholder="1"
                />
                <span>a</span>
                <input
                  className="input"
                  value={searchMaxOverall}
                  onChange={(event) => setSearchMaxOverall(event.target.value)}
                  inputMode="numeric"
                  placeholder="99"
                />
                <small>GLB</small>
              </div>
              <div className="range-filter">
                <input
                  className="input"
                  value={searchMinValue}
                  onChange={(event) => setSearchMinValue(event.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                />
                <span>a</span>
                <input
                  className="input"
                  value={searchMaxValue}
                  onChange={(event) => setSearchMaxValue(event.target.value)}
                  inputMode="decimal"
                  placeholder="999"
                />
                <small>M</small>
              </div>
            </div>
          )}
          <div className="card-grid">
            {appliedSearch.nonce === 0 && <div className="draft-empty-state">Busca por nombre o abre filtros y pulsa buscar.</div>}
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
                      className={`small-action ${playerProtected ? "muted" : "protected-action"}`}
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

      {phase !== "auction" && phase !== "market" && !transferWindowOpen && !regularSeasonComplete && (
        <div className="draft-empty-state">
          El mercado se abre al inicio y en la mitad de temporada.
        </div>
      )}
    </section>
  );

  const renderPanel = () => {
    if (activeTab === "Inicio") return renderInicio();
    if (activeTab === "Club") return renderClub();
    if (activeTab === "Liga") return renderTable();
    return renderTransfer();
  };

  const handleShellTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (showInbox || selectedPlayer || showResultForm || showQuickTournamentForm) return;
    const touch = event.changedTouches[0];
    shellTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleShellTouchEnd = (event: TouchEvent<HTMLElement>) => {
    if (!shellTouchStartRef.current || showInbox || selectedPlayer || showResultForm || showQuickTournamentForm) {
      shellTouchStartRef.current = null;
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - shellTouchStartRef.current.x;
    const deltaY = touch.clientY - shellTouchStartRef.current.y;
    shellTouchStartRef.current = null;

    if (Math.abs(deltaX) < 70 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) {
      return;
    }

    if (deltaX < 0 && activeTabIndex < tabs.length - 1) {
      setActiveTab(tabs[activeTabIndex + 1]);
    }

    if (deltaX > 0 && activeTabIndex > 0) {
      setActiveTab(tabs[activeTabIndex - 1]);
    }
  };

  if (serverPhase === "selection") {
    return renderSelection();
  }

  return (
    <main className="draft-shell">
      <header className="draft-topbar">
        <div className="draft-heading">
          <span className="form-kicker">Draft en vivo</span>
          <h1>Ultimate Fantasy League</h1>
          <span className="draft-version-badge">v{UI_VERSION}</span>
        </div>
        <div className="draft-toolbar">
          <button className="small-action inbox-btn" onClick={() => setShowInbox(true)}>
            <DraftIcon name="inbox" />
            <span>Buzon</span>
            {myInbox.length > 0 && <span className="notif-dot toolbar-dot"></span>}
          </button>
          <button className="logout-btn draft-logout" onClick={onLogout}>
            <DraftIcon name="logout" />
          </button>
        </div>
      </header>

      <nav
        className="draft-tabs bottom-tabs"
        style={{ "--active-tab": activeTabIndex } as CSSProperties}
      >
        <div className="bottom-tab-indicator" />
        {tabs.map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? "active" : ""}
            onClick={() => setActiveTab(tab)}
          >
            <span className="tab-button-inner">
              <span className="tab-icon-wrap">
                <DraftIcon name={tabIcons[tab]} />
              </span>
              <span className="tab-label">{tab}</span>
            </span>
            {tab === "Transferencia" && pendingReceived > 0 && <span className="notif-dot"></span>}
          </button>
        ))}
      </nav>

      <section onTouchStart={handleShellTouchStart} onTouchEnd={handleShellTouchEnd}>
        {renderPanel()}
      </section>

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
                <select className="input" value={goalsFor} onChange={(e) => setGoalsFor(e.target.value)}>
                  {scoreOptions.map((value) => (
                    <option key={`gf-${value}`} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Marcador rival</span>
                <select className="input" value={goalsAgainst} onChange={(e) => setGoalsAgainst(e.target.value)}>
                  {scoreOptions.map((value) => (
                    <option key={`ga-${value}`} value={value}>{value}</option>
                  ))}
                </select>
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
                      <select
                        className="input scorer-goals"
                        value={row.goals}
                        onChange={(e) => updateGoalRow("mine", index, "goals", e.target.value)}
                      >
                        {scorerGoalOptions.map((value) => (
                          <option key={`mine-goals-${index}-${value}`} value={value}>{value}</option>
                        ))}
                      </select>
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
                        <select
                          className="input scorer-goals"
                          value={row.goals}
                          onChange={(e) => updateGoalRow("opponent", index, "goals", e.target.value)}
                        >
                          {scorerGoalOptions.map((value) => (
                            <option key={`opp-goals-${index}-${value}`} value={value}>{value}</option>
                          ))}
                        </select>
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
                <select className="input" value={teamCards} onChange={(e) => setTeamCards(e.target.value)}>
                  {scoreOptions.map((value) => (
                    <option key={`team-cards-${value}`} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Tarjetas del rival</span>
                <select className="input" value={opponentCards} onChange={(e) => setOpponentCards(e.target.value)}>
                  {scoreOptions.map((value) => (
                    <option key={`opp-cards-${value}`} value={value}>{value}</option>
                  ))}
                </select>
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

      {showStandingEditForm && settings.leagueType !== "Fantasia" && (
        <div className="player-modal" onClick={() => setShowStandingEditForm(false)}>
          <div className="player-modal-card" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowStandingEditForm(false)}>Cerrar</button>
            <h2>Editar tabla</h2>
            <div className="form-grid">
              <label className="field">
                <span>Equipo</span>
                <select className="input" value={editStandingKey} onChange={(e) => syncStandingFormWithTeam(e.target.value)}>
                  {displayStandings.map((team) => (
                    <option key={team.key} value={team.key}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Partidos jugados</span>
                <input className="input" value={editPlayed} onChange={(e) => setEditPlayed(e.target.value)} />
              </label>
              <label className="field">
                <span>Ganados</span>
                <input className="input" value={editWins} onChange={(e) => setEditWins(e.target.value)} />
              </label>
              <label className="field">
                <span>Empatados</span>
                <input className="input" value={editDraws} onChange={(e) => setEditDraws(e.target.value)} />
              </label>
              <label className="field">
                <span>Perdidos</span>
                <input className="input" value={editLosses} onChange={(e) => setEditLosses(e.target.value)} />
              </label>
              <label className="field">
                <span>Goles a favor</span>
                <input className="input" value={editGf} onChange={(e) => setEditGf(e.target.value)} />
              </label>
              <label className="field">
                <span>Goles en contra</span>
                <input className="input" value={editGa} onChange={(e) => setEditGa(e.target.value)} />
              </label>
              <label className="field">
                <span>Puntos</span>
                <input className="input" value={editPts} onChange={(e) => setEditPts(e.target.value)} />
              </label>
            </div>
            <button className="btn btn-login" onClick={submitStandingEdit}>GUARDAR</button>
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

      {showQuickTournamentForm && (
        <div className="player-modal" onClick={() => setShowQuickTournamentForm(false)}>
          <div className="player-modal-card" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowQuickTournamentForm(false)}>Cerrar</button>
            <h2>Crear torneo rapido</h2>
            <label className="field">
              <span>Premio del torneo</span>
              <select
                className="input"
                value={quickTournamentPrize}
                onChange={(event) => setQuickTournamentPrize(event.target.value)}
              >
                <option value="2">2M</option>
                <option value="4">4M</option>
                <option value="6">6M</option>
                <option value="8">8M</option>
                <option value="10">10M</option>
                <option value="12">12M</option>
              </select>
            </label>
            <div className="offers-panel">
              {realLeagueClubs.map((team) => (
                <article key={`quick-team-${team.key}`} className="offer-card">
                  <strong>{team.name}</strong>
                  <div className="offer-actions">
                    <button
                      className={`small-action ${selectedQuickTeams.includes(team.key) ? "protected-action" : ""}`}
                      onClick={() => toggleQuickTournamentTeam(team.key)}
                    >
                      {selectedQuickTeams.includes(team.key) ? "Seleccionado" : "Elegir"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <button className="btn btn-login" onClick={createQuickTournament}>CREAR</button>
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
                    className={`small-action ${isProtected ? "muted" : "protected-action"}`}
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

      {championOverlay && (
        <div className="champion-overlay" onClick={() => setChampionOverlay(null)}>
          <div className="champion-overlay-card" onClick={(event) => event.stopPropagation()}>
            <div className="champion-glow-ring" />
            <span className="champion-kicker">Campeon de temporada</span>
            <h2>{championOverlay.name} ★</h2>
            <p>La liga regular ya tiene dueño. Ahora solo queda cerrar la liguilla.</p>
            <div className="champion-confetti" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <button className="btn btn-login" onClick={() => setChampionOverlay(null)}>
              ENTENDIDO
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
