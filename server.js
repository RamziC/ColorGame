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
let timeLeft = 7;
let gameActive = false;
let activeTask = null;
let roundNumber = 0;

const COLORS = ['RED', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'PURPLE'];

function generateTask() {
    // The presenter sees a word written in a specific ink color.
    // They must say the INK COLOR out loud (not the word).
    // The responder hears the ink color and must find the button
    // whose INK COLOR matches what was said.

    // Pick the word shown to presenter (any color name)
    const presenterText = COLORS[Math.floor(Math.random() * COLORS.length)];

    // Pick the ink color of that word — this is what presenter must say aloud
    // Must differ from the word itself to create the Stroop conflict
    let targetColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    while (targetColor === presenterText) {
        targetColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    }

    // Build 4 choices, all with DIFFERENT ink colors
    // One choice must have ink color === targetColor (the correct one)
    // No two choices share the same ink color
    const usedInkColors = new Set();
    usedInkColors.add(targetColor);

    // Correct choice: any word text, ink = targetColor
    const correctText = COLORS[Math.floor(Math.random() * COLORS.length)];
    const choices = [{
        text: correctText,
        color: targetColor,
        isCorrect: true
    }];

    // Fill remaining 3 slots with unique ink colors
    const remainingColors = COLORS.filter(c => c !== targetColor);
    // Shuffle remaining colors
    remainingColors.sort(() => Math.random() - 0.5);

    for (let i = 0; i < 3; i++) {
        const inkColor = remainingColors[i];
        const wordText = COLORS[Math.floor(Math.random() * COLORS.length)];
        choices.push({
            text: wordText,
            color: inkColor,
            isCorrect: false
        });
    }

    // Shuffle choices
    choices.sort(() => Math.random() - 0.5);

    // Strip isCorrect before sending to client — validation happens server-side
    const clientChoices = choices.map((c, index) => ({
        text: c.text,
        color: c.color,
        index: index
    }));

    return {
        task: {
            presenterText,
            presenterColor: targetColor,
            responderChoices: clientChoices
        },
        // Server-side truth: which index is correct
        correctIndex: choices.findIndex(c => c.isCorrect),
        targetColor
    };
}

function getPlayerIds() {
    return Object.keys(players);
}

function startNewRound() {
    const ids = getPlayerIds();
    if (ids.length < 2) return;

    roundNumber++;

    // Alternate roles each round
    if (roundNumber === 1) {
        players[ids[0]].role = 'Presenter';
        players[ids[1]].role = 'Responder';
    } else {
        // Swap roles
        ids.forEach(id => {
            players[id].role = players[id].role === 'Presenter' ? 'Responder' : 'Presenter';
        });
    }

    const generated = generateTask();
    activeTask = generated;
    timeLeft = 7;
    gameActive = true;

    io.emit('roundStart', {
        task: generated.task,
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
            activeTask = null;
            io.emit('roundOver', { success: false, reason: 'Time\'s up!' });
            setTimeout(startNewRound, 2500);
        }
    }, 1000);
}

io.on('connection', (socket) => {
    const ids = getPlayerIds();

    if (ids.length < 2) {
        players[socket.id] = {
            id: socket.id,
            role: null // assigned in startNewRound
        };

        socket.emit('waiting', { message: 'Waiting for another player...' });

        if (getPlayerIds().length === 2) {
            score = 0;
            roundNumber = 0;
            startNewRound();
            startTimer();
        }
    } else {
        socket.emit('spectator');
    }

    // Client sends the index of the choice they picked
    socket.on('submitChoice', (choiceIndex) => {
        if (!gameActive || !activeTask) return;
        if (!players[socket.id] || players[socket.id].role !== 'Responder') return;

        gameActive = false;
        const isCorrect = choiceIndex === activeTask.correctIndex;

        if (isCorrect) {
            score += 10;
            io.emit('roundOver', { success: true, reason: 'Correct! +10 points' });
            setTimeout(startNewRound, 1500);
        } else {
            io.emit('roundOver', { success: false, reason: 'Wrong choice. No points.' });
            setTimeout(startNewRound, 2500);
        }
    });

    socket.on('disconnect', () => {
        const wasPlayer = !!players[socket.id];
        delete players[socket.id];
        gameActive = false;
        activeTask = null;
        roundNumber = 0;

        if (timer) {
            clearInterval(timer);
            timer = null;
        }

        if (wasPlayer) {
            // Notify remaining player
            io.emit('partnerLeft');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Stroop game running on port ${PORT}`));
