const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {

if (req.url === "/" || req.url === "/index.html") {

    const file = path.resolve("index.html");

    console.log("Looking for:", file);

    if (!fs.existsSync(file)) {
        res.writeHead(404, {
            "Content-Type": "text/plain"
        });
        res.end("index.html not found");
        return;
    }

    fs.readFile(file, (err, data) => {

        if (err) {
            res.writeHead(500);
            res.end("Error reading index.html");
            return;
        }

        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        res.end(data);
    });

    return;
}

res.writeHead(404, {
    "Content-Type": "text/plain"
});

res.end("Not found");

});

const wss = new WebSocket.Server({ server });

let player1 = null;
let player2 = null;

let board = Array(9).fill(null);
let currentPlayer = "X";
let gameOver = false;

wss.on("connection", (ws) => {

if (!player1) {
    player1 = ws;
    ws.symbol = "X";

    ws.send(JSON.stringify({
        type: "assign",
        symbol: "X"
    }));

} else if (!player2) {
    player2 = ws;
    ws.symbol = "O";

    ws.send(JSON.stringify({
        type: "assign",
        symbol: "O"
    }));

} else {
    ws.send(JSON.stringify({
        type: "error",
        message: "Game is full."
    }));

    ws.close();
    return;
}

broadcastState();


ws.on("message", (message) => {

    try {

        const data = JSON.parse(message);

        if (data.type === "new_game") {

            board = Array(9).fill(null);
            currentPlayer = "X";
            gameOver = false;

            broadcastState();
            return;
        }


        if (
            data.type !== "move" ||
            !Number.isInteger(data.index)
        ) {
            return;
        }

        if (gameOver) return;

        if (
            data.index < 0 ||
            data.index > 8 ||
            board[data.index] !== null ||
            data.symbol !== currentPlayer ||
            data.symbol !== ws.symbol
        ) {
            return;
        }

        board[data.index] = currentPlayer;

        const winner = getWinner();

        if (winner) {

            gameOver = true;

            broadcastState({
                winner: winner
            });

            return;
        }

        if (board.every(Boolean)) {

            gameOver = true;

            broadcastState({
                draw: true
            });

            return;
        }

        currentPlayer =
            currentPlayer === "X" ? "O" : "X";

        broadcastState();

    } catch (error) {

        ws.send(JSON.stringify({
            type: "error",
            message: "Invalid message."
        }));

    }

});


ws.on("close", () => {

    if (ws === player1) player1 = null;
    if (ws === player2) player2 = null;

    board = Array(9).fill(null);
    currentPlayer = "X";
    gameOver = false;

    broadcastState();
});

});

function getWinner() {

const lines = [
    [0,1,2],
    [3,4,5],
    [6,7,8],
    [0,3,6],
    [1,4,7],
    [2,5,8],
    [0,4,8],
    [2,4,6]
];

for (const [a,b,c] of lines) {

    if (
        board[a] &&
        board[a] === board[b] &&
        board[a] === board[c]
    ) {
        return board[a];
    }

}

return null;

}

function broadcastState(result = {}) {

const state = JSON.stringify({

    type: "state",
    board,
    currentPlayer,
    gameOver,

    players: {
        X: Boolean(player1),
        O: Boolean(player2)
    },

    ...result

});

[player1, player2].forEach((player) => {

    if (
        player &&
        player.readyState === WebSocket.OPEN
    ) {
        player.send(state);
    }

});

}

server.listen(PORT, () => {

console.log(
    `Tic-Tac-Toe server listening on port ${PORT}`
);

});