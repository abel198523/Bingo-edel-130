let currentUserId = null;
let currentStake = 5;
let ws = null;
let isRegistered = false;

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
            checkAdminStatus(); // Assuming checkAdminStatus is defined elsewhere
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
                loadWalletData(); // Assuming loadWalletData is defined elsewhere
            } else if (target === 'profile') {
                if (profileScreen) profileScreen.style.display = 'flex';
                loadProfile();
            } else if (target === 'admin') {
                if (adminScreen) adminScreen.style.display = 'flex';
                loadAdminData(); // Assuming loadAdminData is defined elsewhere
            }
        });
    });
    
    const profileRefreshBtn = document.getElementById('profile-refresh-btn');
    if (profileRefreshBtn) {
        profileRefreshBtn.addEventListener('click', loadProfile);
    }
    
    initializeWallet(); // Assuming initializeWallet is defined elsewhere
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
                            setTimeout(() => { copyBtn.textContent = 'ኮፒ'; }, 2000);
                        }).catch(() => {
                            alert('ሊንኩ: ' + profile.referralLink);
                        });
                    };
                }
            } else if (profile.referralCode) {
                // Fallback to referral code only
                if (referralCodeEl) {
                    referralCodeEl.textContent = profile.referralCode;
                }
                if (copyBtn) {
                    copyBtn.onclick = () => {
                        navigator.clipboard.writeText(profile.referralCode).then(() => {
                            copyBtn.textContent = 'ተኮፒዋል!';
                            setTimeout(() => { copyBtn.textContent = 'ኮፒ'; }, 2000);
                        }).catch(() => {
                            alert('ኮዱ: ' + profile.referralCode);
                        });
                    };
                }
            }
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

let takenCards = new Set();
let playerUsername = 'Anonymous';

function generateCardSelection() {
    const grid = document.getElementById('card-selection-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    for (let cardId = 1; cardId <= 100; cardId++) {
        const cardElement = document.createElement('div');
        cardElement.className = 'card-number-btn';
        cardElement.dataset.cardId = cardId;
        cardElement.textContent = cardId;
        
        // Mark as taken if in takenCards set
        if (takenCards.has(cardId)) {
            cardElement.classList.add('taken');
            cardElement.style.backgroundColor = '#ff4757';
            cardElement.style.color = '#ffffff';
            cardElement.style.fontWeight = 'bold';
            cardElement.style.opacity = '1';
            cardElement.style.cursor = 'not-allowed';
            cardElement.onclick = () => alert('ይህ ካርድ ቀድሞ ተወስዷል');
        } else {
            cardElement.addEventListener('click', function() {
                if (!selectedCardId) {
                    showCardPreview(cardId);
                }
            });
        }
        
        grid.appendChild(cardElement);
    }
}

function showCardPreview(cardId) {
    if (selectedCardId) return; // Prevent previewing if card already confirmed
    previewCardId = cardId;
    const modal = document.getElementById('card-preview-modal');
    const previewGrid = document.getElementById('preview-card-grid');
    const previewTitle = document.getElementById('preview-card-title');
    
    if (!modal || !previewGrid) return;
    
    // Assuming BINGO_CARDS is defined globally (e.g., in card.js)
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

async function confirmPreviewCard() {
    if (previewCardId && !selectedCardId) {
        selectedCardId = previewCardId;
        
        // Notify server about card selection
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'select_card',
                cardId: selectedCardId
            }));
        }
        
        // Final confirmation flow (merging confirmPreview and handleCardConfirmation)
        const result = await handleCardConfirmation(selectedCardId);
        if (result.success) {
            // Stay on selection screen until timer ends
            // The phase_change 'game' message will handle the transition
            hideCardPreview();
            
            // Visual feedback that card is confirmed
            const status = document.getElementById('confirmation-status');
            if (status) {
                status.textContent = `ካርድ #${selectedCardId} ተረጋግጧል! ጨዋታ እስኪጀምር ይጠብቁ...`;
                status.style.display = 'block';
                status.style.color = '#00d984';
            }
        } else {
            selectedCardId = null; // Reset if failed
            alert(result.message || 'ካርድ ለማረጋገጥ አልተቻለም');
        }
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
                    // Only allow clicking if not already marked
                    if (this.classList.contains('marked')) {
                        return; // Can't click already selected cards
                    }
                    this.classList.add('marked');
                }
            });
            
            cardContainer.appendChild(cell);
        });
    });
}

function parseReferralCode(startParam) {
    if (!startParam) return null;
    if (startParam.startsWith('ref_')) {
        return startParam.substring(4);
    }
    return startParam;
}

async function processReferral(telegramId, startParam, referralCode) {
    try {
        const response = await fetch('/api/referral/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegramId: telegramId,
                startParam: startParam,
                referralCode: referralCode
            })
        });
        const data = await response.json();
        if (data.success) {
            console.log('Referral processed:', data.message);
            if (data.pending && data.referralCode) {
                localStorage.setItem('referralCode', data.referralCode);
            }
        }
        return data;
    } catch (error) {
        console.error('Error processing referral:', error);
        return { success: false };
    }
}


async function loadWallet() {
    if (!currentUserId) return;
    
    try {
        const response = await fetch(`/api/wallet/${currentUserId}`);
        const data = await response.json();
        
        if (data.success) {
            updateWalletDisplay(data.balance);
        }
    } catch (error) {
        console.error('Error loading wallet:', error);
    }
    
    // Load pending withdrawals
    loadUserWithdrawals();
}

async function loadWalletData() {
    return await loadWallet();
}

function initializeWallet() {
    loadWallet();
    
    // Deposit button
    const depositBtn = document.getElementById('wallet-deposit-btn');
    if (depositBtn) {
        depositBtn.addEventListener('click', () => {
            const depositModal = document.getElementById('deposit-modal');
            if (depositModal) depositModal.style.display = 'flex';
        });
    }
    
    // Deposit modal close
    const depositClose = document.getElementById('deposit-modal-close');
    if (depositClose) {
        depositClose.addEventListener('click', () => {
            const depositModal = document.getElementById('deposit-modal');
            if (depositModal) depositModal.style.display = 'none';
        });
    }
    
    // Amount buttons in deposit
    const amountBtns = document.querySelectorAll('.amount-btn');
    amountBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            document.getElementById('deposit-custom-amount').value = this.dataset.amount;
        });
    });
    
    // Withdrawal button
    const withdrawBtn = document.getElementById('wallet-withdraw-btn');
    if (withdrawBtn) {
        withdrawBtn.addEventListener('click', () => {
            const withdrawModal = document.getElementById('withdraw-modal');
            if (withdrawModal) withdrawModal.style.display = 'flex';
        });
    }
    
    // Withdraw modal close
    const withdrawClose = document.getElementById('withdraw-modal-close');
    if (withdrawClose) {
        withdrawClose.addEventListener('click', () => {
            const withdrawModal = document.getElementById('withdraw-modal');
            if (withdrawModal) withdrawModal.style.display = 'none';
        });
    }
    
    // Refresh buttons
    const walletRefresh = document.getElementById('wallet-refresh-btn');
    if (walletRefresh) {
        walletRefresh.addEventListener('click', loadWallet);
    }
    
    // Deposit submit
    const depositSubmit = document.getElementById('deposit-submit-btn');
    if (depositSubmit) {
        depositSubmit.addEventListener('click', async () => {
            const amount = document.getElementById('deposit-custom-amount').value;
            const reference = document.getElementById('deposit-reference').value;
            if (!amount || !reference) return alert('መጠን እና ማረጋገጫ ቁጥር ሁለቱም ተራ አስፈላጊ!');
            try {
                const res = await fetch('/api/deposits', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({telegram_id: currentUserId, amount: parseFloat(amount), reference})
                });
                const data = await res.json();
                alert(data.message || 'ጥያቄ ተላክ!');
                document.getElementById('deposit-modal').style.display = 'none';
                document.getElementById('deposit-reference').value = '';
                document.getElementById('deposit-custom-amount').value = '';
            } catch(e) { alert('ስህተት!'); console.error(e); }
        });
    }
    
    // Withdraw submit
    const withdrawSubmit = document.getElementById('withdraw-submit-btn');
    if (withdrawSubmit) {
        withdrawSubmit.addEventListener('click', async () => {
            const amount = document.getElementById('withdraw-amount').value;
            const name = document.getElementById('withdraw-name').value;
            const phone = document.getElementById('withdraw-phone').value;
            if (!amount || !name || !phone) return alert('ሁሉም መስክ ተራ አስፈላጊ ነው!');
            try {
                const res = await fetch('/api/withdrawals', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({telegram_id: currentUserId, amount: parseFloat(amount), account_name: name, phone_number: phone})
                });
                const data = await res.json();
                if(res.ok) {
                    alert(data.message || 'ጥያቄ ተላክ! ገንዘቡ ወድቅ ሂሳብዎ ላይ ይቆይ ድረስ እንደገና ወሰድ።');
                    document.getElementById('withdraw-modal').style.display = 'none';
                    document.getElementById('withdraw-amount').value = '';
                    document.getElementById('withdraw-name').value = '';
                    document.getElementById('withdraw-phone').value = '';
                    loadWallet();
                } else {
                    alert('ስህተት: ' + (data.message || 'ጥያቄ ወደገና ሞክር'));
                }
            } catch(e) { alert('ስህተት!'); console.error(e); }
        });
    }
}

function loadAdminData() {
    loadAdminStats();
    loadPendingItems();
    setupAdminTabs();
}

async function loadAdminStats() {
    try {
        const response = await fetch('/api/admin/stats');
        const data = await response.json();
        document.getElementById('admin-total-users').textContent = data.totalUsers || 0;
        document.getElementById('admin-pending-deposits').textContent = data.pendingDeposits || 0;
        document.getElementById('admin-pending-withdrawals').textContent = data.pendingWithdrawals || 0;
        document.getElementById('admin-today-games').textContent = data.todayGames || 0;
    } catch(e) { console.error('Failed to load admin stats:', e); }
}

async function loadPendingItems() {
    try {
        const response = await fetch('/api/admin/pending');
        const data = await response.json();
        displayPendingDeposits(data.deposits || []);
        displayPendingWithdrawals(data.withdrawals || []);
    } catch(e) { console.error('Failed to load pending items:', e); }
}

function displayPendingDeposits(deposits) {
    const container = document.getElementById('admin-deposits-list');
    if (!container) return;
    
    if (deposits.length === 0) {
        container.innerHTML = '<p class="admin-empty">ምንም ጥያቄ የለም</p>';
        return;
    }
    
    container.innerHTML = '';
    deposits.forEach(d => {
        const item = document.createElement('div');
        item.className = 'admin-list-item';
        item.innerHTML = `
            <div class="admin-item-info">
                <strong>${d.username}</strong> - ${d.amount} ብር
                <div style="font-size: 0.9em; color: #aaa; margin-top: 5px;">
                    📱 ${d.payment_method} | ${d.confirmation_code}
                </div>
            </div>
            <div class="admin-item-actions">
                <button class="admin-btn-approve" data-id="${d.id}" data-action="approve">✓ ግበር</button>
                <button class="admin-btn-reject" data-id="${d.id}" data-action="reject">✗ ውድቅ</button>
            </div>
        `;
        
        // Add event listeners
        item.querySelector('.admin-btn-approve').addEventListener('click', async () => {
            await approveDeposit(d.id);
        });
        item.querySelector('.admin-btn-reject').addEventListener('click', async () => {
            await rejectDeposit(d.id);
        });
        
        container.appendChild(item);
    });
}

function displayPendingWithdrawals(withdrawals) {
    const container = document.getElementById('admin-withdrawals-list');
    if (!container) return;
    
    if (withdrawals.length === 0) {
        container.innerHTML = '<p class="admin-empty">ምንም ጥያቄ የለም</p>';
        return;
    }
    
    container.innerHTML = '';
    withdrawals.forEach(w => {
        const item = document.createElement('div');
        item.className = 'admin-list-item';
        item.innerHTML = `
            <div class="admin-item-info">
                <strong>${w.username}</strong> - ${w.amount} ብር
                <div style="font-size: 0.9em; color: #aaa; margin-top: 5px;">
                    👤 ${w.account_holder_name} | 📱 ${w.phone_number}
                </div>
            </div>
            <div class="admin-item-actions">
                <button class="admin-btn-approve" data-id="${w.id}" data-action="approve">✓ ግበር</button>
                <button class="admin-btn-reject" data-id="${w.id}" data-action="reject">✗ ውድቅ</button>
            </div>
        `;
        
        // Add event listeners
        item.querySelector('.admin-btn-approve').addEventListener('click', async () => {
            await approveWithdrawal(w.id);
        });
        item.querySelector('.admin-btn-reject').addEventListener('click', async () => {
            await rejectWithdrawal(w.id);
        });
        
        container.appendChild(item);
    });
}

async function approveDeposit(id) {
    try {
        const res = await fetch(`/api/admin/deposits/${id}/approve`, { method: 'POST' });
        const data = await res.json();
        if(res.ok) { 
            alert('✓ ዲፖዚት ተጸድቋል'); 
            loadAdminStats();
            loadPendingItems(); 
        } else {
            alert('Error: ' + (data.error || 'Failed to approve'));
        }
    } catch(e) { 
        console.error('Approve deposit error:', e);
        alert('Network error!'); 
    }
}

async function rejectDeposit(id) {
    try {
        const res = await fetch(`/api/admin/deposits/${id}/reject`, { method: 'POST' });
        const data = await res.json();
        if(res.ok) { 
            alert('✓ ዲፖዚት ውድቅ ተደረገ'); 
            loadAdminStats();
            loadPendingItems(); 
        } else {
            alert('Error: ' + (data.error || 'Failed to reject'));
        }
    } catch(e) { 
        console.error('Reject deposit error:', e);
        alert('Network error!'); 
    }
}

async function approveWithdrawal(id) {
    try {
        const res = await fetch(`/api/admin/withdrawals/${id}/approve`, { method: 'POST' });
        const data = await res.json();
        if(res.ok) { 
            alert('✓ ማውጣት ተጸድቋል'); 
            loadAdminStats();
            loadPendingItems(); 
        } else {
            alert('Error: ' + (data.error || 'Failed to approve'));
        }
    } catch(e) { 
        console.error('Approve withdrawal error:', e);
        alert('Network error!'); 
    }
}

async function rejectWithdrawal(id) {
    try {
        const res = await fetch(`/api/admin/withdrawals/${id}/reject`, { method: 'POST' });
        const data = await res.json();
        if(res.ok) { 
            alert('✓ ማውጣት ውድቅ ተደረገ'); 
            loadAdminStats();
            loadPendingItems(); 
        } else {
            alert('Error: ' + (data.error || 'Failed to reject'));
        }
    } catch(e) { 
        console.error('Reject withdrawal error:', e);
        alert('Network error!'); 
    }
}

function openAddBalanceModal(username, telegramId) {
    const amount = prompt(`💰 ${username} ላይ መጠን ጨምር (ብር):`);
    if(amount && !isNaN(amount) && amount > 0) {
        addBalanceToUser(telegramId, parseFloat(amount));
    }
}

async function addBalanceToUser(telegramId, amount) {
    try {
        const res = await fetch('/api/admin/add-balance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegramId, amount })
        });
        const data = await res.json();
        alert(data.message || 'Success!');
        loadAdminStats();
        loadPendingItems();
    } catch(e) { alert('Error!'); }
}

// Get user's pending withdrawals
async function loadUserWithdrawals() {
    if (!currentUserId) return;
    try {
        const res = await fetch(`/api/user/withdrawals/${currentUserId}`);
        const data = await res.json();
        displayUserWithdrawals(data.withdrawals || []);
    } catch(e) { console.error('Failed to load withdrawals:', e); }
}

function displayUserWithdrawals(withdrawals) {
    const walletHistory = document.getElementById('wallet-history-list');
    if (!walletHistory) return;
    
    const pending = withdrawals.filter(w => w.status === 'pending');
    const processed = withdrawals.filter(w => w.status !== 'pending');
    
    let html = '';
    
    if (pending.length > 0) {
        html += '<div class="pending-withdrawals">';
        html += '<h4 style="color: #ffa500; margin-bottom: 10px;">⏳ የሚጠበቀው</h4>';
        pending.forEach(w => {
            html += `<div style="background: rgba(255,165,0,0.1); padding: 10px; margin: 5px 0; border-radius: 5px; border-left: 3px solid #ffa500;">
                <div style="display: flex; justify-content: space-between;">
                    <strong>💸 ${w.amount} ብር</strong>
                    <span style="font-size: 0.9em; color: #aaa;">${new Date(w.created_at).toLocaleDateString('am-ET')}</span>
                </div>
                <div style="font-size: 0.85em; color: #ccc; margin-top: 5px;">📱 ${w.phone_number}</div>
            </div>`;
        });
        html += '</div>';
    }
    
    if (processed.length > 0) {
        html += '<div style="margin-top: 15px;">';
        html += '<h4 style="margin-bottom: 10px;">አስተሳሰብ</h4>';
        processed.forEach(w => {
            const isApproved = w.status === 'approved';
            html += `<div style="background: rgba(${isApproved ? '0,255,0,0.1' : '255,0,0,0.1'}); padding: 10px; margin: 5px 0; border-radius: 5px;">
                <div style="display: flex; justify-content: space-between;">
                    <strong>${isApproved ? '✅' : '❌'} ${w.amount} ብር</strong>
                    <span style="font-size: 0.9em; color: #aaa;">${new Date(w.created_at).toLocaleDateString('am-ET')}</span>
                </div>
            </div>`;
        });
        html += '</div>';
    }
    
    if (withdrawals.length === 0) {
        html = '<div class="history-empty">ምንም ማውጣት የለም</div>';
    }
    
    walletHistory.innerHTML = html;
}

function setupAdminTabs() {
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(`admin-${this.dataset.tab}-content`).classList.add('active');
        });
    });
    
    const refreshBtn = document.getElementById('admin-refresh-btn');
    if(refreshBtn) refreshBtn.addEventListener('click', loadAdminData);
}

async function checkAdminStatus() {
    if (!currentUserId) return;
    
    try {
        const response = await fetch(`/api/check-admin/${currentUserId}`);
        const data = await response.json();
        
        if (data.isAdmin) {
            const adminTab = document.querySelector('[data-target="admin"]');
            if (adminTab) {
                adminTab.style.display = 'block';
            }
            // Load admin data if tab is shown
            loadAdminData();
        }
    } catch (error) {
        console.log('Admin check skipped');
    }
}

function updateWalletDisplay(balance) {
    const formattedBalance = parseFloat(balance || 0).toFixed(2);
    
    // Update main wallet display in selection screen header
    const walletElement = document.getElementById('main-wallet-value');
    if (walletElement) {
        walletElement.textContent = formattedBalance;
    }
    
    // Update wallet screen balance
    const walletBalanceElement = document.getElementById('wallet-balance');
    if (walletBalanceElement) {
        walletBalanceElement.textContent = formattedBalance;
    }
    
    // Update profile balance
    const profileBalanceElement = document.getElementById('profile-balance');
    if (profileBalanceElement) {
        profileBalanceElement.textContent = formattedBalance + ' ETB';
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
            // Load already-selected cards from server
            if (data.selectedCards && data.selectedCards.length > 0) {
                data.selectedCards.forEach(cardId => {
                    if (!takenCards.has(cardId)) {
                        takenCards.add(cardId);
                    }
                });
                // Re-render grid to show selected cards as RED
                generateCardSelection();
            }
            if (data.calledNumbers && data.calledNumbers.length > 0) {
                data.calledNumbers.forEach(num => {
                    markCalledNumber(num);
                    markMasterNumber(num);
                });
            }
            break;
        case 'clear_local_selection':
            selectedCardId = null;
            previewCardId = null;
            takenCards.clear();
            
            // Clear marked cells on the player's current card if any
            const markedCells = document.querySelectorAll('.player-card-cell.marked');
            markedCells.forEach(cell => cell.classList.remove('marked'));
            
            // Update UI to selection state
            const landingScreen = document.getElementById('landing-screen');
            const selectionScreen = document.getElementById('selection-screen');
            const gameScreen = document.getElementById('game-screen');
            
            if (landingScreen) landingScreen.style.display = 'none';
            if (selectionScreen) selectionScreen.style.display = 'flex';
            if (gameScreen) gameScreen.style.display = 'none';
            
            generateCardSelection();
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
            if (data.playerCount !== undefined) {
                updatePlayerCountDisplay(data.playerCount);
            }
            if (data.prizeAmount !== undefined) {
                updatePrizePoolDisplay(data.prizeAmount);
            }
            
            // Reset status message in selection screen
            const status = document.getElementById('confirmation-status');
            if (status && data.phase === 'selection') {
                status.textContent = 'ካርድ ይምረጡና አረጋግጡ';
                status.style.display = 'none';
                status.style.color = 'rgba(255, 255, 255, 0.7)';
            }
            
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
            if (data.playerCount !== undefined) {
                updatePlayerCountDisplay(data.playerCount);
            }
            if (data.prizeAmount !== undefined) {
                updatePrizePoolDisplay(data.prizeAmount);
            }
            break;
        case 'card_selected':
            // Mark card as taken - show in RED for real-time visibility
            if (data.cardId && !takenCards.has(data.cardId)) {
                takenCards.add(data.cardId);
                // Update the card button visual state
                const cardBtn = document.querySelector(`[data-card-id="${data.cardId}"]`);
                if (cardBtn) {
                    cardBtn.classList.add('taken');
                    cardBtn.style.backgroundColor = '#ff4757';
                    cardBtn.style.color = '#ffffff';
                    cardBtn.style.fontWeight = 'bold';
                    cardBtn.style.opacity = '1';
                    cardBtn.style.cursor = 'not-allowed';
                    cardBtn.onclick = () => alert('ይህ ካርድ ቀድሞ ተወስዷል');
                }
            }
            break;
        case 'error':
            if (data.error && data.error.includes('ጨዋታ አስቀድሞ')) {
                alert('❌ ' + data.error);
                // Show landing screen if game is in progress
                const landingScreen = document.getElementById('landing-screen');
                if (landingScreen) {
                    landingScreen.style.display = 'flex';
                }
            } else {
                alert(data.error || 'ችግር ተፈጥሯል');
            }
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
        const selectionScreen = document.getElementById('selection-screen');
        const gameScreen = document.getElementById('game-screen');
        
        if (selectionScreen) selectionScreen.style.display = 'none';
        if (gameScreen) {
            gameScreen.style.display = 'flex';
            renderMasterGrid();
            if (selectedCardId) {
                renderPlayerCard(selectedCardId);
            }
        }
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

function updatePlayerCountDisplay(playerCount) {
    const playerCountElement = document.getElementById('player-count');
    if (playerCountElement) {
        playerCountElement.textContent = playerCount;
    }
}

function updatePrizePoolDisplay(prizeAmount) {
    const prizePoolElement = document.getElementById('prize-pool');
    if (prizePoolElement) {
        prizePoolElement.textContent = Math.round(prizeAmount) + ' ብር';
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
    // Assuming BINGO_CARDS is defined globally (e.g., in card.js)
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
