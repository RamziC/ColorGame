const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

let players = {};
let score = 0;
let roundTimer = null;
let gameTimer = null;
let timeLeft = 7;
let gameTimeLeft = 90;
let gameActive = false;
let activeTask = null;
let roundNumber = 0;

const COLORS = ["BLACK", "RED", "GREEN", "YELLOW", "BLUE", "BROWN", "ORANGE", "PURPLE", "PINK", "GREY"];

function generateTask() {
    // Presenter sees a word in a colored ink; must say the ink color aloud.
    // Responder hears the color and taps the button with that ink color.

    const presenterText = COLORS[Math.floor(Math.random() * COLORS.length)];

    // Ink color must differ from the word text
    let targetColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    while (targetColor === presenterText) {
        targetColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    }

    // Build 4 choices with ALL DIFFERENT ink colors.
    // Correct choice: ink === targetColor
    // Distractor rule: at least one button must SPELL OUT the target color word
    //   (but have a different ink color) to maximise confusion.

    // Slot 0: correct answer — ink = targetColor, text = anything except targetColor word
    let correctText = COLORS[Math.floor(Math.random() * COLORS.length)];
    while (correctText === targetColor) {
        correctText = COLORS[Math.floor(Math.random() * COLORS.length)];
    }
    const choices = [{ text: correctText, color: targetColor, isCorrect: true }];

    // Pick 3 other ink colors (all different from targetColor and each other)
    const remainingColors = COLORS.filter(c => c !== targetColor);
    remainingColors.sort(() => Math.random() - 0.5);
    const distractorInks = remainingColors.slice(0, 3);

    // One distractor must spell out targetColor (wrong ink, right word — very confusing)
    const confuserIndex = Math.floor(Math.random() * 3);
    distractorInks.forEach((inkColor, i) => {
        const text = i === confuserIndex
            ? targetColor                                           // spells the answer, wrong ink
            : COLORS[Math.floor(Math.random() * COLORS.length)];  // random word
        choices.push({ text, color: inkColor, isCorrect: false });
    });

    // Shuffle
    choices.sort(() => Math.random() - 0.5);

    const clientChoices = choices.map((c, index) => ({
        text: c.text,
        color: c.color,
        index
    }));

    return {
        task: {
            presenterText,
            presenterColor: targetColor,
            responderChoices: clientChoices
        },
        correctIndex: choices.findIndex(c => c.isCorrect),
        targetColor
    };
}

function getPlayerIds() {
    return Object.keys(players);
}

function endGame() {
    gameActive = false;
    activeTask = null;
    if (roundTimer) { clearInterval(roundTimer); roundTimer = null; }
    if (gameTimer)  { clearInterval(gameTimer);  gameTimer  = null; }
    io.emit('gameOver', { score });
}

function startNewRound() {
    const ids = getPlayerIds();
    if (ids.length < 2) return;
    if (gameTimeLeft <= 0) { endGame(); return; }

    roundNumber++;

    if (roundNumber === 1) {
        players[ids[0]].role = 'Presenter';
        players[ids[1]].role = 'Responder';
    } else {
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
        players,
        score,
        timeLeft,
        gameTimeLeft
    });
}

function startRoundTimer() {
    if (roundTimer) clearInterval(roundTimer);
    roundTimer = setInterval(() => {
        if (!gameActive) return;
        timeLeft--;
        io.emit('timerUpdate', timeLeft);
        if (timeLeft <= 0) {
            gameActive = false;
            activeTask = null;
            io.emit('roundOver', { success: false, reason: "Time's up!" });
            setTimeout(startNewRound, 2000);
        }
    }, 1000);
}

function startGameTimer() {
    if (gameTimer) clearInterval(gameTimer);
    gameTimer = setInterval(() => {
        gameTimeLeft--;
        io.emit('gameTimerUpdate', gameTimeLeft);
        if (gameTimeLeft <= 0) endGame();
    }, 1000);
}

io.on('connection', (socket) => {
    const ids = getPlayerIds();

    if (ids.length < 2) {
        players[socket.id] = { id: socket.id, role: null };
        socket.emit('waiting');

        if (getPlayerIds().length === 2) {
            score = 0;
            roundNumber = 0;
            gameTimeLeft = 90;
            startNewRound();
            startRoundTimer();
            startGameTimer();
        }
    } else {
        socket.emit('spectator');
    }

    socket.on('submitChoice', (choiceIndex) => {
        if (!gameActive || !activeTask) return;
        if (!players[socket.id] || players[socket.id].role !== 'Responder') return;

        gameActive = false;
        const isCorrect = choiceIndex === activeTask.correctIndex;

        if (isCorrect) {
            score += 10;
            io.emit('roundOver', { success: true, reason: 'Correct! +10' });
            setTimeout(startNewRound, 1200);
        } else {
            io.emit('roundOver', { success: false, reason: 'Wrong.' });
            setTimeout(startNewRound, 2000);
        }
    });

    socket.on('disconnect', () => {
        const wasPlayer = !!players[socket.id];
        delete players[socket.id];
        gameActive = false;
        activeTask = null;
        roundNumber = 0;
        gameTimeLeft = 90;
        if (roundTimer) { clearInterval(roundTimer); roundTimer = null; }
        if (gameTimer)  { clearInterval(gameTimer);  gameTimer  = null; }
        if (wasPlayer) io.emit('partnerLeft');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Game running on port ${PORT}`));
