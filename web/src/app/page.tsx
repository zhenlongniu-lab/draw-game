"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

interface Player {
  name: string;
  score: number;
}

interface GameState {
  code: string;
  players: Player[];
  hostId: string;
  status: "waiting" | "playing" | "round_end";
  currentDrawer: string | null;
  currentWordLength: number;
  round: number;
  maxRounds: number;
  roundTime: number;
  scores: Player[];
}

const COLORS = ["#000000", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5", "#0c8599", "#c92a2a"];
const PEN_SIZES = [2, 4, 8, 14];

// Connect to server — change this to your Railway URL in production
const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [screen, setScreen] = useState<"home" | "lobby" | "game">("home");
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myWord, setMyWord] = useState("");
  const [amDrawer, setAmDrawer] = useState(false);
  const [timer, setTimer] = useState(80);
  const [messages, setMessages] = useState<{ text: string; type: "guess" | "correct" | "system" }[]>([]);
  const [guess, setGuess] = useState("");
  const [error, setError] = useState("");
  const [gameOver, setGameOver] = useState<{ scores: Player[] } | null>(null);

  // Drawing state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [penSize, setPenSize] = useState(PEN_SIZES[1]);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Connect socket
  const connect = useCallback((name: string) => {
    const s = io(SERVER_URL, { transports: ["websocket"] });
    setSocket(s);
    s.on("connect", () => {
      console.log("connected:", s.id);
    });
    s.on("room_created", (code: string) => {
      setRoomCode(code);
      setScreen("lobby");
    });
    s.on("game_state", (gs: GameState) => {
      setGameState(gs);
      setAmDrawer(gs.currentDrawer === s.id);
    });
    s.on("your_word", (word: string) => {
      setMyWord(word);
    });
    s.on("timer", (t: number) => setTimer(t));
    s.on("round_end", (data: { word: string }) => {
      setMessages((m) => [...m, { text: `答案: ${data.word}`, type: "system" }]);
    });
    s.on("correct_guess", (data: { player: string; word: string }) => {
      setMessages((m) => [...m, { text: `${data.player} 猜对了！🎉`, type: "correct" }]);
    });
    s.on("guess_attempt", (data: { player: string; text: string }) => {
      setMessages((m) => [...m, { text: `${data.player}: ${data.text}`, type: "guess" }]);
    });
    s.on("draw", (data: any) => {
      drawFromServer(data);
    });
    s.on("clear_canvas", () => {
      const ctx = ctxRef.current;
      const canvas = canvasRef.current;
      if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
    s.on("game_over", (data: { scores: Player[] }) => {
      setGameOver(data);
    });
    s.on("error", (msg: string) => setError(msg));
    return s;
  }, []);

  // Draw from server data (for guessers)
  function drawFromServer(data: any) {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (data.type === "start") {
      ctx.beginPath();
      ctx.strokeStyle = data.color;
      ctx.lineWidth = data.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(data.x!, data.y!);
    } else if (data.type === "move") {
      ctx.lineTo(data.x!, data.y!);
      ctx.stroke();
    }
  }

  // Initialize canvas context
  useEffect(() => {
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      canvas.width = canvas.offsetWidth * 2;
      canvas.height = canvas.offsetHeight * 2;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(2, 2);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctxRef.current = ctx;
    }
  }, [screen]);

  // Drawing handlers (drawer only)
  function getCanvasPos(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    if (!amDrawer) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    const ctx = ctxRef.current!;
    ctx.strokeStyle = color;
    ctx.lineWidth = penSize;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    lastPos.current = pos;
    setIsDrawing(true);
    socket?.emit("draw", { type: "start", x: pos.x, y: pos.y, color, size: penSize });
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawing || !amDrawer) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    const ctx = ctxRef.current!;
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    socket?.emit("draw", { type: "move", x: pos.x, y: pos.y });
  }

  function stopDraw() {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPos.current = null;
  }

  function clearCanvas() {
    if (!amDrawer) return;
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket?.emit("clear_canvas");
  }

  function sendGuess() {
    if (!guess.trim() || !socket) return;
    socket.emit("guess", guess.trim());
    setMessages((m) => [...m, { text: `我: ${guess.trim()}`, type: "guess" }]);
    setGuess("");
  }

  // Create room
  function createRoom() {
    if (!playerName.trim()) return;
    const s = connect(playerName.trim());
    s.emit("create_room", playerName.trim());
  }

  // Join room
  function joinRoom() {
    if (!playerName.trim() || !roomCode.trim()) return;
    const s = connect(playerName.trim());
    s.emit("join_room", { code: roomCode.trim(), playerName: playerName.trim() });
    setScreen("lobby");
  }

  // Start game
  function startGame() {
    socket?.emit("start_game");
  }

  function soloPractice() {
    if (!playerName.trim()) return;
    const s = connect(playerName.trim());
    s.emit("create_room", playerName.trim());
    s.on("room_created", (code: string) => {
      setRoomCode(code);
      setScreen("game");
      s.emit("solo_practice");
    });
  }

  if (screen === "home") {
    return (
      <div style={{ maxWidth: 420, margin: "10vh auto", padding: "0 1rem" }}>
        <h1 style={{ textAlign: "center", fontSize: "2rem", marginBottom: "2rem" }}>🎨 你画我猜</h1>
        {error && <p style={{ color: "#e03131", textAlign: "center" }}>{error}</p>}
        <input
          placeholder="你的昵称"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          maxLength={10}
          style={inputStyle}
          onKeyDown={(e) => e.key === "Enter" && soloPractice()}
        />
        <button onClick={soloPractice} style={btnStyle("#9c36b5")}>🎨 Solo 练习</button>
        <button onClick={createRoom} style={btnStyle("#1971c2")}>创建多人房间</button>
        <div style={{ margin: "1.5rem 0", textAlign: "center", color: "#868e96" }}>———— 或加入已有房间 ————</div>
        <input
          placeholder="房间代码 (4位)"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          maxLength={4}
          style={inputStyle}
        />
        <button onClick={joinRoom} style={btnStyle("#2f9e44")}>加入房间</button>
      </div>
    );
  }

  if (screen === "lobby" && gameState) {
    return (
      <div style={{ maxWidth: 480, margin: "10vh auto", padding: "0 1rem", textAlign: "center" }}>
        <h2>🏠 房间: {gameState.code}</h2>
        <p style={{ color: "#868e96" }}>分享房间代码给朋友加入</p>
        <div style={{ margin: "1.5rem 0" }}>
          {gameState.players.map((p, i) => (
            <div key={i} style={{ fontSize: "1.1rem", padding: "0.4rem", borderBottom: "1px solid #e9ecef" }}>
              {p.name}
            </div>
          ))}
        </div>
        {socket?.id === gameState.hostId ? (
          <button onClick={startGame} style={btnStyle("#e03131")}>
            开始游戏 ({gameState.players.length} 人)
          </button>
        ) : (
          <p style={{ color: "#868e96" }}>等待房主开始游戏...</p>
        )}
        {error && <p style={{ color: "#e03131" }}>{error}</p>}
      </div>
    );
  }

  if (gameOver) {
    return (
      <div style={{ maxWidth: 480, margin: "10vh auto", textAlign: "center" }}>
        <h1>🏆 游戏结束</h1>
        <div style={{ margin: "2rem 0" }}>
          {gameOver.scores.map((p, i) => (
            <div key={i} style={{ fontSize: i === 0 ? "1.5rem" : "1.1rem", padding: "0.5rem" }}>
              {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}{" "}
              {p.name}: {p.score} 分
            </div>
          ))}
        </div>
        <button onClick={() => { setGameOver(null); setScreen("home"); }} style={btnStyle("#1971c2")}>
          再来一局
        </button>
      </div>
    );
  }

  const isSolo = gameState && gameState.players.length === 1;

  // GAME SCREEN
  return (
    <div style={{ display: "flex", height: "100vh", flexDirection: "column" }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.5rem 1rem", background: "#fff", borderBottom: "1px solid #dee2e6",
        flexShrink: 0,
      }}>
        <div>
          {isSolo ? (
            <span style={{ color: "#9c36b5", fontWeight: 700 }}>🎨 Solo 练习</span>
          ) : (
            <>
              <strong>第 {gameState ? gameState.round + 1 : 1}/{gameState?.maxRounds} 轮</strong>
              <span style={{ marginLeft: "0.75rem", color: "#e03131", fontWeight: 700 }}>⏱ {timer}s</span>
            </>
          )}
        </div>
        <div style={{ color: "#868e96", fontSize: "0.85rem" }}>
          {amDrawer ? "🎨 你在画" : "🔍 猜词中"}
        </div>
      </div>

      {/* Main area */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Canvas */}
        <div style={{ flex: 1, position: "relative", background: "#fff", borderRight: "1px solid #dee2e6" }}>
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height: "100%", cursor: amDrawer ? "crosshair" : "default", touchAction: "none" }}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={stopDraw}
            onMouseLeave={stopDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={stopDraw}
          />
          {amDrawer && myWord && (
            <div style={{
              position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.75)", color: "#fff", padding: "0.4rem 1rem",
              borderRadius: 8, fontSize: "1.2rem", fontWeight: 700, letterSpacing: "0.1em",
            }}>
              请画: {myWord}
            </div>
          )}
          {!amDrawer && gameState?.currentWordLength && (
            <div style={{
              position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.75)", color: "#fff", padding: "0.4rem 1rem",
              borderRadius: 8, fontSize: "1.2rem",
            }}>
              {"_ ".repeat(gameState.currentWordLength).trim()}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ width: 280, display: "flex", flexDirection: "column", background: "#fff", flexShrink: 0 }}>
          {/* Tools (drawer only) */}
          {amDrawer && (
            <div style={{ padding: "0.75rem", borderBottom: "1px solid #dee2e6" }}>
              <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                {COLORS.map((c) => (
                  <button key={c} onClick={() => setColor(c)} style={{
                    width: 28, height: 28, borderRadius: "50%", background: c,
                    border: color === c ? "3px solid #1a1a1a" : "3px solid transparent",
                    cursor: "pointer",
                  }} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                {PEN_SIZES.map((s) => (
                  <button key={s} onClick={() => setPenSize(s)} style={{
                    padding: "0.25rem 0.5rem", borderRadius: 4,
                    background: penSize === s ? "#e9ecef" : "transparent",
                    border: "1px solid #dee2e6", cursor: "pointer", fontSize: "0.8rem",
                  }}>
                    {s}px
                  </button>
                ))}
              </div>
              <button onClick={clearCanvas} style={btnStyle("#868e96")}>清空画布</button>
            </div>
          )}

          {/* Players */}
          <div style={{ padding: "0.75rem", borderBottom: "1px solid #dee2e6" }}>
            <strong style={{ fontSize: "0.85rem" }}>玩家</strong>
            {gameState?.players.map((p, i) => (
              <div key={i} style={{ fontSize: "0.85rem", padding: "0.2rem 0", display: "flex", justifyContent: "space-between" }}>
                <span>{p.name} {p.name === gameState.players[0]?.name ? "👑" : ""}</span>
                <span>{p.score}分</span>
              </div>
            ))}
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflow: "auto", padding: "0.75rem", fontSize: "0.85rem" }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                padding: "0.15rem 0",
                color: m.type === "correct" ? "#2f9e44" : m.type === "system" ? "#868e96" : "#1a1a1a",
                fontWeight: m.type === "correct" ? 700 : 400,
              }}>
                {m.text}
              </div>
            ))}
          </div>

          {/* Solo: Next Word button */}
          {isSolo && (
            <div style={{ padding: "0.75rem", borderTop: "1px solid #dee2e6" }}>
              <button onClick={() => socket?.emit("next_word")} style={btnStyle("#9c36b5")}>
                换一个词 →
              </button>
              <button onClick={() => {
                socket?.emit("clear_canvas");
                clearCanvas();
              }} style={btnStyle("#868e96")}>
                清空画布
              </button>
            </div>
          )}

          {/* Guess input */}
          {!amDrawer && !isSolo && (
            <div style={{ padding: "0.75rem", borderTop: "1px solid #dee2e6", display: "flex", gap: 4 }}>
              <input
                placeholder="输入猜测..."
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendGuess()}
                style={{ ...inputStyle, flex: 1, padding: "0.5rem" }}
              />
              <button onClick={sendGuess} style={{ ...btnStyle("#1971c2"), padding: "0.5rem 1rem" }}>猜</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block", width: "100%", padding: "0.75rem",
  fontSize: "1rem", border: "1px solid #dee2e6", borderRadius: 8,
  marginBottom: "0.75rem", outline: "none", boxSizing: "border-box",
};

function btnStyle(bg: string): React.CSSProperties {
  return {
    display: "block", width: "100%", padding: "0.75rem",
    background: bg, color: "#fff", border: "none", borderRadius: 8,
    fontSize: "1rem", fontWeight: 700, cursor: "pointer",
    marginBottom: "0.5rem",
  };
}
