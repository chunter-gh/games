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

        ws.tttPlayer =
            null;


        const tttPlayers =
            [...wss.clients]
                .filter(
                    client =>
                        client.tttPlayer
                );


        if (
            !tttPlayers.some(
                client =>
                    client.tttPlayer ===
                    "X"
            )
        ) {

            ws.tttPlayer =
                "X";

        } else if (
            !tttPlayers.some(
                client =>
                    client.tttPlayer ===
                    "O"
            )
        ) {

            ws.tttPlayer =
                "O";

        } else {

            ws.tttPlayer =
                "spectator";
        }


        ws.send(
            JSON.stringify({
                type:
                    "tttConnected",
                player:
                    ws.tttPlayer
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

                    client.send(
                        message.toString()
                    );
                }
            }
        });

        return;
    }


    /* =====================================================
       UNKNOWN WEBSOCKET PATH
       ===================================================== */

    ws.close();

});


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
