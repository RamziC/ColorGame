const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Serve frontend directly from the root folder
app.use(express.static(__dirname));

let players = {};
let scoreTarget = 20;
let gameActive = true;

io.on('connection', (socket) => {
    console.log(`Device connected: ${socket.id}`);

    // Assign player number based on who joins first
    if (Object.keys(players).length < 2) {
        const playerNum = Object.keys(players).length === 0 ? 1 : 2;
        players[socket.id] = {
            id: socket.id,
            playerNumber: playerNum,
            score: 0,
            x: playerNum === 1 ? 100 : 300 // Left side vs Right side
        };
        
        socket.emit('playerAssign', playerNum);
        io.emit('stateUpdate', players);
    } else {
        socket.emit('spectator', 'Game is full');
    }

    // Handle score clicks
    socket.on('incrementScore', () => {
        if (!gameActive || !players[socket.id]) return;

        players[socket.id].score += 1;
        
        // Dynamic position bump just to show movement synchronization
        players[socket.id].x += (players[socket.id].playerNumber === 1) ? 10 : -10;

        io.emit('stateUpdate', players);

        // Check win condition
        if (players[socket.id].score >= scoreTarget) {
            gameActive = false;
            io.emit('gameOver', `Player ${players[socket.id].playerNumber} Wins!`);
        }
    });

    // Reset game handler
    socket.on('resetGame', () => {
        for (let id in players) {
            players[id].score = 0;
            players[id].x = players[id].playerNumber === 1 ? 100 : 300;
        }
        gameActive = true;
        io.emit('stateUpdate', players);
        io.emit('gameReset');
    });

    socket.on('disconnect', () => {
        console.log(`Device disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('stateUpdate', players);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Test server live on port ${PORT}`));