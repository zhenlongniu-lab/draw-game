import { createServer } from "http";
import { Server } from "socket.io";

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const WORDS = [
  "苹果", "香蕉", "大象", "飞机", "太阳", "月亮", "星星", "大海",
  "火山", "雪花", "雨伞", "时钟", "钥匙", "书本", "眼镜", "鞋子",
  "自行车", "火箭", "钢琴", "足球", "篮球", "蛋糕", "冰淇淋",
  "恐龙", "机器人", "城堡", "彩虹", "闪电", "蝴蝶", "鲸鱼",
  "西瓜", "汉堡", "猫咪", "小狗", "老虎", "熊猫", "长颈鹿",
  "汽车", "火车", "轮船", "吉他", "电话", "电视", "电脑",
  "向日葵", "蘑菇", "仙人掌", "灯笼", "鞭炮", "红包",
];

interface Player {
  id: string;
  name: string;
  score: number;
  connected: boolean;
}

interface Room {
  code: string;
  players: Player[];
  hostId: string;
  status: "waiting" | "playing" | "round_end";
  currentDrawer: string | null;
  currentWord: string | null;
  round: number;
  maxRounds: number;
  roundTime: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, Room>();

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function randomWord(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

function getRoomState(room: Room) {
  return {
    code: room.code,
    players: room.players.filter((p) => p.connected),
    hostId: room.hostId,
    status: room.status,
    currentDrawer: room.currentDrawer,
    currentWordLength: room.currentWord ? room.currentWord.length : 0,
    round: room.round,
    maxRounds: room.maxRounds,
    roundTime: room.roundTime,
    scores: room.players.map((p) => ({ name: p.name, score: p.score })),
  };
}

function nextTurn(room: Room) {
  if (room.timer) clearTimeout(room.timer);

  // Find next drawer
  const activePlayers = room.players.filter((p) => p.connected);
  if (activePlayers.length < 2) {
    // Not enough players, go back to waiting
    room.status = "waiting";
    room.currentDrawer = null;
    room.currentWord = null;
    io.to(room.code).emit("game_state", getRoomState(room));
    return;
  }

  // Check if game is over
  const totalRounds = room.maxRounds;
  if (room.round >= totalRounds) {
    room.status = "waiting";
    room.currentDrawer = null;
    room.currentWord = null;
    io.to(room.code).emit("game_state", getRoomState(room));
    io.to(room.code).emit("game_over", {
      scores: room.players
        .sort((a, b) => b.score - a.score)
        .map((p) => ({ name: p.name, score: p.score })),
    });
    return;
  }

  // Find current drawer index and pick next
  const currentIdx = room.currentDrawer
    ? activePlayers.findIndex((p) => p.id === room.currentDrawer)
    : -1;
  const nextIdx = (currentIdx + 1) % activePlayers.length;
  const drawer = activePlayers[nextIdx];

  room.currentDrawer = drawer.id;
  room.currentWord = randomWord();
  room.status = "playing";
  room.roundTime = 80;

  // Tell drawer the word
  io.to(drawer.id).emit("your_word", room.currentWord);

  // Tell everyone else to guess
  io.to(room.code).emit("game_state", getRoomState(room));

  // Start timer
  let timeLeft = room.roundTime;
  room.timer = setInterval(() => {
    timeLeft--;
    io.to(room.code).emit("timer", timeLeft);
    if (timeLeft <= 0) {
      clearInterval(room.timer!);
      room.timer = null;
      room.status = "round_end";
      io.to(room.code).emit("round_end", { word: room.currentWord });
      io.to(room.code).emit("game_state", getRoomState(room));

      // Start next round after 5 seconds
      setTimeout(() => {
        nextTurn(room);
      }, 5000);
    }
  }, 1000);
}

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Create room
  socket.on("create_room", (playerName: string) => {
    const code = generateCode();
    const room: Room = {
      code,
      players: [{ id: socket.id, name: playerName, score: 0, connected: true }],
      hostId: socket.id,
      status: "waiting",
      currentDrawer: null,
      currentWord: null,
      round: 0,
      maxRounds: 8,
      roundTime: 80,
      timer: null,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.emit("room_created", code);
    io.to(code).emit("game_state", getRoomState(room));
    console.log(`Room ${code} created by ${playerName}`);
  });

  // Join room
  socket.on("join_room", ({ code, playerName }: { code: string; playerName: string }) => {
    const room = rooms.get(code.toUpperCase());
    if (!room) {
      socket.emit("error", "房间不存在");
      return;
    }
    if (room.status === "playing") {
      socket.emit("error", "游戏已开始，请等待下一局");
      return;
    }
    if (room.players.filter((p) => p.connected).length >= 8) {
      socket.emit("error", "房间已满（最多8人）");
      return;
    }

    // Rejoin if same ID
    const existing = room.players.find((p) => p.id === socket.id);
    if (existing) {
      existing.connected = true;
      existing.name = playerName;
    } else {
      room.players.push({ id: socket.id, name: playerName, score: 0, connected: true });
    }

    socket.join(room.code);
    io.to(room.code).emit("game_state", getRoomState(room));
    console.log(`${playerName} joined room ${code}`);
  });

  // Start game
  socket.on("start_game", () => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.filter((p) => p.connected).length < 2) {
      socket.emit("error", "至少需要2名玩家");
      return;
    }
    room.round = 0;
    room.players.forEach((p) => (p.score = 0));
    nextTurn(room);
  });

  // Drawing events (relay from drawer to guessers)
  socket.on("draw", (data: { type: string; x?: number; y?: number; color?: string; size?: number; prevX?: number; prevY?: number }) => {
    const room = findRoomBySocket(socket.id);
    if (!room) return;
    if (socket.id !== room.currentDrawer) return;
    // Broadcast to everyone EXCEPT the drawer
    socket.to(room.code).emit("draw", data);
  });

  // Clear canvas
  socket.on("clear_canvas", () => {
    const room = findRoomBySocket(socket.id);
    if (!room || socket.id !== room.currentDrawer) return;
    socket.to(room.code).emit("clear_canvas");
  });

  // Guess
  socket.on("guess", (text: string) => {
    const room = findRoomBySocket(socket.id);
    if (!room || !room.currentWord) return;
    if (socket.id === room.currentDrawer) return;

    const guess = text.trim();
    if (guess === room.currentWord) {
      // Calculate score based on remaining time
      const bonus = Math.floor((room.timer ? 30 : 10));
      const player = room.players.find((p) => p.id === socket.id);
      if (player) player.score += 100 + bonus;

      io.to(room.code).emit("correct_guess", {
        player: player?.name,
        word: room.currentWord,
      });

      // Check if all guessers got it right
      const guessers = room.players.filter((p) => p.id !== room.currentDrawer && p.connected);
      const allGuessed = guessers.every((p) => {
        // We can't track who guessed, simplified: end round after first correct guess
        return false;
      });

      // Don't end round immediately, let others guess too
    } else {
      // Broadcast the guess attempt
      socket.to(room.code).emit("guess_attempt", {
        player: room.players.find((p) => p.id === socket.id)?.name,
        text: guess,
      });
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
    for (const [code, room] of rooms) {
      const player = room.players.find((p) => p.id === socket.id);
      if (player) {
        player.connected = false;
        io.to(code).emit("game_state", getRoomState(room));

        // If drawer disconnected, end round
        if (room.currentDrawer === socket.id && room.status === "playing") {
          if (room.timer) clearTimeout(room.timer);
          room.timer = null;
          room.status = "round_end";
          io.to(code).emit("round_end", { word: room.currentWord });
          setTimeout(() => nextTurn(room), 5000);
        }

        // Cleanup empty rooms
        if (room.players.every((p) => !p.connected)) {
          rooms.delete(code);
        }
        break;
      }
    }
  });
});

function findRoomBySocket(socketId: string): Room | null {
  for (const [, room] of rooms) {
    if (room.players.some((p) => p.id === socketId)) return room;
  }
  return null;
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Draw Game server running on port ${PORT}`);
});
