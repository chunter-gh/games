const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const ROOT = __dirname;


/* =========================================================
   HTTP SERVER
   ========================================================= */

const server = http.createServer((req, res) => {

    let requestPath;

    try {
        requestPath = decodeURIComponent(
            req.url.split("?")[0]
        );
    } catch (err) {
        res.writeHead(400, {
            "Content-Type": "text/plain"
        });

        res.end("Bad Request");
        return;
    }


    /* -----------------------------------------------------
       AUTOMATIC GAME LIST
       ----------------------------------------------------- */

    if (requestPath === "/games") {

        fs.readdir(ROOT, (err, files) => {

            if (err) {

                res.writeHead(500, {
                    "Content-Type": "application/json"
                });

                res.end(JSON.stringify({
                    error: "Unable to read game directory"
                }));

                return;
            }


            const games = files
                .filter(file =>
                    file.toLowerCase().endsWith(".html")
                )
                .filter(file =>
                    file.toLowerCase() !== "index.html"
                )
                .sort((a, b) =>
                    a.localeCompare(
                        b,
                        undefined,
                        {
                            sensitivity: "base"
                        }
                    )
                );


            res.writeHead(200, {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
                "Access-Control-Allow-Origin": "*"
            });

            res.end(JSON.stringify(games));

        });

        return;
    }


    /* -----------------------------------------------------
       ROOT
       ----------------------------------------------------- */

    if (requestPath === "/") {
        requestPath = "/index.html";
    }


    /* -----------------------------------------------------
       AUTOMATIC HTML FILE SERVING
       ----------------------------------------------------- */

    if (requestPath.toLowerCase().endsWith(".html")) {

        /*
         * Only allow simple filenames.
         *
         * This prevents requests from escaping the
         * game directory with ../ paths.
         */

        const filename =
            path.basename(requestPath);

        const filePath =
            path.join(ROOT, filename);


        /*
         * Make sure the requested file actually exists
         * and is a regular file.
         */

        fs.stat(filePath, (err, stats) => {

            if (err || !stats.isFile()) {

                res.writeHead(404, {
                    "Content-Type": "text/plain"
                });

                res.end("404 - Game Not Found");
                return;
            }


            /*
             * All .html files are automatically served.
             */

            fs.readFile(
                filePath,
                "utf8",
                (readErr, data) => {

                    if (readErr) {

                        res.writeHead(500, {
                            "Content-Type": "text/plain"
                        });

                        res.end("500 - Error Reading File");
                        return;
                    }


                    res.writeHead(200, {
                        "Content-Type": "text/html; charset=utf-8",
                        "Cache-Control": "no-store"
                    });

                    res.end(data);
                }
            );

        });

        return;
    }


    /* -----------------------------------------------------
       FAVICON
       ----------------------------------------------------- */

    if (requestPath === "/favicon.ico") {

        res.writeHead(204);
        res.end();

        return;
    }


    /* -----------------------------------------------------
       EVERYTHING ELSE
       ----------------------------------------------------- */

    res.writeHead(404, {
        "Content-Type": "text/plain"
    });

    res.end("404 - Not Found");

});


/* =========================================================
   WEBSOCKET SERVER
   ========================================================= */

const wss = new WebSocket.Server({
    server
});


/* =========================================================
   TIC-TAC-TOE
   ========================================================= */

let tttPlayer1 = null;
let tttPlayer2 = null;

let tttBoard = Array(9).fill(null);

let tttTurn = "X";

let tttGameOver = false;


/* =========================================================
   CHECKERS
   ========================================================= */

let checkersPlayer1 = null;
let checkersPlayer2 = null;

let checkersBoard = createCheckersBoard();

let checkersTurn = "red";

let checkersGameOver = false;

let checkersForcedPiece = null;


/* =========================================================
   CREATE CHECKERS BOARD
   ========================================================= */

function createCheckersBoard() {

    const board = Array.from(
        { length: 8 },
        () => Array(8).fill(null)
    );


    for (let row = 0; row < 3; row++) {

        for (let col = 0; col < 8; col++) {

            if ((row + col) % 2 === 1) {
                board[row][col] = "black";
            }

        }

    }


    for (let row = 5; row < 8; row++) {

        for (let col = 0; col < 8; col++) {

            if ((row + col) % 2 === 1) {
                board[row][col] = "red";
            }

        }

    }


    return board;
}


/* =========================================================
   TTT WIN CHECK
   ========================================================= */

function checkTTTWinner(board) {

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


    for (const line of wins) {

        const [a, b, c] = line;

        if (
            board[a] &&
            board[a] === board[b] &&
            board[a] === board[c]
        ) {
            return board[a];
        }

    }


    if (board.every(cell => cell !== null)) {
        return "draw";
    }


    return null;
}


/* =========================================================
   BROADCAST TTT
   ========================================================= */

function broadcastTTT() {

    const message = JSON.stringify({
        type: "tttState",
        board: tttBoard,
        turn: tttTurn,
        gameOver: tttGameOver
    });


    [tttPlayer1, tttPlayer2].forEach(player => {

        if (
            player &&
            player.readyState === WebSocket.OPEN
        ) {
            player.send(message);
        }

    });

}


/* =========================================================
   BROADCAST CHECKERS
   ========================================================= */

function broadcastCheckers() {

    const message = JSON.stringify({
        type: "checkersState",
        board: checkersBoard,
        turn: checkersTurn,
        gameOver: checkersGameOver,
        forcedPiece: checkersForcedPiece
    });


    [checkersPlayer1, checkersPlayer2].forEach(player => {

        if (
            player &&
            player.readyState === WebSocket.OPEN
        ) {
            player.send(message);
        }

    });

}


/* =========================================================
   CHECKERS PIECE COLOR
   ========================================================= */

function checkersColor(piece) {

    if (!piece) {
        return null;
    }


    if (piece === "red" || piece === "redKing") {
        return "red";
    }


    if (piece === "black" || piece === "blackKing") {
        return "black";
    }


    return null;
}


/* =========================================================
   CHECKERS KING
   ========================================================= */

function isCheckersKing(piece) {

    return (
        piece === "redKing" ||
        piece === "blackKing"
    );
}


/* =========================================================
   CHECKERS VALID MOVE
   ========================================================= */

function validCheckersMove(
    fromRow,
    fromCol,
    toRow,
    toCol,
    player
) {

    if (
        fromRow < 0 ||
        fromRow > 7 ||
        fromCol < 0 ||
        fromCol > 7 ||
        toRow < 0 ||
        toRow > 7 ||
        toCol < 0 ||
        toCol > 7
    ) {
        return false;
    }


    const piece =
        checkersBoard[fromRow][fromCol];


    if (!piece) {
        return false;
    }


    if (
        checkersColor(piece) !== player
    ) {
        return false;
    }


    if (
        checkersBoard[toRow][toCol] !== null
    ) {
        return false;
    }


    const rowDiff =
        toRow - fromRow;

    const colDiff =
        toCol - fromCol;


    const absRow =
        Math.abs(rowDiff);

    const absCol =
        Math.abs(colDiff);


    if (
        absRow !== absCol
    ) {
        return false;
    }


    if (absRow === 1) {

        if (isCheckersKing(piece)) {
            return true;
        }


        if (player === "red") {
            return rowDiff === -1;
        }


        return rowDiff === 1;
    }


    if (absRow === 2) {

        const middleRow =
            fromRow + rowDiff / 2;

        const middleCol =
            fromCol + colDiff / 2;


        const middlePiece =
            checkersBoard[middleRow][middleCol];


        if (!middlePiece) {
            return false;
        }


        if (
            checkersColor(middlePiece) === player
        ) {
            return false;
        }


        return true;
    }


    return false;
}


/* =========================================================
   CHECKERS MOVE
   ========================================================= */

function makeCheckersMove(
    fromRow,
    fromCol,
    toRow,
    toCol,
    player
) {

    if (
        !validCheckersMove(
            fromRow,
            fromCol,
            toRow,
            toCol,
            player
        )
    ) {
        return false;
    }


    const piece =
        checkersBoard[fromRow][fromCol];


    const rowDiff =
        toRow - fromRow;

    const absRow =
        Math.abs(rowDiff);


    const wasKing =
        isCheckersKing(piece);


    checkersBoard[
        toRow
    ][
        toCol
    ] = piece;


    checkersBoard[
        fromRow
    ][
        fromCol
    ] = null;


    /*
     * Capture
     */

    if (absRow === 2) {

        const middleRow =
            fromRow + rowDiff / 2;

        const middleCol =
            fromCol +
            (toCol - fromCol) / 2;


        checkersBoard[
            middleRow
        ][
            middleCol
        ] = null;

    }


    /*
     * Promotion
     */

    if (
        piece === "red" &&
        toRow === 0
    ) {
        checkersBoard[
            toRow
        ][
            toCol
        ] = "redKing";
    }


    if (
        piece === "black" &&
        toRow === 7
    ) {
        checkersBoard[
            toRow
        ][
            toCol
        ] = "blackKing";
    }


    /*
     * Multi-capture detection.
     */

    checkersForcedPiece = null;


    if (absRow === 2) {

        const nextPiece =
            checkersBoard[toRow][toCol];


        const moves =
            getCheckersCaptures(
                toRow,
                toCol,
                player
            );


        if (moves.length > 0) {

            checkersForcedPiece = {
                row: toRow,
                col: toCol
            };

            broadcastCheckers();

            return true;
        }
    }


    checkersTurn =
        player === "red"
            ? "black"
            : "red";


    return true;
}


/* =========================================================
   CHECKERS CAPTURES
   ========================================================= */

function getCheckersCaptures(
    row,
    col,
    player
) {

    const piece =
        checkersBoard[row][col];


    if (!piece) {
        return [];
    }


    const directions = [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1]
    ];


    const result = [];


    for (const [dr, dc] of directions) {

        const middleRow =
            row + dr;

        const middleCol =
            col + dc;

        const toRow =
            row + dr * 2;

        const toCol =
            col + dc * 2;


        if (
            toRow < 0 ||
            toRow > 7 ||
            toCol < 0 ||
            toCol > 7
        ) {
            continue;
        }


        const middlePiece =
            checkersBoard[
                middleRow
            ][
                middleCol
            ];


        if (!middlePiece) {
            continue;
        }


        if (
            checkersColor(middlePiece) === player
        ) {
            continue;
        }


        if (
            checkersBoard[
                toRow
            ][
                toCol
            ] !== null
        ) {
            continue;
        }


        result.push({
            row: toRow,
            col: toCol
        });

    }


    return result;
}


/* =========================================================
   WEBSOCKET CONNECTION
   ========================================================= */

wss.on("connection", (ws, req) => {

    const url =
        req.url || "/";


    /* =====================================================
       CHESS
       ===================================================== */

    if (url.startsWith("/chess")) {

        ws.game = "chess";

        ws.send(JSON.stringify({
            type: "chessConnected"
        }));

        return;
    }


    /* =====================================================
       NAVAL STRIKE
       ===================================================== */

    if (url.startsWith("/navalstrike")) {

        ws.game = "navalstrike";

        ws.send(JSON.stringify({
            type: "navalStrikeConnected"
        }));

        return;
    }


    /* =====================================================
       CHECKERS
       ===================================================== */

    if (url.startsWith("/checkers")) {

        ws.game = "checkers";


        if (!checkersPlayer1) {

            checkersPlayer1 = ws;

            ws.player =
                "red";

        } else if (!checkersPlayer2) {

            checkersPlayer2 = ws;

            ws.player =
                "black";

        } else {

            ws.player =
                "spectator";
        }


        ws.send(JSON.stringify({
            type: "checkersAssigned",
            player: ws.player
        }));


        broadcastCheckers();


        ws.on("message", data => {

            let message;

            try {
                message =
                    JSON.parse(data.toString());
            } catch (err) {
                return;
            }


            if (
                message.type === "checkersMove"
            ) {

                if (
                    ws.player !== checkersTurn
                ) {
                    return;
                }


                if (
                    checkersForcedPiece &&
                    (
                        message.fromRow !==
                            checkersForcedPiece.row ||
                        message.fromCol !==
                            checkersForcedPiece.col
                    )
                ) {
                    return;
                }


                const moved =
                    makeCheckersMove(
                        message.fromRow,
                        message.fromCol,
                        message.toRow,
                        message.toCol,
                        ws.player
                    );


                if (!moved) {
                    return;
                }


                broadcastCheckers();
            }


            if (
                message.type === "checkersReset"
            ) {

                checkersBoard =
                    createCheckersBoard();

                checkersTurn =
                    "red";

                checkersGameOver =
                    false;

                checkersForcedPiece =
                    null;

                broadcastCheckers();
            }

        });


        ws.on("close", () => {

            if (
                checkersPlayer1 === ws
            ) {
                checkersPlayer1 = null;
            }


            if (
                checkersPlayer2 === ws
            ) {
                checkersPlayer2 = null;
            }

        });


        return;
    }


    /* =====================================================
       TIC-TAC-TOE
       ===================================================== */

    ws.game = "ttt";


    if (!tttPlayer1) {

        tttPlayer1 = ws;

        ws.player =
            "X";

    } else if (!tttPlayer2) {

        tttPlayer2 = ws;

        ws.player =
            "O";

    } else {

        ws.player =
            "spectator";
    }


    ws.send(JSON.stringify({
        type: "tttAssigned",
        player: ws.player
    }));


    broadcastTTT();


    ws.on("message", data => {

        let message;

        try {
            message =
                JSON.parse(data.toString());
        } catch (err) {
            return;
        }


        /* -----------------------------------------------
           MOVE
           ----------------------------------------------- */

        if (
            message.type === "tttMove"
        ) {

            if (
                tttGameOver
            ) {
                return;
            }


            if (
                ws.player !== tttTurn
            ) {
                return;
            }


            const index =
                Number(message.index);


            if (
                !Number.isInteger(index) ||
                index < 0 ||
                index > 8
            ) {
                return;
            }


            if (
                tttBoard[index] !== null
            ) {
                return;
            }


            tttBoard[index] =
                ws.player;


            const winner =
                checkTTTWinner(
                    tttBoard
                );


            if (winner) {

                tttGameOver =
                    true;
            } else {

                tttTurn =
                    tttTurn === "X"
                        ? "O"
                        : "X";
            }


            broadcastTTT();
        }


        /* -----------------------------------------------
           RESET
           ----------------------------------------------- */

        if (
            message.type === "tttReset"
        ) {

            tttBoard =
                Array(9).fill(null);

            tttTurn =
                "X";

            tttGameOver =
                false;

            broadcastTTT();
        }

    });


    ws.on("close", () => {

        if (
            tttPlayer1 === ws
        ) {
            tttPlayer1 = null;
        }


        if (
            tttPlayer2 === ws
        ) {
            tttPlayer2 = null;
        }

    });

});


/* =========================================================
   START SERVER
   ========================================================= */

server.listen(PORT, () => {

    console.log("");
    console.log("==========================================");
    console.log("             GAME SERVER");
    console.log("==========================================");
    console.log("");
    console.log("Port:", PORT);
    console.log("");
    console.log("Automatic HTML game discovery: ENABLED");
    console.log("Automatic /games endpoint: ENABLED");
    console.log("Tic-Tac-Toe WebSocket: ENABLED");
    console.log("Checkers WebSocket: ENABLED");
    console.log("Naval Strike WebSocket: ENABLED");
    console.log("Chess WebSocket: ENABLED");
    console.log("");
    console.log("Any .html game in this folder is");
    console.log("automatically available.");
    console.log("");
    console.log("==========================================");
    console.log("");

});
