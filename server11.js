const http = require("http");
const fs = require("fs");
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

    } else if (req.url === "/navalstrike.html") {
        file = "navalstrike.html";

    } else if (req.url === "/chess.html") {
        file = "chess.html";

    } else {
        res.writeHead(404);
        res.end("Not Found");
        return;
    }

    fs.readFile(file, (err, data) => {

        if (err) {
            res.writeHead(500);
            res.end("Server Error");
            return;
        }

        let contentType = "text/html";

        res.writeHead(200, {
            "Content-Type": contentType
        });

        res.end(data);
    });
});


// ============================================================
// WEBSOCKET SERVER
// ============================================================

const wss = new WebSocket.Server({
    server: server
});


// ============================================================
// TIC-TAC-TOE
// ============================================================

let tttPlayer1 = null;
let tttPlayer2 = null;

let tttBoard = [
    "", "", "",
    "", "", "",
    "", ""
];

let tttTurn = "X";

function tttBroadcast(message) {

    [tttPlayer1, tttPlayer2].forEach(player => {

        if (player && player.readyState === WebSocket.OPEN) {
            player.send(JSON.stringify(message));
        }

    });
}

function checkTTTWinner() {

    const wins = [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6]
    ];

    for (const [a, b, c] of wins) {

        if (
            tttBoard[a] &&
            tttBoard[a] === tttBoard[b] &&
            tttBoard[a] === tttBoard[c]
        ) {
            return tttBoard[a];
        }
    }

    if (tttBoard.every(cell => cell !== "")) {
        return "DRAW";
    }

    return null;
}


// ============================================================
// CHECKERS
// ============================================================

let checkersPlayer1 = null;
let checkersPlayer2 = null;

let checkersBoard = createCheckersBoard();

let checkersTurn = "red";

let checkersForcedPiece = null;


function createCheckersBoard() {

    const board = Array.from(
        { length: 8 },
        () => Array(8).fill(null)
    );

    for (let row = 0; row < 3; row++) {

        for (let col = 0; col < 8; col++) {

            if ((row + col) % 2 === 1) {
                board[row][col] = {
                    color: "black",
                    king: false
                };
            }
        }
    }

    for (let row = 5; row < 8; row++) {

        for (let col = 0; col < 8; col++) {

            if ((row + col) % 2 === 1) {
                board[row][col] = {
                    color: "red",
                    king: false
                };
            }
        }
    }

    return board;
}


function checkersBroadcast(message) {

    [checkersPlayer1, checkersPlayer2].forEach(player => {

        if (player && player.readyState === WebSocket.OPEN) {
            player.send(JSON.stringify(message));
        }

    });
}


function getCheckersMoves(row, col) {

    const piece = checkersBoard[row][col];

    if (!piece) {
        return [];
    }

    const moves = [];

    const directions = [];

    if (piece.king || piece.color === "red") {
        directions.push([-1, -1]);
        directions.push([-1, 1]);
    }

    if (piece.king || piece.color === "black") {
        directions.push([1, -1]);
        directions.push([1, 1]);
    }

    for (const [dr, dc] of directions) {

        const r = row + dr;
        const c = col + dc;

        if (
            r >= 0 &&
            r < 8 &&
            c >= 0 &&
            c < 8 &&
            !checkersBoard[r][c]
        ) {

            moves.push({
                row: r,
                col: c,
                capture: false
            });

        }

        const jumpR = row + dr * 2;
        const jumpC = col + dc * 2;

        if (
            jumpR >= 0 &&
            jumpR < 8 &&
            jumpC >= 0 &&
            jumpC < 8 &&
            checkersBoard[r]?.[c] &&
            checkersBoard[r][c].color !== piece.color &&
            !checkersBoard[jumpR][jumpC]
        ) {

            moves.push({
                row: jumpR,
                col: jumpC,
                capture: true,
                capturedRow: r,
                capturedCol: c
            });

        }
    }

    return moves;
}


function hasCheckersCapture(color) {

    for (let row = 0; row < 8; row++) {

        for (let col = 0; col < 8; col++) {

            const piece = checkersBoard[row][col];

            if (
                piece &&
                piece.color === color
            ) {

                const moves = getCheckersMoves(row, col);

                if (moves.some(move => move.capture)) {
                    return true;
                }
            }
        }
    }

    return false;
}


function checkCheckersWinner() {

    let redPieces = 0;
    let blackPieces = 0;

    let redMoves = 0;
    let blackMoves = 0;

    for (let row = 0; row < 8; row++) {

        for (let col = 0; col < 8; col++) {

            const piece = checkersBoard[row][col];

            if (!piece) {
                continue;
            }

            if (piece.color === "red") {
                redPieces++;
                redMoves += getCheckersMoves(row, col).length;
            }

            if (piece.color === "black") {
                blackPieces++;
                blackMoves += getCheckersMoves(row, col).length;
            }
        }
    }

    if (redPieces === 0 || redMoves === 0) {
        return "black";
    }

    if (blackPieces === 0 || blackMoves === 0) {
        return "red";
    }

    return null;
}


// ============================================================
// WEBSOCKET CONNECTION
// ============================================================

wss.on("connection", (ws, req) => {

    const url = req.url || "/";

    // --------------------------------------------------------
    // NAVAL STRIKE
    // --------------------------------------------------------

    if (url.startsWith("/navalstrike")) {

        ws.game = "navalstrike";

        ws.send(JSON.stringify({
            type: "navalStrikeConnected"
        }));

        return;
    }


    // --------------------------------------------------------
    // CHESS
    // --------------------------------------------------------

    if (url.startsWith("/chess")) {

        ws.game = "chess";

        /*
         * Chess currently runs locally inside chess.html.
         * This route is reserved so the server can support
         * network chess later without disturbing the game.
         */

        ws.send(JSON.stringify({
            type: "chessConnected"
        }));

        return;
    }


    // --------------------------------------------------------
    // CHECKERS
    // --------------------------------------------------------

    if (url.startsWith("/checkers")) {

        ws.game = "checkers";

        if (!checkersPlayer1) {

            checkersPlayer1 = ws;
            ws.player = "red";

        } else if (!checkersPlayer2) {

            checkersPlayer2 = ws;
            ws.player = "black";

        } else {

            ws.send(JSON.stringify({
                type: "full"
            }));

            return;
        }

        ws.send(JSON.stringify({
            type: "checkersInit",
            player: ws.player,
            board: checkersBoard,
            turn: checkersTurn
        }));

        checkersBroadcast({
            type: "checkersPlayers",
            red: !!checkersPlayer1,
            black: !!checkersPlayer2
        });

        ws.on("message", data => {

            let message;

            try {
                message = JSON.parse(data);
            } catch {
                return;
            }

            if (message.type === "checkersMove") {

                if (ws.player !== checkersTurn) {
                    return;
                }

                const fromRow = message.fromRow;
                const fromCol = message.fromCol;

                const toRow = message.toRow;
                const toCol = message.toCol;

                if (
                    !Number.isInteger(fromRow) ||
                    !Number.isInteger(fromCol) ||
                    !Number.isInteger(toRow) ||
                    !Number.isInteger(toCol)
                ) {
                    return;
                }

                if (
                    fromRow < 0 || fromRow > 7 ||
                    fromCol < 0 || fromCol > 7 ||
                    toRow < 0 || toRow > 7 ||
                    toCol < 0 || toCol > 7
                ) {
                    return;
                }

                const piece = checkersBoard[fromRow][fromCol];

                if (!piece) {
                    return;
                }

                if (piece.color !== checkersTurn) {
                    return;
                }

                if (
                    checkersForcedPiece &&
                    (
                        checkersForcedPiece.row !== fromRow ||
                        checkersForcedPiece.col !== fromCol
                    )
                ) {
                    return;
                }

                const moves = getCheckersMoves(fromRow, fromCol);

                const move = moves.find(m =>
                    m.row === toRow &&
                    m.col === toCol
                );

                if (!move) {
                    return;
                }

                if (
                    hasCheckersCapture(checkersTurn) &&
                    !move.capture
                ) {
                    return;
                }

                checkersBoard[toRow][toCol] = piece;
                checkersBoard[fromRow][fromCol] = null;

                if (move.capture) {

                    checkersBoard[
                        move.capturedRow
                    ][
                        move.capturedCol
                    ] = null;
                }

                if (
                    piece.color === "red" &&
                    toRow === 0
                ) {
                    piece.king = true;
                }

                if (
                    piece.color === "black" &&
                    toRow === 7
                ) {
                    piece.king = true;
                }

                let anotherCapture = false;

                if (move.capture) {

                    const nextMoves =
                        getCheckersMoves(toRow, toCol);

                    anotherCapture =
                        nextMoves.some(m => m.capture);
                }

                if (anotherCapture) {

                    checkersForcedPiece = {
                        row: toRow,
                        col: toCol
                    };

                } else {

                    checkersForcedPiece = null;

                    checkersTurn =
                        checkersTurn === "red"
                            ? "black"
                            : "red";
                }

                const winner = checkCheckersWinner();

                checkersBroadcast({
                    type: "checkersUpdate",
                    board: checkersBoard,
                    turn: checkersTurn,
                    forcedPiece: checkersForcedPiece,
                    winner
                });
            }


            if (message.type === "checkersReset") {

                checkersBoard = createCheckersBoard();
                checkersTurn = "red";
                checkersForcedPiece = null;

                checkersBroadcast({
                    type: "checkersUpdate",
                    board: checkersBoard,
                    turn: checkersTurn,
                    forcedPiece: null,
                    winner: null
                });
            }

        });

        ws.on("close", () => {

            if (ws === checkersPlayer1) {
                checkersPlayer1 = null;
            }

            if (ws === checkersPlayer2) {
                checkersPlayer2 = null;
            }

            checkersBroadcast({
                type: "checkersPlayers",
                red: !!checkersPlayer1,
                black: !!checkersPlayer2
            });
        });

        return;
    }


    // --------------------------------------------------------
    // TIC-TAC-TOE
    // --------------------------------------------------------

    ws.game = "ttt";

    if (!tttPlayer1) {

        tttPlayer1 = ws;
        ws.player = "X";

    } else if (!tttPlayer2) {

        tttPlayer2 = ws;
        ws.player = "O";

    } else {

        ws.send(JSON.stringify({
            type: "full"
        }));

        return;
    }

    ws.send(JSON.stringify({
        type: "init",
        player: ws.player,
        board: tttBoard,
        turn: tttTurn
    }));

    tttBroadcast({
        type: "players",
        x: !!tttPlayer1,
        o: !!tttPlayer2
    });


    ws.on("message", data => {

        let message;

        try {
            message = JSON.parse(data);
        } catch {
            return;
        }


        // ----------------------------------------------------
        // TIC-TAC-TOE MOVE
        // ----------------------------------------------------

        if (message.type === "move") {

            if (ws.player !== tttTurn) {
                return;
            }

            const index = message.index;

            if (
                !Number.isInteger(index) ||
                index < 0 ||
                index > 8
            ) {
                return;
            }

            if (tttBoard[index] !== "") {
                return;
            }

            tttBoard[index] = ws.player;

            const winner = checkTTTWinner();

            if (!winner) {

                tttTurn =
                    tttTurn === "X"
                        ? "O"
                        : "X";
            }

            tttBroadcast({
                type: "update",
                board: tttBoard,
                turn: tttTurn,
                winner
            });
        }


        // ----------------------------------------------------
        // TIC-TAC-TOE RESET
        // ----------------------------------------------------

        if (message.type === "reset") {

            tttBoard = [
                "", "", "",
                "", "", "",
                "", "", ""
            ];

            tttTurn = "X";

            tttBroadcast({
                type: "update",
                board: tttBoard,
                turn: tttTurn,
                winner: null
            });
        }

    });


    ws.on("close", () => {

        if (ws === tttPlayer1) {
            tttPlayer1 = null;
        }

        if (ws === tttPlayer2) {
            tttPlayer2 = null;
        }

        tttBroadcast({
            type: "players",
            x: !!tttPlayer1,
            o: !!tttPlayer2
        });
    });

});


// ============================================================
// START SERVER
// ============================================================

server.listen(PORT, () => {

    console.log("");
    console.log("========================================");
    console.log("       GAME SERVER ONLINE");
    console.log("========================================");
    console.log("");
    console.log("Port:", PORT);
    console.log("");
    console.log("Games:");
    console.log("  /ttt.html");
    console.log("  /checkers.html");
    console.log("  /navalstrike.html");
    console.log("  /chess.html");
    console.log("");
    console.log("========================================");
    console.log("");

});
