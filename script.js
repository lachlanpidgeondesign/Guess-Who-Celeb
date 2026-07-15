/* ============================================
   CONFIG
   ============================================ */
const TOTAL_QUESTIONS = 5;
const MAX_GUESSES = 3;

/* ============================================
   ANALYTICS (GA4 puzzle tracking)
   ============================================ */
var PUZZLE_PROVIDER = 'dailymail';
var PUZZLE_NAME = 'guess-who';
var SHEETS_ENDPOINT = 'https://script.google.com/a/macros/dmgmedia.co.uk/s/AKfycbyrmojeZe0buOOAa52qXru8mS5cJECPpdUKQx3oQZZIMD_-qlD4v0NF8BAuLJ36zMj2jg/exec';
var SESSION_ID = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

function trackSheets(eventName, score) {
    try {
        var payload = {
            timestamp: new Date().toISOString(),
            event: eventName,
            puzzle_name: PUZZLE_NAME,
            puzzle_provider: PUZZLE_PROVIDER,
            session_id: SESSION_ID,
            page_url: (window.parent !== window ? document.referrer : window.location.href) || window.location.href
        };
        if (score !== undefined) payload.score = score;
        navigator.sendBeacon
            ? navigator.sendBeacon(SHEETS_ENDPOINT, JSON.stringify(payload))
            : fetch(SHEETS_ENDPOINT, { method: 'POST', body: JSON.stringify(payload) });
    } catch (e) { /* never break gameplay */ }
}

// Resolve the gtag function to use. The game runs in a SAME-ORIGIN iframe inside
// the Daily Mail article, so we fire on the parent page's configured GA4 container
// (window.parent.gtag) — this enriches the hit with all standard dimensions.
// Falls back to a local window.gtag if the game is ever loaded standalone.
function resolveGtag() {
    try {
        if (window.parent && typeof window.parent.gtag === 'function') return window.parent.gtag;
    } catch (e) { /* cross-origin access blocked — fall through */ }
    if (typeof window.gtag === 'function') return window.gtag;
    return null;
}

function trackPuzzleEvent(eventName, extra) {
    var payload = {
        event_category: 'puzzle',
        event_label: PUZZLE_NAME,
        non_interaction: false,
        puzzle_name: PUZZLE_NAME,
        puzzle_provider: PUZZLE_PROVIDER
    };
    if (extra) {
        for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
        }
    }
    try {
        var g = resolveGtag();
        if (g) g('event', eventName, payload);
    } catch (e) { /* never break gameplay */ }
}

/* ============================================
   CELEBRITY DATA - loaded from data.json
   ============================================ */
let PLAYERS = [];

function parseClues(clueString) {
    if (!clueString || !clueString.trim()) return [];
    // Split on numbered patterns like "1." or "1.\t" etc
    var parts = clueString.split(/\d+\.\s+/).filter(function(s) { return s.trim().length > 0; });
    return parts.map(function(s) { return s.trim().replace(/\s+/g, ' '); });
}

function buildAccepted(playerName) {
    var name = playerName.trim();
    var accepted = [name.toLowerCase()];
    // Add last name only
    var parts = name.split(' ');
    if (parts.length > 1) {
        accepted.push(parts[parts.length - 1].toLowerCase());
    }
    // Add without accents
    var norm = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (accepted.indexOf(norm) === -1) accepted.push(norm);
    if (parts.length > 1) {
        var lastNorm = parts[parts.length - 1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (accepted.indexOf(lastNorm) === -1) accepted.push(lastNorm);
    }
    return accepted;
}

function buildDisplayName(playerName) {
    var name = playerName.trim();
    var parts = name.split(' ');
    if (parts.length === 1) {
        return { first: "", last: parts[0].toUpperCase() };
    }
    return { first: parts.slice(0, -1).join(' ').toUpperCase(), last: parts[parts.length - 1].toUpperCase() };
}

async function loadPlayerData() {
    try {
        var response = await fetch('data.json');
        var data = await response.json();
        PLAYERS = data.map(function(entry) {
            var name = entry.Player.trim();
            var display = buildDisplayName(name);
            // Single image: use the entry's image, else the first of an images array
            var image = entry.image || entry.Image;
            if (!image) {
                var imgs = entry.images || entry.Images;
                image = (imgs && imgs.length) ? imgs[0] : '';
            }
            // Clues: accept a ready-made array, else parse the numbered string
            var clues = entry.clues || entry.Clues;
            clues = Array.isArray(clues) ? clues.slice() : parseClues(clues);
            return {
                name: name,
                displayFirst: display.first,
                displayLast: display.last,
                accepted: buildAccepted(name),
                label: entry.label || entry.Label || null,
                image: image,
                revealImage: entry.revealImage || entry.RevealImage || null,
                clues: clues,
                funFact: entry.Significance || ""
            };
        });
    } catch(e) {
        console.error('Failed to load data.json:', e);
    }
}


/* ============================================
   STATE
   ============================================ */
let currentQuestion = 0;      // 0-based index into PLAYERS
let questionStates = {};


/* ============================================
   UTILITIES
   ============================================ */

function normalize(str) {
    return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, ' ');
}

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(a[i-1]!==b[j-1]?1:0));
    return dp[m][n];
}

function checkAnswer(guess, acceptedAnswers) {
    const g = normalize(guess);
    if (!g || g.length < 2) return 'wrong';
    for (const ans of acceptedAnswers) { if (g === normalize(ans)) return 'exact'; }
    for (const ans of acceptedAnswers) {
        const a = normalize(ans);
        const dist = levenshtein(g, a);
        const threshold = Math.max(1, Math.floor(Math.max(g.length, a.length) * 0.28));
        if (dist <= threshold && dist <= 4) return 'close';
    }
    return 'wrong';
}

/* ============================================
   QUESTION STATE
   ============================================ */

function getQuestionState(i) {
    if (!questionStates[i]) questionStates[i] = { wrongGuesses: [], revealedCount: 1, viewIndex: 0, results: [], completed: false, won: false };
    return questionStates[i];
}

function getTotalScore() {
    var s = 0;
    for (var k in questionStates) {
        if (questionStates[k] && questionStates[k].won) s++;
    }
    return s;
}


/* ============================================
   RENDERING
   ============================================ */

function renderCard(player) {
    var card = document.getElementById('quiz-card');
    var nameEl = document.getElementById('card-name');
    var state = getQuestionState(currentQuestion);

    // Reveal the name only once the game is over
    if (state.completed) {
        var displayName = player.displayFirst
            ? player.displayFirst + '<br>' + player.displayLast
            : player.displayLast;
        nameEl.innerHTML = displayName;
        nameEl.classList.remove('hidden-name');
        card.classList.add('revealed');
    } else {
        nameEl.textContent = '? ? ?';
        nameEl.classList.add('hidden-name');
        card.classList.remove('revealed');
    }

    renderPhoto(player);
}

/* ---- PHOTO ---- */
function renderPhoto(player) {
    var img = document.getElementById('card-photo');
    if (!img) return;
    if (player.image) {
        img.src = player.image;
        img.alt = 'Mystery celebrity';
    } else {
        img.removeAttribute('src');
    }
}

function renderClues(player, clueIndex) {
    var area = document.getElementById('clue-display');
    if (!player.clues || player.clues.length === 0) {
        area.innerHTML = '<div class="no-clues-msg">No clues available yet - just the photo to go on!</div>';
        return;
    }
    var idx = Math.min(clueIndex, player.clues.length - 1);
    area.innerHTML = '<div class="clue-area">' +
        '<div class="clue-header">' +
            '<span class="clue-label">Clue</span>' +
            '<span class="clue-counter">' + (idx + 1) + ' of ' + player.clues.length + '</span>' +
        '</div>' +
        '<div class="clue-text">' + player.clues[idx] + '</div>' +
    '</div>';
}

function renderClueNav(player, state) {
    var display = document.getElementById('attempts-display');
    display.innerHTML = '';
    var n = (player.clues && player.clues.length) ? player.clues.length : 0;
    for (var i = 0; i < n; i++) {
        var dot = document.createElement('span');
        dot.className = 'attempt-dot';
        dot.textContent = (i + 1);
        var result = state.results[i] || 'none';
        var unlocked = i < state.revealedCount;
        if (result === 'wrong') dot.classList.add('wrong');
        else if (result === 'skip') dot.classList.add('skip');
        else if (result === 'correct') dot.classList.add('correct');
        else if (unlocked) dot.classList.add('available');
        if (!unlocked) dot.classList.add('locked');
        if (i === state.viewIndex) dot.classList.add('active');
        if (unlocked) {
            (function(idx) {
                dot.onclick = function() {
                    // Pure navigation: review an earlier clue without unlocking clues or costing a guess
                    state.viewIndex = idx;
                    renderClues(player, state.viewIndex);
                    renderClueNav(player, state);
                };
            })(i);
        }
        display.appendChild(dot);
    }
}

function renderProgress() {
    var scoreEl = document.getElementById('hdr-score');
    var qEl = document.getElementById('hdr-question');
    var fill = document.getElementById('progress-fill');
    if (scoreEl) scoreEl.textContent = 'Score: ' + getTotalScore();
    if (qEl) qEl.textContent = 'Question ' + (currentQuestion + 1) + ' of ' + TOTAL_QUESTIONS;
    if (fill) fill.style.width = (((currentQuestion + 1) / TOTAL_QUESTIONS) * 100) + '%';
}

function showFeedback(type, msg) {
    var fb = document.getElementById('feedback');
    fb.className = 'feedback ' + type;
    fb.textContent = msg;
    if (type !== 'correct') {
        clearTimeout(fb._t);
        fb._t = setTimeout(function() { fb.className = 'feedback hidden'; }, 3000);
    }
}

function showFinalResult() {
    trackPuzzleEvent('puzzle_completed', { successful_puzzle_completions: 1 });
    trackSheets('puzzle_completed', getTotalScore());
    var area = document.getElementById('result-overlay');
    var title = document.getElementById('result-title');
    var scoreEl = document.getElementById('result-score');
    var funfact = document.getElementById('result-funfact');
    area.classList.remove('hidden');

    // Date label
    var dateLabel = document.getElementById('result-date-label');
    if (dateLabel) {
        var d = new Date();
        var months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        dateLabel.textContent = d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    }

    var total = getTotalScore();
    title.textContent = total === TOTAL_QUESTIONS ? 'Brilliant!'
        : total >= 3 ? 'Well done!'
        : total >= 1 ? 'Good try!'
        : 'Better luck next time!';
    scoreEl.textContent = 'You scored ' + total + ' / ' + TOTAL_QUESTIONS;

    // No per-celebrity reveal image or fun fact on the summary screen
    var revealImg = document.getElementById('result-reveal-img');
    if (revealImg) {
        revealImg.removeAttribute('src');
        revealImg.classList.add('hidden');
    }
    if (funfact) {
        funfact.textContent = '';
        funfact.style.display = 'none';
    }

    var shareSection = document.getElementById('share-section');
    if (shareSection) shareSection.classList.add('hidden');

    // Show Results button in header
    var resultsBtn = document.getElementById('header-results-btn');
    if (resultsBtn) resultsBtn.classList.remove('hidden');
}

/* ============================================
   GAME LOGIC
   ============================================ */
function getShareText() {
    var total = getTotalScore();
    return 'I scored ' + total + '/' + TOTAL_QUESTIONS + " on today's Guess Who. Can you beat that?\n\nTry it out!";
}

// ✏️ Share link temporarily disabled. Set the final page URL here and re-add
// SHARE_URL to getShareText()/shareTo() to include it in shared posts again.
var SHARE_URL = 'https://www.dailymail.com/games/game/index.html?game=guess-who';

function toggleShareSection() {
    var section = document.getElementById('share-section');
    var msgEl = document.getElementById('share-message');
    var text = getShareText();
    msgEl.textContent = '\u201c' + text + '\u201d';
    section.classList.toggle('hidden');
    // Hide toast when toggling
    document.getElementById('share-copied-toast').classList.add('hidden');
}

function shareTo(platform) {
    var text = getShareText();
    var encodedText = encodeURIComponent(text);
    var url;

    // WhatsApp and X support pre-filled text natively
    if (platform === 'whatsapp') {
        url = 'https://wa.me/?text=' + encodedText;
    } else if (platform === 'x') {
        url = 'https://x.com/intent/tweet?text=' + encodedText;
    } else {
        // Facebook and LinkedIn don't allow pre-filled text, so copy to clipboard
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
            var toast = document.getElementById('share-copied-toast');
            toast.classList.remove('hidden');
            setTimeout(function() { toast.classList.add('hidden'); }, 4000);
        }
        if (platform === 'facebook') {
            url = 'https://www.facebook.com/';
        } else {
            url = 'https://www.linkedin.com/';
        }
    }
    window.open(url, '_blank', 'noopener');
}

function loadQuestion(i) {
    if (i < 0 || i >= TOTAL_QUESTIONS) return;
    currentQuestion = i;
    var player = PLAYERS[i];

    document.getElementById('pre-launch-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');

    // Reset card animation classes
    document.getElementById('quiz-card').classList.remove('celebrate', 'shake');

    if (!player) {
        document.querySelector('.game-col-card').style.display = 'none';
        document.getElementById('clue-display').innerHTML = '';
        document.getElementById('guess-area').style.display = 'none';
        document.getElementById('attempts-display').innerHTML = '';
        document.getElementById('feedback').className = 'feedback hidden';
        renderProgress();
        return;
    }
    document.querySelector('.game-col-card').style.display = '';
    document.getElementById('guess-area').style.display = 'flex';
    document.getElementById('feedback').className = 'feedback hidden';
    document.getElementById('answer-reveal').className = 'answer-reveal hidden';

    var state = getQuestionState(i);
    // Ensure per-clue tracking is sized to this player's clues
    if (!state.results) state.results = [];
    while (state.results.length < player.clues.length) state.results.push('none');
    if (typeof state.revealedCount !== 'number') state.revealedCount = player.clues.length ? 1 : 0;
    if (state.revealedCount > player.clues.length) state.revealedCount = player.clues.length;
    if (typeof state.viewIndex !== 'number') state.viewIndex = 0;

    renderCard(player);
    renderClues(player, state.viewIndex);
    renderClueNav(player, state);
    document.getElementById('guess-area').style.display = 'flex';
    var inp = document.getElementById('guess-input');
    inp.value = ''; inp.focus();

    updateGuessButton(state);
    updateNextClueBtn(state, player);
    renderProgress();
}

// Move to the next celebrity, or show the final score after the last one
function advanceQuestion() {
    if (currentQuestion + 1 < TOTAL_QUESTIONS) {
        loadQuestion(currentQuestion + 1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
        renderProgress();
        showFinalResult();
    }
}

function updateGuessButton(state) {
    document.getElementById('guess-btn').disabled = state.completed;
    document.getElementById('guess-input').disabled = state.completed;
}

function makeGuess() {
    var input = document.getElementById('guess-input');
    var guess = input.value.trim();
    if (!guess) return;
    var player = PLAYERS[currentQuestion];
    if (!player) return;
    var state = getQuestionState(currentQuestion);
    if (state.completed) return;

    var result = checkAnswer(guess, player.accepted);

    if (result === 'exact' || result === 'close') {
        state.completed = true; state.won = true;
        // The clue they were viewing when they solved it turns green
        state.results[state.viewIndex] = 'correct';
        renderCard(player);
        renderClueNav(player, state);
        document.getElementById('quiz-card').classList.add('celebrate');
        showFeedback('correct', result === 'close' ? 'Close enough! It\'s ' + player.name + '!' : 'Correct! It\'s ' + player.name + '!');
        showAnswerReveal(true, player.name);
        document.getElementById('guess-area').style.display = 'none';
        document.getElementById('next-clue-btn').classList.add('hidden');
        launchConfetti();
        renderProgress();
        setTimeout(advanceQuestion, 2000);
    } else {
        state.wrongGuesses.push(guess);
        var wc = state.wrongGuesses.length;
        // Mark the furthest-unlocked clue as a wrong guess
        state.results[state.revealedCount - 1] = 'wrong';
        var card = document.getElementById('quiz-card');
        card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');

        if (wc >= MAX_GUESSES) {
            state.completed = true; state.won = false;
            renderCard(player); renderClueNav(player, state);
            showFeedback('wrong', 'Not quite!');
            showAnswerReveal(false, player.name);
            document.getElementById('guess-area').style.display = 'none';
            document.getElementById('next-clue-btn').classList.add('hidden');
            setTimeout(advanceQuestion, 2000);
        } else {
            // Unlock the next clue and auto-advance to it
            if (state.revealedCount < player.clues.length) state.revealedCount++;
            state.viewIndex = state.revealedCount - 1;
            renderClues(player, state.viewIndex);
            renderClueNav(player, state);
            showFeedback('wrong', 'Not right - here\'s your next clue!');
            updateNextClueBtn(state, player);
        }
    }
    input.value = '';
}

function skipClue() {
    var player = PLAYERS[currentQuestion];
    if (!player || !player.clues) return;
    var state = getQuestionState(currentQuestion);
    if (state.completed) return;

    // Skipping the current furthest clue: mark it 'skip' and count it as an attempt
    state.results[state.revealedCount - 1] = 'skip';
    state.wrongGuesses.push('(skipped)');
    var wc = state.wrongGuesses.length;

    if (wc >= MAX_GUESSES) {
        state.completed = true; state.won = false;
        state.viewIndex = state.revealedCount - 1;
        renderCard(player); renderClueNav(player, state);
        renderClues(player, state.viewIndex);
        showFeedback('wrong', 'Not quite!');
        showAnswerReveal(false, player.name);
        document.getElementById('guess-area').style.display = 'none';
        document.getElementById('next-clue-btn').classList.add('hidden');
        setTimeout(advanceQuestion, 2000);
    } else {
        // Unlock the next clue and auto-advance to it
        if (state.revealedCount < player.clues.length) state.revealedCount++;
        state.viewIndex = state.revealedCount - 1;
        renderClues(player, state.viewIndex);
        renderClueNav(player, state);
        updateNextClueBtn(state, player);
    }
}

function showAnswerReveal(won, playerName) {
    var el = document.getElementById('answer-reveal');
    if (!el) return;
    el.className = 'answer-reveal ' + (won ? 'correct' : 'wrong');
    el.textContent = playerName;
}

function updateNextClueBtn(state, player) {
    var btn = document.getElementById('next-clue-btn');
    if (!btn) return;
    if (state.completed) {
        btn.classList.add('hidden');
    } else if (state.revealedCount >= player.clues.length) {
        btn.textContent = 'Give up';
        btn.classList.remove('hidden');
    } else {
        btn.textContent = 'Next clue';
        btn.classList.remove('hidden');
    }
}


/* ============================================
   CONFETTI
   ============================================ */

function launchConfetti() {
    var c = document.getElementById('confetti-container');
    if (!c) return;
    c.innerHTML = '';
    var cols = ['#6ea93a', '#8dc461', '#5a8c2e', '#b8dda0', '#fff', '#ddd'];
    for (var i = 0; i < 50; i++) {
        var p = document.createElement('div');
        p.className = 'confetti-piece';
        p.style.left = Math.random()*100+'%';
        p.style.background = cols[Math.floor(Math.random()*cols.length)];
        p.style.animationDelay = Math.random()*1.5+'s';
        p.style.animationDuration = (2+Math.random()*2)+'s';
        p.style.width = (5+Math.random()*7)+'px';
        p.style.height = (5+Math.random()*7)+'px';
        p.style.borderRadius = Math.random()>0.5?'50%':'2px';
        c.appendChild(p);
    }
    setTimeout(function() { c.innerHTML = ''; }, 5000);
}


/* ============================================
   INIT
   ============================================ */

async function init() {
    await loadPlayerData();
    questionStates = {};
    document.getElementById('pre-launch-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    loadQuestion(0);
}

/* Event listeners */
document.getElementById('guess-btn').addEventListener('click', makeGuess);
document.getElementById('guess-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') makeGuess(); });
document.getElementById('next-clue-btn').addEventListener('click', skipClue);
document.getElementById('header-results-btn').addEventListener('click', function() {
    document.getElementById('result-overlay').classList.remove('hidden');
});

/* Splash screen */
(function() {
    var splashDate = document.getElementById('splash-date');
    if (splashDate) {
        var d = new Date();
        var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        var day = d.getDate();
        var suffix = (day % 10 === 1 && day !== 11) ? 'st' : (day % 10 === 2 && day !== 12) ? 'nd' : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
        splashDate.textContent = days[d.getDay()] + ' ' + months[d.getMonth()] + ' ' + day + suffix + ' ' + d.getFullYear();
    }
    var startBtn = document.getElementById('splash-start-btn');
    if (startBtn) startBtn.addEventListener('click', function() {
        trackPuzzleEvent('puzzle_started');
        trackSheets('puzzle_started');
        document.getElementById('splash-screen').classList.add('hidden');
    });
})();

/* Run init when DOM is ready (supports defer) */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
