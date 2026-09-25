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

    const url = new URL(
        req.url,
        `http://${req.headers.host}`
    );


    /* -----------------------------------------------------
       AUTOMATIC GAME DISCOVERY
       ----------------------------------------------------- */

    if (url.pathname === "/games") {

        fs.readdir(
            ROOT,
            { withFileTypes: true },
            (err, entries) => {

                if (err) {

                    console.error(
                        "Game discovery error:",
                        err
                    );

                    res.writeHead(
                        500,
                        {
                            "Content-Type":
                                "application/json"
                        }
                    );

                    res.end(
                        JSON.stringify({
                            error:
                                "Could not scan games"
                        })
                    );

                    return;
                }


                const games =
                    entries
                        .filter(entry =>

                            entry.isFile() &&

                            entry.name
                                .toLowerCase()
                                .endsWith(".html") &&

                            entry.name
                                .toLowerCase() !==
                                "index.html"

                        )
                        .map(entry =>
                            entry.name
                        )
                        .sort(
                            (a, b) =>
                                a.localeCompare(
                                    b,
                                    undefined,
                                    {
                                        sensitivity:
                                            "base"
                                    }
                                )
                        );


                console.log(
                    "Discovered games:",
                    games
                );


                res.writeHead(
                    200,
                    {
                        "Content-Type":
                            "application/json",

                        "Cache-Control":
                            "no-store"
                    }
                );

                res.end(
                    JSON.stringify(games)
                );
            }
        );

        return;
    }


    /* -----------------------------------------------------
       ROOT / MENU
       ----------------------------------------------------- */

    if (
        url.pathname === "/" ||
        url.pathname === "/index.html"
    ) {

        const file =
            path.join(
                ROOT,
                "index.html"
            );

        fs.readFile(
            file,
            (err, data) => {

                if (err) {

                    res.writeHead(404);

                    res.end(
                        "index.html not found"
                    );

                    return;
                }

                res.writeHead(
                    200,
                    {
                        "Content-Type":
                            "text/html"
                    }
                );

                res.end(data);
            }
        );

        return;
    }


    /* -----------------------------------------------------
       FAVICON
       ----------------------------------------------------- */

    if (
        url.pathname === "/favicon.ico"
    ) {

        res.writeHead(204);

        res.end();

        return;
    }


    /* -----------------------------------------------------
       HTML FILES
       ----------------------------------------------------- */

    if (
        url.pathname
            .toLowerCase()
            .endsWith(".html")
    ) {

        const requested =
            decodeURIComponent(
                url.pathname
            )
            .replace(/^\/+/, "");


        /*
         * Prevent paths from escaping ROOT.
         */

        const file =
            path.resolve(
                ROOT,
                requested
            );

        if (
            !file.startsWith(
                path.resolve(ROOT)
            )
        ) {

            res.writeHead(403);

            res.end(
                "Forbidden"
            );

            return;
        }


        fs.readFile(
            file,
            (err, data) => {

                if (err) {

                    res.writeHead(404);

                    res.end(
                        "File not found"
                    );

                    return;
                }

                res.writeHead(
                    200,
                    {
                        "Content-Type":
                            "text/html"
                    }
                );

                res.end(data);
            }
        );

        return;
    }


    /* -----------------------------------------------------
       404
       ----------------------------------------------------- */

    res.writeHead(404);

    res.end("Not found");
});


/* =========================================================
   WEBSOCKET SERVER
   ========================================================= */

const wss =
    new WebSocket.Server({
        server
    });


/* =========================================================
   CHESS
   ========================================================= */

const chessClients = new Set();

wss.on("connection", (ws, req) => {

    const pathname =
        new URL(
            req.url,
            `http://${req.headers.host}`
        ).pathname;


    /* =====================================================
       CHESS
       ===================================================== */

    if (pathname === "/chess") {

        chessClients.add(ws);

        let player =
            "spectator";


        if (
            ![...chessClients]
                .some(
                    client =>
                        client.chessPlayer ===
                        "white"
                )
        ) {

            player = "white";

        } else if (
            ![...chessClients]
                .some(
                    client =>
                        client.chessPlayer ===
                        "black"
                )
        ) {

            player = "black";
        }


        ws.chessPlayer =
            player;


        ws.send(
            JSON.stringify({
                type:
                    "chessConnected",
                player
            })
        );


        ws.on("message", message => {

            /*
             * Chess currently handles
             * the actual board/game logic
             * in the browser.
             *
             * The server simply relays
             * messages between chess
             * players.
             */

            for (
                const client of chessClients
            ) {

                if (
                    client !== ws &&
                    client.readyState ===
                        WebSocket.OPEN
                ) {

                    client.send(
                        message.toString()
                    );
                }
            }
        });


        ws.on("close", () => {

            chessClients.delete(ws);

        });


        return;
    }


    /* =====================================================
       NAVAL STRIKE
       ===================================================== */

    if (
        pathname === "/navalstrike"
    ) {

        /*
         * Naval Strike clients are
         * relayed to each other.
         */

        ws.on("message", message => {

            wss.clients.forEach(
                client => {

                    if (
                        client !== ws &&
                        client.readyState ===
                            WebSocket.OPEN
                    ) {

                        client.send(
                            message.toString()
                        );
                    }
                }
            );
        });

        return;
    }


    /* =====================================================
       CHECKERS
       ===================================================== */

    if (
        pathname === "/checkers"
    ) {

        ws.checkersPlayer =
            null;


        /*
         * Find existing checkers
         * players.
         */

        const checkersPlayers =
            [...wss.clients]
                .filter(
                    client =>
                        client.checkersPlayer
                );


        if (
            !checkersPlayers.some(
                client =>
                    client.checkersPlayer ===
                    "red"
            )
        ) {

            ws.checkersPlayer =
                "red";

        } else if (
            !checkersPlayers.some(
                client =>
                    client.checkersPlayer ===
                    "black"
            )
        ) {

            ws.checkersPlayer =
                "black";

        } else {

            ws.checkersPlayer =
                "spectator";
        }


        ws.send(
            JSON.stringify({
                type:
                    "checkersConnected",
                player:
                    ws.checkersPlayer
            })
        );


        ws.on("message", message => {

            for (
                const client of wss.clients
            ) {

                if (
                    client !== ws &&
                    client.readyState ===
                        WebSocket.OPEN
                ) {

                    try {

                        const data =
                            JSON.parse(
                                message.toString()
                            );


                        client.send(
                            JSON.stringify(
                                data
                            )
                        );

                    } catch {

                        client.send(
                            message.toString()
                        );
                    }
                }
            }
        });

        return;
    }


    /* =====================================================
       TIC-TAC-TOE
       ===================================================== */

    if (
        pathname === "/ttt"
    ) {

        handleTicTacToe(ws);

        return;
    }


    /* =====================================================
       UNKNOWN WEBSOCKET PATH
       ===================================================== */

    ws.close();

});


/* =========================================================
   TIC-TAC-TOE GAME SERVER
   =========================================================

   There is one active two-player TTT game.

   Player 1 = X
   Player 2 = O

   Additional connections become spectators.

   The SERVER owns:
   - board
   - turn
   - winner
   - draw
   - game-over state

   This prevents the two browsers from getting
   out of synchronization.
   ========================================================= */

let tttX = null;
let tttO = null;

const tttSpectators = new Set();

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

let tttCurrentPlayer = "X";
let tttGameOver = false;
let tttWinner = null;
let tttDraw = false;


/* =========================================================
   RESET TTT GAME
   ========================================================= */

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

    tttCurrentPlayer = "X";
    tttGameOver = false;
    tttWinner = null;
    tttDraw = false;

}


/* =========================================================
   SEND MESSAGE
   ========================================================= */

function sendTTT(ws, data) {

    if (
        ws &&
        ws.readyState ===
            WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify(data)
        );
    }
}


/* =========================================================
   BROADCAST TTT STATE
   ========================================================= */

function broadcastTTTState() {

    const state = {

        type: "state",

        board: [...tttBoard],

        currentPlayer:
            tttCurrentPlayer,

        gameOver:
            tttGameOver,

        winner:
            tttWinner,

        draw:
            tttDraw
    };


    sendTTT(
        tttX,
        state
    );

    sendTTT(
        tttO,
        state
    );


    for (
        const spectator of tttSpectators
    ) {

        sendTTT(
            spectator,
            state
        );
    }
}


/* =========================================================
   SEND PLAYER ASSIGNMENT
   ========================================================= */

function assignTTTPlayer(
    ws,
    symbol
) {

    /*
     * Send the protocol expected by
     * the current Tic-Tac-Toe HTML.
     */

    sendTTT(
        ws,
        {
            type:
                "assign",

            symbol:
                symbol
        }
    );


    /*
     * Also send the older connection
     * message for compatibility.
     */

    sendTTT(
        ws,
        {
            type:
                "tttConnected",

            player:
                symbol
        }
    );
}


/* =========================================================
   WIN CHECK
   ========================================================= */

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


    for (
        const [a, b, c] of wins
    ) {

        if (
            tttBoard[a] !== "" &&
            tttBoard[a] ===
                tttBoard[b] &&
            tttBoard[a] ===
                tttBoard[c]
        ) {

            return tttBoard[a];
        }
    }


    return null;
}


/* =========================================================
   TTT CONNECTION HANDLER
   ========================================================= */

function handleTicTacToe(ws) {

    /*
     * First player gets X.
     */

    if (
        tttX === null
    ) {

        tttX = ws;

        ws.tttPlayer = "X";

        assignTTTPlayer(
            ws,
            "X"
        );

        console.log(
            "TTT: Player X connected"
        );

    }


    /*
     * Second player gets O.
     */

    else if (
        tttO === null
    ) {

        tttO = ws;

        ws.tttPlayer = "O";

        assignTTTPlayer(
            ws,
            "O"
        );

        console.log(
            "TTT: Player O connected"
        );

    }


    /*
     * Third and later players
     * become spectators.
     */

    else {

        ws.tttPlayer =
            "spectator";

        tttSpectators.add(ws);


        assignTTTPlayer(
            ws,
            "spectator"
        );


        console.log(
            "TTT: Spectator connected"
        );
    }


    /*
     * Give this browser the
     * current board immediately.
     */

    sendTTT(
        ws,
        {
            type: "state",

            board: [...tttBoard],

            currentPlayer:
                tttCurrentPlayer,

            gameOver:
                tttGameOver,

            winner:
                tttWinner,

            draw:
                tttDraw
        }
    );


    /* -----------------------------------------------------
       MESSAGE HANDLER
       ----------------------------------------------------- */

    ws.on(
        "message",
        message => {

            let data;


            try {

                data =
                    JSON.parse(
                        message.toString()
                    );

            } catch {

                sendTTT(
                    ws,
                    {
                        type:
                            "error",

                        message:
                            "Invalid message."
                    }
                );

                return;
            }


            /* =============================================
               NEW GAME
               ============================================= */

            if (
                data.type ===
                "new_game"
            ) {

                /*
                 * Only an actual player can
                 * start a new game.
                 */

                if (
                    ws.tttPlayer !== "X" &&
                    ws.tttPlayer !== "O"
                ) {

                    sendTTT(
                        ws,
                        {
                            type:
                                "error",

                            message:
                                "Spectators cannot start a game."
                        }
                    );

                    return;
                }


                resetTicTacToe();

                console.log(
                    "TTT: New game"
                );


                broadcastTTTState();

                return;
            }


            /* =============================================
               MOVE
               ============================================= */

            if (
                data.type ===
                "move"
            ) {

                /*
                 * Spectators cannot move.
                 */

                if (
                    ws.tttPlayer !== "X" &&
                    ws.tttPlayer !== "O"
                ) {

                    sendTTT(
                        ws,
                        {
                            type:
                                "error",

                            message:
                                "You are a spectator."
                        }
                    );

                    return;
                }


                /*
                 * Game already finished.
                 */

                if (
                    tttGameOver
                ) {

                    sendTTT(
                        ws,
                        {
                            type:
                                "error",

                            message:
                                "Game is over."
                        }
                    );

                    return;
                }


                /*
                 * Make sure it is this
                 * player's turn.
                 */

                if (
                    ws.tttPlayer !==
                    tttCurrentPlayer
                ) {

                    sendTTT(
                        ws,
                        {
                            type:
                                "error",

                            message:
                                "It is not your turn."
                        }
                    );

                    return;
                }


                /*
                 * Validate board index.
                 */

                const index =
                    Number(
                        data.index
                    );


                if (
                    !Number.isInteger(
                        index
                    ) ||
                    index < 0 ||
                    index > 8
                ) {

                    sendTTT(
                        ws,
                        {
                            type:
                                "error",

                            message:
                                "Invalid square."
                        }
                    );

                    return;
                }


                /*
                 * Square already occupied.
                 */

                if (
                    tttBoard[index] !== ""
                ) {

                    sendTTT(
                        ws,
                        {
                            type:
                                "error",

                            message:
                                "That square is already occupied."
                        }
                    );

                    return;
                }


                /*
                 * Make the move.
                 */

                tttBoard[index] =
                    ws.tttPlayer;


                /*
                 * Check for winner.
                 */

                const winner =
                    checkTTTWinner();


                if (
                    winner
                ) {

                    tttWinner =
                        winner;

                    tttGameOver =
                        true;

                }


                /*
                 * Check for draw.
                 */

                else if (
                    tttBoard.every(
                        square =>
                            square !== ""
                    )
                ) {

                    tttDraw =
                        true;

                    tttGameOver =
                        true;
                }


                /*
                 * Otherwise switch turns.
                 */

                else {

                    tttCurrentPlayer =
                        tttCurrentPlayer ===
                        "X"
                            ? "O"
                            : "X";
                }


                console.log(
                    "TTT move:",
                    ws.tttPlayer,
                    index
                );


                /*
                 * Send identical state
                 * to both players.
                 */

                broadcastTTTState();

                return;
            }


            /* =============================================
               UNKNOWN TTT MESSAGE
               ============================================= */

            sendTTT(
                ws,
                {
                    type:
                        "error",

                    message:
                        "Unknown Tic-Tac-Toe command."
                }
            );
        }
    );


    /* -----------------------------------------------------
       DISCONNECT
       ----------------------------------------------------- */

    ws.on(
        "close",
        () => {

            if (
                ws === tttX
            ) {

                tttX = null;

                console.log(
                    "TTT: Player X disconnected"
                );

            }


            if (
                ws === tttO
            ) {

                tttO = null;

                console.log(
                    "TTT: Player O disconnected"
                );

            }


            tttSpectators.delete(ws);


            /*
             * If one of the two players leaves,
             * reset the board so a new pair can
             * start cleanly.
             */

            if (
                ws.tttPlayer === "X" ||
                ws.tttPlayer === "O"
            ) {

                resetTicTacToe();

                /*
                 * If the other player is still
                 * connected, tell them that the
                 * opponent has left.
                 */

                const remainingPlayer =
                    ws === tttX
                        ? tttO
                        : tttX;


                if (
                    remainingPlayer
                ) {

                    sendTTT(
                        remainingPlayer,
                        {
                            type:
                                "error",

                            message:
                                "The other player disconnected."
                        }
                    );

                    broadcastTTTState();
                }
            }


            console.log(
                "TTT connection closed"
            );
        }
    );
}


/* =========================================================
   SERVER START
   ========================================================= */

server.listen(
    PORT,
    () => {

        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            `Game root: ${ROOT}`
        );

    }
);
