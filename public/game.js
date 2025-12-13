let currentUserId = null;
let currentStake = 10;
let ws = null;
let isRegistered = false;

document.addEventListener('DOMContentLoaded', function() {
    initializeUser();
    checkRegistrationAndProceed();
});

async function checkRegistrationAndProceed() {
    if (!currentUserId) {
        showRegistrationRequired();
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
                <h1 style="font-size: 2em; margin-bottom: 20px;">🎰 ችዋታቢንጎ</h1>
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

function initializeFooterNavigation() {
    const footerButtons = document.querySelectorAll('.footer-btn');
    
    footerButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const target = this.dataset.target;
            
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
                if (landingScreen) landingScreen.style.display = 'flex';
            } else if (target === 'wallet') {
                if (walletScreen) walletScreen.style.display = 'flex';
                loadWalletData();
            } else if (target === 'profile') {
                if (profileScreen) profileScreen.style.display = 'flex';
                loadProfile();
            } else if (target === 'admin') {
                if (adminScreen) adminScreen.style.display = 'flex';
                loadAdminData();
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
        }
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

function initializeLandingScreen() {
    const landingScreen = document.getElementById('landing-screen');
    const selectionScreen = document.getElementById('selection-screen');
    const gameScreen = document.getElementById('game-screen');
    const startBtn = document.getElementById('start-selection-btn');
    const stakeButtons = document.querySelectorAll('.stake-btn');
    
    stakeButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const stake = parseInt(this.dataset.stake);
            currentStake = stake;
            window.currentStake = stake;
            
            stakeButtons.forEach(b => b.classList.remove('active-stake'));
            this.classList.add('active-stake');
            
            if (startBtn) {
                startBtn.textContent = `▷ Play ${stake} ETB`;
            }
            
            const currentStakeDisplay = document.getElementById('current-stake');
            if (currentStakeDisplay) {
                currentStakeDisplay.textContent = stake;
            }
        });
    });
    
    if (startBtn) {
        startBtn.addEventListener('click', function() {
            if (landingScreen) landingScreen.style.display = 'none';
            if (selectionScreen) selectionScreen.style.display = 'flex';
            
            generateCardSelection();
        });
    }
    
    const confirmCardBtn = document.getElementById('confirm-card-btn');
    if (confirmCardBtn) {
        confirmCardBtn.addEventListener('click', async function() {
            if (selectedCardId) {
                const result = await handleCardConfirmation(selectedCardId);
                if (result.success) {
                    if (selectionScreen) selectionScreen.style.display = 'none';
                    if (gameScreen) gameScreen.style.display = 'flex';
                    renderPlayerCard(selectedCardId);
                } else {
                    alert(result.message || 'ካርድ ለማረጋገጥ አልተቻለም');
                }
            }
        });
    }
}

let selectedCardId = null;
let previewCardId = null;

function generateCardSelection() {
    const grid = document.getElementById('card-selection-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    for (let cardId = 1; cardId <= 100; cardId++) {
        const cardElement = document.createElement('div');
        cardElement.className = 'card-number-btn';
        cardElement.dataset.cardId = cardId;
        cardElement.textContent = cardId;
        
        cardElement.addEventListener('click', function() {
            showCardPreview(cardId);
        });
        
        grid.appendChild(cardElement);
    }
}

function showCardPreview(cardId) {
    previewCardId = cardId;
    const modal = document.getElementById('card-preview-modal');
    const previewGrid = document.getElementById('preview-card-grid');
    const previewTitle = document.getElementById('preview-card-title');
    
    if (!modal || !previewGrid) return;
    
    const cardData = BINGO_CARDS[cardId];
    if (!cardData) return;
    
    previewTitle.textContent = `ካርድ #${cardId}`;
    previewGrid.innerHTML = '';
    
    cardData.forEach((row, rowIndex) => {
        row.forEach((num, colIndex) => {
            const cell = document.createElement('div');
            cell.className = 'preview-cell';
            
            if (rowIndex === 2 && colIndex === 2) {
                cell.classList.add('free-space');
                cell.textContent = '★';
            } else {
                cell.textContent = num;
            }
            
            previewGrid.appendChild(cell);
        });
    });
    
    modal.style.display = 'flex';
}

function hideCardPreview() {
    const modal = document.getElementById('card-preview-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    previewCardId = null;
}

function confirmPreviewCard() {
    if (previewCardId) {
        selectedCardId = previewCardId;
        
        document.querySelectorAll('.card-number-btn').forEach(btn => {
            btn.classList.remove('selected');
            if (parseInt(btn.dataset.cardId) === selectedCardId) {
                btn.classList.add('selected');
            }
        });
        
        const confirmBtn = document.getElementById('confirm-card-btn');
        if (confirmBtn) {
            confirmBtn.disabled = false;
        }
        
        const status = document.getElementById('confirmation-status');
        if (status) {
            status.textContent = `ካርድ #${selectedCardId} ተመርጧል`;
        }
        
        hideCardPreview();
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const backBtn = document.getElementById('preview-back-btn');
    const confirmPreviewBtn = document.getElementById('preview-confirm-btn');
    
    if (backBtn) {
        backBtn.addEventListener('click', hideCardPreview);
    }
    
    if (confirmPreviewBtn) {
        confirmPreviewBtn.addEventListener('click', confirmPreviewCard);
    }
});

function renderPlayerCard(cardId) {
    const cardContainer = document.getElementById('player-bingo-card');
    if (!cardContainer) return;
    
    const cardData = BINGO_CARDS[cardId];
    if (!cardData) return;
    
    cardContainer.innerHTML = '';
    
    cardData.forEach((row, rowIndex) => {
        row.forEach((num, colIndex) => {
            const cell = document.createElement('div');
            cell.className = 'player-card-cell';
            cell.dataset.number = num;
            
            if (rowIndex === 2 && colIndex === 2) {
                cell.classList.add('free-space', 'marked');
                cell.textContent = '★';
            } else {
                cell.textContent = num;
            }
            
            cell.addEventListener('click', function() {
                if (num !== 0) {
                    this.classList.toggle('marked');
                }
            });
            
            cardContainer.appendChild(cell);
        });
    });
}

function initializeUser() {
    try {
        if (window.Telegram && window.Telegram.WebApp) {
            const tg = window.Telegram.WebApp;
            tg.ready();
            tg.expand();
            
            if (tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) {
                currentUserId = tg.initDataUnsafe.user.id;
                console.log('Telegram user ID:', currentUserId);
            } else {
                const urlParams = new URLSearchParams(window.location.search);
                const tgId = urlParams.get('tg_id');
                if (tgId) {
                    currentUserId = parseInt(tgId);
                    console.log('Telegram ID from URL:', currentUserId);
                } else {
                    currentUserId = null;
                    console.log('No Telegram user ID available');
                }
            }
        } else {
            const urlParams = new URLSearchParams(window.location.search);
            const tgId = urlParams.get('tg_id');
            if (tgId) {
                currentUserId = parseInt(tgId);
                console.log('Telegram ID from URL:', currentUserId);
            } else {
                currentUserId = null;
                console.log('Telegram WebApp not available');
            }
        }
    } catch (error) {
        console.error('Error initializing user:', error);
        currentUserId = null;
    }
}

async function loadWallet() {
    if (!currentUserId) {
        console.log('No user ID, skipping wallet load');
        updateWalletDisplay(0);
        return;
    }
    
    try {
        const response = await fetch(`/api/wallet/${currentUserId}`);
        const data = await response.json();
        
        updateWalletDisplay(data.balance);
        
        if (data.stake) {
            currentStake = data.stake;
        }
        
        console.log('Wallet loaded:', data);
    } catch (error) {
        console.error('Error loading wallet:', error);
        updateWalletDisplay(0);
    }
}

function updateWalletDisplay(balance) {
    const walletElement = document.getElementById('main-wallet-value');
    if (walletElement) {
        walletElement.textContent = parseFloat(balance).toFixed(2);
    }
}

function initializeWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = function() {
        console.log('WebSocket connected');
        if (currentUserId && currentUserId !== 999999) {
            ws.send(JSON.stringify({
                type: 'auth_telegram',
                telegramId: currentUserId.toString(),
                username: 'Player_' + currentUserId
            }));
        }
    };
    
    ws.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };
    
    ws.onclose = function() {
        console.log('WebSocket disconnected');
        setTimeout(initializeWebSocket, 3000);
    };
    
    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'init':
            console.log('Game initialized:', data);
            updateTimerDisplay(data.timeLeft);
            updatePhaseDisplay(data.phase);
            renderMasterGrid();
            if (data.calledNumbers && data.calledNumbers.length > 0) {
                data.calledNumbers.forEach(num => {
                    markCalledNumber(num);
                    markMasterNumber(num);
                });
            }
            break;
        case 'auth_success':
            console.log('Authentication successful:', data.user);
            if (data.user && data.user.balance !== undefined) {
                updateWalletDisplay(data.user.balance);
            }
            break;
        case 'balance_update':
            updateWalletDisplay(data.balance);
            break;
        case 'card_confirmed':
            updateWalletDisplay(data.balance);
            renderMasterGrid();
            break;
        case 'phase_change':
            console.log('Phase changed:', data.phase);
            updatePhaseDisplay(data.phase);
            handlePhaseChange(data);
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
            break;
        case 'error':
            alert(data.error || 'ችግር ተፈጥሯል');
            break;
        case 'bingo_rejected':
            alert(data.error || 'ቢንጎ ትክክል አይደለም');
            break;
        default:
            console.log('Unknown message type:', data.type);
    }
}

let calledNumbersSet = new Set();

function handlePhaseChange(data) {
    const gameScreen = document.getElementById('game-screen');
    const selectionScreen = document.getElementById('selection-screen');
    const landingScreen = document.getElementById('landing-screen');
    
    if (data.phase === 'selection') {
        // Clear previous game data
        clearCallHistory();
        clearMasterGrid();
        calledNumbersSet.clear();
        selectedCardId = null;
        
        // Clear player card marks
        const playerCells = document.querySelectorAll('.player-card-cell');
        playerCells.forEach(cell => cell.classList.remove('called', 'marked'));
        
        // If on game screen, go back to selection
        if (gameScreen && gameScreen.style.display === 'flex') {
            gameScreen.style.display = 'none';
            if (selectionScreen) {
                selectionScreen.style.display = 'flex';
            }
        }
        
        // Always regenerate cards in selection screen
        if (selectionScreen) {
            generateCardSelection();
        }
        
        // Reset confirm button
        const confirmBtn = document.getElementById('confirm-card-btn');
        if (confirmBtn) confirmBtn.disabled = true;
    } else if (data.phase === 'game') {
        // Game is starting
        renderMasterGrid();
    } else if (data.phase === 'winner') {
        if (data.winner) {
            showWinnerDisplay(data.winner);
        }
    }
}

function showWinnerDisplay(winner) {
    const message = `🎉 አሸናፊ: ${winner.username}\nካርድ: #${winner.cardId}${winner.prize ? '\nሽልማት: ' + winner.prize + ' ብር' : ''}`;
    alert(message);
}

function renderMasterGrid() {
    const masterGrid = document.getElementById('master-grid');
    if (!masterGrid) return;
    
    masterGrid.innerHTML = '';
    
    // Create 5 columns x 15 rows (75 numbers)
    for (let row = 0; row < 15; row++) {
        for (let col = 0; col < 5; col++) {
            const num = col * 15 + row + 1;
            const cell = document.createElement('div');
            cell.className = 'master-cell';
            cell.dataset.number = num;
            cell.textContent = num;
            masterGrid.appendChild(cell);
        }
    }
}

function markMasterNumber(number) {
    const masterGrid = document.getElementById('master-grid');
    if (!masterGrid) return;
    
    const cells = masterGrid.querySelectorAll('.master-cell');
    cells.forEach(cell => {
        if (parseInt(cell.dataset.number) === number) {
            cell.classList.add('called');
        }
    });
}

function clearMasterGrid() {
    const masterGrid = document.getElementById('master-grid');
    if (!masterGrid) return;
    
    const cells = masterGrid.querySelectorAll('.master-cell');
    cells.forEach(cell => cell.classList.remove('called'));
}

function clearCallHistory() {
    const historyElement = document.getElementById('call-history');
    if (historyElement) {
        historyElement.innerHTML = '';
    }
    
    const letterElement = document.getElementById('call-letter');
    const numberElement = document.getElementById('call-number');
    if (letterElement) letterElement.textContent = '';
    if (numberElement) numberElement.textContent = '--';
}

function updateTimerDisplay(timeLeft) {
    const timerElement = document.getElementById('time-left');
    if (timerElement) {
        timerElement.textContent = timeLeft + 's';
    }
}

function updatePhaseDisplay(phase) {
    const phaseElement = document.getElementById('game-phase');
    if (phaseElement) {
        if (phase === 'selection') {
            phaseElement.textContent = 'ካርድ ይምረጡ';
        } else if (phase === 'game') {
            phaseElement.textContent = 'ጨዋታ በሂደት ላይ';
        } else if (phase === 'winner') {
            phaseElement.textContent = 'አሸናፊ!';
        }
    }
}

function displayCalledNumber(letter, number) {
    const letterElement = document.getElementById('call-letter');
    const numberElement = document.getElementById('call-number');
    
    if (letterElement) {
        letterElement.textContent = letter;
    }
    if (numberElement) {
        numberElement.textContent = number;
    }
    
    const callCircle = document.getElementById('current-call');
    if (callCircle) {
        callCircle.classList.add('new-call');
        setTimeout(() => callCircle.classList.remove('new-call'), 500);
    }
    
    // Add to call history (limit to 3)
    const historyElement = document.getElementById('call-history');
    if (historyElement) {
        const callItem = document.createElement('span');
        callItem.className = 'history-call';
        callItem.textContent = letter + number;
        historyElement.insertBefore(callItem, historyElement.firstChild);
        
        // Keep only last 3 calls
        while (historyElement.children.length > 3) {
            historyElement.removeChild(historyElement.lastChild);
        }
    }
}

function markCalledNumber(number) {
    calledNumbersSet.add(number);
    
    const cells = document.querySelectorAll('.player-card-cell');
    cells.forEach(cell => {
        if (parseInt(cell.dataset.number) === number) {
            cell.classList.add('called');
        }
    });
}

async function handleCardConfirmation(cardId) {
    if (!currentUserId) {
        console.error('User not initialized');
        return { success: false, message: 'እባክዎ መጀመሪያ ከቴሌግራም ቦት ይመዝገቡ' };
    }
    
    try {
        const response = await fetch('/api/bet', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: currentUserId,
                stakeAmount: currentStake
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            updateWalletDisplay(result.balance);
            
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'confirm_card',
                    cardId: cardId
                }));
            }
        }
        
        return result;
    } catch (error) {
        console.error('Error placing bet:', error);
        return { success: false, message: 'Bet failed' };
    }
}

function refreshBalance() {
    loadWallet();
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
    
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            refreshBalance();
        });
    }
}

function claimBingo() {
    if (!selectedCardId) {
        alert('ካርድ አልመረጡም');
        return;
    }
    
    const isValid = checkBingo(selectedCardId);
    
    if (isValid) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'claim_bingo',
                cardId: selectedCardId,
                isValid: true
            }));
        }
    } else {
        alert('ቢንጎ የለዎትም። ሙሉ መስመር ይፈልጉ።');
    }
}

function checkBingo(cardId) {
    const cardData = BINGO_CARDS[cardId];
    if (!cardData) return false;
    
    // Only use server-called numbers (not manually marked cells)
    const markedNumbers = calledNumbersSet;
    
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
    
    // Check diagonals
    let diag1Complete = true;
    let diag2Complete = true;
    for (let i = 0; i < 5; i++) {
        const num1 = cardData[i][i];
        const num2 = cardData[i][4 - i];
        
        if (num1 !== 0 && !markedNumbers.has(num1)) diag1Complete = false;
        if (num2 !== 0 && !markedNumbers.has(num2)) diag2Complete = false;
    }
    
    if (diag1Complete || diag2Complete) return true;
    
    return false;
}

// Initialize Bingo button when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    initializeBingoButton();
});

window.currentUserId = currentUserId;
window.currentStake = currentStake;
window.handleCardConfirmation = handleCardConfirmation;
window.refreshBalance = refreshBalance;
window.claimBingo = claimBingo;

// ================================================
// Admin Panel Functions
// ================================================

let isAdmin = false;

async function checkAdminStatus() {
    if (!currentUserId) return false;
    
    try {
        const response = await fetch(`/api/check-admin/${currentUserId}`);
        const data = await response.json();
        isAdmin = data.isAdmin;
        
        if (isAdmin) {
            showAdminTab();
            initializeAdminPanel();
        }
        
        return isAdmin;
    } catch (error) {
        console.error('Error checking admin status:', error);
        return false;
    }
}

function showAdminTab() {
    const footers = document.querySelectorAll('.selection-footer');
    footers.forEach(footer => {
        if (!footer.querySelector('[data-target="admin"]')) {
            const adminBtn = document.createElement('div');
            adminBtn.className = 'footer-btn';
            adminBtn.dataset.target = 'admin';
            adminBtn.textContent = 'Admin';
            footer.appendChild(adminBtn);
            
            adminBtn.addEventListener('click', function() {
                document.querySelectorAll('.footer-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                showAdminScreen();
            });
        }
    });
}

function showAdminScreen() {
    const landingScreen = document.getElementById('landing-screen');
    const selectionScreen = document.getElementById('selection-screen');
    const profileScreen = document.getElementById('profile-screen');
    const gameScreen = document.getElementById('game-screen');
    const adminScreen = document.getElementById('admin-screen');
    
    if (landingScreen) landingScreen.style.display = 'none';
    if (selectionScreen) selectionScreen.style.display = 'none';
    if (profileScreen) profileScreen.style.display = 'none';
    if (gameScreen) gameScreen.style.display = 'none';
    if (adminScreen) adminScreen.style.display = 'flex';
    
    loadAdminData();
}

function initializeAdminPanel() {
    const adminTabs = document.querySelectorAll('.admin-tab');
    adminTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.dataset.tab;
            
            adminTabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`admin-${tabName}-content`).classList.add('active');
        });
    });
    
    const refreshBtn = document.getElementById('admin-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadAdminData);
    }
}

async function loadAdminData() {
    try {
        const statsResponse = await fetch('/api/admin/stats');
        const stats = await statsResponse.json();
        
        document.getElementById('admin-total-users').textContent = stats.totalUsers || 0;
        document.getElementById('admin-pending-deposits').textContent = stats.pendingDeposits || 0;
        document.getElementById('admin-pending-withdrawals').textContent = stats.pendingWithdrawals || 0;
        document.getElementById('admin-today-games').textContent = stats.todayGames || 0;
    } catch (err) {
        console.error('Failed to load admin stats:', err);
    }
    
    loadAdminDeposits();
    loadAdminWithdrawals();
    loadAdminUsers();
}

async function loadAdminDeposits() {
    try {
        const response = await fetch('/api/admin/deposits');
        const deposits = await response.json();
        
        const container = document.getElementById('admin-deposits-list');
        
        if (deposits.length === 0) {
            container.innerHTML = '<p class="admin-empty">ዲፖዚቶች የሉም</p>';
            return;
        }
        
        let html = '';
        for (const d of deposits) {
            html += `
                <div class="admin-item">
                    <div class="admin-item-header">
                        <span class="admin-item-id">#${d.id}</span>
                        <span class="admin-item-status ${d.status}">${d.status}</span>
                    </div>
                    <div class="admin-item-details">
                        <p><strong>${d.username}</strong> - ${d.amount} ብር</p>
                        <p>${d.payment_method} | ኮድ: ${d.confirmation_code}</p>
                    </div>
                    ${d.status === 'pending' ? `
                        <div class="admin-item-actions">
                            <button class="admin-btn admin-btn-approve" onclick="adminApproveDeposit(${d.id})">✓ ፈቅድ</button>
                            <button class="admin-btn admin-btn-reject" onclick="adminRejectDeposit(${d.id})">✗ ውድቅ</button>
                        </div>
                    ` : ''}
                </div>
            `;
        }
        container.innerHTML = html;
    } catch (err) {
        document.getElementById('admin-deposits-list').innerHTML = '<p class="admin-empty">Error loading</p>';
    }
}

async function loadAdminWithdrawals() {
    try {
        const response = await fetch('/api/admin/withdrawals');
        const withdrawals = await response.json();
        
        const container = document.getElementById('admin-withdrawals-list');
        
        if (withdrawals.length === 0) {
            container.innerHTML = '<p class="admin-empty">ማውጣቶች የሉም</p>';
            return;
        }
        
        let html = '';
        for (const w of withdrawals) {
            html += `
                <div class="admin-item">
                    <div class="admin-item-header">
                        <span class="admin-item-id">#${w.id}</span>
                        <span class="admin-item-status ${w.status}">${w.status}</span>
                    </div>
                    <div class="admin-item-details">
                        <p><strong>${w.username}</strong> - ${w.amount} ብር</p>
                        <p>📞 ${w.phone_number} | 🏷 ${w.account_name}</p>
                    </div>
                    ${w.status === 'pending' ? `
                        <div class="admin-item-actions">
                            <button class="admin-btn admin-btn-approve" onclick="adminApproveWithdrawal(${w.id})">✓ ፈቅድ</button>
                            <button class="admin-btn admin-btn-reject" onclick="adminRejectWithdrawal(${w.id})">✗ ውድቅ</button>
                        </div>
                    ` : ''}
                </div>
            `;
        }
        container.innerHTML = html;
    } catch (err) {
        document.getElementById('admin-withdrawals-list').innerHTML = '<p class="admin-empty">Error loading</p>';
    }
}

async function loadAdminUsers() {
    try {
        const response = await fetch('/api/admin/users');
        const users = await response.json();
        
        const container = document.getElementById('admin-users-list');
        
        if (users.length === 0) {
            container.innerHTML = '<p class="admin-empty">ተጠቃሚዎች የሉም</p>';
            return;
        }
        
        let html = '';
        for (const u of users) {
            html += `
                <div class="admin-user-item">
                    <div class="admin-user-info">
                        <div class="admin-user-name">${u.username}</div>
                        <div class="admin-user-phone">${u.phone_number || '-'}</div>
                    </div>
                    <div class="admin-user-balance">${parseFloat(u.balance || 0).toFixed(2)} ብር</div>
                </div>
            `;
        }
        container.innerHTML = html;
    } catch (err) {
        document.getElementById('admin-users-list').innerHTML = '<p class="admin-empty">Error loading</p>';
    }
}

async function adminApproveDeposit(id) {
    if (!confirm('ይህን ዲፖዚት ለማፅደቅ እርግጠኛ ነዎት?')) return;
    
    try {
        const response = await fetch(`/api/admin/deposits/${id}/approve`, { method: 'POST' });
        if (response.ok) {
            showAdminNotification('✅ ዲፖዚት ተፈቅዷል!');
            loadAdminData();
        } else {
            alert('Error approving deposit');
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function adminRejectDeposit(id) {
    if (!confirm('ይህን ዲፖዚት ውድቅ ለማድረግ እርግጠኛ ነዎት?')) return;
    
    try {
        const response = await fetch(`/api/admin/deposits/${id}/reject`, { method: 'POST' });
        if (response.ok) {
            showAdminNotification('❌ ዲፖዚት ውድቅ ተደርጓል');
            loadAdminData();
        } else {
            alert('Error rejecting deposit');
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function adminApproveWithdrawal(id) {
    if (!confirm('ይህን ማውጣት ለማፅደቅ እርግጠኛ ነዎት?')) return;
    
    try {
        const response = await fetch(`/api/admin/withdrawals/${id}/approve`, { method: 'POST' });
        if (response.ok) {
            showAdminNotification('✅ ማውጣት ተፈቅዷል!');
            loadAdminData();
        } else {
            alert('Error approving withdrawal');
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function adminRejectWithdrawal(id) {
    if (!confirm('ይህን ማውጣት ውድቅ ለማድረግ እርግጠኛ ነዎት?')) return;
    
    try {
        const response = await fetch(`/api/admin/withdrawals/${id}/reject`, { method: 'POST' });
        if (response.ok) {
            showAdminNotification('❌ ማውጣት ውድቅ ተደርጓል');
            loadAdminData();
        } else {
            alert('Error rejecting withdrawal');
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function showAdminNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'admin-notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

window.adminApproveDeposit = adminApproveDeposit;
window.adminRejectDeposit = adminRejectDeposit;
window.adminApproveWithdrawal = adminApproveWithdrawal;
window.adminRejectWithdrawal = adminRejectWithdrawal;

// ================================================
// Wallet Functions
// ================================================

let selectedDepositAmount = 0;

function initializeWallet() {
    const walletRefreshBtn = document.getElementById('wallet-refresh-btn');
    if (walletRefreshBtn) {
        walletRefreshBtn.addEventListener('click', () => {
            walletRefreshBtn.classList.add('spinning');
            loadWalletData().finally(() => {
                setTimeout(() => walletRefreshBtn.classList.remove('spinning'), 500);
            });
        });
    }
    
    const depositBtn = document.getElementById('wallet-deposit-btn');
    if (depositBtn) {
        depositBtn.addEventListener('click', openDepositModal);
    }
    
    const withdrawBtn = document.getElementById('wallet-withdraw-btn');
    if (withdrawBtn) {
        withdrawBtn.addEventListener('click', openWithdrawModal);
    }
    
    const depositModalClose = document.getElementById('deposit-modal-close');
    if (depositModalClose) {
        depositModalClose.addEventListener('click', closeDepositModal);
    }
    
    const withdrawModalClose = document.getElementById('withdraw-modal-close');
    if (withdrawModalClose) {
        withdrawModalClose.addEventListener('click', closeWithdrawModal);
    }
    
    const amountBtns = document.querySelectorAll('.amount-btn');
    amountBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            amountBtns.forEach(b => b.classList.remove('selected'));
            this.classList.add('selected');
            selectedDepositAmount = parseInt(this.dataset.amount);
            document.getElementById('deposit-custom-amount').value = '';
        });
    });
    
    const customAmountInput = document.getElementById('deposit-custom-amount');
    if (customAmountInput) {
        customAmountInput.addEventListener('input', function() {
            document.querySelectorAll('.amount-btn').forEach(b => b.classList.remove('selected'));
            selectedDepositAmount = parseInt(this.value) || 0;
        });
    }
    
    const depositSubmitBtn = document.getElementById('deposit-submit-btn');
    if (depositSubmitBtn) {
        depositSubmitBtn.addEventListener('click', submitDeposit);
    }
    
    const withdrawSubmitBtn = document.getElementById('withdraw-submit-btn');
    if (withdrawSubmitBtn) {
        withdrawSubmitBtn.addEventListener('click', submitWithdraw);
    }
    
    const depositModal = document.getElementById('deposit-modal');
    if (depositModal) {
        depositModal.addEventListener('click', function(e) {
            if (e.target === this) closeDepositModal();
        });
    }
    
    const withdrawModal = document.getElementById('withdraw-modal');
    if (withdrawModal) {
        withdrawModal.addEventListener('click', function(e) {
            if (e.target === this) closeWithdrawModal();
        });
    }
}

async function loadWalletData() {
    if (!currentUserId) {
        console.log('No user ID for wallet');
        return;
    }
    
    try {
        const response = await fetch(`/api/wallet/${currentUserId}`);
        const data = await response.json();
        
        if (data.success) {
            const balanceEl = document.getElementById('wallet-balance');
            if (balanceEl) balanceEl.textContent = parseFloat(data.balance).toFixed(2);
            
            const updatedEl = document.getElementById('wallet-updated');
            if (updatedEl) {
                const now = new Date();
                updatedEl.textContent = `Last updated: ${now.toLocaleTimeString()}`;
            }
            
            const gamesEl = document.getElementById('wallet-total-games');
            if (gamesEl) gamesEl.textContent = data.totalGames || 0;
            
            const winsEl = document.getElementById('wallet-wins');
            if (winsEl) winsEl.textContent = data.wins || 0;
            
            const winningsEl = document.getElementById('wallet-total-winnings');
            if (winningsEl) winningsEl.textContent = data.totalWinnings || 0;
            
            renderWalletHistory(data.history || []);
        }
    } catch (error) {
        console.error('Error loading wallet:', error);
    }
}

function renderWalletHistory(history) {
    const historyList = document.getElementById('wallet-history-list');
    if (!historyList) return;
    
    if (!history || history.length === 0) {
        historyList.innerHTML = '<div class="history-empty">ምንም እንቅስቃሴ የለም</div>';
        return;
    }
    
    historyList.innerHTML = history.map(item => {
        let icon = '💰';
        let iconClass = 'deposit';
        let amountClass = 'positive';
        let typeText = 'ዲፖዚት';
        let amountPrefix = '+';
        
        if (item.type === 'withdraw') {
            icon = '💸';
            iconClass = 'withdraw';
            amountClass = item.status === 'pending' ? 'pending' : 'negative';
            typeText = 'ማውጣት';
            amountPrefix = '-';
        } else if (item.type === 'game') {
            icon = '🎮';
            iconClass = 'game';
            amountClass = 'negative';
            typeText = 'ጨዋታ';
            amountPrefix = '-';
        } else if (item.type === 'win') {
            icon = '🏆';
            iconClass = 'win';
            amountClass = 'positive';
            typeText = 'ድል';
            amountPrefix = '+';
        }
        
        if (item.status === 'pending') {
            amountClass = 'pending';
            typeText += ' (በመጠባበቅ)';
        }
        
        const date = new Date(item.created_at);
        const dateStr = date.toLocaleDateString('am-ET', { month: 'short', day: 'numeric' });
        
        return `
            <div class="history-item">
                <div class="history-item-left">
                    <div class="history-icon ${iconClass}">${icon}</div>
                    <div class="history-details">
                        <span class="history-type">${typeText}</span>
                        <span class="history-date">${dateStr}</span>
                    </div>
                </div>
                <span class="history-amount ${amountClass}">${amountPrefix}${parseFloat(item.amount).toFixed(0)} ETB</span>
            </div>
        `;
    }).join('');
}

function openDepositModal() {
    const modal = document.getElementById('deposit-modal');
    if (modal) {
        modal.style.display = 'flex';
        selectedDepositAmount = 0;
        document.querySelectorAll('.amount-btn').forEach(b => b.classList.remove('selected'));
        document.getElementById('deposit-custom-amount').value = '';
        document.getElementById('deposit-reference').value = '';
        document.getElementById('deposit-status').innerHTML = '';
    }
}

function closeDepositModal() {
    const modal = document.getElementById('deposit-modal');
    if (modal) modal.style.display = 'none';
}

function openWithdrawModal() {
    const modal = document.getElementById('withdraw-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.getElementById('withdraw-amount').value = '';
        document.getElementById('withdraw-phone').value = '';
        document.getElementById('withdraw-status').innerHTML = '';
        
        const balanceEl = document.getElementById('wallet-balance');
        const currentBalanceEl = document.getElementById('withdraw-current-balance');
        if (balanceEl && currentBalanceEl) {
            currentBalanceEl.textContent = balanceEl.textContent + ' ETB';
        }
    }
}

function closeWithdrawModal() {
    const modal = document.getElementById('withdraw-modal');
    if (modal) modal.style.display = 'none';
}

async function submitDeposit() {
    const reference = document.getElementById('deposit-reference').value.trim();
    const statusEl = document.getElementById('deposit-status');
    const submitBtn = document.getElementById('deposit-submit-btn');
    
    if (!selectedDepositAmount || selectedDepositAmount < 10) {
        statusEl.className = 'deposit-status error';
        statusEl.textContent = 'እባክዎ መጠን ይምረጡ (ቢያንስ 10 ብር)';
        return;
    }
    
    if (!reference) {
        statusEl.className = 'deposit-status error';
        statusEl.textContent = 'እባክዎ የማረጋገጫ ቁጥር ያስገቡ';
        return;
    }
    
    submitBtn.disabled = true;
    statusEl.className = 'deposit-status pending';
    statusEl.textContent = 'በመላክ ላይ...';
    
    try {
        const response = await fetch('/api/deposits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: currentUserId,
                amount: selectedDepositAmount,
                reference: reference
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            statusEl.className = 'deposit-status success';
            statusEl.textContent = '✅ ዲፖዚት ጥያቄ ተልኳል! Admin ሲያረጋግጥ ይገባል።';
            setTimeout(() => {
                closeDepositModal();
                loadWalletData();
            }, 2000);
        } else {
            statusEl.className = 'deposit-status error';
            statusEl.textContent = data.message || 'ዲፖዚት አልተሳካም';
        }
    } catch (error) {
        statusEl.className = 'deposit-status error';
        statusEl.textContent = 'ስህተት ተከስቷል። እንደገና ይሞክሩ።';
    } finally {
        submitBtn.disabled = false;
    }
}

async function submitWithdraw() {
    const amount = parseFloat(document.getElementById('withdraw-amount').value);
    const phone = document.getElementById('withdraw-phone').value.trim();
    const statusEl = document.getElementById('withdraw-status');
    const submitBtn = document.getElementById('withdraw-submit-btn');
    
    if (!amount || amount < 10) {
        statusEl.className = 'withdraw-status error';
        statusEl.textContent = 'እባክዎ ትክክለኛ መጠን ያስገቡ (ቢያንስ 10 ብር)';
        return;
    }
    
    if (!phone || phone.length < 10) {
        statusEl.className = 'withdraw-status error';
        statusEl.textContent = 'እባክዎ ትክክለኛ ስልክ ቁጥር ያስገቡ';
        return;
    }
    
    submitBtn.disabled = true;
    statusEl.className = 'withdraw-status pending';
    statusEl.textContent = 'በመላክ ላይ...';
    
    try {
        const response = await fetch('/api/withdrawals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: currentUserId,
                amount: amount,
                phone_number: phone
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            statusEl.className = 'withdraw-status success';
            statusEl.textContent = '✅ ማውጣት ጥያቄ ተልኳል! Admin ሲያረጋግጥ ይላካል።';
            setTimeout(() => {
                closeWithdrawModal();
                loadWalletData();
            }, 2000);
        } else {
            statusEl.className = 'withdraw-status error';
            statusEl.textContent = data.message || 'ማውጣት አልተሳካም';
        }
    } catch (error) {
        statusEl.className = 'withdraw-status error';
        statusEl.textContent = 'ስህተት ተከስቷል። እንደገና ይሞክሩ።';
    } finally {
        submitBtn.disabled = false;
    }
}
