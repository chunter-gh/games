const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

// ============================================================
// HTTP SERVER
// ============================================================

const server = http.createServer((req, res) => {
    let file;

    if (req.url === "/" || req.url === "/index.html") {
        file = "index.html";
    } else if (req.url === "/ttt.html") {
        file = "ttt.html";
    } else if (req.url === "/checkers.html") {
        file = "checkers.html";
    } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
    }

    const fs = require("fs");

    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Could not load " + file);
            return;
        }

        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        res.end(data);
    });
});

// ============================================================
// WEBSOCKET SERVER
// ============================================================

const wss = new WebSocket.Server({ server });

// ============================================================
// TIC-TAC-TOE ROOM
// ============================================================

let tttPlayer1 = null;
let tttPlayer2 = null;

let tttBoard = Array(9).fill(null);
let tttCurrentPlayer = "X";
let tttGameOver = false;
let tttWinner = null;
let tttDraw = false;


// ============================================================
// CHECKERS ROOM
// ============================================================

let checkersPlayer1 = null;
let checkersPlayer2 = null;

let checkersBoard = createCheckersBoard();

let checkersTurn = "red";
let checkersGameOver = false;
let checkersWinner = null;

let checkersForcedPiece = null;


// ============================================================
// WEBSOCKET CONNECTION
// ============================================================

wss.on("connection", (ws, req) => {

    const path = req.url || "/";

    // --------------------------------------------------------
    // CHECKERS CONNECTION
    // --------------------------------------------------------

    if (path.startsWith("/checkers")) {
        connectCheckers(ws);
        return;
    }

    // --------------------------------------------------------
    // TIC-TAC-TOE CONNECTION
    // --------------------------------------------------------

    connectTicTacToe(ws);
});


// ============================================================
// TIC-TAC-TOE
// ============================================================

function connectTicTacToe(ws) {

    if (!tttPlayer1) {

        tttPlayer1 = ws;
        ws.game = "ttt";
        ws.symbol = "X";

        ws.send(JSON.stringify({
            type: "assign",
            symbol: "X"
        }));

    } else if (!tttPlayer2) {

        tttPlayer2 = ws;
        ws.game = "ttt";
        ws.symbol = "O";

        ws.send(JSON.stringify({
            type: "assign",
            symbol: "O"
        }));

        broadcastTTT();

    } else {

        ws.send(JSON.stringify({
            type: "error",
            message: "Tic-Tac-Toe is full."
        }));

        ws.close();
        return;
    }

    broadcastTTT();

    ws.on("message", (message) => {

        try {

            const data = JSON.parse(message);

            // ------------------------------------------------
            // NEW GAME
            // ------------------------------------------------

            if (data.type === "new_game") {

                resetTTT();
                broadcastTTT();
                return;
            }

            // ------------------------------------------------
            // MOVE
            // ------------------------------------------------

            if (data.type !== "move") {
                return;
            }

            if (!Number.isInteger(data.index)) {
                return;
            }

            if (tttGameOver) {
                return;
            }

            if (data.index < 0 || data.index > 8) {
                return;
            }

            if (tttBoard[data.index] !== null) {
                return;
            }

            if (ws.symbol !== tttCurrentPlayer) {
                return;
            }

            // Make move
            tttBoard[data.index] = ws.symbol;

            const winner = getTTTWinner();

            if (winner) {

                tttGameOver = true;
                tttWinner = winner;

                broadcastTTT();
                return;
            }

            if (tttBoard.every(cell => cell !== null)) {

                tttGameOver = true;
                tttDraw = true;

                broadcastTTT();
                return;
            }

            // Change turn
            tttCurrentPlayer =
                tttCurrentPlayer === "X" ? "O" : "X";

            broadcastTTT();

        } catch (error) {

            ws.send(JSON.stringify({
                type: "error",
                message: "Invalid message."
            }));
        }
    });

    ws.on("close", () => {

        if (ws === tttPlayer1) {
            tttPlayer1 = null;
        }

        if (ws === tttPlayer2) {
            tttPlayer2 = null;
        }

        resetTTT();
        broadcastTTT();
    });
}


// ============================================================
// TIC-TAC-TOE WINNER
// ============================================================

function getTTTWinner() {

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

    for (const [a, b, c] of winningLines) {

        if (
            tttBoard[a] &&
            tttBoard[a] === tttBoard[b] &&
            tttBoard[a] === tttBoard[c]
        ) {
            return tttBoard[a];
        }
    }

    return null;
}


// ============================================================
// TIC-TAC-TOE RESET
// ============================================================

function resetTTT() {

    tttBoard = Array(9).fill(null);

    tttCurrentPlayer = "X";

    tttGameOver = false;

    tttWinner = null;

    tttDraw = false;
}


// ============================================================
// TIC-TAC-TOE BROADCAST
// ============================================================

function broadcastTTT() {

    const state = JSON.stringify({

        type: "state",

        board: tttBoard,

        currentPlayer: tttCurrentPlayer,

        gameOver: tttGameOver,

        winner: tttWinner,

        draw: tttDraw,

        players: {
            X: Boolean(tttPlayer1),
            O: Boolean(tttPlayer2)
        }
    });

    [tttPlayer1, tttPlayer2].forEach(player => {

        if (
            player &&
            player.readyState === WebSocket.OPEN
        ) {
            player.send(state);
        }
    });
}


// ============================================================
// CHECKERS CONNECTION
// ============================================================

function connectCheckers(ws) {

    if (!checkersPlayer1) {

        checkersPlayer1 = ws;

        ws.game = "checkers";
        ws.color = "red";

        ws.send(JSON.stringify({
            type: "assign",
            color: "red"
        }));

    } else if (!checkersPlayer2) {

        checkersPlayer2 = ws;

        ws.game = "checkers";
        ws.color = "black";

        ws.send(JSON.stringify({
            type: "assign",
            color: "black"
        }));

        broadcastCheckers();

    } else {

        ws.send(JSON.stringify({
            type: "error",
            message: "Checkers is full."
        }));

        ws.close();
        return;
    }

    broadcastCheckers();

    ws.on("message", (message) => {

        try {

            const data = JSON.parse(message);

            // ------------------------------------------------
            // NEW GAME
            // ------------------------------------------------

            if (data.type === "new_game") {

                resetCheckers();

                broadcastCheckers();

                return;
            }

            // ------------------------------------------------
            // CHECKERS MOVE
            // ------------------------------------------------

            if (data.type !== "move") {
                return;
            }

            if (checkersGameOver) {
                return;
            }

            if (ws.color !== checkersTurn) {
                return;
            }

            if (
                !Number.isInteger(data.fromRow) ||
                !Number.isInteger(data.fromCol) ||
                !Number.isInteger(data.toRow) ||
                !Number.isInteger(data.toCol)
            ) {
                return;
            }

            const fromRow = data.fromRow;
            const fromCol = data.fromCol;

            const toRow = data.toRow;
            const toCol = data.toCol;

            if (
                !insideBoard(fromRow, fromCol) ||
                !insideBoard(toRow, toCol)
            ) {
                return;
            }

            const piece =
                checkersBoard[fromRow][fromCol];

            if (!piece) {
                return;
            }

            if (piece.color !== ws.color) {
                return;
            }

            if (checkersBoard[toRow][toCol] !== null) {
                return;
            }

            // If a multiple jump is active,
            // the same piece must continue.
            if (checkersForcedPiece) {

                if (
                    checkersForcedPiece.row !== fromRow ||
                    checkersForcedPiece.col !== fromCol
                ) {
                    return;
                }
            }

            const move = validateCheckersMove(
                fromRow,
                fromCol,
                toRow,
                toCol
            );

            if (!move.valid) {
                return;
            }

            // ------------------------------------------------
            // MAKE MOVE
            // ------------------------------------------------

            checkersBoard[toRow][toCol] = piece;
            checkersBoard[fromRow][fromCol] = null;

            // Remove captured piece
            if (move.capture) {

                checkersBoard[move.capture.row]
                    [move.capture.col] = null;
            }

            // ------------------------------------------------
            // KING PROMOTION
            // ------------------------------------------------

            let promoted = false;

            if (
                !piece.king &&
                (
                    (piece.color === "red" && toRow === 7) ||
                    (piece.color === "black" && toRow === 0)
                )
            ) {

                piece.king = true;
                promoted = true;
            }

            // ------------------------------------------------
            // CHECK FOR ANOTHER JUMP
            // ------------------------------------------------

            if (move.capture && !promoted) {

                const moreCaptures =
                    getPieceCaptures(
                        toRow,
                        toCol
                    );

                if (moreCaptures.length > 0) {

                    checkersForcedPiece = {
                        row: toRow,
                        col: toCol
                    };

                    broadcastCheckers();
                    return;
                }
            }

            // Turn complete
            checkersForcedPiece = null;

            checkersTurn =
                checkersTurn === "red"
                    ? "black"
                    : "red";

            // ------------------------------------------------
            // CHECK WIN
            // ------------------------------------------------

            checkCheckersGameOver();

            broadcastCheckers();

        } catch (error) {

            ws.send(JSON.stringify({
                type: "error",
                message: "Invalid message."
            }));
        }
    });

    ws.on("close", () => {

        if (ws === checkersPlayer1) {
            checkersPlayer1 = null;
        }

        if (ws === checkersPlayer2) {
            checkersPlayer2 = null;
        }

        resetCheckers();

        broadcastCheckers();
    });
}


// ============================================================
// CREATE CHECKERS BOARD
// ============================================================

function createCheckersBoard() {

    const board = [];

    for (let row = 0; row < 8; row++) {

        board[row] = [];

        for (let col = 0; col < 8; col++) {

            board[row][col] = null;

            // Black starts at the top
            if (row < 3 && (row + col) % 2 === 1) {

                board[row][col] = {
                    color: "black",
                    king: false
                };
            }

            // Red starts at the bottom
            if (row > 4 && (row + col) % 2 === 1) {

                board[row][col] = {
                    color: "red",
                    king: false
                };
            }
        }
    }

    return board;
}


// ============================================================
// CHECKERS MOVE VALIDATION
// ============================================================

function validateCheckersMove(
    fromRow,
    fromCol,
    toRow,
    toCol
) {

    const piece =
        checkersBoard[fromRow][fromCol];

    if (!piece) {
        return { valid: false };
    }

    const rowDiff = toRow - fromRow;
    const colDiff = toCol - fromCol;

    const absRow = Math.abs(rowDiff);
    const absCol = Math.abs(colDiff);

    // Must move diagonally
    if (absRow !== absCol) {
        return { valid: false };
    }

    // --------------------------------------------------------
    // MANDATORY CAPTURE
    // --------------------------------------------------------

    const playerMustCapture =
        playerHasCapture(piece.color);

    // --------------------------------------------------------
    // NORMAL MOVE
    // --------------------------------------------------------

    if (absRow === 1) {

        if (playerMustCapture) {
            return { valid: false };
        }

        // Red moves downward
        if (
            piece.color === "red" &&
            !piece.king &&
            rowDiff !== 1
        ) {
            return { valid: false };
        }

        // Black moves upward
        if (
            piece.color === "black" &&
            !piece.king &&
            rowDiff !== -1
        ) {
            return { valid: false };
        }

        return {
            valid: true,
            capture: null
        };
    }

    // --------------------------------------------------------
    // CAPTURE
    // --------------------------------------------------------

    if (absRow === 2) {

        const middleRow =
            fromRow + rowDiff / 2;

        const middleCol =
            fromCol + colDiff / 2;

        const middlePiece =
            checkersBoard[middleRow][middleCol];

        if (!middlePiece) {
            return { valid: false };
        }

        if (middlePiece.color === piece.color) {
            return { valid: false };
        }

        // Regular pieces can capture only forward
        if (
            !piece.king &&
            piece.color === "red" &&
            rowDiff !== 2
        ) {
            return { valid: false };
        }

        if (
            !piece.king &&
            piece.color === "black" &&
            rowDiff !== -2
        ) {
            return { valid: false };
        }

        return {
            valid: true,
            capture: {
                row: middleRow,
                col: middleCol
            }
        };
    }

    return { valid: false };
}


// ============================================================
// GET CAPTURES FOR ONE PIECE
// ============================================================

function getPieceCaptures(row, col) {

    const piece = checkersBoard[row][col];

    if (!piece) {
        return [];
    }

    const directions = [];

    // Kings move both ways
    if (piece.king || piece.color === "red") {

        directions.push(
            [1, 1],
            [1, -1]
        );
    }

    if (piece.king || piece.color === "black") {

        directions.push(
            [-1, 1],
            [-1, -1]
        );
    }

    const captures = [];

    for (const [dr, dc] of directions) {

        const middleRow = row + dr;
        const middleCol = col + dc;

        const landingRow = row + dr * 2;
        const landingCol = col + dc * 2;

        if (
            !insideBoard(middleRow, middleCol) ||
            !insideBoard(landingRow, landingCol)
        ) {
            continue;
        }

        const middle =
            checkersBoard[middleRow][middleCol];

        const landing =
            checkersBoard[landingRow][landingCol];

        if (
            middle &&
            middle.color !== piece.color &&
            landing === null
        ) {

            captures.push({
                row: landingRow,
                col: landingCol,
                captureRow: middleRow,
                captureCol: middleCol
            });
        }
    }

    return captures;
}


// ============================================================
// DOES PLAYER HAVE ANY CAPTURE?
// ============================================================

function playerHasCapture(color) {

    for (let row = 0; row < 8; row++) {

        for (let col = 0; col < 8; col++) {

            const piece = checkersBoard[row][col];

            if (
                piece &&
                piece.color === color &&
                getPieceCaptures(row, col).length > 0
            ) {
                return true;
            }
        }
    }

    return false;
}


// ============================================================
// DOES PLAYER HAVE ANY LEGAL MOVE?
// ============================================================

function playerHasLegalMove(color) {

    const mustCapture =
        playerHasCapture(color);

    for (let row = 0; row < 8; row++) {

        for (let col = 0; col < 8; col++) {

            const piece = checkersBoard[row][col];

            if (
                !piece ||
                piece.color !== color
            ) {
                continue;
            }

            // Captures
            if (
                mustCapture &&
                getPieceCaptures(row, col).length > 0
            ) {
                return true;
            }

            if (mustCapture) {
                continue;
            }

            // Normal diagonal moves
            const directions = [];

            if (
                piece.king ||
                piece.color === "red"
            ) {
                directions.push(
                    [1, 1],
                    [1, -1]
                );
            }

            if (
                piece.king ||
                piece.color === "black"
            ) {
                directions.push(
                    [-1, 1],
                    [-1, -1]
                );
            }

            for (const [dr, dc] of directions) {

                const newRow = row + dr;
                const newCol = col + dc;

                if (
                    insideBoard(newRow, newCol) &&
                    checkersBoard[newRow][newCol] === null
                ) {
                    return true;
                }
            }
        }
    }

    return false;
}


// ============================================================
// CHECK CHECKERS WIN
// ============================================================

function checkCheckersGameOver() {

    const redPieces = countPieces("red");
    const blackPieces = countPieces("black");

    if (redPieces === 0) {

        checkersGameOver = true;
        checkersWinner = "black";

        return;
    }

    if (blackPieces === 0) {

        checkersGameOver = true;
        checkersWinner = "red";

        return;
    }

    if (!playerHasLegalMove(checkersTurn)) {

        checkersGameOver = true;

        checkersWinner =
            checkersTurn === "red"
                ? "black"
                : "red";
    }
}


// ============================================================
// COUNT PIECES
// ============================================================

function countPieces(color) {

    let count = 0;

    for (let row = 0; row < 8; row++) {

        for (let col = 0; col < 8; col++) {

            const piece = checkersBoard[row][col];

            if (piece && piece.color === color) {
                count++;
            }
        }
    }

    return count;
}


// ============================================================
// BOARD BOUNDS
// ============================================================

function insideBoard(row, col) {

    return (
        row >= 0 &&
        row < 8 &&
        col >= 0 &&
        col < 8
    );
}


// ============================================================
// RESET CHECKERS
// ============================================================

function resetCheckers() {

    checkersBoard = createCheckersBoard();

    checkersTurn = "red";

    checkersGameOver = false;

    checkersWinner = null;

    checkersForcedPiece = null;
}


// ============================================================
// CHECKERS BROADCAST
// ============================================================

function broadcastCheckers() {

    const state = JSON.stringify({

        type: "state",

        board: checkersBoard,

        currentPlayer: checkersTurn,

        gameOver: checkersGameOver,

        winner: checkersWinner,

        forcedPiece: checkersForcedPiece,

        players: {
            red: Boolean(checkersPlayer1),
            black: Boolean(checkersPlayer2)
        }
    });

    [checkersPlayer1, checkersPlayer2].forEach(player => {

        if (
            player &&
            player.readyState === WebSocket.OPEN
        ) {
            player.send(state);
        }
    });
}


// ============================================================
// START SERVER
// ============================================================

server.listen(PORT, () => {

    console.log("");
    console.log("=================================");
    console.log("       GAME SERVER 11");
    console.log("=================================");
    console.log("");
    console.log("Server running on port " + PORT);
    console.log("");
    console.log("Games:");
    console.log("  Tic-Tac-Toe");
    console.log("  Checkers");
    console.log("");
});
