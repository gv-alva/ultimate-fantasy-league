type Props = {
  code: string;
  currentUser: string;
  creator: string;
  maxPlayers: number;
  players: string[];
  status: "waiting" | "started";
  onStart: () => void;
  onBack: () => void;
};

export default function Lobby({
  code,
  currentUser,
  creator,
  maxPlayers,
  players,
  status,
  onStart,
  onBack,
}: Props) {
  const totalPlayers = maxPlayers > 0 ? maxPlayers : players.length || 1;
  const isCreator = currentUser === creator;
  const isFull = players.length >= totalPlayers;
  const progressWidth = Math.min((players.length / totalPlayers) * 100, 100);

  return (
    <div className="overlay">
      <div className="overlay-card">

        <h2 className="lobby-code">
          Codigo: {code}
        </h2>

        <div className="lobby-status">
          {status === "started" ? "Liga iniciada" : "Lobby en vivo"}
        </div>

        <div className="lobby-progress">
          <span>Jugadores unidos</span>
          <strong>{players.length}/{totalPlayers}</strong>
        </div>

        <div className="lobby-meter">
          <div
            className="lobby-meter-fill"
            style={{ width: `${progressWidth}%` }}
          />
        </div>

        <div className="lobby-title">
          Jugadores
        </div>

        {players.length === 0 && (
          <div className="lobby-empty">
            Aun no hay jugadores...
          </div>
        )}

        <div className="lobby-list">
          {players.map((player) => (
            <div key={player} className="lobby-player">
              <span>{player}</span>
              {player === creator && <small>Creador</small>}
            </div>
          ))}
        </div>

        {isCreator && (
          <button
            className="btn btn-login"
            disabled={!isFull || status === "started"}
            onClick={onStart}
          >
            {status === "started" ? "LIGA INICIADA" : "COMENZAR LIGA"}
          </button>
        )}

        <button className="btn btn-outline" onClick={onBack}>
          SALIR
        </button>

      </div>
    </div>
  );
}
