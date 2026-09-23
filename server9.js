const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

// =====================================
// HTTP SERVER — SERVE THE GAME PAGES
// =====================================

const server = http.createServer((req, res) => {
    const requestedPath = new URL(req.url, "http://localhost").pathname;

    let file;

    if (requestedPath === "/" || requestedPath === "/index.html") {
        file = "index.html";
    } else if (requestedPath === "/ttt.html") {
        file = "ttt.html";
    } else if (requestedPath === "/checkers.html") {
        file = "checkers.html";
    } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Page not found.");
        return;
    }

    fs.readFile(path.join(__dirname, file), (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end(file + " not found.");
            return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data);
    });
});

// =====================================
// WEBSOCKET SERVER — TIC-TAC-TOE
// =====================================

const wss = new WebSocket.Server({ server });

let players = [];
let board = Array(9).fill(null);
let currentPlayer = "X";
let gameOver = false;
let winner = null;

const winningLines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6]
];

// =====================================
// CHECK FOR A WIN
// =====================================

function checkWinner() {
    for (const [a, b, c] of winningLines) {
        if (
            board[a] !== null &&
            board[a] === board[b] &&
            board[b] === board[c]
        ) {
            return board[a];
        }
    }

    return null;
}

// =====================================
// CHECK FOR A DRAW
// =====================================

function checkDraw() {
    return board.every(cell => cell !== null);
}

// =====================================
// SEND CURRENT GAME STATE
// =====================================

function sendState() {
    const state = {
        type: "state",
        board: board,
        currentPlayer: currentPlayer,
        gameOver: gameOver,
        winner: winner,
        draw: gameOver && winner === null && checkDraw(),
        players: {
            X: players.some(player => player.symbol === "X"),
            O: players.some(player => player.symbol === "O")
        }
    };

    const message = JSON.stringify(state);

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// =====================================
// RESET THE GAME
// =====================================

function resetGame() {
    board = Array(9).fill(null);
    currentPlayer = "X";
    gameOver = false;
    winner = null;

    sendState();
}

// =====================================
// HANDLE NEW CONNECTIONS
// =====================================

wss.on("connection", ws => {
    if (players.length >= 2) {
        ws.send(JSON.stringify({
            type: "error",
            message: "Game is full."
        }));

        ws.close();
        return;
    }

    const symbol = players.some(player => player.symbol === "X")
        ? "O"
        : "X";

    players.push({
        ws: ws,
        symbol: symbol
    });

    ws.symbol = symbol;

    ws.send(JSON.stringify({
        type: "assign",
        symbol: symbol
    }));

    sendState();

    // =================================
    // HANDLE MESSAGES
    // =================================

    ws.on("message", rawMessage => {
        let message;

        try {
            message = JSON.parse(rawMessage.toString());
        } catch (error) {
            ws.send(JSON.stringify({
                type: "error",
                message: "Invalid message."
            }));
            return;
        }

        const player = players.find(p => p.ws === ws);

        if (!player) return;

        // =============================
        // PLAYER MAKES A MOVE
        // =============================

        if (message.type === "move") {
            if (gameOver) return;
            if (players.length !== 2) return;
            if (player.symbol !== currentPlayer) return;

            const index = message.index;

            if (!Number.isInteger(index) || index < 0 || index > 8) {
                return;
            }

            if (board[index] !== null) {
                return;
            }

            // Place the current player's mark.
            board[index] = currentPlayer;

            // Check whether that move created a winning line.
            const foundWinner = checkWinner();

            if (foundWinner !== null) {
                winner = foundWinner;
                gameOver = true;
                sendState();
                return;
            }

            // If no winner, check for a draw.
            if (checkDraw()) {
                winner = null;
                gameOver = true;
                sendState();
                return;
            }

            // No winner or draw: switch turns.
            currentPlayer = currentPlayer === "X" ? "O" : "X";

            sendState();
        }

        // =============================
        // START A NEW GAME
        // =============================

        if (message.type === "new_game") {
            resetGame();
        }
    });

    // =================================
    // HANDLE DISCONNECTION
    // =================================

    ws.on("close", () => {
        players = players.filter(player => player.ws !== ws);

        // Start fresh when someone leaves.
        board = Array(9).fill(null);
        currentPlayer = "X";
        gameOver = false;
        winner = null;

        sendState();
    });
});

// =====================================
// START SERVER
// =====================================

server.listen(PORT, () => {
    console.log("=================================");
    console.log("  GAME ROOM SERVER");
    console.log("=================================");
    console.log("Server running on port " + PORT);
    console.log("Game menu: /");
    console.log("Tic-Tac-Toe: /ttt.html");
    console.log("Checkers: /checkers.html");
});
