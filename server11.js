"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

/* =========================================================
   GAME FILES
   ========================================================= */

const GAME_FILES = {
    ttt: "ttt.html",
    checkers: "checkers.html",
    navalstrike: "navalstrike.html",
    carrierstrike: "carrierstrike.html",
    chess: "chess.html"
};

const TWO_PLAYER_GAMES = new Set([
    "ttt",
    "checkers",
    "navalstrike",
    "carrierstrike",
    "chess"
]);

/* =========================================================
   CENTRAL ROOM MANAGER
   ========================================================= */

/*
    Lobby player:

    {
        id,
        ws,
        game,
        name,
        anonymous,
        status,
        pendingInviteFrom,
        pendingInviteTo,
        roomId
    }
*/

const lobbyPlayers = new Map();
const rooms = new Map();

const gameLobbies = new Map();

for (const game of TWO_PLAYER_GAMES) {
    gameLobbies.set(game, new Map());
}

function makeId(prefix) {
    return (
        prefix +
        "-" +
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).slice(2, 9)
    );
}

function cleanName(name) {

    if (typeof name !== "string") {
        return "Anonymous";
    }

    name = name.trim();

    if (!name) {
        return "Anonymous";
    }

    return name.slice(0, 24);
}

function normalizeGame(game) {

    if (typeof game !== "string") {
        return null;
    }

    game = game.toLowerCase().trim();

    if (game.endsWith(".html")) {
        game = game.slice(0, -5);
    }

    if (!TWO_PLAYER_GAMES.has(game)) {
        return null;
    }

    return game;
}

function safeSend(ws, data) {

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        try {
            ws.send(JSON.stringify(data));
        } catch (err) {
            console.error("WebSocket send error:", err.message);
        }
    }
}

function lobbyPlayerInfo(player) {

    return {
        id: player.id,
        name: player.anonymous
            ? "Anonymous"
            : player.name,
        anonymous: player.anonymous,
        game: player.game,
        status: player.status
    };
}

function sendLobbyState(game) {

    const lobby = gameLobbies.get(game);

    if (!lobby) {
        return;
    }

    const players = [];

    for (const player of lobby.values()) {

        if (
            player.status === "waiting" &&
            !player.pendingInviteFrom &&
            !player.pendingInviteTo
        ) {
            players.push(
                lobbyPlayerInfo(player)
            );
        }
    }

    for (const player of lobby.values()) {

        safeSend(
            player.ws,
            {
                type: "lobbyState",
                game,
                players
            }
        );
    }
}

function removeFromLobby(player) {

    if (!player || !player.game) {
        return;
    }

    const lobby =
        gameLobbies.get(player.game);

    if (lobby) {
        lobby.delete(player.id);
        sendLobbyState(player.game);
    }
}

function addToLobby(player) {

    const lobby =
        gameLobbies.get(player.game);

    if (!lobby) {
        return false;
    }

    lobby.set(player.id, player);

    player.status = "waiting";

    sendLobbyState(player.game);

    return true;
}

/* =========================================================
   ROOM CREATION
   ========================================================= */

function createRoom(player1, player2) {

    const roomId =
        makeId(player1.game);

    const room = {
        id: roomId,
        game: player1.game,
        players: new Map()
    };

    room.players.set(
        player1.id,
        {
            id: player1.id,
            ws: player1.ws,
            name: player1.anonymous
                ? "Anonymous"
                : player1.name,
            anonymous: player1.anonymous,
            color: "red"
        }
    );

    room.players.set(
        player2.id,
        {
            id: player2.id,
            ws: player2.ws,
            name: player2.anonymous
                ? "Anonymous"
                : player2.name,
            anonymous: player2.anonymous,
            color: "black"
        }
    );

    rooms.set(roomId, room);

    player1.roomId = roomId;
    player2.roomId = roomId;

    player1.status = "matched";
    player2.status = "matched";

    removeFromLobby(player1);
    removeFromLobby(player2);

    /*
       Player 1 = red / first player
       Player 2 = black / second player

       For games with a different traditional side assignment,
       the game itself can interpret playerNumber/role later.
    */

    const file =
        GAME_FILES[player1.game];

    safeSend(
        player1.ws,
        {
            type: "matchFound",
            roomId,
            game: player1.game,
            gameFile: file,
            playerNumber: 1,
            role: "red",
            opponent: {
                id: player2.id,
                name: player2.anonymous
                    ? "Anonymous"
                    : player2.name
            }
        }
    );

    safeSend(
        player2.ws,
        {
            type: "matchFound",
            roomId,
            game: player2.game,
            gameFile: file,
            playerNumber: 2,
            role: "black",
            opponent: {
                id: player1.id,
                name: player1.anonymous
                    ? "Anonymous"
                    : player1.name
            }
        }
    );

    console.log(
        `[ROOM] ${roomId} created for ${player1.game}`
    );

    return room;
}

/* =========================================================
   RANDOM MATCHING
   ========================================================= */

function findRandomOpponent(player) {

    const lobby =
        gameLobbies.get(player.game);

    if (!lobby) {
        return null;
    }

    for (const candidate of lobby.values()) {

        if (candidate.id === player.id) {
            continue;
        }

        if (candidate.status !== "waiting") {
            continue;
        }

        if (candidate.pendingInviteFrom) {
            continue;
        }

        if (candidate.pendingInviteTo) {
            continue;
        }

        return candidate;
    }

    return null;
}

function randomMatch(player) {

    if (!player) {
        return;
    }

    if (player.status !== "waiting") {

        safeSend(
            player.ws,
            {
                type: "error",
                message:
                    "You are already matched or waiting for an invitation."
            }
        );

        return;
    }

    const opponent =
        findRandomOpponent(player);

    if (!opponent) {

        safeSend(
            player.ws,
            {
                type: "randomWaiting",
                game: player.game,
                message:
                    "Waiting for another player..."
            }
        );

        sendLobbyState(player.game);

        return;
    }

    createRoom(
        player,
        opponent
    );
}

/* =========================================================
   DIRECT INVITATIONS
   ========================================================= */

function sendInvite(player, targetId) {

    if (!player) {
        return;
    }

    const lobby =
        gameLobbies.get(player.game);

    if (!lobby) {
        return;
    }

    const target =
        lobby.get(targetId);

    if (!target) {

        safeSend(
            player.ws,
            {
                type: "error",
                message:
                    "That player is no longer in the lobby."
            }
        );

        return;
    }

    if (target.id === player.id) {

        safeSend(
            player.ws,
            {
                type: "error",
                message:
                    "You cannot invite yourself."
            }
        );

        return;
    }

    if (
        player.status !== "waiting" ||
        target.status !== "waiting"
    ) {

        safeSend(
            player.ws,
            {
                type: "error",
                message:
                    "That player is no longer available."
            }
        );

        return;
    }

    if (
        player.pendingInviteTo ||
        player.pendingInviteFrom ||
        target.pendingInviteTo ||
        target.pendingInviteFrom
    ) {

        safeSend(
            player.ws,
            {
                type: "error",
                message:
                    "One of the players already has a pending invitation."
            }
        );

        return;
    }

    player.pendingInviteTo = target.id;
    target.pendingInviteFrom = player.id;

    safeSend(
        player.ws,
        {
            type: "inviteSent",
            target: lobbyPlayerInfo(target)
        }
    );

    safeSend(
        target.ws,
        {
            type: "inviteReceived",
            from: {
                id: player.id,
                name: player.anonymous
                    ? "Anonymous"
                    : player.name,
                anonymous: player.anonymous
            },
            game: player.game
        }
    );

    sendLobbyState(player.game);
}

/* =========================================================
   ACCEPT INVITATION
   ========================================================= */

function acceptInvite(player, fromId) {

    if (!player) {
        return;
    }

    const lobby =
        gameLobbies.get(player.game);

    if (!lobby) {
        return;
    }

    const requester =
        lobby.get(fromId);

    if (!requester) {

        player.pendingInviteFrom = null;

        safeSend(
            player.ws,
            {
                type: "error",
                message:
                    "That player is no longer available."
            }
        );

        sendLobbyState(player.game);

        return;
    }

    if (
        requester.pendingInviteTo !== player.id ||
        player.pendingInviteFrom !== requester.id
    ) {

        safeSend(
            player.ws,
            {
                type: "error",
                message:
                    "That invitation is no longer valid."
            }
        );

        return;
    }

    requester.pendingInviteTo = null;
    player.pendingInviteFrom = null;

    createRoom(
        requester,
        player
    );
}

/* =========================================================
   DECLINE INVITATION
   ========================================================= */

function declineInvite(player, fromId) {

    if (!player) {
        return;
    }

    const lobby =
        gameLobbies.get(player.game);

    if (!lobby) {
        return;
    }

    const requester =
        lobby.get(fromId);

    player.pendingInviteFrom = null;

    if (
        requester &&
        requester.pendingInviteTo === player.id
    ) {

        requester.pendingInviteTo = null;

        safeSend(
            requester.ws,
            {
                type: "inviteDeclined",
                player: {
                    id: player.id,
                    name: player.anonymous
                        ? "Anonymous"
                        : player.name
                }
            }
        );
    }

    sendLobbyState(player.game);
}

/* =========================================================
   LEAVE LOBBY
   ========================================================= */

function leaveLobby(player) {

    if (!player) {
        return;
    }

    /*
       Cancel an invitation if necessary.
    */

    if (player.pendingInviteTo) {

        const target =
            lobbyPlayers.get(
                player.pendingInviteTo
            );

        if (
            target &&
            target.pendingInviteFrom === player.id
        ) {

            target.pendingInviteFrom = null;

            safeSend(
                target.ws,
                {
                    type: "inviteCancelled"
                }
            );
        }
    }

    if (player.pendingInviteFrom) {

        const requester =
            lobbyPlayers.get(
                player.pendingInviteFrom
            );

        if (
            requester &&
            requester.pendingInviteTo === player.id
        ) {

            requester.pendingInviteTo = null;

            safeSend(
                requester.ws,
                {
                    type: "inviteCancelled"
                }
            );
        }
    }

    player.pendingInviteTo = null;
    player.pendingInviteFrom = null;

    removeFromLobby(player);

    player.status = "left";

    safeSend(
        player.ws,
        {
            type: "leftLobby"
        }
    );
}

/* =========================================================
   ROOM MESSAGES
   ========================================================= */

function roomBroadcast(
    room,
    senderId,
    message
) {

    if (!room) {
        return;
    }

    for (const player of room.players.values()) {

        if (player.id === senderId) {
            continue;
        }

        safeSend(
            player.ws,
            message
        );
    }
}

function handleRoomMessage(player, message) {

    if (!player) {
        return;
    }

    /*
       Once a player is in a room, game messages can be
       passed through this central room channel.

       This is the foundation for:
       - moves
       - chat
       - rematch
       - status
       - future game-specific events
    */

    if (
        player.roomId &&
        message.type === "roomMessage"
    ) {

        const room =
            rooms.get(player.roomId);

        if (!room) {
            return;
        }

        roomBroadcast(
            room,
            player.id,
            {
                type: "roomMessage",
                from: player.id,
                payload: message.payload
            }
        );

        return;
    }

    if (
        player.roomId &&
        message.type === "chat"
    ) {

        const room =
            rooms.get(player.roomId);

        if (!room) {
            return;
        }

        roomBroadcast(
            room,
            player.id,
            {
                type: "chat",
                from: player.id,
                name: player.anonymous
                    ? "Anonymous"
                    : player.name,
                text:
                    typeof message.text === "string"
                        ? message.text.slice(0, 500)
                        : ""
            }
        );

        return;
    }

    /*
       Game-specific network messages.

       Checkers will use this channel when its new
       room-aware version is installed.
    */

    if (
        player.roomId &&
        message.type === "game"
    ) {

        const room =
            rooms.get(player.roomId);

        if (!room) {
            return;
        }

        roomBroadcast(
            room,
            player.id,
            {
                type: "game",
                from: player.id,
                payload: message.payload
            }
        );

        return;
    }
}

/* =========================================================
   ROOM DISCONNECT
   ========================================================= */

function leaveRoom(player) {

    if (!player || !player.roomId) {
        return;
    }

    const room =
        rooms.get(player.roomId);

    if (!room) {
        player.roomId = null;
        return;
    }

    room.players.delete(player.id);

    roomBroadcast(
        room,
        player.id,
        {
            type: "opponentDisconnected",
            playerId: player.id
        }
    );

    console.log(
        `[ROOM] ${room.id}: player disconnected`
    );

    player.roomId = null;

    /*
       Rooms are currently two-player rooms.
       Once either player leaves, the room is no longer
       usable as a two-player room.
    */

    if (room.players.size === 0) {

        rooms.delete(room.id);

        console.log(
            `[ROOM] ${room.id} closed`
        );
    }
}

/* =========================================================
   ROOMS WEBSOCKET
   ========================================================= */

function handleRoomsConnection(ws) {

    const player = {
        id: makeId("player"),
        ws,
        game: null,
        name: "Anonymous",
        anonymous: true,
        status: "connected",
        pendingInviteFrom: null,
        pendingInviteTo: null,
        roomId: null
    };

    lobbyPlayers.set(
        player.id,
        player
    );

    safeSend(
        ws,
        {
            type: "connected",
            playerId: player.id
        }
    );

    ws.on("message", raw => {

        let message;

        try {
            message =
                JSON.parse(
                    raw.toString()
                );
        } catch (err) {

            safeSend(
                ws,
                {
                    type: "error",
                    message: "Invalid message."
                }
            );

            return;
        }

        if (
            !message ||
            typeof message.type !== "string"
        ) {
            return;
        }

        switch (message.type) {

            /* -----------------------------------------
               REGISTER
               ----------------------------------------- */

            case "register": {

                const game =
                    normalizeGame(
                        message.game
                    );

                if (!game) {

                    safeSend(
                        ws,
                        {
                            type: "error",
                            message:
                                "Invalid two-player game."
                        }
                    );

                    return;
                }

                player.game = game;

                player.anonymous =
                    message.anonymous === true;

                player.name =
                    cleanName(
                        message.name
                    );

                if (player.anonymous) {
                    player.name = "Anonymous";
                }

                addToLobby(player);

                safeSend(
                    ws,
                    {
                        type: "registered",
                        playerId: player.id,
                        game,
                        name: player.anonymous
                            ? "Anonymous"
                            : player.name
                    }
                );

                break;
            }

            /* -----------------------------------------
               FIND RANDOM PLAYER
               ----------------------------------------- */

            case "findRandom": {

                if (!player.game) {

                    safeSend(
                        ws,
                        {
                            type: "error",
                            message:
                                "Choose a game first."
                        }
                    );

                    return;
                }

                randomMatch(player);

                break;
            }

            /* -----------------------------------------
               INVITE PLAYER
               ----------------------------------------- */

            case "invite": {

                if (
                    typeof message.playerId !==
                    "string"
                ) {
                    return;
                }

                sendInvite(
                    player,
                    message.playerId
                );

                break;
            }

            /* -----------------------------------------
               ACCEPT INVITE
               ----------------------------------------- */

            case "inviteAccept": {

                if (
                    typeof message.playerId !==
                    "string"
                ) {
                    return;
                }

                acceptInvite(
                    player,
                    message.playerId
                );

                break;
            }

            /* -----------------------------------------
               DECLINE INVITE
               ----------------------------------------- */

            case "inviteDecline": {

                if (
                    typeof message.playerId !==
                    "string"
                ) {
                    return;
                }

                declineInvite(
                    player,
                    message.playerId
                );

                break;
            }

            /* -----------------------------------------
               LEAVE LOBBY
               ----------------------------------------- */

            case "leaveLobby": {

                leaveLobby(player);

                break;
            }

            /* -----------------------------------------
               ROOM MESSAGE
               ----------------------------------------- */

            case "roomMessage":
            case "chat":
            case "game": {

                handleRoomMessage(
                    player,
                    message
                );

                break;
            }

            /* -----------------------------------------
               LEAVE ROOM
               ----------------------------------------- */

            case "leaveRoom": {

                leaveRoom(player);

                player.status = "connected";

                break;
            }

            default: {

                safeSend(
                    ws,
                    {
                        type: "error",
                        message:
                            "Unknown room command."
                    }
                );
            }
        }
    });

    ws.on("close", () => {

        if (player.pendingInviteTo) {

            const target =
                lobbyPlayers.get(
                    player.pendingInviteTo
                );

            if (
                target &&
                target.pendingInviteFrom ===
                    player.id
            ) {

                target.pendingInviteFrom = null;

                safeSend(
                    target.ws,
                    {
                        type: "inviteCancelled"
                    }
                );
            }
        }

        if (player.pendingInviteFrom) {

            const requester =
                lobbyPlayers.get(
                    player.pendingInviteFrom
                );

            if (
                requester &&
                requester.pendingInviteTo ===
                    player.id
            ) {

                requester.pendingInviteTo = null;

                safeSend(
                    requester.ws,
                    {
                        type: "inviteCancelled"
                    }
                );
            }
        }

        removeFromLobby(player);
        leaveRoom(player);

        lobbyPlayers.delete(
            player.id
        );

        console.log(
            `[ROOM] player ${player.id} disconnected`
        );
    });
}

/* =========================================================
   HTTP SERVER
   ========================================================= */

const server = http.createServer(
    (req, res) => {

        let requestPath;

        try {
            requestPath =
                decodeURIComponent(
                    new URL(
                        req.url,
                        `http://${req.headers.host || "localhost"}`
                    ).pathname
                );
        } catch (err) {

            res.writeHead(
                400,
                {
                    "Content-Type":
                        "text/plain"
                }
            );

            res.end("Bad request");

            return;
        }

        /* ---------------------------------------------
           GAME DISCOVERY
           --------------------------------------------- */

        if (requestPath === "/games") {

            fs.readdir(
                ROOT,
                {
                    withFileTypes: true
                },
                (err, entries) => {

                    if (err) {

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
                                    "Could not read game directory."
                            })
                        );

                        return;
                    }

                    const games =
                        entries
                            .filter(
                                entry =>
                                    entry.isFile() &&
                                    entry.name
                                        .toLowerCase()
                                        .endsWith(".html") &&
                                    entry.name
                                        .toLowerCase() !==
                                        "index.html"
                            )
                            .map(
                                entry =>
                                    entry.name
                            )
                            .sort(
                                (a, b) =>
                                    a.localeCompare(b)
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

        /* ---------------------------------------------
           ROOT / INDEX
           --------------------------------------------- */

        if (
            requestPath === "/" ||
            requestPath === "/index.html"
        ) {

            serveFile(
                path.join(
                    ROOT,
                    "index.html"
                ),
                res,
                "text/html; charset=utf-8"
            );

            return;
        }

        /* ---------------------------------------------
           ROOMS
           --------------------------------------------- */

        if (
            requestPath === "/rooms" ||
            requestPath === "/rooms.html"
        ) {

            serveFile(
                path.join(
                    ROOT,
                    "rooms.html"
                ),
                res,
                "text/html; charset=utf-8"
            );

            return;
        }

        /* ---------------------------------------------
           FAVICON
           --------------------------------------------- */

        if (
            requestPath === "/favicon.ico"
        ) {

            res.writeHead(204);
            res.end();

            return;
        }

        /* ---------------------------------------------
           HTML FILES
           --------------------------------------------- */

        if (
            requestPath
                .toLowerCase()
                .endsWith(".html")
        ) {

            const requested =
                path.normalize(
                    path.join(
                        ROOT,
                        requestPath
                    )
                );

            const relative =
                path.relative(
                    ROOT,
                    requested
                );

            /*
               Prevent paths outside the website root.
            */

            if (
                relative.startsWith("..") ||
                path.isAbsolute(relative)
            ) {

                res.writeHead(
                    403,
                    {
                        "Content-Type":
                            "text/plain"
                    }
                );

                res.end("Forbidden");

                return;
            }

            serveFile(
                requested,
                res,
                "text/html; charset=utf-8"
            );

            return;
        }

        /* ---------------------------------------------
           404
           --------------------------------------------- */

        res.writeHead(
            404,
            {
                "Content-Type":
                    "text/plain; charset=utf-8"
            }
        );

        res.end("Not found");
    }
);

/* =========================================================
   SAFE FILE SERVER
   ========================================================= */

function serveFile(
    filePath,
    res,
    contentType
) {

    fs.readFile(
        filePath,
        (err, data) => {

            if (err) {

                if (err.code === "ENOENT") {

                    res.writeHead(
                        404,
                        {
                            "Content-Type":
                                "text/plain; charset=utf-8"
                        }
                    );

                    res.end("Not found");

                    return;
                }

                console.error(
                    "File read error:",
                    err
                );

                res.writeHead(
                    500,
                    {
                        "Content-Type":
                            "text/plain; charset=utf-8"
                    }
                );

                res.end("Server error");

                return;
            }

            res.writeHead(
                200,
                {
                    "Content-Type":
                        contentType,
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
   OLD CHESS CONNECTION SYSTEM
   ========================================================= */

const chessClients = new Set();

wss.on("connection", (ws, req) => {

    const url =
        new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
        );

    const pathname =
        url.pathname;

    /* =====================================================
       CENTRAL ROOMS
       ===================================================== */

    if (pathname === "/rooms") {

        handleRoomsConnection(ws);

        return;
    }

    /* =====================================================
       CHESS
       ===================================================== */

    if (pathname === "/chess") {

        chessClients.add(ws);

        let role;

        if (
            ![...chessClients]
                .some(client =>
                    client._chessRole === "white"
                )
        ) {

            role = "white";

        } else if (
            ![...chessClients]
                .some(client =>
                    client._chessRole === "black"
                )
        ) {

            role = "black";

        } else {

            role = "spectator";
        }

        ws._chessRole = role;

        safeSend(
            ws,
            {
                type: "role",
                role
            }
        );

        for (const client of chessClients) {

            if (
                client !== ws &&
                client.readyState ===
                    WebSocket.OPEN
            ) {

                safeSend(
                    client,
                    {
                        type: "playerJoined",
                        role
                    }
                );
            }
        }

        ws.on("message", raw => {

            for (const client of chessClients) {

                if (
                    client !== ws &&
                    client.readyState ===
                        WebSocket.OPEN
                ) {

                    client.send(
                        raw.toString()
                    );
                }
            }
        });

        ws.on("close", () => {

            chessClients.delete(ws);

            for (const client of chessClients) {

                if (
                    client.readyState ===
                    WebSocket.OPEN
                ) {

                    safeSend(
                        client,
                        {
                            type:
                                "playerDisconnected",
                            role
                        }
                    );
                }
            }
        });

        return;
    }

    /* =====================================================
       NAVAL STRIKE
       ===================================================== */

    if (pathname === "/navalstrike") {

        ws.on("message", raw => {

            for (const client of wss.clients) {

                if (
                    client !== ws &&
                    client.readyState ===
                        WebSocket.OPEN
                ) {

                    /*
                       Preserve the existing Naval Strike
                       behavior for now.
                    */

                    client.send(
                        raw.toString()
                    );
                }
            }
        });

        return;
    }

    /* =====================================================
       CHECKERS
       ===================================================== */

    if (pathname === "/checkers") {

        /*
           This is the legacy Checkers connection.
           The new room-aware Checkers client will use
           /rooms for matchmaking and room messaging.

           We keep this endpoint alive so the existing
           Checkers game does not suddenly break while
           we transition it.
        */

        ws._checkersRole =
            "spectator";

        ws.on("message", raw => {

            for (const client of wss.clients) {

                if (
                    client !== ws &&
                    client.readyState ===
                        WebSocket.OPEN
                ) {

                    client.send(
                        raw.toString()
                    );
                }
            }
        });

        return;
    }

    /* =====================================================
       TIC-TAC-TOE
       ===================================================== */

    if (pathname === "/ttt") {

        handleTicTacToe(ws);

        return;
    }

    /*
       Unknown WebSocket path.
    */

    ws.close(
        1008,
        "Unknown WebSocket endpoint"
    );
});

/* =========================================================
   TIC-TAC-TOE SERVER STATE
   ========================================================= */

let tttX = null;
let tttO = null;
const tttSpectators = new Set();

let tttBoard =
    Array(9).fill(null);

let tttCurrentPlayer = "X";
let tttGameOver = false;
let tttWinner = null;
let tttDraw = false;

function resetTicTacToe() {

    tttBoard =
        Array(9).fill(null);

    tttCurrentPlayer = "X";
    tttGameOver = false;
    tttWinner = null;
    tttDraw = false;
}

function sendTTT(ws, message) {

    safeSend(
        ws,
        {
            type: "ttt",
            ...message
        }
    );
}

function broadcastTTTState() {

    const message = {
        type: "state",
        board: tttBoard,
        currentPlayer: tttCurrentPlayer,
        gameOver: tttGameOver,
        winner: tttWinner,
        draw: tttDraw
    };

    if (tttX) {
        sendTTT(
            tttX,
            message
        );
    }

    if (tttO) {
        sendTTT(
            tttO,
            message
        );
    }

    for (
        const spectator
        of tttSpectators
    ) {

        sendTTT(
            spectator,
            message
        );
    }
}

function assignTTTPlayer(ws) {

    if (!tttX) {

        tttX = ws;

        safeSend(
            ws,
            {
                type: "role",
                role: "X"
            }
        );

        return "X";
    }

    if (!tttO) {

        tttO = ws;

        safeSend(
            ws,
            {
                type: "role",
                role: "O"
            }
        );

        return "O";
    }

    tttSpectators.add(ws);

    safeSend(
        ws,
        {
            type: "role",
            role: "spectator"
        }
    );

    return "spectator";
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

    return null;
}

function handleTicTacToe(ws) {

    const role =
        assignTTTPlayer(ws);

    /*
       Send current state immediately.
    */

    sendTTT(
        ws,
        {
            type: "state",
            board: tttBoard,
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

    ws.on("message", raw => {

        let message;

        try {
            message =
                JSON.parse(
                    raw.toString()
                );
        } catch (err) {
            return;
        }

        if (!message) {
            return;
        }

        /* ---------------------------------------------
           NEW GAME
           --------------------------------------------- */

        if (
            message.type ===
            "new_game"
        ) {

            if (
                role !== "X" &&
                role !== "O"
            ) {
                return;
            }

            resetTicTacToe();

            broadcastTTTState();

            return;
        }

        /* ---------------------------------------------
           MOVE
           --------------------------------------------- */

        if (
            message.type ===
            "move"
        ) {

            if (
                role !==
                tttCurrentPlayer
            ) {
                return;
            }

            if (tttGameOver) {
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
                tttCurrentPlayer;

            const winner =
                checkTTTWinner();

            if (winner) {

                tttGameOver = true;
                tttWinner = winner;

            } else if (
                tttBoard.every(
                    cell => cell !== null
                )
            ) {

                tttGameOver = true;
                tttDraw = true;

            } else {

                tttCurrentPlayer =
                    tttCurrentPlayer === "X"
                        ? "O"
                        : "X";
            }

            broadcastTTTState();
        }
    });

    ws.on("close", () => {

        if (tttX === ws) {
            tttX = null;
        }

        if (tttO === ws) {
            tttO = null;
        }

        tttSpectators.delete(ws);

        /*
           Preserve the existing behavior:
           a player disconnecting resets the game.
        */

        if (!tttX && !tttO) {
            resetTicTacToe();
        } else {

            /*
               If one player remains, reset the board so
               the remaining player can be paired again.
            */

            resetTicTacToe();

            if (tttX) {

                safeSend(
                    tttX,
                    {
                        type:
                            "playerDisconnected"
                    }
                );
            }

            if (tttO) {

                safeSend(
                    tttO,
                    {
                        type:
                            "playerDisconnected"
                    }
                );
            }

            broadcastTTTState();
        }
    });
}

/* =========================================================
   START SERVER
   ========================================================= */

server.listen(
    PORT,
    () => {

        console.log(
            "============================================================"
        );

        console.log(
            "GAME SERVER RUNNING"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            `Root: ${ROOT}`
        );

        console.log(
            "Central Room Manager: ENABLED"
        );

        console.log(
            "============================================================"
        );
    }
);
