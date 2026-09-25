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

        serveHTML(
            "index.html",
            res
        );

        return;
    }


    /* -----------------------------------------------------
       ROOMS PAGE
       ----------------------------------------------------- */

    if (
        url.pathname === "/rooms.html"
    ) {

        serveHTML(
            "rooms.html",
            res
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


        const file =
            path.resolve(
                ROOT,
                requested
            );


        /*
         * Prevent paths from escaping ROOT.
         */

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
   SIMPLE HTML SERVER
   ========================================================= */

function serveHTML(
    filename,
    res
) {

    const file =
        path.join(
            ROOT,
            filename
        );


    fs.readFile(
        file,
        (err, data) => {

            if (err) {

                res.writeHead(404);

                res.end(
                    `${filename} not found`
                );

                return;
            }


            res.writeHead(
                200,
                {
                    "Content-Type":
                        "text/html",

                    "Cache-Control":
                        "no-store"
                }
            );

            res.end(data);
        }
    );
}


/* =========================================================
   WEBSOCKET SERVER
   ========================================================= */

const wss =
    new WebSocket.Server({
        server
    });


/* =========================================================
   ROOM MANAGER
   =========================================================

   One central manager handles ALL games.

   Example:

   roomsByGame.get("checkers")
   roomsByGame.get("chess")
   roomsByGame.get("navalstrike")

   Each game has its own lobby.

   Players never appear in another game's lobby.
   ========================================================= */

const roomsByGame = new Map();

const privateRooms = new Map();

const roomClients = new Map();

let nextPlayerId = 1;
let nextRoomId = 1;


/* =========================================================
   GAME NORMALIZATION
   ========================================================= */

function normalizeGame(game) {

    if (
        typeof game !== "string"
    ) {
        return "";
    }


    let value =
        game
            .trim()
            .toLowerCase();


    value =
        value
            .replace(/\.html$/i, "");


    return value;
}


/* =========================================================
   DISPLAY GAME NAME
   ========================================================= */

function displayGameName(game) {

    const names = {

        checkers:
            "CHECKERS",

        chess:
            "CHESS",

        navalstrike:
            "NAVAL STRIKE",

        carrierstrike:
            "CARRIER STRIKE",

        ttt:
            "TIC-TAC-TOE",

        solitaire:
            "SOLITAIRE"
    };


    if (
        names[game]
    ) {
        return names[game];
    }


    return game
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, c =>
            c.toUpperCase()
        );
}


/* =========================================================
   GET GAME LOBBY
   ========================================================= */

function getLobby(game) {

    if (
        !roomsByGame.has(game)
    ) {

        roomsByGame.set(
            game,
            new Map()
        );
    }


    return roomsByGame.get(game);
}


/* =========================================================
   SEND JSON
   ========================================================= */

function sendJSON(
    ws,
    data
) {

    if (
        !ws ||
        ws.readyState !==
            WebSocket.OPEN
    ) {
        return;
    }


    try {

        ws.send(
            JSON.stringify(data)
        );

    } catch (error) {

        console.error(
            "WebSocket send error:",
            error
        );
    }
}


/* =========================================================
   PLAYER LIST
   ========================================================= */

function getLobbyPlayers(game) {

    const lobby =
        getLobby(game);


    return [
        ...lobby.values()
    ]
    .filter(player =>
        player.ws &&
        player.ws.readyState ===
            WebSocket.OPEN &&
        !player.roomId &&
        !player.invitedBy &&
        !player.inviting
    )
    .map(player => ({

        id:
            player.id,

        name:
            player.name,

        anonymous:
            player.anonymous,

        game:
            player.game
    }));
}


/* =========================================================
   BROADCAST LOBBY
   ========================================================= */

function broadcastLobby(game) {

    const lobby =
        getLobby(game);


    const players =
        getLobbyPlayers(game);


    for (
        const player of lobby.values()
    ) {

        sendJSON(
            player.ws,
            {
                type:
                    "lobbyUpdate",

                game,

                gameName:
                    displayGameName(game),

                players
            }
        );
    }
}


/* =========================================================
   CREATE PLAYER
   ========================================================= */

function createRoomPlayer(
    ws,
    game,
    name,
    anonymous
) {

    const player = {

        id:
            "P" +
            String(nextPlayerId++)
                .padStart(5, "0"),

        ws,

        game,

        name:
            anonymous
                ? "Anonymous"
                : name,

        anonymous:
            !!anonymous,

        roomId:
            null,

        invitedBy:
            null,

        inviting:
            null
    };


    ws.roomPlayer =
        player;


    getLobby(game).set(
        player.id,
        player
    );


    return player;
}


/* =========================================================
   REMOVE PLAYER FROM LOBBY
   ========================================================= */

function removeFromLobby(
    player
) {

    if (!player) {
        return;
    }


    const lobby =
        roomsByGame.get(
            player.game
        );


    if (!lobby) {
        return;
    }


    lobby.delete(
        player.id
    );


    broadcastLobby(
        player.game
    );
}


/* =========================================================
   PRIVATE ROOM
   ========================================================= */

function createPrivateRoom(
    player1,
    player2
) {

    const roomId =
        "ROOM-" +
        String(nextRoomId++)
            .padStart(5, "0");


    const room = {

        id:
            roomId,

        game:
            player1.game,

        players:
            [
                player1,
                player2
            ],

        createdAt:
            Date.now()
    };


    privateRooms.set(
        roomId,
        room
    );


    roomClients.set(
        roomId,
        new Set([
            player1.ws,
            player2.ws
        ])
    );


    player1.roomId =
        roomId;

    player2.roomId =
        roomId;


    removeFromLobby(
        player1
    );

    removeFromLobby(
        player2
    );


    sendJSON(
        player1.ws,
        {
            type:
                "roomMatched",

            roomId,

            game:
                room.game,

            gameName:
                displayGameName(
                    room.game
                ),

            player:
                "player1",

            opponent: {

                id:
                    player2.id,

                name:
                    player2.name,

                anonymous:
                    player2.anonymous
            }
        }
    );


    sendJSON(
        player2.ws,
        {
            type:
                "roomMatched",

            roomId,

            game:
                room.game,

            gameName:
                displayGameName(
                    room.game
                ),

            player:
                "player2",

            opponent: {

                id:
                    player1.id,

                name:
                    player1.name,

                anonymous:
                    player1.anonymous
            }
        }
    );


    console.log(
        `ROOM ${roomId}: ${player1.name} vs ${player2.name} (${room.game})`
    );


    return room;
}


/* =========================================================
   FIND RANDOM PLAYER
   ========================================================= */

function findRandomPlayer(
    player
) {

    if (
        !player ||
        player.roomId
    ) {
        return false;
    }


    const lobby =
        getLobby(
            player.game
        );


    const candidates =
        [
            ...lobby.values()
        ]
        .filter(other =>

            other.id !==
                player.id &&

            !other.roomId &&

            !other.invitedBy &&

            !other.inviting &&

            other.ws &&
            other.ws.readyState ===
                WebSocket.OPEN

        );


    if (
        candidates.length === 0
    ) {

        sendJSON(
            player.ws,
            {
                type:
                    "noMatch",

                message:
                    "No other player is waiting yet."
            }
        );

        return false;
    }


    const opponent =
        candidates[
            Math.floor(
                Math.random() *
                candidates.length
            )
        ];


    createPrivateRoom(
        player,
        opponent
    );


    return true;
}


/* =========================================================
   DIRECT INVITATION
   ========================================================= */

function invitePlayer(
    from,
    targetId
) {

    if (
        !from ||
        from.roomId
    ) {
        return;
    }


    const lobby =
        getLobby(
            from.game
        );


    const target =
        lobby.get(
            targetId
        );


    if (
        !target ||
        target.id === from.id ||
        target.roomId
    ) {

        sendJSON(
            from.ws,
            {
                type:
                    "inviteError",

                message:
                    "That player is no longer available."
            }
        );

        broadcastLobby(
            from.game
        );

        return;
    }


    if (
        target.invitedBy ||
        target.inviting
    ) {

        sendJSON(
            from.ws,
            {
                type:
                    "inviteError",

                message:
                    "That player is already being invited."
            }
        );

        return;
    }


    from.inviting =
        target.id;

    target.invitedBy =
        from.id;


    sendJSON(
        target.ws,
        {
            type:
                "invitation",

            game:
                from.game,

            gameName:
                displayGameName(
                    from.game
                ),

            from: {

                id:
                    from.id,

                name:
                    from.name,

                anonymous:
                    from.anonymous
            }
        }
    );


    sendJSON(
        from.ws,
        {
            type:
                "inviteSent",

            target: {

                id:
                    target.id,

                name:
                    target.name
            }
        }
    );


    broadcastLobby(
        from.game
    );


    console.log(
        `INVITE: ${from.name} -> ${target.name} (${from.game})`
    );
}


/* =========================================================
   ACCEPT INVITATION
   ========================================================= */

function acceptInvitation(
    target
) {

    if (
        !target ||
        !target.invitedBy
    ) {
        return;
    }


    const lobby =
        getLobby(
            target.game
        );


    const from =
        lobby.get(
            target.invitedBy
        );


    if (
        !from ||
        from.roomId ||
        !from.ws ||
        from.ws.readyState !==
            WebSocket.OPEN
    ) {

        target.invitedBy =
            null;

        sendJSON(
            target.ws,
            {
                type:
                    "inviteError",

                message:
                    "The inviting player is no longer available."
            }
        );

        broadcastLobby(
            target.game
        );

        return;
    }


    from.inviting =
        null;

    target.invitedBy =
        null;


    createPrivateRoom(
        from,
        target
    );
}


/* =========================================================
   DECLINE INVITATION
   ========================================================= */

function declineInvitation(
    target
) {

    if (
        !target ||
        !target.invitedBy
    ) {
        return;
    }


    const lobby =
        getLobby(
            target.game
        );


    const from =
        lobby.get(
            target.invitedBy
        );


    target.invitedBy =
        null;


    if (from) {

        from.inviting =
            null;


        sendJSON(
            from.ws,
            {
                type:
                    "inviteDeclined",

                player: {

                    id:
                        target.id,

                    name:
                        target.name
                }
            }
        );
    }


    broadcastLobby(
        target.game
    );
}


/* =========================================================
   CANCEL INVITATION
   ========================================================= */

function cancelInvitation(
    from
) {

    if (
        !from ||
        !from.inviting
    ) {
        return;
    }


    const lobby =
        getLobby(
            from.game
        );


    const target =
        lobby.get(
            from.inviting
        );


    from.inviting =
        null;


    if (target) {

        target.invitedBy =
            null;


        sendJSON(
            target.ws,
            {
                type:
                    "inviteCancelled",

                player: {

                    id:
                        from.id,

                    name:
                        from.name
                }
            }
        );
    }


    broadcastLobby(
        from.game
    );
}


/* =========================================================
   ROOM MESSAGE
   ========================================================= */

function roomMessage(
    player,
    data
) {

    if (
        !player ||
        !player.roomId
    ) {
        return;
    }


    const clients =
        roomClients.get(
            player.roomId
        );


    if (!clients) {
        return;
    }


    const message =
        typeof data.message ===
        "string"
            ? data.message.trim()
            : "";


    if (!message) {
        return;
    }


    if (message.length > 1000) {
        return;
    }


    for (
        const client of clients
    ) {

        sendJSON(
            client,
            {
                type:
                    "roomChat",

                roomId:
                    player.roomId,

                playerId:
                    player.id,

                playerName:
                    player.name,

                message
            }
        );
    }
}


/* =========================================================
   LEAVE PRIVATE ROOM
   ========================================================= */

function leavePrivateRoom(
    player,
    notifyOpponent = true
) {

    if (
        !player ||
        !player.roomId
    ) {
        return;
    }


    const roomId =
        player.roomId;


    const room =
        privateRooms.get(
            roomId
        );


    const clients =
        roomClients.get(
            roomId
        );


    if (clients) {

        clients.delete(
            player.ws
        );
    }


    player.roomId =
        null;


    if (room) {

        room.players =
            room.players.filter(
                p =>
                    p !== player
            );
    }


    if (
        notifyOpponent &&
        room
    ) {

        for (
            const opponent of
                room.players
        ) {

            sendJSON(
                opponent.ws,
                {
                    type:
                        "opponentLeft",

                    roomId
                }
            );


            opponent.roomId =
                null;
        }
    }


    privateRooms.delete(
        roomId
    );


    roomClients.delete(
        roomId
    );


    console.log(
        `ROOM ${roomId}: closed`
    );
}


/* =========================================================
   ROOMS WEBSOCKET
   ========================================================= */

function handleRooms(
    ws
) {

    ws.roomPlayer =
        null;


    sendJSON(
        ws,
        {
            type:
                "roomsConnected"
        }
    );


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

                sendJSON(
                    ws,
                    {
                        type:
                            "error",

                        message:
                            "Invalid room message."
                    }
                );

                return;
            }


            /* ---------------------------------------------
               JOIN LOBBY
               --------------------------------------------- */

            if (
                data.type ===
                "joinLobby"
            ) {

                const game =
                    normalizeGame(
                        data.game
                    );


                if (!game) {

                    sendJSON(
                        ws,
                        {
                            type:
                                "error",

                            message:
                                "No game specified."
                        }
                    );

                    return;
                }


                const anonymous =
                    data.anonymous === true;


                let name =
                    typeof data.name ===
                    "string"
                        ? data.name.trim()
                        : "";


                if (
                    !anonymous &&
                    !name
                ) {

                    sendJSON(
                        ws,
                        {
                            type:
                                "error",

                            message:
                                "Enter a player name or choose Anonymous."
                        }
                    );

                    return;
                }


                if (
                    name.length > 24
                ) {

                    name =
                        name.substring(
                            0,
                            24
                        );
                }


                if (
                    ws.roomPlayer
                ) {

                    removeRoomConnection(
                        ws
                    );
                }


                const player =
                    createRoomPlayer(
                        ws,
                        game,
                        name,
                        anonymous
                    );


                sendJSON(
                    ws,
                    {
                        type:
                            "lobbyJoined",

                        playerId:
                            player.id,

                        game,

                        gameName:
                            displayGameName(
                                game
                            ),

                        playerName:
                            player.name,

                        anonymous:
                            player.anonymous
                    }
                );


                broadcastLobby(
                    game
                );


                console.log(
                    `LOBBY: ${player.name} joined ${game}`
                );


                return;
            }


            /* ---------------------------------------------
               RANDOM MATCH
               --------------------------------------------- */

            if (
                data.type ===
                "findRandom"
            ) {

                const player =
                    ws.roomPlayer;


                if (!player) {

                    sendJSON(
                        ws,
                        {
                            type:
                                "error",

                            message:
                                "Join a lobby first."
                        }
                    );

                    return;
                }


                findRandomPlayer(
                    player
                );


                return;
            }


            /* ---------------------------------------------
               DIRECT INVITE
               --------------------------------------------- */

            if (
                data.type ===
                "invite"
            ) {

                const player =
                    ws.roomPlayer;


                if (!player) {
                    return;
                }


                invitePlayer(
                    player,
                    String(
                        data.playerId || ""
                    )
                );


                return;
            }


            /* ---------------------------------------------
               ACCEPT
               --------------------------------------------- */

            if (
                data.type ===
                "acceptInvite"
            ) {

                const player =
                    ws.roomPlayer;


                if (!player) {
                    return;
                }


                acceptInvitation(
                    player
                );


                return;
            }


            /* ---------------------------------------------
               DECLINE
               --------------------------------------------- */

            if (
                data.type ===
                "declineInvite"
            ) {

                const player =
                    ws.roomPlayer;


                if (!player) {
                    return;
                }


                declineInvitation(
                    player
                );


                return;
            }


            /* ---------------------------------------------
               CANCEL
               --------------------------------------------- */

            if (
                data.type ===
                "cancelInvite"
            ) {

                const player =
                    ws.roomPlayer;


                if (!player) {
                    return;
                }


                cancelInvitation(
                    player
                );


                return;
            }


            /* ---------------------------------------------
               CHAT
               --------------------------------------------- */

            if (
                data.type ===
                "roomChat"
            ) {

                roomMessage(
                    ws.roomPlayer,
                    data
                );


                return;
            }


            /* ---------------------------------------------
               LEAVE ROOM
               --------------------------------------------- */

            if (
                data.type ===
                "leaveRoom"
            ) {

                leavePrivateRoom(
                    ws.roomPlayer,
                    true
                );


                return;
            }


            /* ---------------------------------------------
               PING
               --------------------------------------------- */

            if (
                data.type ===
                "ping"
            ) {

                sendJSON(
                    ws,
                    {
                        type:
                            "pong"
                    }
                );


                return;
            }


            sendJSON(
                ws,
                {
                    type:
                        "error",

                    message:
                        "Unknown room command."
                }
            );
        }
    );


    ws.on(
        "close",
        () => {

            removeRoomConnection(
                ws
            );
        }
    );
}


/* =========================================================
   REMOVE ROOM CONNECTION
   ========================================================= */

function removeRoomConnection(
    ws
) {

    const player =
        ws.roomPlayer;


    if (!player) {
        return;
    }


    /*
     * If player is in a private room,
     * notify the opponent.
     */

    if (
        player.roomId
    ) {

        leavePrivateRoom(
            player,
            true
        );

    }


    /*
     * Cancel invitation sent by
     * this player.
     */

    if (
        player.inviting
    ) {

        cancelInvitation(
            player
        );
    }


    /*
     * Remove invitation received
     * by this player.
     */

    if (
        player.invitedBy
    ) {

        declineInvitation(
            player
        );
    }


    /*
     * Remove from lobby.
     */

    removeFromLobby(
        player
    );


    ws.roomPlayer =
        null;
}


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
       ROOM MANAGER
       ===================================================== */

    if (
        pathname === "/rooms"
    ) {

        handleRooms(ws);

        return;
    }


    /* =====================================================
       CHESS
       ===================================================== */

    if (
        pathname === "/chess"
    ) {

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
   SEND TTT
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

        type:
            "state",

        board:
            [...tttBoard],

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
        const spectator of
            tttSpectators
    ) {

        sendTTT(
            spectator,
            state
        );
    }
}


/* =========================================================
   ASSIGN TTT PLAYER
   ========================================================= */

function assignTTTPlayer(
    ws,
    symbol
) {

    sendTTT(
        ws,
        {
            type:
                "assign",

            symbol:
                symbol
        }
    );


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

    if (
        tttX === null
    ) {

        tttX = ws;

        ws.tttPlayer =
            "X";

        assignTTTPlayer(
            ws,
            "X"
        );

        console.log(
            "TTT: Player X connected"
        );

    } else if (
        tttO === null
    ) {

        tttO = ws;

        ws.tttPlayer =
            "O";

        assignTTTPlayer(
            ws,
            "O"
        );

        console.log(
            "TTT: Player O connected"
        );

    } else {

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


    sendTTT(
        ws,
        {
            type:
                "state",

            board:
                [...tttBoard],

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


            /* NEW GAME */

            if (
                data.type ===
                "new_game"
            ) {

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


            /* MOVE */

            if (
                data.type ===
                "move"
            ) {

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


                tttBoard[index] =
                    ws.tttPlayer;


                const winner =
                    checkTTTWinner();


                if (
                    winner
                ) {

                    tttWinner =
                        winner;

                    tttGameOver =
                        true;

                } else if (
                    tttBoard.every(
                        square =>
                            square !== ""
                    )
                ) {

                    tttDraw =
                        true;

                    tttGameOver =
                        true;

                } else {

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


                broadcastTTTState();

                return;
            }


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


    ws.on(
        "close",
        () => {

            if (
                ws === tttX
            ) {

                tttX =
                    null;

                console.log(
                    "TTT: Player X disconnected"
                );
            }


            if (
                ws === tttO
            ) {

                tttO =
                    null;

                console.log(
                    "TTT: Player O disconnected"
                );
            }


            tttSpectators.delete(
                ws
            );


            if (
                ws.tttPlayer === "X" ||
                ws.tttPlayer === "O"
            ) {

                resetTicTacToe();


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
