import { useEffect, useState } from "react";
import "./styles.css";
import Draft from "./Draft";
import Lobby from "./Lobby";
import logo from "./assets/logo.png";

const APP_VERSION = "0.911";

type LobbyData = {
  code: string;
  leagueName: string;
  creator?: string;
  maxManagers?: number;
  managers?: number;
  format?: string;
  leagueType?: string;
  money?: number;
  salaryCap?: number;
  champions?: boolean;
  fillCpuTeams?: boolean;
  randomEvents?: boolean;
  leaguePrize?: number;
  playoffPrize1?: number;
  playoffPrize2?: number;
  playoffPrize3?: number;
  playoffPrize4?: number;
  players: string[];
  status?: "waiting" | "started";
  deleted?: boolean;
};

type LeagueSettings = {
  format: string;
  leagueType: string;
  money: number;
  salaryCap: number;
  champions: boolean;
  fillCpuTeams: boolean;
  randomEvents: boolean;
  leaguePrize: number;
  playoffPrize1: number;
  playoffPrize2: number;
  playoffPrize3: number;
  playoffPrize4: number;
};

type SavedLeague = {
  code: string;
  leagueName: string;
  creator: string;
  status: "waiting" | "started";
  updatedAt: number;
};

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "");

const getLobbyMaxManagers = (lobby: LobbyData) => {
  return lobby.maxManagers || lobby.managers;
};

const getLeagueSettings = (
  lobby: LobbyData,
  fallback: LeagueSettings
): LeagueSettings => ({
  format: lobby.format || fallback.format,
  leagueType: lobby.leagueType || fallback.leagueType,
  money: lobby.money || fallback.money,
  salaryCap: lobby.salaryCap || fallback.salaryCap,
  champions: lobby.champions ?? fallback.champions,
  fillCpuTeams: lobby.fillCpuTeams ?? fallback.fillCpuTeams,
  randomEvents: lobby.randomEvents ?? fallback.randomEvents,
  leaguePrize: lobby.leaguePrize || fallback.leaguePrize,
  playoffPrize1: lobby.playoffPrize1 || fallback.playoffPrize1,
  playoffPrize2: lobby.playoffPrize2 || fallback.playoffPrize2,
  playoffPrize3: lobby.playoffPrize3 || fallback.playoffPrize3,
  playoffPrize4: lobby.playoffPrize4 || fallback.playoffPrize4,
});

const getSavedLeaguesKey = (user: string) => `ufl-saved-leagues:${user}`;

export default function App() {
  const [screen, setScreen] = useState("home");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentUser, setCurrentUser] = useState("");

  // liga
  const [leagueName, setLeagueName] = useState("");
  const [managers, setManagers] = useState("4");
  const [champions, setChampions] = useState(false);
  const [fillCpuTeams, setFillCpuTeams] = useState(true);
  const [randomEvents, setRandomEvents] = useState(true);
  const [format, setFormat] = useState("Normal");
  const [leagueType, setLeagueType] = useState("Real");
  const [money, setMoney] = useState(220);
  const [salaryCap, setSalaryCap] = useState(1500);
  const [leaguePrize, setLeaguePrize] = useState(50);
  const [playoffPrize1, setPlayoffPrize1] = useState(30);
  const [playoffPrize2, setPlayoffPrize2] = useState(20);
  const [playoffPrize3, setPlayoffPrize3] = useState(10);
  const [playoffPrize4, setPlayoffPrize4] = useState(10);

  // lobby
  const [leagueCode, setLeagueCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [players, setPlayers] = useState<string[]>([]);
  const [lobbyCreator, setLobbyCreator] = useState("");
  const [lobbyMaxManagers, setLobbyMaxManagers] = useState(4);
  const [lobbyStatus, setLobbyStatus] = useState<"waiting" | "started">("waiting");
  const [savedLeagues, setSavedLeagues] = useState<SavedLeague[]>([]);
  const [leagueSettings, setLeagueSettings] = useState<LeagueSettings>({
    format: "Normal",
    leagueType: "Real",
    money: 220,
    salaryCap: 1500,
    champions: false,
    fillCpuTeams: true,
    randomEvents: true,
    leaguePrize: 50,
    playoffPrize1: 30,
    playoffPrize2: 20,
    playoffPrize3: 10,
    playoffPrize4: 10,
  });

  const persistLeague = (league: SavedLeague) => {
    if (!currentUser) return;

    setSavedLeagues((currentLeagues) => {
      const nextLeagues = [
        league,
        ...currentLeagues.filter((item) => item.code !== league.code),
      ].sort((a, b) => b.updatedAt - a.updatedAt);

      localStorage.setItem(getSavedLeaguesKey(currentUser), JSON.stringify(nextLeagues));
      return nextLeagues;
    });
  };

  const loadSavedLeagues = async (user: string) => {
    if (!user) {
      setSavedLeagues([]);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/users/${encodeURIComponent(user)}/leagues`);
      if (!response.ok) {
        throw new Error("No se pudieron cargar las ligas del usuario");
      }

      const data = await response.json();
      const serverLeagues: SavedLeague[] = Array.isArray(data.leagues) ? data.leagues : [];
      setSavedLeagues(serverLeagues);
      localStorage.setItem(getSavedLeaguesKey(user), JSON.stringify(serverLeagues));
    } catch (error) {
      const stored = localStorage.getItem(getSavedLeaguesKey(user));
      setSavedLeagues(stored ? JSON.parse(stored) : []);
    }
  };

  const removeSavedLeague = (code: string) => {
    if (!currentUser) return;

    setSavedLeagues((currentLeagues) => {
      const nextLeagues = currentLeagues.filter((item) => item.code !== code);
      localStorage.setItem(getSavedLeaguesKey(currentUser), JSON.stringify(nextLeagues));
      return nextLeagues;
    });
  };

  useEffect(() => {
    if (!currentUser) {
      setSavedLeagues([]);
      return;
    }

    loadSavedLeagues(currentUser);
  }, [currentUser]);

  useEffect(() => {
    if (screen !== "lobby" || !leagueCode) return;

    const events = new EventSource(`${API_URL}/lobbies/${leagueCode}/events`);

    events.onmessage = (event) => {
      const lobby: LobbyData = JSON.parse(event.data);

      if (lobby.deleted) {
        removeSavedLeague(lobby.code || leagueCode);
        setLeagueCode("");
        setPlayers([]);
        setLobbyCreator("");
        setLobbyStatus("waiting");
        setScreen("dashboard");
        return;
      }

      const nextMaxManagers = getLobbyMaxManagers(lobby);
      setPlayers(lobby.players);
      setLobbyCreator((currentCreator) => lobby.creator || currentCreator);
      setLobbyMaxManagers((currentMaxManagers) => nextMaxManagers || currentMaxManagers);
      setLobbyStatus(lobby.status || "waiting");
      setLeagueSettings((currentSettings) => getLeagueSettings(lobby, currentSettings));
      persistLeague({
        code: lobby.code,
        leagueName: lobby.leagueName,
        creator: lobby.creator || lobbyCreator || currentUser,
        status: lobby.status || "waiting",
        updatedAt: Date.now(),
      });
    };

    events.onerror = () => {
      events.close();
    };

    return () => {
      events.close();
    };
  }, [screen, leagueCode, currentUser, lobbyCreator]);

  useEffect(() => {
    if (screen !== "continue" || savedLeagues.length === 0) return;

    let cancelled = false;

    Promise.all(
      savedLeagues.map(async (savedLeague) => {
        try {
          const response = await fetch(`${API_URL}/lobbies/${savedLeague.code}`);
          return response.ok ? savedLeague : null;
        } catch {
          return savedLeague;
        }
      })
    ).then((existingLeagues) => {
      if (cancelled) return;

      const nextLeagues = existingLeagues.filter(Boolean) as SavedLeague[];
      if (nextLeagues.length !== savedLeagues.length) {
        setSavedLeagues(nextLeagues);
        if (currentUser) {
          localStorage.setItem(getSavedLeaguesKey(currentUser), JSON.stringify(nextLeagues));
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [screen, savedLeagues, currentUser]);

  useEffect(() => {
    if (screen !== "continue" || !currentUser) return;
    loadSavedLeagues(currentUser);
  }, [screen, currentUser]);

  useEffect(() => {
    if (screen === "lobby" && lobbyStatus === "started") {
      setScreen("draft");
    }
  }, [screen, lobbyStatus]);

  const handleLogin = async () => {
    try {
      const res = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        alert(text || "Error login");
        return;
      }

      const data = await res.json();
      setCurrentUser(data.user);
      setScreen("dashboard");
    } catch (error) {
      alert(`No se pudo conectar con el servidor (${API_URL}). Revisa que el backend y el tunnel esten activos.`);
      console.error(error);
    }
  };

  const handleLogout = () => {
    setUsername("");
    setPassword("");
    setCurrentUser("");
    setLeagueCode("");
    setJoinCode("");
    setPlayers([]);
    setLobbyCreator("");
    setLobbyMaxManagers(4);
    setLobbyStatus("waiting");
      setLeagueSettings({
        format: "Normal",
        leagueType: "Real",
        money: 220,
        salaryCap: 1500,
        champions: false,
        fillCpuTeams: true,
        randomEvents: true,
        leaguePrize: 50,
        playoffPrize1: 30,
        playoffPrize2: 20,
        playoffPrize3: 10,
        playoffPrize4: 10,
      });
    setScreen("login");
  };

  const createLeague = async () => {
    const managerCount = Number(managers);
    if (!leagueName) return alert("Pon nombre");
    if (!currentUser) return alert("Inicia sesion primero");
    if (!Number.isInteger(managerCount) || managerCount < 2 || managerCount > 20) {
      alert("El numero de jugadores debe estar entre 2 y 20");
      return;
    }

    const nextSettings = {
      format,
      leagueType,
      money,
      salaryCap,
      champions,
      fillCpuTeams,
      randomEvents,
      leaguePrize,
      playoffPrize1,
      playoffPrize2,
      playoffPrize3,
      playoffPrize4,
    };

    let res: Response;
    try {
      res = await fetch(`${API_URL}/lobbies`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leagueName,
          username: currentUser,
          managers: managerCount,
          champions,
          fillCpuTeams,
          randomEvents,
          format,
          leagueType,
          money,
          salaryCap,
          leaguePrize,
          playoffPrize1,
          playoffPrize2,
          playoffPrize3,
          playoffPrize4,
        }),
      });
    } catch (error) {
      alert(`No se pudo conectar con el servidor (${API_URL}).`);
      console.error(error);
      return;
    }

    if (!res.ok) {
      alert("No se pudo crear la liga");
      return;
    }

    const lobby: LobbyData = await res.json();
    setLeagueCode(lobby.code);
    setPlayers(lobby.players);
    setLobbyCreator(lobby.creator || currentUser);
    setLobbyMaxManagers(getLobbyMaxManagers(lobby) || managerCount);
    setLobbyStatus(lobby.status || "waiting");
    setLeagueSettings(getLeagueSettings(lobby, nextSettings));
    persistLeague({
      code: lobby.code,
      leagueName: lobby.leagueName,
      creator: lobby.creator || currentUser,
      status: lobby.status || "waiting",
      updatedAt: Date.now(),
    });
    setScreen("lobby");
  };

  const goJoin = () => {
    setJoinCode("");
    setScreen("join");
  };

  const joinLobby = async () => {
    const code = joinCode.trim();

    if (!/^\d{4}$/.test(code)) {
      alert("El codigo debe tener 4 numeros");
      return;
    }

    if (!currentUser) {
      alert("Inicia sesion primero");
      return;
    }

    let res: Response;
    try {
      res = await fetch(`${API_URL}/lobbies/${code}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: currentUser }),
      });
    } catch (error) {
      alert(`No se pudo conectar con el servidor (${API_URL}).`);
      console.error(error);
      return;
    }

    if (!res.ok) {
      alert("No se encontro una liga con ese codigo");
      return;
    }

    const lobby: LobbyData = await res.json();
    const nextMaxManagers = getLobbyMaxManagers(lobby);
    setLeagueCode(lobby.code);
    setPlayers(lobby.players);
    setLobbyCreator(lobby.creator || "");
    setLobbyMaxManagers((currentMaxManagers) => nextMaxManagers || currentMaxManagers);
    setLobbyStatus(lobby.status || "waiting");
    setLeagueSettings((currentSettings) => getLeagueSettings(lobby, currentSettings));
    persistLeague({
      code: lobby.code,
      leagueName: lobby.leagueName,
      creator: lobby.creator || "",
      status: lobby.status || "waiting",
      updatedAt: Date.now(),
    });
    setScreen("lobby");
  };

  const startLeague = async () => {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/lobbies/${leagueCode}/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: currentUser }),
      });
    } catch (error) {
      alert(`No se pudo conectar con el servidor (${API_URL}).`);
      console.error(error);
      return;
    }

    if (!res.ok) {
      alert("Todavia no se puede iniciar la liga");
      return;
    }

    const lobby: LobbyData = await res.json();
    const nextMaxManagers = getLobbyMaxManagers(lobby);
    setPlayers(lobby.players);
    setLobbyMaxManagers((currentMaxManagers) => nextMaxManagers || currentMaxManagers);
    setLobbyStatus(lobby.status || "started");
    setLeagueSettings((currentSettings) => getLeagueSettings(lobby, currentSettings));
    persistLeague({
      code: lobby.code,
      leagueName: lobby.leagueName,
      creator: lobby.creator || lobbyCreator || currentUser,
      status: lobby.status || "started",
      updatedAt: Date.now(),
    });
  };

  const continueLeague = async (savedLeague: SavedLeague) => {
    try {
      const res = await fetch(`${API_URL}/lobbies/${savedLeague.code}`);

      if (!res.ok) {
        removeSavedLeague(savedLeague.code);
        alert("La liga ya no esta disponible");
        return;
      }

      const lobby: LobbyData = await res.json();
      const nextMaxManagers = getLobbyMaxManagers(lobby);
      setLeagueCode(lobby.code);
      setPlayers(lobby.players);
      setLobbyCreator(lobby.creator || "");
      setLobbyMaxManagers(nextMaxManagers || 4);
      setLobbyStatus(lobby.status || "waiting");
      setLeagueSettings((currentSettings) => getLeagueSettings(lobby, currentSettings));
      persistLeague({
        code: lobby.code,
        leagueName: lobby.leagueName,
        creator: lobby.creator || "",
        status: lobby.status || "waiting",
        updatedAt: Date.now(),
      });
      setScreen((lobby.status || "waiting") === "started" ? "draft" : "lobby");
    } catch (error) {
      alert("No se pudo cargar la liga");
      console.error(error);
    }
  };

  const deleteLeague = async (savedLeague: SavedLeague) => {
    if (savedLeague.creator !== currentUser) return;

    try {
      const res = await fetch(`${API_URL}/lobbies/${savedLeague.code}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: currentUser }),
      });

      if (res.status === 404) {
        removeSavedLeague(savedLeague.code);
        return;
      }

      if (!res.ok) {
        alert("No se pudo eliminar la liga");
        return;
      }

      removeSavedLeague(savedLeague.code);
    } catch (error) {
      alert("No se pudo eliminar la liga");
      console.error(error);
    }
  };

  if (screen === "draft") {
    return (
      <Draft
        key={`${leagueCode}-${currentUser}`}
        leagueCode={leagueCode}
        players={players}
        currentUser={currentUser}
        settings={leagueSettings}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="container">

      {/* TOP */}
      <div className="top" style={{ position: "relative" }}>
        <img src={logo} className="logo" />

        {currentUser && screen !== "login" && (
          <button className="logout-btn" onClick={handleLogout}>
            Cerrar sesion
          </button>
        )}
      </div>

      {/* ===== HOME ===== */}
      {screen === "home" && (
        <div className="bottom">
          <button
            className="btn btn-login"
            onClick={() => setScreen("login")}
          >
            LOGIN
          </button>

          <button className="btn btn-outline" disabled>
            SIGN IN
          </button>
        </div>
      )}

      {/* ===== LOGIN ===== */}
      {screen === "login" && (
        <div className="bottom">
          <div className="login-version">v{APP_VERSION}</div>

          <input
            className="input"
            placeholder="Usuario"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />

          <input
            className="input"
            type="password"
            placeholder="Contrasena"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button className="btn btn-login" onClick={handleLogin}>
            ENTRAR
          </button>

          <button
            className="btn btn-outline"
            onClick={() => setScreen("home")}
          >
            VOLVER
          </button>
        </div>
      )}

      {/* ===== DASHBOARD ===== */}
      {screen === "dashboard" && (
        <div className="bottom">
          <button
            className="btn btn-login"
            onClick={() => setScreen("create")}
          >
            Crear Liga Local
          </button>

          <button
            className="btn btn-login"
            onClick={() => setScreen("create")}
          >
            Crear Liga Online
          </button>

          <button className="btn btn-login" onClick={goJoin}>
            Unirme a Liga
          </button>

          <button className="btn btn-outline" onClick={() => setScreen("continue")}>
            Continuar Liga
          </button>
        </div>
      )}

      {/* ===== CREAR ===== */}
      {screen === "create" && (
        <div className="overlay">
          <div className="overlay-card create-card">

            <div className="form-header">
              <span className="form-kicker">Nueva liga</span>
              <h2>Configura tu liga</h2>
            </div>

            <label className="field">
              <span>Nombre de la liga</span>
              <input
                className="input"
                placeholder="Ultimate League"
                value={leagueName}
                onChange={(e) => setLeagueName(e.target.value)}
              />
            </label>

            <label className="field">
              <span>Jugadores</span>
              <input
                className="input"
                min={2}
                max={20}
                type="number"
                value={managers}
                onChange={(e) => setManagers(e.target.value)}
              />
            </label>

            <div className="switch-container">
              <div>
                <strong>Champions League</strong>
                <small>Competicion extra</small>
              </div>

              <div
                className={`switch ${champions ? "active" : ""}`}
                onClick={() => setChampions(!champions)}
              >
                <div className="switch-circle"></div>
              </div>
            </div>

            <div className="switch-container">
              <div>
                <strong>Rellenar equipos aleatorios</strong>
                <small>Agregar clubes CPU a la tabla</small>
              </div>

              <div
                className={`switch ${fillCpuTeams ? "active" : ""}`}
                onClick={() => setFillCpuTeams(!fillCpuTeams)}
              >
                <div className="switch-circle"></div>
              </div>
            </div>

            <div className="switch-container">
              <div>
                <strong>Eventos aleatorios</strong>
                <small>Noticias y problemas inesperados con jugadores</small>
              </div>

              <div
                className={`switch ${randomEvents ? "active" : ""}`}
                onClick={() => setRandomEvents(!randomEvents)}
              >
                <div className="switch-circle"></div>
              </div>
            </div>

            <label className="field">
              <span>Formato</span>
              <select
                className="input"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                <option>Normal</option>
                <option>Corta</option>
                <option>Pequena</option>
              </select>
            </label>

            <label className="field">
              <span>Tipo de liga</span>
              <select
                className="input"
                value={leagueType}
                onChange={(e) => setLeagueType(e.target.value)}
              >
                <option>Real</option>
                <option>Fantasia</option>
              </select>
            </label>

            <label className="field">
              <span>Presupuesto</span>
              <select
                className="input"
                value={money}
                onChange={(e) => setMoney(Number(e.target.value))}
              >
                <option value={100}>100M</option>
                <option value={150}>150M</option>
                <option value={200}>200M</option>
                <option value={220}>220M</option>
                <option value={300}>300M</option>
              </select>
            </label>

            <label className="field">
              <span>Masa salarial</span>
              <select
                className="input"
                value={salaryCap}
                onChange={(e) => setSalaryCap(Number(e.target.value))}
              >
                <option value={1400}>1.4M por temporada</option>
                <option value={1500}>1.5M por temporada</option>
                <option value={1800}>1.8M por temporada</option>
                <option value={2200}>2.2M por temporada</option>
                <option value={2600}>2.6M por temporada</option>
                <option value={3200}>3.2M por temporada</option>
              </select>
            </label>

            <label className="field">
              <span>Premio por liga</span>
              <select
                className="input"
                value={leaguePrize}
                onChange={(e) => setLeaguePrize(Number(e.target.value))}
              >
                <option value={12}>12M para cada club real</option>
                <option value={15}>15M para cada club real</option>
                <option value={20}>20M para cada club real</option>
                <option value={25}>25M para cada club real</option>
                <option value={30}>30M para cada club real</option>
                <option value={50}>50M para cada club real</option>
              </select>
            </label>

            <div className="field">
              <span>Premios de liguilla</span>
              <div className="field-grid">
                <label className="field">
                  <span>1er lugar</span>
                  <select
                    className="input"
                    value={playoffPrize1}
                    onChange={(e) => setPlayoffPrize1(Number(e.target.value))}
                  >
                    <option value={15}>15M</option>
                    <option value={20}>20M</option>
                    <option value={25}>25M</option>
                    <option value={30}>30M</option>
                    <option value={35}>35M</option>
                  </select>
                </label>
                <label className="field">
                  <span>2do lugar</span>
                  <select
                    className="input"
                    value={playoffPrize2}
                    onChange={(e) => setPlayoffPrize2(Number(e.target.value))}
                  >
                    <option value={8}>8M</option>
                    <option value={10}>10M</option>
                    <option value={12}>12M</option>
                    <option value={14}>14M</option>
                    <option value={15}>15M</option>
                    <option value={20}>20M</option>
                  </select>
                </label>
                <label className="field">
                  <span>3er lugar</span>
                  <select
                    className="input"
                    value={playoffPrize3}
                    onChange={(e) => setPlayoffPrize3(Number(e.target.value))}
                  >
                    <option value={5}>5M</option>
                    <option value={6}>6M</option>
                    <option value={8}>8M</option>
                    <option value={10}>10M</option>
                    <option value={12}>12M</option>
                  </select>
                </label>
                <label className="field">
                  <span>4to lugar</span>
                  <select
                    className="input"
                    value={playoffPrize4}
                    onChange={(e) => setPlayoffPrize4(Number(e.target.value))}
                  >
                    <option value={2}>2M</option>
                    <option value={3}>3M</option>
                    <option value={4}>4M</option>
                    <option value={5}>5M</option>
                    <option value={6}>6M</option>
                    <option value={10}>10M</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="stack-actions">
              <button className="btn btn-login" onClick={createLeague}>
                CREAR
              </button>

              <button
                className="btn btn-outline"
                onClick={() => setScreen("dashboard")}
              >
                VOLVER
              </button>
            </div>

          </div>
        </div>
      )}

      {screen === "continue" && (
        <div className="overlay">
          <div className="overlay-card create-card">
            <div className="form-header">
              <span className="form-kicker">Continuar liga</span>
              <h2>Tus ligas guardadas</h2>
            </div>

            {savedLeagues.length === 0 && (
              <div className="lobby-empty">No tienes ligas guardadas todavia.</div>
            )}

            <div className="lobby-list">
              {savedLeagues.map((savedLeague) => (
                <div key={savedLeague.code} className="lobby-player">
                  <div>
                    <span>{savedLeague.leagueName}</span>
                    <small>
                      {savedLeague.code} | {savedLeague.status === "started" ? "Iniciada" : "Esperando"}
                    </small>
                  </div>
                  <div className="continue-actions">
                    <button className="small-action" onClick={() => continueLeague(savedLeague)}>
                      Continuar
                    </button>
                    {savedLeague.creator === currentUser && (
                      <button className="small-action danger" onClick={() => deleteLeague(savedLeague)}>
                        Eliminar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              className="btn btn-outline"
              onClick={() => setScreen("dashboard")}
            >
              VOLVER
            </button>
          </div>
        </div>
      )}

      {/* ===== JOIN ===== */}
      {screen === "join" && (
        <div className="overlay">
          <div className="overlay-card">

            <input
              className="input"
              inputMode="numeric"
              maxLength={4}
              placeholder="Codigo de liga"
              value={joinCode}
              onChange={(e) => {
                const nextCode = e.target.value.replace(/\D/g, "").slice(0, 4);
                setJoinCode(nextCode);
              }}
            />

            <button className="btn btn-login" onClick={joinLobby}>
              UNIRME
            </button>

            <button
              className="btn btn-outline"
              onClick={() => setScreen("dashboard")}
            >
              VOLVER
            </button>

          </div>
        </div>
      )}

      {/* ===== LOBBY ===== */}
      {screen === "lobby" && (
        <Lobby
          code={leagueCode}
          currentUser={currentUser}
          creator={lobbyCreator}
          maxPlayers={lobbyMaxManagers}
          players={players}
          status={lobbyStatus}
          onStart={startLeague}
          onBack={() => setScreen("dashboard")}
        />
      )}

    </div>
  );
}

