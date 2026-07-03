/* ============================================
   CONFIG
   ============================================ */
const START_DATE = new Date(2026, 5, 1); // June 1, 2026
const TOTAL_GAMES = 1;
const MAX_GUESSES = 5;

/* Country code lookup for flag images */
const COUNTRY_FLAGS = {
    "Argentina": "ar",
    "France": "fr",
    "England": "gb-eng",
    "Brazil": "br",
    "Croatia": "hr",
    "Netherlands": "nl",
    "West Germany": "de",
    "W. Germany": "de",
    "Germany": "de",
    "Italy": "it",
    "Cameroon": "cm",
    "Spain": "es",
    "Portugal": "pt",
    "Colombia": "co",
    "Morocco": "ma",
    "Bulgaria": "bg",
    "Uruguay": "uy",
    "Poland": "pl",
    "Peru": "pe",
    "Romania": "ro"
};

/* Nation strip colours */
const NATION_STRIPS = {
    "Argentina": { bg: "#75aadb", color: "#fff" },
    "France": { bg: "#002395", color: "#fff" },
    "England": { bg: "#cf081f", color: "#fff" },
    "Brazil": { bg: "#ffdf00", color: "#002776" },
    "Croatia": { bg: "#ff0000", color: "#fff" },
    "Netherlands": { bg: "#ff6600", color: "#fff" },
    "West Germany": { bg: "#000", color: "#ffcc00" },
    "W. Germany": { bg: "#000", color: "#ffcc00" },
    "Germany": { bg: "#000", color: "#ffcc00" },
    "Italy": { bg: "#0066cc", color: "#fff" },
    "Cameroon": { bg: "#007a5e", color: "#fcd116" },
    "Spain": { bg: "#c60b1e", color: "#ffc400" },
    "Portugal": { bg: "#006600", color: "#fff" },
    "Colombia": { bg: "#fcd116", color: "#003893" },
    "Morocco": { bg: "#c1272d", color: "#fff" },
    "Bulgaria": { bg: "#00966e", color: "#fff" },
    "Uruguay": { bg: "#001489", color: "#fff" },
    "Poland": { bg: "#dc143c", color: "#fff" },
    "Peru": { bg: "#d91023", color: "#fff" },
    "Romania": { bg: "#fcd116", color: "#002b7f" }
};

/* Image filename overrides for names that don't map cleanly */
const IMAGE_OVERRIDES = {
    "Ronaldo ": "Ronaldo.webp",
    "Sir Geoff Hurst": "Geoff_Hurst.webp",
    "Andres Iniesta": "Andres_Iniesta.webp"
};

/* ============================================
   PLAYER DATA - loaded from data.json
   ============================================ */
let PLAYERS = [];

function buildImagePath(playerName) {
    var trimmed = playerName.trim();
    if (IMAGE_OVERRIDES[playerName]) return "footballers/" + IMAGE_OVERRIDES[playerName];
    // Remove "Sir " prefix if present
    var name = trimmed.replace(/^Sir /, '');
    return "footballers/" + name.replace(/ /g, '_') + ".webp";
}

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
            var nation = entry.Nation;
            var strip = NATION_STRIPS[nation] || { bg: "#333", color: "#fff" };
            var display = buildDisplayName(name);
            // Carousel images: use the entry's images array, else fall back to the single derived image
            var images = entry.images || entry.Images;
            if (!images || !images.length) images = [buildImagePath(entry.Player)];
            // Clues: accept a ready-made array, else parse the numbered string
            var clues = entry.clues || entry.Clues;
            clues = Array.isArray(clues) ? clues.slice() : parseClues(clues);
            return {
                name: name,
                displayFirst: display.first,
                displayLast: display.last,
                accepted: buildAccepted(name),
                nation: nation,
                label: entry.label || entry.Label || null,
                images: images,
                revealImage: entry.revealImage || entry.RevealImage || null,
                stripBg: strip.bg,
                stripColor: strip.color,
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
let currentDay = 1;
let gameStates = {};


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

function getDateForDay(dayNum) {
    const d = new Date(START_DATE);
    d.setDate(d.getDate() + dayNum - 1);
    return d;
}

function formatDate(date) {
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return days[date.getDay()] + ' ' + date.getDate() + ' ' + months[date.getMonth()];
}


/* ============================================
   DATE LOGIC
   ============================================ */

function getTodayGameDay() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(START_DATE.getFullYear(), START_DATE.getMonth(), START_DATE.getDate());
    return Math.floor((today - start) / (1000*60*60*24)) + 1;
}

function getMaxPlayableDay() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('testday')) return Math.min(parseInt(params.get('testday')) || TOTAL_GAMES, TOTAL_GAMES);
    const today = getTodayGameDay();
    return today < 1 ? 0 : Math.min(today, TOTAL_GAMES);
}


/* ============================================
   STORAGE
   ============================================ */

function saveGameStates() {
    // No persistence - each visit starts fresh
}
function loadGameStates() {
    gameStates = {};
    try { localStorage.removeItem('wcquiz_states'); } catch(e) {}
}
function getGameState(day) {
    if (!gameStates[day]) gameStates[day] = { wrongGuesses: [], clueIndex: 0, revealedCount: 1, viewIndex: 0, results: [], completed: false, won: false, score: 0 };
    return gameStates[day];
}


/* ============================================
   RENDERING
   ============================================ */

function getFlagUrl(nation) {
    const code = COUNTRY_FLAGS[nation];
    if (!code) return null;
    return 'https://flagcdn.com/w40/' + code + '.png';
}

function renderCard(player) {
    var card = document.getElementById('quiz-card');
    var strip = document.getElementById('team-strip');
    var badge = document.getElementById('badge-area');
    var nameEl = document.getElementById('card-name');
    var state = getGameState(currentDay);

    // Card chrome: optional generic label, else nation strip + flag, else nothing
    if (player.label) {
        strip.textContent = player.label;
        strip.style.background = '#191919';
        strip.style.color = '#fff';
        strip.style.display = '';
        badge.innerHTML = '';
        badge.style.display = 'none';
    } else if (player.nation) {
        strip.textContent = player.nation.toUpperCase();
        strip.style.background = player.stripBg;
        strip.style.color = player.stripColor;
        strip.style.display = '';
        badge.style.display = '';
        var flagUrl = getFlagUrl(player.nation);
        if (flagUrl) {
            badge.innerHTML = '<img class="flag-badge" src="' + flagUrl + '" alt="' + player.nation + '" loading="lazy">';
        } else {
            badge.innerHTML = '<span class="flag-badge-text">' + player.nation.substring(0,3).toUpperCase() + '</span>';
        }
    } else {
        strip.style.display = 'none';
        badge.innerHTML = '';
        badge.style.display = 'none';
    }

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

    renderCarousel(player);
}

/* ---- CAROUSEL ---- */
var carouselState = { index: 0, count: 1 };

function renderCarousel(player) {
    var track = document.getElementById('carousel-track');
    var dots = document.getElementById('carousel-dots');
    var prev = document.getElementById('carousel-prev');
    var next = document.getElementById('carousel-next');
    if (!track) return;
    var images = (player.images && player.images.length) ? player.images : [];
    track.innerHTML = '';
    dots.innerHTML = '';
    carouselState.index = 0;
    carouselState.count = images.length;
    for (var i = 0; i < images.length; i++) {
        var img = document.createElement('img');
        img.src = images[i];
        img.alt = 'Mystery player';
        img.loading = 'lazy';
        img.decoding = 'async';
        track.appendChild(img);
        var dot = document.createElement('span');
        dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
        (function(idx) { dot.onclick = function() { goToSlide(idx); }; })(i);
        dots.appendChild(dot);
    }
    // Hide arrows + dots when there's only a single image
    var single = images.length <= 1;
    if (prev) prev.classList.toggle('hidden', single);
    if (next) next.classList.toggle('hidden', single);
    dots.classList.toggle('hidden', single);
    updateCarousel();
}

function updateCarousel() {
    var track = document.getElementById('carousel-track');
    if (!track) return;
    track.style.transform = 'translateX(' + (-carouselState.index * 100) + '%)';
    var dots = document.getElementById('carousel-dots').children;
    for (var i = 0; i < dots.length; i++) {
        dots[i].className = 'carousel-dot' + (i === carouselState.index ? ' active' : '');
    }
}

// Move to slide i, clamped to range (no wrap-around)
function goToSlide(i) {
    if (i < 0) i = 0;
    if (i > carouselState.count - 1) i = carouselState.count - 1;
    carouselState.index = i;
    updateCarousel();
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

function renderDayInfo() {
    var maxDay = getMaxPlayableDay();
    document.getElementById('day-number').textContent = 'Day ' + currentDay;
    document.getElementById('day-date').textContent = formatDate(getDateForDay(currentDay));
    document.getElementById('prev-day').disabled = currentDay <= 1;
    document.getElementById('next-day').disabled = currentDay >= maxDay;
    var pickerLabel = document.getElementById('picker-btn-label');
    if (pickerLabel) pickerLabel.textContent = 'Day ' + currentDay;
}

function renderPicker() {
    var grid = document.getElementById('picker-grid');
    var maxDay = getMaxPlayableDay();
    grid.innerHTML = '';
    for (var d = 1; d <= TOTAL_GAMES; d++) {
        var btn = document.createElement('div');
        btn.className = 'pick-day';
        btn.textContent = d;
        var state = gameStates[d];
        if (d > maxDay) {
            btn.classList.add('locked');
        } else if (d === currentDay) {
            btn.classList.add('current');
            (function(day) {
                btn.onclick = function() { closePicker(); };
            })(d);
        } else if (state && state.completed) {
            btn.classList.add('completed');
            (function(day) {
                btn.onclick = function() { closePicker(); loadDay(day); };
            })(d);
        } else {
            btn.classList.add('available');
            (function(day) {
                btn.onclick = function() { closePicker(); loadDay(day); };
            })(d);
        }
        grid.appendChild(btn);
    }
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

function showResult(won, score, player) {
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

    if (won) {
        var cluesUsed = MAX_GUESSES - score + 1;
        title.textContent = score === MAX_GUESSES ? 'Brilliant!' : score >= 3 ? 'Well done!' : 'Got it!';
        scoreEl.textContent = 'You guessed ' + player.name + ' with ' + cluesUsed + (cluesUsed === 1 ? ' clue' : ' clues');
    } else {
        title.textContent = 'Unlucky!';
        scoreEl.textContent = 'The answer was ' + player.name;
    }
    // Reveal image (shown in place of the fun-fact copy) for entries that supply one
    var revealImg = document.getElementById('result-reveal-img');
    if (revealImg) {
        if (player.revealImage) {
            revealImg.src = player.revealImage;
            revealImg.alt = player.name;
            revealImg.classList.remove('hidden');
        } else {
            revealImg.removeAttribute('src');
            revealImg.classList.add('hidden');
        }
    }
    funfact.textContent = player.funFact || '';
    funfact.style.display = player.funFact ? 'block' : 'none';

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
    var state = getGameState(currentDay);
    var player = PLAYERS[currentDay - 1];
    if (state.won) {
        var cluesUsed = MAX_GUESSES - state.score + 1;
        return 'I guessed the celebrity in ' + cluesUsed + ' clue' + (cluesUsed !== 1 ? 's' : '') + " on today's Guess Who. Can you beat that?\n\nTry it out!";
    } else {
        return "I couldn't guess today's Guess Who. Can you do better?\n\nTry it out!";
    }
}

// ✏️ Share link temporarily disabled. Set the final page URL here and re-add
// SHARE_URL to getShareText()/shareTo() to include it in shared posts again.
var SHARE_URL = 'https://www.dailymail.com/news/article-15831601/world-cup-legends-quiz.html';

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

function loadDay(day) {
    var maxDay = getMaxPlayableDay();
    if (day < 1 || day > maxDay) return;
    currentDay = day;
    var player = PLAYERS[day - 1];

    var url = new URL(window.location);
    url.searchParams.set('day', day);
    history.replaceState(null, '', url);

    document.getElementById('pre-launch-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');

    // Reset card animation classes
    document.getElementById('quiz-card').classList.remove('celebrate', 'shake');

    if (!player) {
        document.querySelector('.game-col-card').style.display = 'none';
        document.getElementById('clue-display').innerHTML = '';
        document.getElementById('guess-area').style.display = 'none';
        document.getElementById('attempts-display').innerHTML = '';
        document.getElementById('result-overlay').classList.add('hidden');
        document.getElementById('feedback').className = 'feedback hidden';
        renderDayInfo(); renderPicker();
        return;
    }
    document.querySelector('.game-col-card').style.display = '';
    document.getElementById('guess-area').style.display = 'flex';
    document.getElementById('feedback').className = 'feedback hidden';
    document.getElementById('result-overlay').classList.add('hidden');
    document.getElementById('answer-reveal').className = 'answer-reveal hidden';

    var state = getGameState(day);
    // Ensure per-clue tracking is sized to this player's clues
    if (!state.results) state.results = [];
    while (state.results.length < player.clues.length) state.results.push('none');
    if (typeof state.revealedCount !== 'number') state.revealedCount = player.clues.length ? 1 : 0;
    if (state.revealedCount > player.clues.length) state.revealedCount = player.clues.length;
    if (typeof state.viewIndex !== 'number') state.viewIndex = 0;

    if (state.completed) {
        renderCard(player);
        renderClues(player, state.viewIndex);
        renderClueNav(player, state);
        showResult(state.won, state.score, player);
        showAnswerReveal(state.won, player.name);
        document.getElementById('guess-area').style.display = 'none';
    } else {
        renderCard(player);
        renderClues(player, state.viewIndex);
        renderClueNav(player, state);
        document.getElementById('guess-area').style.display = 'flex';
        var inp = document.getElementById('guess-input');
        inp.value = ''; inp.focus();
    }

    updateGuessButton(state);
    updateNextClueBtn(state, player);
    renderDayInfo(); renderPicker();
}

function updateGuessButton(state) {
    document.getElementById('guess-btn').disabled = state.completed;
    document.getElementById('guess-input').disabled = state.completed;
}

function makeGuess() {
    var input = document.getElementById('guess-input');
    var guess = input.value.trim();
    if (!guess) return;
    var player = PLAYERS[currentDay - 1];
    if (!player) return;
    var state = getGameState(currentDay);
    if (state.completed) return;

    var result = checkAnswer(guess, player.accepted);

    if (result === 'exact' || result === 'close') {
        state.completed = true; state.won = true;
        state.score = MAX_GUESSES - state.wrongGuesses.length;
        // The clue they were viewing when they solved it turns green
        state.results[state.viewIndex] = 'correct';
        renderCard(player);
        renderClueNav(player, state);
        document.getElementById('quiz-card').classList.add('celebrate');
        showFeedback('correct', result === 'close' ? 'Close enough! It\'s ' + player.name + '!' : 'Correct! It\'s ' + player.name + '!');
        showAnswerReveal(true, player.name);
        setTimeout(function() { showResult(true, state.score, player); }, 2000);
        document.getElementById('guess-area').style.display = 'none';
        document.getElementById('next-clue-btn').classList.add('hidden');
        launchConfetti();
        saveGameStates(); renderPicker();
    } else {
        state.wrongGuesses.push(guess);
        var wc = state.wrongGuesses.length;
        // Mark the furthest-unlocked clue as a wrong guess
        state.results[state.revealedCount - 1] = 'wrong';
        var card = document.getElementById('quiz-card');
        card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');

        if (wc >= MAX_GUESSES) {
            state.completed = true; state.won = false; state.score = 0;
            renderCard(player); renderClueNav(player, state);
            showFeedback('wrong', 'Not quite!');
            showAnswerReveal(false, player.name);
            document.getElementById('guess-area').style.display = 'none';
            document.getElementById('next-clue-btn').classList.add('hidden');
            setTimeout(function() { showResult(false, 0, player); }, 2000);
        } else {
            // Unlock the next clue and auto-advance to it
            if (state.revealedCount < player.clues.length) state.revealedCount++;
            state.viewIndex = state.revealedCount - 1;
            state.clueIndex = state.viewIndex;
            renderClues(player, state.viewIndex);
            renderClueNav(player, state);
            showFeedback('wrong', 'Not right - here\'s your next clue!');
            updateNextClueBtn(state, player);
        }
        saveGameStates(); renderPicker();
    }
    input.value = '';
}

function skipClue() {
    var player = PLAYERS[currentDay - 1];
    if (!player || !player.clues) return;
    var state = getGameState(currentDay);
    if (state.completed) return;

    // Skipping the current furthest clue: mark it 'skip' and count it as an attempt
    state.results[state.revealedCount - 1] = 'skip';
    state.wrongGuesses.push('(skipped)');
    var wc = state.wrongGuesses.length;

    if (wc >= MAX_GUESSES) {
        state.completed = true; state.won = false; state.score = 0;
        state.viewIndex = state.revealedCount - 1;
        renderCard(player); renderClueNav(player, state);
        renderClues(player, state.viewIndex);
        showFeedback('wrong', 'Not quite!');
        showAnswerReveal(false, player.name);
        document.getElementById('guess-area').style.display = 'none';
        document.getElementById('next-clue-btn').classList.add('hidden');
        setTimeout(function() { showResult(false, 0, player); }, 2000);
    } else {
        // Unlock the next clue and auto-advance to it
        if (state.revealedCount < player.clues.length) state.revealedCount++;
        state.viewIndex = state.revealedCount - 1;
        state.clueIndex = state.viewIndex;
        renderClues(player, state.viewIndex);
        renderClueNav(player, state);
        updateNextClueBtn(state, player);
    }
    saveGameStates(); renderPicker();
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
   NAVIGATION & PICKER
   ============================================ */

function goToPrevDay() {
    document.getElementById('result-overlay').classList.add('hidden');
    if (currentDay > 1) { loadDay(currentDay - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }
}

function goToNextDay() {
    document.getElementById('result-overlay').classList.add('hidden');
    if (currentDay < getMaxPlayableDay()) { loadDay(currentDay + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }
}

function openPicker() {
    document.getElementById('day-picker-overlay').classList.add('open');
    renderPicker();
}
function closePicker() {
    document.getElementById('day-picker-overlay').classList.remove('open');
}


/* ============================================
   CONFETTI
   ============================================ */

function launchConfetti() {
    var c = document.getElementById('confetti-container');
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
   COUNTDOWN (pre-launch)
   ============================================ */

function updateCountdown() {
    var now = new Date();
    var diff = START_DATE - now;
    if (diff <= 0) { init(); return; }
    var d = Math.floor(diff / 86400000);
    var h = Math.floor((diff % 86400000) / 3600000);
    var m = Math.floor((diff % 3600000) / 60000);
    var s = Math.floor((diff % 60000) / 1000);
    var el = document.getElementById('countdown-display');
    if (el) el.textContent = d + 'd ' + h + 'h ' + m + 'm ' + s + 's';
}


/* ============================================
   INIT
   ============================================ */

async function init() {
    await loadPlayerData();
    loadGameStates();
    var maxDay = getMaxPlayableDay();
    var params = new URLSearchParams(window.location.search);
    var reqDay = parseInt(params.get('day')) || 0;

    if (maxDay < 1) {
        document.getElementById('pre-launch-screen').classList.add('active');
        updateCountdown();
        setInterval(updateCountdown, 1000);
        return;
    }

    // Default to today's game
    var dayToShow = maxDay;
    if (reqDay >= 1 && reqDay <= maxDay) {
        dayToShow = reqDay;
    }

    loadDay(dayToShow);
}

/* Event listeners */
var openPickerBtn = document.getElementById('open-picker');
if (openPickerBtn) openPickerBtn.addEventListener('click', openPicker);
document.getElementById('day-picker-overlay').addEventListener('click', function(e) {
    if (e.target === document.getElementById('day-picker-overlay')) closePicker();
});
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closePicker();
});
var prevDayBtn = document.getElementById('prev-day');
if (prevDayBtn) prevDayBtn.addEventListener('click', function() {
    if (currentDay > 1) { loadDay(currentDay - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }
});
var nextDayBtn = document.getElementById('next-day');
if (nextDayBtn) nextDayBtn.addEventListener('click', function() {
    if (currentDay < getMaxPlayableDay()) { loadDay(currentDay + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }
});
document.getElementById('guess-btn').addEventListener('click', makeGuess);
document.getElementById('guess-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') makeGuess(); });
document.getElementById('next-clue-btn').addEventListener('click', skipClue);
document.getElementById('header-results-btn').addEventListener('click', function() {
    document.getElementById('result-overlay').classList.remove('hidden');
});

/* Carousel controls: arrows, and touch-swipe / mouse-drag on the track */
var carPrev = document.getElementById('carousel-prev');
var carNext = document.getElementById('carousel-next');
if (carPrev) carPrev.addEventListener('click', function() { goToSlide(carouselState.index - 1); });
if (carNext) carNext.addEventListener('click', function() { goToSlide(carouselState.index + 1); });
(function() {
    var track = document.getElementById('carousel-track');
    if (!track) return;
    var startX = 0, curX = 0, dragging = false;
    var THRESHOLD = 40; // px of horizontal travel needed to change slide
    function start(x) { startX = curX = x; dragging = true; }
    function move(x) { if (dragging) curX = x; }
    function end() {
        if (!dragging) return;
        dragging = false;
        var dx = curX - startX;
        if (Math.abs(dx) > THRESHOLD) goToSlide(carouselState.index + (dx < 0 ? 1 : -1));
    }
    // Touch (mobile)
    track.addEventListener('touchstart', function(e) { start(e.touches[0].clientX); }, { passive: true });
    track.addEventListener('touchmove', function(e) { move(e.touches[0].clientX); }, { passive: true });
    track.addEventListener('touchend', end);
    // Mouse drag (desktop)
    track.addEventListener('mousedown', function(e) { start(e.clientX); e.preventDefault(); });
    window.addEventListener('mousemove', function(e) { move(e.clientX); });
    window.addEventListener('mouseup', end);
})();

/* Run init when DOM is ready (supports defer) */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
