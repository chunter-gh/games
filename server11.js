const http = require("http");
const fs = require("fs");
const WebSocket = require("ws");


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

    } else {
        res.writeHead(404, {
            "Content-Type": "text/plain"
        });

        res.end("Not found");
        return;
    }

    fs.readFile(file, (err, data) => {

        if (err) {
            console.log("File error:", file, err.message);

            res.writeHead(500, {
                "Content-Type": "text/plain"
            });

            res.end("Server error");
            return;
        }

        res.writeHead(200, {
            "Content-Type": "text/html"
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
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
];

let tttTurn = "X";
let tttGameOver = false;
let tttWinner = null;


function tttCheckWinner() {

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

    for (const combo of wins) {

        const a = combo[0];
        const b = combo[1];
        const c = combo[2];

        if (
            tttBoard[a] !== "" &&
            tttBoard[a] === tttBoard[b] &&
            tttBoard[a] === tttBoard[c]
        ) {
            return tttBoard[a];
        }
    }

    if (!tttBoard.includes("")) {
        return "DRAW";
    }

    return null;
}


function broadcastTicTacToe() {

    const message = JSON.stringify({
        type: "tttState",
        board: tttBoard,
        turn: tttTurn,
        gameOver: tttGameOver,
        winner: tttWinner,
        players: {
            player1: !!tttPlayer1,
            player2: !!tttPlayer2
        }
    });

    if (
        tttPlayer1 &&
        tttPlayer1.readyState === WebSocket.OPEN
    ) {
        tttPlayer1.send(message);
    }

    if (
        tttPlayer2 &&
        tttPlayer2.readyState === WebSocket.OPEN
    ) {
        tttPlayer2.send(message);
    }
}


function resetTicTacToe() {

    tttBoard = [
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ];

    tttTurn = "X";
    tttGameOver = false;
    tttWinner = null;

    broadcastTicTacToe();
}


function connectTicTacToe(ws) {

    if (!tttPlayer1) {

        tttPlayer1 = ws;
        ws.tttPlayer = "X";

        ws.send(JSON.stringify({
            type: "tttRole",
            player: "X"
        }));

    } else if (!tttPlayer2) {

        tttPlayer2 = ws;
        ws.tttPlayer = "O";

        ws.send(JSON.stringify({
            type: "tttRole",
            player: "O"
        }));

    } else {

        ws.send(JSON.stringify({
            type: "full"
        }));

        return;
    }

    broadcastTicTacToe();
}


function handleTicTacToe(ws, data) {

    if (data.type === "connectTicTacToe") {
        connectTicTacToe(ws);
        return;
    }

    if (data.type === "tttMove") {

        if (tttGameOver) {
            return;
        }

        if (!ws.tttPlayer) {
            return;
        }

        if (ws.tttPlayer !== tttTurn) {
            return;
        }

        const index = Number(data.index);

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

        tttBoard[index] = ws.tttPlayer;

        const result = tttCheckWinner();

        if (result) {

            tttGameOver = true;
            tttWinner = result;

        } else {

            tttTurn =
                tttTurn === "X"
                    ? "O"
                    : "X";
        }

        broadcastTicTacToe();
        return;
    }

    if (data.type === "tttReset") {
        resetTicTacToe();
        return;
    }
}


// ============================================================
// CHECKERS
// ============================================================

let checkersPlayer1 = null;
let checkersPlayer2 = null;

let checkersBoard = [];

let checkersTurn = "red";

let checkersGameOver = false;

let checkersWinner = null;

let checkersMustContinue = null;


// ============================================================
// CREATE CHECKERS BOARD
// ============================================================

function createCheckersBoard() {

    const board = [];

    for (let row = 0; row < 8; row++) {

        board[row] = [];

        for (let col = 0; col < 8; col++) {

            if ((row + col) % 2 === 0) {

                board[row][col] = null;

            } else {

                if (row < 3) {

                    board[row][col] = {
                        color: "black",
                        king: false
                    };

                } else if (row > 4) {

                    board[row][col] = {
                        color: "red",
                        king: false
                    };

                } else {

                    board[row][col] = null;
                }
            }
        }
    }

    return board;
}


checkersBoard = createCheckersBoard();


// ============================================================
// CHECKERS HELPERS
// ============================================================

function checkersInside(row, col) {

    return (
        row >= 0 &&
        row < 8 &&
        col >= 0 &&
        col < 8
    );
}


function checkersValidMove(
    fromRow,
    fromCol,
    toRow,
    toCol,
    player
) {

    if (
        !checkersInside(fromRow, fromCol) ||
        !checkersInside(toRow, toCol)
    ) {
        return false;
    }

    const piece =
        checkersBoard[fromRow][fromCol];

    if (!piece) {
        return false;
    }

    if (piece.color !== player) {
        return false;
    }

    if (checkersBoard[toRow][toCol]) {
        return false;
    }

    const rowDiff = toRow - fromRow;
    const colDiff = toCol - fromCol;

    const absRow = Math.abs(rowDiff);
    const absCol = Math.abs(colDiff);

    if (absRow !== absCol) {
        return false;
    }


    if (piece.king) {

        if (absRow === 1) {
            return true;
        }

        if (absRow === 2) {

            const middleRow =
                fromRow + rowDiff / 2;

            const middleCol =
                fromCol + colDiff / 2;

            const middlePiece =
                checkersBoard[middleRow][middleCol];

            if (
                middlePiece &&
                middlePiece.color !== player
            ) {
                return true;
            }
        }

        return false;
    }


    const direction =
        player === "red"
            ? -1
            : 1;

    if (absRow === 1) {

        if (rowDiff === direction) {
            return true;
        }

        return false;
    }


    if (absRow === 2) {

        if (rowDiff !== direction * 2) {
            return false;
        }

        const middleRow =
            fromRow + rowDiff / 2;

        const middleCol =
            fromCol + colDiff / 2;

        const middlePiece =
            checkersBoard[middleRow][middleCol];

        if (
            middlePiece &&
            middlePiece.color !== player
        ) {
            return true;
        }
    }

    return false;
}


function makeCheckersMove(
    fromRow,
    fromCol,
    toRow,
    toCol
) {

    const piece =
        checkersBoard[fromRow][fromCol];

    if (!piece) {
        return false;
    }

    const rowDiff =
        toRow - fromRow;

    const absRow =
        Math.abs(rowDiff);


    checkersBoard[toRow][toCol] = piece;

    checkersBoard[fromRow][fromCol] = null;


    let captured = false;

    if (absRow === 2) {

        const middleRow =
            fromRow + rowDiff / 2;

        const middleCol =
            fromCol +
            (toCol - fromCol) / 2;

        checkersBoard[middleRow][middleCol] = null;

        captured = true;
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

    return captured;
}


function checkersHasCapture(row, col) {

    const piece =
        checkersBoard[row][col];

    if (!piece) {
        return false;
    }

    const directions = [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1]
    ];

    for (const dir of directions) {

        const middleRow =
            row + dir[0];

        const middleCol =
            col + dir[1];

        const landRow =
            row + dir[0] * 2;

        const landCol =
            col + dir[1] * 2;

        if (
            checkersInside(landRow, landCol) &&
            checkersInside(middleRow, middleCol)
        ) {

            const middle =
                checkersBoard[middleRow][middleCol];

            const landing =
                checkersBoard[landRow][landCol];

            if (
                middle &&
                middle.color !== piece.color &&
                !landing
            ) {
                return true;
            }
        }
    }

    return false;
}


function checkersHasPieces(color) {

    for (let row = 0; row < 8; row++) {

        for (let col = 0; col < 8; col++) {

            const piece =
                checkersBoard[row][col];

            if (
                piece &&
                piece.color === color
            ) {
                return true;
            }
        }
    }

    return false;
}


function checkCheckersWinner() {

    if (!checkersHasPieces("red")) {
        return "black";
    }

    if (!checkersHasPieces("black")) {
        return "red";
    }

    return null;
}


// ============================================================
// CHECKERS BROADCAST
// ============================================================

function broadcastCheckers() {

    const message = JSON.stringify({
        type: "checkersState",
        board: checkersBoard,
        turn: checkersTurn,
        gameOver: checkersGameOver,
        winner: checkersWinner,
        mustContinue: checkersMustContinue,
        players: {
            player1: !!checkersPlayer1,
            player2: !!checkersPlayer2
        }
    });

    if (
        checkersPlayer1 &&
        checkersPlayer1.readyState === WebSocket.OPEN
    ) {
        checkersPlayer1.send(message);
    }

    if (
        checkersPlayer2 &&
        checkersPlayer2.readyState === WebSocket.OPEN
    ) {
        checkersPlayer2.send(message);
    }
}


// ============================================================
// CHECKERS RESET
// ============================================================

function resetCheckers() {

    checkersBoard =
        createCheckersBoard();

    checkersTurn = "red";

    checkersGameOver = false;

    checkersWinner = null;

    checkersMustContinue = null;

    broadcastCheckers();
}


// ============================================================
// CHECKERS CONNECT
// ============================================================

function connectCheckers(ws) {

    if (!checkersPlayer1) {

        checkersPlayer1 = ws;

        ws.checkersPlayer = "red";

        ws.send(JSON.stringify({
            type: "checkersRole",
            player: "red"
        }));

    } else if (!checkersPlayer2) {

        checkersPlayer2 = ws;

        ws.checkersPlayer = "black";

        ws.send(JSON.stringify({
            type: "checkersRole",
            player: "black"
        }));

    } else {

        ws.send(JSON.stringify({
            type: "full"
        }));

        return;
    }

    broadcastCheckers();
}


// ============================================================
// CHECKERS MESSAGE HANDLER
// ============================================================

function handleCheckers(ws, data) {

    if (data.type === "connectCheckers") {

        connectCheckers(ws);

        return;
    }


    if (data.type === "checkersMove") {

        if (checkersGameOver) {
            return;
        }

        if (!ws.checkersPlayer) {
            return;
        }

        const player =
            ws.checkersPlayer;

        if (player !== checkersTurn) {
            return;
        }


        const fromRow =
            Number(data.fromRow);

        const fromCol =
            Number(data.fromCol);

        const toRow =
            Number(data.toRow);

        const toCol =
            Number(data.toCol);


        if (
            !Number.isInteger(fromRow) ||
            !Number.isInteger(fromCol) ||
            !Number.isInteger(toRow) ||
            !Number.isInteger(toCol)
        ) {
            return;
        }


        if (
            !checkersInside(fromRow, fromCol) ||
            !checkersInside(toRow, toCol)
        ) {
            return;
        }


        const piece =
            checkersBoard[fromRow][fromCol];

        if (!piece) {
            return;
        }

        if (piece.color !== player) {
            return;
        }


        if (checkersMustContinue) {

            if (
                checkersMustContinue.row !== fromRow ||
                checkersMustContinue.col !== fromCol
            ) {
                return;
            }
        }


        if (
            !checkersValidMove(
                fromRow,
                fromCol,
                toRow,
                toCol,
                player
            )
        ) {
            return;
        }


        const captured =
            makeCheckersMove(
                fromRow,
                fromCol,
                toRow,
                toCol
            );


        const winner =
            checkCheckersWinner();

        if (winner) {

            checkersGameOver = true;

            checkersWinner = winner;

            checkersMustContinue = null;

            broadcastCheckers();

            return;
        }


        if (captured) {

            if (
                checkersHasCapture(
                    toRow,
                    toCol
                )
            ) {

                checkersMustContinue = {
                    row: toRow,
                    col: toCol
                };

                broadcastCheckers();

                return;
            }
        }


        checkersMustContinue = null;


        checkersTurn =
            checkersTurn === "red"
                ? "black"
                : "red";


        broadcastCheckers();

        return;
    }


    if (data.type === "checkersReset") {

        resetCheckers();

        return;
    }
}


// ============================================================
// WEBSOCKET CONNECTION
// ============================================================

wss.on("connection", (ws, req) => {

    const url =
        req.url || "/";


    // ========================================================
    // CHECKERS
    // ========================================================

    if (url.startsWith("/checkers")) {

        ws.game = "checkers";

        handleCheckers(ws, {
            type: "connectCheckers"
        });


        ws.on("message", message => {

            try {

                const data =
                    JSON.parse(
                        message.toString()
                    );

                handleCheckers(ws, data);

            } catch (err) {

                console.log(
                    "Invalid Checkers message"
                );
            }
        });


        ws.on("close", () => {

            if (checkersPlayer1 === ws) {
                checkersPlayer1 = null;
            }

            if (checkersPlayer2 === ws) {
                checkersPlayer2 = null;
            }

            broadcastCheckers();
        });


        return;
    }


    // ========================================================
    // NAVAL STRIKE
    // ========================================================

    if (url.startsWith("/navalstrike")) {

        ws.game = "navalstrike";

        ws.send(JSON.stringify({
            type: "navalStrikeConnected"
        }));

        return;
    }


    // ========================================================
    // TIC-TAC-TOE
    // ========================================================

    ws.game = "ttt";

    handleTicTacToe(ws, {
        type: "connectTicTacToe"
    });


    ws.on("message", message => {

        try {

            const data =
                JSON.parse(
                    message.toString()
                );

            handleTicTacToe(ws, data);

        } catch (err) {

            console.log(
                "Invalid Tic-Tac-Toe message"
            );
        }
    });


    ws.on("close", () => {

        if (tttPlayer1 === ws) {
            tttPlayer1 = null;
        }

        if (tttPlayer2 === ws) {
            tttPlayer2 = null;
        }

        broadcastTicTacToe();
    });
});


// ============================================================
// START SERVER
// ============================================================

const PORT =
    process.env.PORT || 3000;


server.listen(PORT, () => {

    console.log("");
    console.log("============================================================");
    console.log("                   GAME SERVER 11");
    console.log("============================================================");
    console.log("");
    console.log("Port:", PORT);
    console.log("");
    console.log("Games:");
    console.log("  Tic-Tac-Toe");
    console.log("  Checkers");
    console.log("  Naval Strike");
    console.log("");
    console.log("============================================================");
    console.log("");
});
