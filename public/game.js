let currentUserId = null;
let currentStake = 10;
let ws = null;
let isRegistered = false;
const MAINTENANCE_MODE = false;

document.addEventListener('DOMContentLoaded', function() {
    initializeUserAndCheck();
    initializeBingoButton(); 
});

async function initializeUserAndCheck() {
    await initializeUserAsync();
    checkRegistrationAndProceed();
}

async function initializeUserAsync() {
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 5;
        
        function tryInitialize() {
            attempts++;
            
            try {
                // Debug: Log full URL and hash
                console.log('Full URL:', window.location.href);
                console.log('Search params:', window.location.search);
                console.log('Hash:', window.location.hash);
                console.log('Pathname:', window.location.pathname);
                
                const urlParams = new URLSearchParams(window.location.search);
                let startParam = null;
                let referralCode = null;

                const refCode = urlParams.get('ref');
                if (refCode) {
                    referralCode = refCode;
                    localStorage.setItem('referralCode', refCode);
                }

                const startappParam = urlParams.get('startapp');
                if (startappParam) {
                    startParam = startappParam;
                    const parsedRef = parseReferralCode(startappParam);
                    if (parsedRef) {
                        referralCode = parsedRef;
                        localStorage.setItem('referralCode', parsedRef);
                    }
                }

                // PRIORITY 0: Check URL path for user ID (e.g., /user/123456789)
                const pathMatch = window.location.pathname.match(/\/user\/(\d+)/);
                if (pathMatch && pathMatch[1]) {
                    currentUserId = parseInt(pathMatch[1]);
                    console.log('Telegram ID from path:', currentUserId);
                }

                // PRIORITY 1: Check URL parameter (fallback)
                if (!currentUserId) {
                    const tgIdFromUrl = urlParams.get('tg_id');
                    if (tgIdFromUrl) {
                        currentUserId = parseInt(tgIdFromUrl);
                        console.log('Telegram ID from URL param:', currentUserId);
                    }
                }

                // PRIORITY 2: Try Telegram WebApp
                if (window.Telegram && window.Telegram.WebApp) {
                    const tg = window.Telegram.WebApp;
                    tg.ready();
                    tg.expand();
                    
                    // Debug: Log all Telegram data
                    console.log('Telegram initData:', tg.initData);
                    console.log('Telegram initDataUnsafe:', JSON.stringify(tg.initDataUnsafe));
                    
                    if (tg.initDataUnsafe) {
                        if (tg.initDataUnsafe.start_param) {
                            startParam = tg.initDataUnsafe.start_param;
                            const parsedRef = parseReferralCode(startParam);
                            if (parsedRef) {
                                referralCode = parsedRef;
                                localStorage.setItem('referralCode', parsedRef);
                            }
                        }
                        
                        // Try to get user ID from Telegram WebApp
                        if (!currentUserId && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) {
                            currentUserId = tg.initDataUnsafe.user.id;
                            console.log('Telegram user ID from WebApp:', currentUserId);
                        }
                    }
                    
                    // PRIORITY 3: Parse hash for tgWebAppData
                    if (!currentUserId && window.location.hash) {
                        try {
                            const hashParams = new URLSearchParams(window.location.hash.substring(1));
                            const tgWebAppData = hashParams.get('tgWebAppData');
                            if (tgWebAppData) {
                                const webAppParams = new URLSearchParams(tgWebAppData);
                                const userJson = webAppParams.get('user');
                                if (userJson) {
                                    const user = JSON.parse(decodeURIComponent(userJson));
                                    if (user && user.id) {
                                        currentUserId = user.id;
                                        console.log('Telegram user ID from hash:', currentUserId);
                                    }
                                }
                            }
                        } catch (e) {
                            console.log('Hash parse error:', e);
                        }
                    }
                }
                
                if (currentUserId) {
                    console.log('User initialized successfully:', currentUserId);
                    if (startParam || referralCode) {
                        processReferral(currentUserId, startParam, referralCode);
                    }
                    resolve();
                } else if (attempts < maxAttempts) {
                    console.log(`User ID not found, retry ${attempts}/${maxAttempts}...`);
                    setTimeout(tryInitialize, 300);
                } else {
                    console.log('Max attempts reached, proceeding without user ID');
                    console.log('Debug - window.Telegram:', window.Telegram ? 'exists' : 'missing');
                    resolve();
                }
            } catch (error) {
                console.error('Error initializing user:', error);
                if (attempts < maxAttempts) {
                    setTimeout(tryInitialize, 300);
                } else {
                    resolve();
                }
            }
        }
        
        tryInitialize();
    });
}

async function checkRegistrationAndProceed() {
    if (!currentUserId) {
        showRegistrationRequired();
        return;
    }
    
    // Show maintenance screen if maintenance mode is enabled
    if (MAINTENANCE_MODE) {
        showMaintenanceScreen();
        return;
    }
    
    try {
        const response = await fetch(`/api/check-registration/${currentUserId}`);
        const data = await response.json();
        
        if (data.registered) {
            isRegistered = true;
            hideRegistrationRequired();
            loadWallet();
            initializeWebSocket();
            initializeLandingScreen();
            initializeFooterNavigation();
            checkAdminStatus();
            
            // Handle hash-based navigation (from Telegram bot buttons)
            setTimeout(() => {
                const hash = window.location.hash.substring(1);
                console.log('Hash detected:', hash);
                if (hash === 'wallet') {
                    const walletBtn = document.querySelector('[data-target="wallet"]');
                    if (walletBtn) walletBtn.click();
                } else if (hash === 'profile') {
                    const profileBtn = document.querySelector('[data-target="profile"]');
                    if (profileBtn) profileBtn.click();
                }
            }, 500);
        } else {
            showRegistrationRequired();
        }
    } catch (error) {
        console.error('Error checking registration:', error);
        showRegistrationRequired();
    }
}

function showRegistrationRequired() {
    const landingScreen = document.getElementById('landing-screen');
    const selectionScreen = document.getElementById('selection-screen');
    const gameScreen = document.getElementById('game-screen');
    const profileScreen = document.getElementById('profile-screen');
    
    if (landingScreen) landingScreen.style.display = 'none';
    if (selectionScreen) selectionScreen.style.display = 'none';
    if (gameScreen) gameScreen.style.display = 'none';
    if (profileScreen) profileScreen.style.display = 'none';
    
    let regScreen = document.getElementById('registration-required-screen');
    if (!regScreen) {
        regScreen = document.createElement('div');
        regScreen.id = 'registration-required-screen';
        regScreen.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 9999;';
        regScreen.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; text-align: center; padding: 20px;">
                <h1 style="font-size: 2em; margin-bottom: 20px;">🎰 Edele Bingo</h1>
                <div style="background: rgba(255,255,255,0.1); padding: 30px; border-radius: 15px; max-width: 300px;">
                    <p style="font-size: 1.2em; margin-bottom: 20px;">⚠️ አልተመዘገቡም</p>
                    <p style="margin-bottom: 20px;">ይህን ጨዋታ ለመጫወት መጀመሪያ መመዝገብ አለብዎት።</p>
                    <p style="margin-bottom: 20px;">እባክዎ ወደ Telegram ቦት ተመልሰው <strong>"📱 Register"</strong> ቁልፍን ይጫኑ።</p>
                    <p style="font-size: 0.9em; color: #aaa;">ከተመዘገቡ በኋላ 10 ብር ቦነስ ያገኛሉ! 🎁</p>
                </div>
            </div>
        `;
        document.body.appendChild(regScreen);
    }
    regScreen.style.display = 'block';
}

function hideRegistrationRequired() {
    const regScreen = document.getElementById('registration-required-screen');
    if (regScreen) {
        regScreen.style.display = 'none';
    }
}

function showMaintenanceScreen() {
    const landingScreen = document.getElementById('landing-screen');
    const selectionScreen = document.getElementById('selection-screen');
    const gameScreen = document.getElementById('game-screen');
    const profileScreen = document.getElementById('profile-screen');
    const maintenanceScreen = document.getElementById('maintenance-screen');
    
    if (landingScreen) landingScreen.style.display = 'none';
    if (selectionScreen) selectionScreen.style.display = 'none';
    if (gameScreen) gameScreen.style.display = 'none';
    if (profileScreen) profileScreen.style.display = 'none';
    if (maintenanceScreen) maintenanceScreen.style.display = 'flex';
}

function initializeAuthHandlers() {
    // Register form
    const registerBtn = document.getElementById('register-btn');
    if (registerBtn) {
        registerBtn.onclick = async () => {
            const username = document.getElementById('register-username')?.value.trim();
            const password = document.getElementById('register-password')?.value.trim();
            const confirmPassword = document.getElementById('register-confirm-password')?.value.trim();
            
            if (!username || !password || !confirmPassword) {
                alert('ሁሉም መስኮች ሙሉ ማድረግ አለበት');
                return;
            }
            
            if (password !== confirmPassword) {
                alert('ይለፍ ቃል አይስማማም');
                return;
            }
            
            try {
                const res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                
                if (data.token) {
                    localStorage.setItem('token', data.token);
                    currentUserId = data.user.id;
                    isRegistered = true;
                    hideRegistrationRequired();
                    loadWallet();
                    initializeWebSocket();
                    initializeLandingScreen();
                    initializeFooterNavigation();
                    checkAdminStatus();
                    alert('✅ በሳካ ተመዘገቡ!');
                } else {
                    alert(data.error || 'ቆርጠህ ተመዝገብ ሙከራ');
                }
            } catch (err) {
                console.error('Registration error:', err);
                alert('ብርሳ፣ አንድ ችግር ተከስቷል');
            }
        };
    }
    
    // Login form
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.onclick = async () => {
            const username = document.getElementById('login-username')?.value.trim();
            const password = document.getElementById('login-password')?.value.trim();
            
            if (!username || !password) {
                alert('መስተሪ ስም እና ይለፍ ቃል አስፈላጊ');
                return;
            }
            
            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                
                if (data.token) {
                    localStorage.setItem('token', data.token);
                    currentUserId = data.user.id;
                    isRegistered = true;
                    hideRegistrationRequired();
                    loadWallet();
                    initializeWebSocket();
                    initializeLandingScreen();
                    initializeFooterNavigation();
                    checkAdminStatus();
                    alert('✅ በሳካ ገባሉ!');
                } else {
                    alert(data.error || 'ውጉባዊ መስተሪ ስም ወይም ይለፍ ቃል');
                }
            } catch (err) {
                console.error('Login error:', err);
                alert('ብርሳ፣ አንድ ችግር ተከስቷል');
            }
        };
    }
    
    // Switch to register form
    const showRegisterLink = document.getElementById('show-register');
    if (showRegisterLink) {
        showRegisterLink.onclick = (e) => {
            e.preventDefault();
            document.getElementById('login-form').style.display = 'none';
            document.getElementById('register-form').style.display = 'block';
        };
    }
    
    // Switch to login form
    const showLoginLink = document.getElementById('show-login');
    if (showLoginLink) {
        showLoginLink.onclick = (e) => {
            e.preventDefault();
            document.getElementById('register-form').style.display = 'none';
            document.getElementById('login-form').style.display = 'block';
        };
    }
    
    // Close button
    const closeAuthBtn = document.getElementById('close-auth');
    if (closeAuthBtn) {
        closeAuthBtn.onclick = () => {
            const authScreen = document.getElementById('auth-screen');
            if (authScreen) authScreen.style.display = 'none';
        };
    }
}

function initializeFooterNavigation() {
    const footerButtons = document.querySelectorAll('.footer-btn');
    
    footerButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const target = this.dataset.target;
            console.log('Footer clicked:', target);
            
            document.querySelectorAll('.footer-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            const landingScreen = document.getElementById('landing-screen');
            const selectionScreen = document.getElementById('selection-screen');
            const profileScreen = document.getElementById('profile-screen');
            const gameScreen = document.getElementById('game-screen');
            const adminScreen = document.getElementById('admin-screen');
            const walletScreen = document.getElementById('wallet-screen');
            
            if (landingScreen) landingScreen.style.display = 'none';
            if (selectionScreen) selectionScreen.style.display = 'none';
            if (profileScreen) profileScreen.style.display = 'none';
            if (gameScreen) gameScreen.style.display = 'none';
            if (adminScreen) adminScreen.style.display = 'none';
            if (walletScreen) walletScreen.style.display = 'none';
            
            if (target === 'game') {
                if (landingScreen) {
                    landingScreen.style.display = 'flex';
                    console.log('Game screen shown');
                }
            } else if (target === 'wallet') {
                if (walletScreen) {
                    walletScreen.style.display = 'flex';
                    walletScreen.style.visibility = 'visible';
                    walletScreen.style.opacity = '1';
                    console.log('Wallet screen shown');
                    loadWalletData();
                }
            } else if (target === 'profile') {
                if (profileScreen) {
                    profileScreen.style.display = 'flex';
                    console.log('Profile screen shown');
                    loadProfile();
                }
            } else if (target === 'admin') {
                if (adminScreen) {
                    adminScreen.style.display = 'flex';
                    console.log('Admin screen shown');
                    loadAdminData();
                }
            }
        });
    });
    
    const profileRefreshBtn = document.getElementById('profile-refresh-btn');
    if (profileRefreshBtn) {
        profileRefreshBtn.addEventListener('click', loadProfile);
    }
    
    initializeWallet();
}

async function loadProfile() {
    if (!currentUserId) {
        console.log('No user ID for profile');
        return;
    }
    
    try {
        const response = await fetch(`/api/profile/${currentUserId}`);
        const data = await response.json();
        
        if (data.success && data.profile) {
            const profile = data.profile;
            
            const avatarLetter = document.getElementById('profile-avatar-letter');
            if (avatarLetter) {
                avatarLetter.textContent = (profile.username || 'P').charAt(0).toUpperCase();
            }
            
            const usernameEl = document.getElementById('profile-username');
            if (usernameEl) usernameEl.textContent = profile.username || '---';
            
            const telegramIdEl = document.getElementById('profile-telegram-id');
            if (telegramIdEl) telegramIdEl.textContent = profile.telegramId || '---';
            
            const phoneEl = document.getElementById('profile-phone');
            if (phoneEl) phoneEl.textContent = profile.phoneNumber || '---';
            
            const balanceEl = document.getElementById('profile-balance');
            if (balanceEl) balanceEl.textContent = `${parseFloat(profile.balance).toFixed(2)} ETB`;
            
            const gamesEl = document.getElementById('profile-total-games');
            if (gamesEl) gamesEl.textContent = profile.totalGames || 0;
            
            const winsEl = document.getElementById('profile-wins');
            if (winsEl) winsEl.textContent = profile.wins || 0;
            
            // Display referral code or link
            const referralCodeEl = document.getElementById('profile-referral-code');
            const copyBtn = document.getElementById('copy-referral-btn');
            
            if (profile.referralLink) {
                // Show full referral link
                if (referralCodeEl) {
                    referralCodeEl.textContent = profile.referralLink;
                }
                if (copyBtn) {
                    copyBtn.onclick = () => {
                        navigator.clipboard.writeText(profile.referralLink).then(() => {
                            copyBtn.textContent = 'ተኮፒዋል!';
                            setTimeout(() => {
                                copyBtn.textContent = 'ቅዳ';
                            }, 2000);
                        });
                    };
                }
            }
        }
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

function processReferral(userId, startParam, referralCode) {
    console.log('Processing referral for user:', userId, 'code:', referralCode || startParam);
}

function parseReferralCode(code) {
    if (!code) return null;
    if (code.startsWith('ref_')) {
        return code.substring(4);
    }
    return code;
}

function parseReferralFromStartParam(param) {
    if (!param) return null;
    if (param.startsWith(' ')) {
        return param.substring(1);
    }
    return param;
}

// Bingo button functionality
function initializeBingoButton() {
    const bingoBtn = document.getElementById('bingo-btn');
    if (bingoBtn) {
        bingoBtn.addEventListener('click', function() {
            claimBingo();
        });
    }
    
    const exitBtn = document.getElementById('exit-btn');
    if (exitBtn) {
        exitBtn.addEventListener('click', function() {
            const gameScreen = document.getElementById('game-screen');
            const landingScreen = document.getElementById('landing-screen');
            if (gameScreen) gameScreen.style.display = 'none';
            if (landingScreen) landingScreen.style.display = 'flex';
        });
    }
}

let selectedCardId = null;
let markedNumbers = new Set();
let takenCards = new Set();

function initializeWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onmessage = (event) => {
        handleGameMessage(JSON.parse(event.data));
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
    
    ws.onclose = () => {
        console.log('WebSocket closed, reconnecting...');
        setTimeout(initializeWebSocket, 3000);
    };
}

function initializeLandingScreen() {
    const playBtn = document.getElementById('start-selection-btn');
    if (playBtn) {
        playBtn.addEventListener('click', joinGame);
    }
}

async function joinGame() {
    if (!currentUserId) {
        alert('User ID not found');
        return;
    }
    
    try {
        const response = await fetch(`/api/games/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUserId,
                stake: currentStake
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            selectedCardId = null;
            markedNumbers.clear();
            const selectionScreen = document.getElementById('selection-screen');
            const landingScreen = document.getElementById('landing-screen');
            if (selectionScreen) selectionScreen.style.display = 'flex';
            if (landingScreen) landingScreen.style.display = 'none';
            generateCardSelection();
        } else {
            alert(data.message || 'Failed to join game');
        }
    } catch (error) {
        console.error('Error joining game:', error);
        alert('Error joining game');
    }
}

function generateCardSelection() {
    const container = document.getElementById('card-selection-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    for (let i = 1; i <= 6; i++) {
        const btn = document.createElement('button');
        btn.className = 'card-btn';
        btn.textContent = `ካርድ ${i}`;
        btn.data = { cardId: i };
        btn.onclick = () => selectCard(i);
        container.appendChild(btn);
    }
}

function selectCard(cardId) {
    selectedCardId = cardId;
    const confirmBtn = document.getElementById('confirm-card-btn');
    if (confirmBtn) confirmBtn.disabled = false;
}

async function confirmCard() {
    if (!selectedCardId || !currentUserId) return;
    
    try {
        const response = await fetch(`/api/games/confirm-card`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUserId,
                cardId: selectedCardId
            })
        });
        
        const data = await response.json();
        if (!data.success) {
            alert(data.message || 'Failed to confirm card');
        }
    } catch (error) {
        console.error('Error confirming card:', error);
    }
}

function handleGameMessage(data) {
    switch(data.type) {
        case 'game_state':
            if (data.phase === 'selection') {
                const selectionScreen = document.getElementById('selection-screen');
                if (selectionScreen) selectionScreen.style.display = 'flex';
            }
            break;
        case 'number_called':
            console.log('Number called:', data.letter + data.number);
            displayCalledNumber(data.letter, data.number);
            markCalledNumber(data.number);
            markMasterNumber(data.number);
            break;
        case 'timer_update':
            updateTimerDisplay(data.timeLeft);
            updatePhaseDisplay(data.phase);
            if (data.playerCount !== undefined) {
                updatePlayerCountDisplay(data.playerCount);
            }
            if (data.prizeAmount !== undefined) {
                updatePrizePoolDisplay(data.prizeAmount);
            }
            break;
        case 'card_selected':
            // Mark card as taken
            if (data.cardId && !takenCards.has(data.cardId)) {
                takenCards.add(data.cardId);
                const cardBtn = document.querySelector(`[data-card-id="${data.cardId}"]`);
                if (cardBtn) {
                    cardBtn.classList.add('taken');
                    cardBtn.style.backgroundColor = '#ff4757';
                }
            }
            break;
        case 'error':
            alert(data.error || 'ችግር ተፈጥሯል');
            break;
        case 'bingo_rejected':
            alert(data.error || 'ቢንጎ ትክክል አይደለም');
            break;
    }
}

function displayCalledNumber(letter, number) {
    const callHistoryEl = document.getElementById('call-history');
    if (callHistoryEl) {
        const item = document.createElement('div');
        item.className = 'call-history-item';
        item.textContent = `${letter}${number}`;
        callHistoryEl.appendChild(item);
    }
}

function markCalledNumber(number) {
    markedNumbers.add(number);
    const playerCells = document.querySelectorAll('.player-card-cell');
    playerCells.forEach(cell => {
        if (cell.textContent.includes(number)) {
            cell.classList.add('called');
            cell.classList.add('marked');
        }
    });
}

function markMasterNumber(number) {
    const masterCells = document.querySelectorAll('.master-grid-cell');
    masterCells.forEach(cell => {
        if (parseInt(cell.textContent) === number) {
            cell.classList.add('called');
        }
    });
}

function updateTimerDisplay(timeLeft) {
    const timerEl = document.getElementById('time-left');
    if (timerEl) {
        timerEl.textContent = `${timeLeft}s`;
    }
}

function updatePhaseDisplay(phase) {
    const phaseEl = document.getElementById('current-phase');
    if (phaseEl) {
        const phaseText = {
            'selection': 'ካርድ መምረጫ',
            'game': 'ጨዋታ በሂደት ላይ',
            'winner': 'ዝግጅት'
        };
        phaseEl.textContent = phaseText[phase] || phase;
    }
}

function updatePlayerCountDisplay(count) {
    const playerCountEl = document.getElementById('player-count');
    if (playerCountEl) {
        playerCountEl.textContent = count;
    }
}

function updatePrizePoolDisplay(amount) {
    const prizePoolEl = document.getElementById('prize-pool');
    if (prizePoolEl) {
        prizePoolEl.textContent = `${amount} ብር`;
    }
}

function clearCallHistory() {
    const callHistoryEl = document.getElementById('call-history');
    if (callHistoryEl) {
        callHistoryEl.innerHTML = '';
    }
}

function clearMasterGrid() {
    const masterGridEl = document.getElementById('master-grid');
    if (masterGridEl) {
        masterGridEl.innerHTML = '';
    }
}

function renderMasterGrid() {
    const masterGrid = document.getElementById('master-grid');
    if (!masterGrid) return;
    
    masterGrid.innerHTML = '';
    const letters = ['B', 'I', 'N', 'G', 'O'];
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'master-grid-cell';
        cell.textContent = Math.floor(Math.random() * 75) + 1;
        masterGrid.appendChild(cell);
    }
}

function renderPlayerCard(cardId) {
    const playerCard = document.getElementById('player-card');
    if (!playerCard) return;
    
    playerCard.innerHTML = '';
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'player-card-cell';
        cell.textContent = Math.floor(Math.random() * 75) + 1;
        playerCard.appendChild(cell);
    }
}

async function claimBingo() {
    if (!currentUserId || !selectedCardId) {
        alert('Invalid game state');
        return;
    }
    
    try {
        const response = await fetch(`/api/games/claim-bingo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUserId,
                cardId: selectedCardId
            })
        });
        
        const data = await response.json();
        if (data.success) {
            alert('🎉 ቢንጎ! ሽልማት አገኛሉ');
        } else {
            alert(data.message || 'ቢንጎ ይህ በአሁኑ ጊዜ ልክ ነው');
        }
    } catch (error) {
        console.error('Error claiming bingo:', error);
    }
}

let cachedWalletData = null;

async function loadWallet() {
    if (!currentUserId) {
        console.log('No user ID for wallet');
        return;
    }
    
    try {
        const response = await fetch(`/api/wallet/${currentUserId}`);
        const data = await response.json();
        
        if (data.success) {
            cachedWalletData = data.wallet;
            updateWalletUI();
        }
    } catch (error) {
        console.error('Error loading wallet:', error);
    }
}

function updateWalletUI() {
    if (!cachedWalletData) return;
    
    const mainWalletEl = document.getElementById('main-wallet-value');
    if (mainWalletEl) {
        mainWalletEl.textContent = `${parseFloat(cachedWalletData.balance).toFixed(2)} ETB`;
    }
}

function initializeWallet() {
    const depositBtn = document.getElementById('deposit-btn');
    if (depositBtn) {
        depositBtn.addEventListener('click', () => {
            const amount = prompt('ሚንት መጠን (ብር):');
            if (amount && !isNaN(amount)) {
                processDeposit(parseFloat(amount));
            }
        });
    }
}

async function processDeposit(amount) {
    if (!currentUserId) {
        alert('User not logged in');
        return;
    }
    
    try {
        const response = await fetch(`/api/deposits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUserId,
                amount: amount
            })
        });
        
        const data = await response.json();
        if (data.success) {
            alert('✅ ሚዲ ሰሌዳ ውል ላይ ተቀበለ');
            loadWallet();
        } else {
            alert(data.message || 'ሚንት ይህ በአሁኑ ጊዜ ሊሰር ወደ ሙከራ');
        }
    } catch (error) {
        console.error('Error processing deposit:', error);
    }
}

async function loadWalletData() {
    await loadWallet();
    
    if (!currentUserId) return;
    
    try {
        const response = await fetch(`/api/wallet/${currentUserId}`);
        const data = await response.json();
        
        if (data.success && data.wallet) {
            cachedWalletData = data.wallet;
            updateWalletUI();
            
            const transactionsContainer = document.getElementById('transactions-container');
            if (transactionsContainer && data.transactions) {
                transactionsContainer.innerHTML = data.transactions.map(tx => `
                    <div class="transaction-item">
                        <span>${tx.type}</span>
                        <span>${tx.amount} ETB</span>
                    </div>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Error loading wallet data:', error);
    }
}

async function checkAdminStatus() {
    if (!currentUserId) return;
    
    try {
        const response = await fetch(`/api/admin/check/${currentUserId}`);
        const data = await response.json();
        
        if (data.isAdmin) {
            const adminFooterBtn = document.querySelector('[data-target="admin"]');
            if (adminFooterBtn) {
                adminFooterBtn.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Error checking admin status:', error);
    }
}

async function loadAdminData() {
    if (!currentUserId) return;
    
    try {
        const depositsResponse = await fetch(`/api/admin/deposits`);
        const depositsData = await depositsResponse.json();
        
        const depositsContainer = document.getElementById('admin-deposits-container');
        if (depositsContainer && depositsData.deposits) {
            depositsContainer.innerHTML = depositsData.deposits.map(deposit => `
                <div class="admin-item">
                    <span>User ${deposit.userId}: ${deposit.amount} ETB</span>
                    <button onclick="approveDeposit(${deposit.id})">✓ Approve</button>
                    <button onclick="rejectDeposit(${deposit.id})">✗ Reject</button>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading admin data:', error);
    }
}

async function approveDeposit(depositId) {
    try {
        const response = await fetch(`/api/admin/deposits/${depositId}/approve`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            alert('✓ Deposit approved');
            loadAdminData();
        }
    } catch (error) {
        console.error('Error approving deposit:', error);
    }
}

async function rejectDeposit(depositId) {
    try {
        const response = await fetch(`/api/admin/deposits/${depositId}/reject`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            alert('✗ Deposit rejected');
            loadAdminData();
        }
    } catch (error) {
        console.error('Error rejecting deposit:', error);
    }
}

async function approveWithdrawal(withdrawalId) {
    try {
        const response = await fetch(`/api/admin/withdrawals/${withdrawalId}/approve`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            alert('✓ Withdrawal approved');
            loadAdminData();
        }
    } catch (error) {
        console.error('Error approving withdrawal:', error);
    }
}

async function rejectWithdrawal(withdrawalId) {
    try {
        const response = await fetch(`/api/admin/withdrawals/${withdrawalId}/reject`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            alert('✗ Withdrawal rejected');
            loadAdminData();
        }
    } catch (error) {
        console.error('Error rejecting withdrawal:', error);
    }
}

function isBingo(cardData, markedNumbers) {
    // Check rows
    for (let row = 0; row < 5; row++) {
        let rowComplete = true;
        for (let col = 0; col < 5; col++) {
            const num = cardData[row][col];
            if (num === 0) continue; // Free space
            if (!markedNumbers.has(num)) {
                rowComplete = false;
                break;
            }
        }
        if (rowComplete) return true;
    }

    // Check columns
    for (let col = 0; col < 5; col++) {
        let colComplete = true;
        for (let row = 0; row < 5; row++) {
            const num = cardData[row][col];
            if (num === 0) continue; // Free space
            if (!markedNumbers.has(num)) {
                colComplete = false;
                break;
            }
        }
        if (colComplete) return true;
    }

    // Check diagonals (top-left to bottom-right)
    let diag1Complete = true;
    for (let i = 0; i < 5; i++) {
        const num = cardData[i][i];
        if (num === 0) continue; // Free space
        if (!markedNumbers.has(num)) {
            diag1Complete = false;
            break;
        }
    }
    if (diag1Complete) return true;

    // Check diagonals (top-right to bottom-left)
    let diag2Complete = true;
    for (let i = 0; i < 5; i++) {
        const num = cardData[i][4 - i];
        if (num === 0) continue; // Free space
        if (!markedNumbers.has(num)) {
            diag2Complete = false;
            break;
        }
    }
    if (diag2Complete) return true;
    
    return false;
}
