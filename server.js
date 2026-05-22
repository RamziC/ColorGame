const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

let players = {};
let score = 0;
let timer = null;
let timeLeft = 7; // Fast-paced Stroop timer
let gameActive = false;

// The core colors used for the mechanics
const COLORS = ['RED', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'PURPLE'];

function generateStroopChallenge() {
    // 1. Pick the text word
    const textWord = COLORS[Math.floor(Math.random() * COLORS.length)];
    
    // 2. Pick a distinct ink color (ensuring a clean Stroop mismatch)
    let inkColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    while (inkColor === textWord) {
        inkColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    }

    // 3. Generate options for the terminal receiver
    // The correct option is the actual INK color of the monitor challenge.
    let options = [inkColor];
    
    // Fill up options with distinct random colors for deceptive choices
    while (options.length < 4) {
        const randomOpt = COLORS[Math.floor(Math.random() * COLORS.length)];
        if (!options.includes(randomOpt)) {
            options.push(randomOpt);
        }
    }

    // Shuffle the options array so the correct answer isn't always first
    options.sort(() => Math.random() - 0.5);

    return {
        text: textWord,
        color: inkColor,
        choices: options
    };
}

function startNewRound() {
    if (Object.keys(players).length < 2) return;

    const challenge = generateStroopChallenge();
    timeLeft = 7; 
    gameActive = true;

    // Direct role swap every round to balance the cognitive load
    const ids = Object.keys(players);
    if (players[ids[0]].role === 'Monitor') {
        players[ids[0]].role = 'Terminal';
        players[ids[1]].role = 'Monitor';
    } else {
        players[ids[0]].role = 'Monitor';
        players[ids[1]].role = 'Terminal';
    }

    io.emit('roundStart', {
        challenge: challenge,
        players: players,
        score: score,
        timeLeft: timeLeft
    });
}

function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
        if (!gameActive) return;
        timeLeft--;
        io.emit('timerUpdate', timeLeft);

        if (timeLeft <= 0) {
            gameActive = false;
            io.emit('roundOver', { success: false, reason: 'Time Ran Out!' });
            setTimeout(startNewRound, 3000);
        }
    }, 1000);
}

io.on('connection', (socket) => {
    console.log(`Connected: ${socket.id}`);

    if (Object.keys(players).length < 2) {
        const isFirst = Object.keys(players).length === 0;
        players[socket.id] = {
            id: socket.id,
            playerNumber: isFirst ? 1 : 2,
            role: isFirst ? 'Monitor' : 'Terminal'
        };

        socket.emit('playerAssign', players[socket.id].playerNumber);

        if (Object.keys(players).length === 2) {
            score = 0;
            startNewRound();
            startTimer();
        }
    } else {
        socket.emit('spectator');
    }

    socket.on('submitSelection', (selectedColor, targetInkColor) => {
        if (!gameActive || !players[socket.id] || players[socket.id].role !== 'Terminal') return;

        if (selectedColor === targetInkColor) {
            gameActive = false;
            score += 10;
            io.emit('roundOver', { success: true, reason: 'Correct De-interference!' });
            setTimeout(startNewRound, 1500);
        } else {
            gameActive = false;
            io.emit('roundOver', { success: false, reason: 'Interference Failure!' });
            setTimeout(startNewRound, 3000);
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        gameActive = false;
        if (timer) clearInterval(timer);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Stroop server active on port ${PORT}`));
