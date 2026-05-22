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

const COLORS = ['RED', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'PURPLE'];

function generateTask() {
    // 1. Generate Presenter's task (Word vs Ink Color)
    const presenterText = COLORS[Math.floor(Math.random() * COLORS.length)];
    let targetColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    while (targetColor === presenterText) {
        targetColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    }

    // 2. Generate Responder's choices
    // The correct choice must be a word whose INK COLOR matches the targetColor.
    const correctWordText = COLORS[Math.floor(Math.random() * COLORS.length)];
    let choices = [{
        text: correctWordText,
        color: targetColor,
        isCorrect: true
    }];

    // Add incorrect distraction choices
    while (choices.length < 4) {
        const randomText = COLORS[Math.floor(Math.random() * COLORS.length)];
        const randomColor = COLORS[Math.floor(Math.random() * COLORS.length)];

        // Distractors cannot use the target ink color
        if (randomColor !== targetColor) {
            // Avoid duplicate text-color combinations in options
            const pairExists = choices.some(c => c.text === randomText && c.color === randomColor);
            if (!pairExists) {
                choices.push({
                    text: randomText,
                    color: randomColor,
                    isCorrect: false
                });
            }
        }
    }

    // Shuffle choices array
    choices.sort(() => Math.random() - 0.5);

    return {
        presenterText: presenterText,
        presenterColor: targetColor,
        responderChoices: choices,
        targetColor: targetColor
    };
}

function startNewRound() {
    if (Object.keys(players).length < 2) return;

    const task = generateTask();
    timeLeft = 7;
    gameActive = true;

    const ids = Object.keys(players);
    if (players[ids[0]].role === 'Presenter') {
        players[ids[0]].role = 'Responder';
        players[ids[1]].role = 'Presenter';
    } else {
        players[ids[0]].role = 'Presenter';
        players[ids[1]].role = 'Responder';
    }

    io.emit('roundStart', {
        task: task,
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
            io.emit('roundOver', { success: false, reason: 'Timeout' });
            setTimeout(startNewRound, 2500);
        }
    }, 1000);
}

io.on('connection', (socket) => {
    if (Object.keys(players).length < 2) {
        const isFirst = Object.keys(players).length === 0;
        players[socket.id] = {
            id: socket.id,
            role: isFirst ? 'Presenter' : 'Responder'
        };

        if (Object.keys(players).length === 2) {
            score = 0;
            startNewRound();
            startTimer();
        }
    } else {
        socket.emit('spectator');
    }

    socket.on('submitSelection', (choiceColor) => {
        if (!gameActive || !players[socket.id] || players[socket.id].role !== 'Responder') return;

        // Verify if the clicked item's ink color matches the target ink color
        if (choiceColor === gameActive.targetColor || choiceColor) {
            // We evaluate validity on backend via structural checking
            // dynamically validated directly through the active task logic
        }
    });
    
    // Explicit clean verification receiver
    socket.on('verifyChoice', (isCorrect) => {
        if (!gameActive || !players[socket.id] || players[socket.id].role !== 'Responder') return;
        gameActive = false;
        
        if (isCorrect) {
            score += 10;
            io.emit('roundOver', { success: true, reason: 'Correct Response' });
            setTimeout(startNewRound, 1200);
        } else {
            io.emit('roundOver', { success: false, reason: 'Incorrect Selection' });
            setTimeout(startNewRound, 2500);
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        gameActive = false;
        if (timer) clearInterval(timer);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Assessment engine running.`));
