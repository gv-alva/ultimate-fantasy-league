import { useEffect, useState } from "react";
import "./styles.css";
import Draft from "./Draft";
import Lobby from "./Lobby";

type LobbyData = {
  code: string;
  leagueName: string;
  creator?: string;
  maxManagers?: number;
  managers?: number;
  format?: string;
  money?: number;
  champions?: boolean;
  bidTime?: number;
  marketTime?: number;
  players: string[];
  status?: "waiting" | "started";
};

type LeagueSettings = {
  format: string;
  money: number;
  champions: boolean;
  bidTime: number;
  marketTime: number;
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
  money: lobby.money || fallback.money,
  champions: lobby.champions ?? fallback.champions,
  bidTime: lobby.bidTime || fallback.bidTime,
  marketTime: lobby.marketTime || fallback.marketTime,
});

export default function App() {
  const [screen, setScreen] = useState("home");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentUser, setCurrentUser] = useState("");

  // liga
  const [leagueName, setLeagueName] = useState("");
  const [managers, setManagers] = useState("4");
  const [champions, setChampions] = useState(false);
  const [format, setFormat] = useState("Normal");
  const [money, setMoney] = useState(100);
  const [bidTime, setBidTime] = useState("60");
  const [marketTime, setMarketTime] = useState("10");

  // lobby
  const [leagueCode, setLeagueCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [players, setPlayers] = useState<string[]>([]);
  const [lobbyCreator, setLobbyCreator] = useState("");
  const [lobbyMaxManagers, setLobbyMaxManagers] = useState(4);
  const [lobbyStatus, setLobbyStatus] = useState<"waiting" | "started">("waiting");
  const [leagueSettings, setLeagueSettings] = useState<LeagueSettings>({
    format: "Normal",
    money: 100,
    champions: false,
    bidTime: 60,
    marketTime: 10,
  });

  useEffect(() => {
    if (screen !== "lobby" || !leagueCode) return;

    const events = new EventSource(`${API_URL}/lobbies/${leagueCode}/events`);

    events.onmessage = (event) => {
      const lobby: LobbyData = JSON.parse(event.data);
      const nextMaxManagers = getLobbyMaxManagers(lobby);
      setPlayers(lobby.players);
      setLobbyCreator((currentCreator) => lobby.creator || currentCreator);
      setLobbyMaxManagers((currentMaxManagers) => nextMaxManagers || currentMaxManagers);
      setLobbyStatus(lobby.status || "waiting");
      setLeagueSettings((currentSettings) => getLeagueSettings(lobby, currentSettings));
    };

    events.onerror = () => {
      events.close();
    };

    return () => {
      events.close();
    };
  }, [screen, leagueCode]);

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
      money: 100,
      champions: false,
      bidTime: 60,
      marketTime: 10,
    });
    setScreen("login");
  };

  const createLeague = async () => {
    const managerCount = Number(managers);
    const bidSeconds = Number(bidTime);
    const marketMinutes = Number(marketTime);

    if (!leagueName) return alert("Pon nombre");
    if (!currentUser) return alert("Inicia sesion primero");
    if (!Number.isInteger(managerCount) || managerCount < 2 || managerCount > 20) {
      alert("El numero de jugadores debe estar entre 2 y 20");
      return;
    }
    if (!Number.isInteger(bidSeconds) || bidSeconds < 15 || bidSeconds > 300) {
      alert("El tiempo de puja debe estar entre 15 y 300 segundos");
      return;
    }
    if (!Number.isInteger(marketMinutes) || marketMinutes < 1 || marketMinutes > 120) {
      alert("El mercado debe durar entre 1 y 120 minutos");
      return;
    }

    const nextSettings = {
      format,
      money,
      champions,
      bidTime: bidSeconds,
      marketTime: marketMinutes,
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
          format,
          money,
          bidTime: bidSeconds,
          marketTime: marketMinutes,
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
  };

  if (screen === "draft") {
    return (
      <Draft
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
        <img src="/src/assets/logo.png" className="logo" />

        <button className="logout-btn" onClick={handleLogout}>
          Cerrar sesion
        </button>
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

          <button className="btn btn-outline">
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
              <span>Presupuesto</span>
              <select
                className="input"
                value={money}
                onChange={(e) => setMoney(Number(e.target.value))}
              >
                <option value={100}>100M</option>
                <option value={150}>150M</option>
                <option value={200}>200M</option>
                <option value={300}>300M</option>
              </select>
            </label>

            <label className="field">
              <span>Tiempo de puja por etapa (segundos)</span>
              <input
                className="input"
                min={15}
                max={300}
                type="number"
                value={bidTime}
                onChange={(e) => setBidTime(e.target.value)}
              />
            </label>

            <label className="field">
              <span>Tiempo de mercado (minutos)</span>
              <input
                className="input"
                min={1}
                max={120}
                type="number"
                value={marketTime}
                onChange={(e) => setMarketTime(e.target.value)}
              />
            </label>

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
