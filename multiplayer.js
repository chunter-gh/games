"use strict";

/*
=========================================================
MULTIPLAYER.JS
=========================================================

Shared multiplayer engine for the browser games.

CURRENT USE:
    Othello

FUTURE USE:
    Other games can use this same multiplayer layer.

IMPORTANT ARCHITECTURE:

    rooms.html
        |
        |  ?room=ROOM-xxxxx&player=1/2
        v
    GAME HTML
        |
        |  creates game state
        |  makes legal move
        |  changes turn
        v
    multiplayer.js
        |
        |  sends COMPLETE resulting state
        v
    GAME SERVER
        |
        |  broadcasts message
        v
    multiplayer.js
        |
        |  installs COMPLETE received state
        v
    OTHER GAME HTML

The game owns:
    - board
    - pieces
    - rules
    - legal moves
    - currentPlayer
    - gameOver
    - rendering

This file owns:
    - room
    - player number
    - client identity
    - WebSocket connection
    - Join messages
    - Move messages
    - New Game messages
    - self-echo filtering
    - game filtering
    - room filtering
    - receiving complete state snapshots

CRITICAL RULE:

The GAME changes its state and currentPlayer BEFORE
calling sendStateAfterMove().

The receiving browser DOES NOT replay the move.

It simply installs the complete state sent by the
player who made the move.

There are intentionally NO:
    - move counters
    - revision numbers
    - ACK systems
    - resend timers
    - state request systems
    - remote move reconstruction
    - independent remote turn calculations

This follows the working Checkers architecture.
=========================================================
*/


/* =========================================================
   GLOBAL MULTIPLAYER FACTORY
   ========================================================= */

(function () {

    /*
    ---------------------------------------------------------
    CREATE CLIENT ID
    ---------------------------------------------------------
    */

    function createClientId() {

        if (
            window.crypto &&
            typeof window.crypto.randomUUID === "function"
        ) {

            return window.crypto.randomUUID();
        }

        return (
            Date.now().toString(36) +
            "-" +
            Math.random()
                .toString(36)
                .slice(2)
        );
    }


    /*
    ---------------------------------------------------------
    NORMALIZE PLAYER NUMBER
    ---------------------------------------------------------

    Same player interpretation used by Checkers.

        1
        player1
        player 1
        p1

    all become "1".

        2
        player2
        player 2
        p2

    become "2".
    */

    function normalizePlayerNumber(value) {

        const raw =
            String(value || "")
                .trim()
                .toLowerCase();

        return (
            raw === "2" ||
            raw === "player2" ||
            raw === "player 2" ||
            raw === "p2"
        )
            ? "2"
            : "1";
    }


    /*
    =========================================================
    CREATE MULTIPLAYER
    =========================================================

    Example:

        const multiplayer =
            createMultiplayer({

                game: "othello",

                endpoint: "/othello",

                roomId,

                playerNumber,

                color:
                    myColor === BLACK
                        ? "black"
                        : "white",

                getState:
                    getBoardState,

                applyState:
                    applyBoardState,

                onState:
                    function(state, reason) {
                        render...
                    },

                onJoin:
                    function() {
                        updateOnlineStatus();
                    },

                onConnection:
                    function() {
                        updateOnlineStatus();
                    },

                onDisconnect:
                    function() {
                        updateOnlineStatus();
                    },

                onError:
                    function() {
                        updateOnlineStatus();
                    }
            });

        multiplayer.connect();

    =========================================================
    */

    function createMultiplayer(options) {

        options =
            options || {};


        /*
        -----------------------------------------------------
        BASIC GAME INFORMATION
        -----------------------------------------------------
        */

        const game =
            String(
                options.game || ""
            )
            .trim()
            .toLowerCase();


        const endpoint =
            String(
                options.endpoint || ""
            )
            .trim();


        const roomId =
            options.roomId == null
                ? null
                : String(
                    options.roomId
                );


        const playerNumber =
            normalizePlayerNumber(
                options.playerNumber
            );


        const onlineMode =
            !!roomId;


        /*
        -----------------------------------------------------
        OPTIONAL GAME-SPECIFIC JOIN INFORMATION
        -----------------------------------------------------

        Othello needs its color information in the Join
        message.

        Future games can use this too.
        */

        const color =
            options.color == null
                ? null
                : options.color;


        /*
        -----------------------------------------------------
        CONNECTION STATE
        -----------------------------------------------------
        */

        let socket = null;

        let socketReady = false;

        let opponentConnected = false;


        /*
        -----------------------------------------------------
        UNIQUE BROWSER ID
        -----------------------------------------------------
        */

        const clientId =
            createClientId();


        /*
        -----------------------------------------------------
        GAME STATE CALLBACKS
        -----------------------------------------------------
        */

        const getState =
            typeof options.getState ===
            "function"
                ? options.getState
                : function () {
                    return {};
                };


        const applyState =
            typeof options.applyState ===
            "function"
                ? options.applyState
                : function () {
                    return false;
                };


        const onState =
            typeof options.onState ===
            "function"
                ? options.onState
                : function () {};


        const onJoin =
            typeof options.onJoin ===
            "function"
                ? options.onJoin
                : function () {};


        const onConnection =
            typeof options.onConnection ===
            "function"
                ? options.onConnection
                : function () {};


        const onDisconnect =
            typeof options.onDisconnect ===
            "function"
                ? options.onDisconnect
                : function () {};


        const onError =
            typeof options.onError ===
            "function"
                ? options.onError
                : function () {};


        /*
        =====================================================
        SOCKET URL
        =====================================================
        */

        function getSocketUrl() {

            const protocol =
                location.protocol === "https:"
                    ? "wss:"
                    : "ws:";

            return (
                protocol +
                "//" +
                location.host +
                endpoint
            );
        }


        /*
        =====================================================
        SEND SOCKET MESSAGE
        =====================================================
        */

        function send(message) {

            if (
                socket &&
                socket.readyState ===
                WebSocket.OPEN
            ) {

                socket.send(
                    JSON.stringify(
                        message
                    )
                );

                return true;
            }

            return false;
        }


        /*
        =====================================================
        CONNECT TO ROOM
        =====================================================
        */

        function connect() {

            if (!onlineMode) {

                return;
            }


            /*
            Prevent accidentally opening a second socket.
            */

            if (
                socket &&
                (
                    socket.readyState ===
                        WebSocket.OPEN ||
                    socket.readyState ===
                        WebSocket.CONNECTING
                )
            ) {

                return;
            }


            try {

                socket =
                    new WebSocket(
                        getSocketUrl()
                    );

            } catch (error) {

                socketReady =
                    false;

                opponentConnected =
                    false;

                onError(
                    error
                );

                return;
            }


            /*
            -------------------------------------------------
            SOCKET OPEN
            -------------------------------------------------
            */

            socket.addEventListener(
                "open",
                function () {

                    socketReady =
                        true;


                    /*
                     * This matches Checkers.
                     *
                     * The matchmaking page has already
                     * placed the players into a room.
                     */
                    opponentConnected =
                        true;


                    /*
                     * Send Join.
                     */

                    const joinMessage = {

                        type:
                            game +
                            "Join",

                        game,

                        room:
                            roomId,

                        player:
                            playerNumber,

                        clientId
                    };


                    /*
                     * Add game-specific information when
                     * supplied.
                     */

                    if (
                        color != null
                    ) {

                        joinMessage.color =
                            color;
                    }


                    send(
                        joinMessage
                    );


                    onConnection({

                        connected:
                            true,

                        socketReady:
                            true,

                        opponentConnected:
                            true
                    });

                }
            );


            /*
            -------------------------------------------------
            SOCKET MESSAGE
            -------------------------------------------------
            */

            socket.addEventListener(
                "message",
                function (event) {

                    let message;

                    try {

                        message =
                            JSON.parse(
                                event.data
                            );

                    } catch (error) {

                        /*
                         * Ignore malformed messages.
                         */

                        return;
                    }


                    handleMessage(
                        message
                    );
                }
            );


            /*
            -------------------------------------------------
            SOCKET CLOSE
            -------------------------------------------------
            */

            socket.addEventListener(
                "close",
                function () {

                    socketReady =
                        false;

                    opponentConnected =
                        false;


                    onDisconnect({

                        connected:
                            false,

                        socketReady:
                            false,

                        opponentConnected:
                            false
                    });

                }
            );


            /*
            -------------------------------------------------
            SOCKET ERROR
            -------------------------------------------------
            */

            socket.addEventListener(
                "error",
                function (error) {

                    socketReady =
                        false;

                    onError(
                        error
                    );

                }
            );
        }


        /*
        =====================================================
        HANDLE INCOMING MESSAGE
        =====================================================
        */

        function handleMessage(
            message
        ) {

            if (
                !message
            ) {

                return;
            }


            /*
            -------------------------------------------------
            IGNORE OUR OWN ECHO
            -------------------------------------------------

            The existing server broadcasts messages,
            including the sender's own message.

            clientId prevents the local browser from
            processing its own state a second time.
            */

            if (
                message.clientId &&
                message.clientId ===
                    clientId
            ) {

                return;
            }


            /*
            -------------------------------------------------
            ONLY OUR GAME
            -------------------------------------------------
            */

            if (
                message.game &&
                String(
                    message.game
                ).toLowerCase() !==
                    game
            ) {

                return;
            }


            /*
            -------------------------------------------------
            ONLY OUR ROOM
            -------------------------------------------------
            */

            if (
                onlineMode &&
                message.room &&
                String(
                    message.room
                ) !==
                    String(roomId)
            ) {

                return;
            }


            /*
            -------------------------------------------------
            ROOM MESSAGES MUST HAVE A ROOM
            -------------------------------------------------
            */

            if (
                onlineMode &&
                (
                    message.type ===
                        game +
                        "Move" ||

                    message.type ===
                        game +
                        "Join" ||

                    message.type ===
                        game +
                        "NewGame"
                ) &&
                !message.room
            ) {

                return;
            }


            /*
            =================================================
            JOIN
            =================================================
            */

            if (
                message.type ===
                    game +
                    "Join"
            ) {

                opponentConnected =
                    true;


                onJoin({

                    opponentConnected:
                        true,

                    message

                });


                return;
            }


            /*
            =================================================
            NEW GAME
            =================================================
            */

            if (
                message.type ===
                    game +
                    "NewGame"
            ) {

                /*
                 * The state is authoritative.
                 *
                 * Do not reconstruct anything.
                 */

                if (
                    message.state &&
                    applyState(
                        message.state
                    )
                ) {

                    opponentConnected =
                        true;


                    onState(
                        message.state,
                        "newGame"
                    );
                }


                return;
            }


            /*
            =================================================
            MOVE
            =================================================
            */

            if (
                message.type ===
                    game +
                    "Move"
            ) {

                opponentConnected =
                    true;


                /*
                 * CRITICAL:
                 *
                 * Install the complete state.
                 *
                 * DO NOT:
                 *
                 *     replay move
                 *     flip pieces
                 *     calculate turn
                 *     calculate captures
                 *     increment counters
                 *     reconstruct anything
                 */

                if (
                    message.state &&
                    applyState(
                        message.state
                    )
                ) {

                    onState(
                        message.state,
                        "move"
                    );
                }


                return;
            }
        }


        /*
        =====================================================
        SEND COMPLETE STATE AFTER MOVE
        =====================================================

        The game MUST already have:

            1. Applied the move.
            2. Determined whether another move is possible.
            3. Changed currentPlayer if appropriate.
            4. Set gameOver if appropriate.

        Only THEN should this function be called.
        */

        function sendStateAfterMove(
            move
        ) {

            if (!onlineMode) {

                return false;
            }


            const state =
                getState();


            const message = {

                type:
                    game +
                    "Move",

                game,

                room:
                    roomId,

                player:
                    playerNumber,

                move:
                    move || null,

                state,

                clientId
            };


            /*
            Optional game-specific color.
            */

            if (
                color != null
            ) {

                message.color =
                    color;

                message.playerColor =
                    color;
            }


            return send(
                message
            );
        }


        /*
        =====================================================
        SEND NEW GAME STATE
        =====================================================
        */

        function sendNewGame() {

            if (!onlineMode) {

                return false;
            }


            const message = {

                type:
                    game +
                    "NewGame",

                game,

                room:
                    roomId,

                player:
                    playerNumber,

                state:
                    getState(),

                clientId
            };


            if (
                color != null
            ) {

                message.color =
                    color;

                message.playerColor =
                    color;
            }


            return send(
                message
            );
        }


        /*
        =====================================================
        CLOSE
        =====================================================
        */

        function close() {

            if (socket) {

                try {

                    socket.close();

                } catch (error) {

                    /*
                     * Nothing else is required.
                     */
                }
            }

            socket =
                null;

            socketReady =
                false;

            opponentConnected =
                false;
        }


        /*
        =====================================================
        PUBLIC API
        =====================================================
        */

        return {

            onlineMode,

            roomId,

            playerNumber,

            clientId,

            get socket() {

                return socket;
            },

            get socketReady() {

                return socketReady;
            },

            get opponentConnected() {

                return opponentConnected;
            },

            getSocketUrl,

            connect,

            close,

            send,

            sendStateAfterMove,

            sendNewGame,

            handleMessage
        };
    }


    /*
    =========================================================
    EXPOSE GLOBAL FACTORY
    =========================================================
    */

    window.createMultiplayer =
        createMultiplayer;

})();
