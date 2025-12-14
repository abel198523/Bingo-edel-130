require('dotenv').config();
const express = require('express');
const http = require('http'); // ✅ የተስተካከለ
const WebSocket = require('ws'); 
const path = require('path');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api'); 

const db = require('./db/database');
const User = require('./models/User');
const Wallet = require('./models/Wallet');
const Game = require('./models/Game');
const { validateBingo } = require('./data/cards');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const app = express();

// ✅ Body parser MUST come first before any routes
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- Telegram Bot Logic Added ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const RENDER_SERVER_URL = process.env.RENDER_SERVER_URL;
const MINI_APP_URL = process.env.MINI_APP_URL || (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS}` : null);

let bot = null;
let botUsername = null;

if (TELEGRAM_BOT_TOKEN) {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
        polling: true
    });

    bot.getMe().then((botInfo) => {
        botUsername = botInfo.username;
        console.log("Bot running in Polling mode.");
        console.log("Bot username:", botInfo.username);
        console.log("Bot ID:", botInfo.id);
        if (MINI_APP_URL) {
            console.log(`Mini App URL: ${MINI_APP_URL}`);
        }
    }).catch((err) => {
        console.error("Failed to get bot info:", err.message);
    });
} else {
    console.log("TELEGRAM_BOT_TOKEN not provided - Bot functionality disabled");
    console.log("Set TELEGRAM_BOT_TOKEN environment variable to enable the bot");
}

function generateReferralLink(referralCode) {
    if (botUsername) {
        return `https://t.me/${botUsername}?start=${referralCode}`;
    } else if (MINI_APP_URL) {
        return `${MINI_APP_URL}?ref=${referralCode}`;
    }
    return null;
}

// User conversation state tracking
const userStates = new Map();

// Admin Telegram IDs - Add admin IDs here
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// Generate unique referral code
function generateReferralCode(userId) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'ED';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code + userId.toString().slice(-2);
}

// Award referral bonus to referrer
async function awardReferralBonus(referrerId, referredUserId) {
    const REFERRAL_BONUS = 2.00;
    
    try {
        // Check if bonus already awarded
        const existingBonus = await pool.query(
            'SELECT id FROM referrals WHERE referred_user_id = $1 AND bonus_awarded = true',
            [referredUserId]
        );
        
        if (existingBonus.rows.length > 0) {
            return false; // Already awarded
        }
        
        // Award bonus to referrer
        await pool.query(
            'UPDATE wallets SET balance = balance + $1 WHERE user_id = $2',
            [REFERRAL_BONUS, referrerId]
        );
        
        // Record the referral
        await pool.query(
            `INSERT INTO referrals (referrer_id, referred_user_id, bonus_amount, bonus_awarded, bonus_awarded_at) 
             VALUES ($1, $2, $3, true, NOW())
             ON CONFLICT (referred_user_id) DO UPDATE SET bonus_awarded = true, bonus_awarded_at = NOW()`,
            [referrerId, referredUserId, REFERRAL_BONUS]
        );
        
        // Record transaction
        const balanceResult = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [referrerId]);
        const newBalance = parseFloat(balanceResult.rows[0]?.balance || 0);
        
        await pool.query(
            `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description) 
             VALUES ($1, 'referral_bonus', $2, $3, $4, $5)`,
            [referrerId, REFERRAL_BONUS, newBalance - REFERRAL_BONUS, newBalance, 'Referral bonus - new user registered']
        );
        
        console.log(`Referral bonus of ${REFERRAL_BONUS} ETB awarded to user ${referrerId}`);
        return true;
    } catch (err) {
        console.error('Error awarding referral bonus:', err);
        return false;
    }
}

// Helper function to get main keyboard
function getMainKeyboard(telegramId) {
    const miniAppUrlWithId = MINI_APP_URL ? `${MINI_APP_URL}?tg_id=${telegramId}` : null;
    
    const keyboard = [
        [{ text: "📱 Register", request_contact: true }]
    ];
    
    if (miniAppUrlWithId) {
        keyboard.push([{ text: "▶️ Play", web_app: { url: miniAppUrlWithId } }]);
    }
    
    keyboard.push([{ text: "💰 Check Balance" }, { text: "🔗 ሪፈራል" }]);
    
    return {
        keyboard: keyboard,
        resize_keyboard: true
    };
}

// Helper to notify admin
async function notifyAdmin(message) {
    if (ADMIN_CHAT_ID && bot) {
        try {
            await bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML' });
        } catch (err) {
            console.error('Failed to notify admin:', err.message);
        }
    }
}

// Helper to check withdrawal eligibility
async function checkWithdrawEligibility(telegramId) {
    try {
        const userResult = await pool.query(
            'SELECT u.id FROM users u WHERE u.telegram_id = $1',
            [telegramId]
        );
        
        if (userResult.rows.length === 0) {
            return { eligible: false, reason: 'not_registered' };
        }
        
        const userId = userResult.rows[0].id;
        
        // Get current balance
        const balanceResult = await pool.query(
            'SELECT balance FROM wallets WHERE user_id = $1',
            [userId]
        );
        const balance = parseFloat(balanceResult.rows[0]?.balance || 0);
        
        // Check minimum 50 birr balance requirement
        if (balance < 50) {
            return { eligible: false, reason: 'min_balance', balance, minRequired: 50, message: 'ለማውጣት ቢያንስ 50 ብር ባላንስ ሊኖርዎት ይገባል' };
        }
        
        // Check for confirmed deposits - must have at least 1 successful transaction
        const depositResult = await pool.query(
            'SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM deposits WHERE user_id = $1 AND status = $2',
            [userId, 'confirmed']
        );
        
        const totalDeposits = parseFloat(depositResult.rows[0].total);
        const depositCount = parseInt(depositResult.rows[0].count);
        
        // Must have at least 1 successful transaction (confirmed deposit)
        if (depositCount < 1) {
            return { eligible: false, reason: 'no_transaction', message: 'ለማውጣት ቢያንስ 1 የተሳካ ዲፖዚት ማድረግ አለብዎት' };
        }
        
        // Check if user won games - if they have wins but deposits < 100, they need more deposits
        // This ensures users who won using only the welcome bonus must deposit 100 birr first
        const winCount = await pool.query(
            'SELECT COUNT(*) as count FROM game_participants WHERE user_id = $1 AND is_winner = true',
            [userId]
        );
        const wins = parseInt(winCount.rows[0].count);
        
        if (wins > 0 && totalDeposits < 100) {
            return { eligible: false, reason: 'bonus_winner_min_deposit', message: 'በቦነስ ካሸነፉ ቢያንስ 100 ብር ዲፖዚት ማድረግ አለብዎት', totalDeposits, minRequired: 100 };
        }
        
        return { eligible: true, depositCount, wins, userId, balance };
    } catch (error) {
        console.error('Eligibility check error:', error);
        return { eligible: false, reason: 'error' };
    }
}

// Only setup bot handlers if bot is available
if (bot) {

// Handle the /start command with referral code support
bot.onText(/\/start(.*)/, async (msg, match) => {
    console.log('Received /start command from:', msg.from.id);
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    
    // Extract referral code from start parameter (e.g., /start REFCODE)
    const startParam = match[1] ? match[1].trim() : null;
    if (startParam) {
        console.log('Start parameter (referral code):', startParam);
        // Store referral code in user state
        userStates.set(telegramId, { referrerCode: startParam });
    }
    
    // Check if user is already registered
    let isRegistered = false;
    try {
        const result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
        isRegistered = result.rows.length > 0;
    } catch (err) {
        console.error('Error checking user:', err);
    }
    
    const miniAppUrlWithId = MINI_APP_URL ? `${MINI_APP_URL}?tg_id=${telegramId}` : null;
    
    if (isRegistered && miniAppUrlWithId) {
        // User is registered - show full menu
        bot.sendMessage(chatId, "እንኳን ደህና መጡ! ጨዋታውን ለመጀመር 'Play' የሚለውን ቁልፍ ይጫኑ።\n\n💳 ለዲፖዚትና ማውጣት 'Wallet' ታብ ውስጥ ይገቡ።", {
            reply_markup: getMainKeyboard(telegramId)
        });
    } else {
        // User is not registered or no Mini App URL - show Register button
        let welcomeMsg = "እንኳን ደህና መጡ ወደ Edele Bingo! 🎉\n\n";
        if (startParam) {
            welcomeMsg += "🎁 በሪፈራል ተጋብዘዋል!\n\n";
        }
        welcomeMsg += "ለመመዝገብ እና 10 ብር ቦነስ ለማግኘት ስልክ ቁጥርዎን ያጋሩ።";
        
        bot.sendMessage(chatId, welcomeMsg, {
            reply_markup: {
                keyboard: [
                    [{ text: "📱 Register", request_contact: true }]
                ],
                resize_keyboard: true
            }
        });
    }
});

// Handle contact sharing for registration
bot.on('contact', async (msg) => {
    const chatId = msg.chat.id;
    const contact = msg.contact;
    const telegramId = contact.user_id;
    const phoneNumber = contact.phone_number;
    const miniAppUrlWithId = MINI_APP_URL ? `${MINI_APP_URL}?tg_id=${telegramId}` : null;
    
    try {
        // Check if already registered
        const existingUser = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
        
        if (existingUser.rows.length > 0) {
            bot.sendMessage(chatId, "እርስዎ ቀድሞ ተመዝግበዋል! 'Play' ን ይጫኑ።\n\n💳 ለዲፖዚትና ማውጣት 'Wallet' ታብ ውስጥ ይገቡ።", {
                reply_markup: getMainKeyboard(telegramId)
            });
            return;
        }
        
        // Register new user with 10 ETB bonus
        const username = msg.from.username || `Player_${telegramId}`;
        const userResult = await pool.query(
            'INSERT INTO users (telegram_id, username, phone_number, is_registered) VALUES ($1, $2, $3, $4) RETURNING id',
            [telegramId, username, phoneNumber, true]
        );
        
        // Create wallet with 10 ETB bonus
        const userId = userResult.rows[0].id;
        await pool.query(
            'INSERT INTO wallets (user_id, balance) VALUES ($1, $2)',
            [userId, 10.00]
        );
        
        // Generate and save referral code
        const referralCode = generateReferralCode(userId);
        await pool.query('UPDATE users SET referral_code = $1 WHERE id = $2', [referralCode, userId]);
        
        // Check if user was referred by someone (from userState)
        const state = userStates.get(telegramId);
        if (state && state.referrerCode) {
            const referrerResult = await pool.query('SELECT id FROM users WHERE referral_code = $1', [state.referrerCode]);
            if (referrerResult.rows.length > 0) {
                const referrerId = referrerResult.rows[0].id;
                await pool.query('UPDATE users SET referrer_id = $1 WHERE id = $2', [referrerId, userId]);
                await awardReferralBonus(referrerId, userId);
            }
        }
        
        console.log(`New user registered: ${telegramId} - ${phoneNumber} - Referral: ${referralCode}`);
        
        let welcomeMessage = `✅ በተሳካ ሁኔታ ተመዝግበዋል!\n\n🎁 10 ብር የእንኳን ደህና መጡ ቦነስ አግኝተዋል!\n\n`;
        
        const referralLink = generateReferralLink(referralCode);
        if (referralLink) {
            welcomeMessage += `🔗 የእርስዎ ሪፈራል ሊንክ:\n${referralLink}\n\nጓደኞችዎን ይጋብዙ 2 ብር ቦነስ ያግኙ!\n\n`;
        } else {
            welcomeMessage += `🔗 የእርስዎ ሪፈራል ኮድ: ${referralCode}\n\nጓደኞችዎን ይጋብዙ 2 ብር ቦነስ ያግኙ!\n\n`;
        }
        
        welcomeMessage += `አሁን 'Play' ን ይጫኑ!\n\n💳 ለዲፖዚትና ማውጣት 'Wallet' ታብ ውስጥ ይገቡ።`;
        
        bot.sendMessage(chatId, welcomeMessage, {
            reply_markup: getMainKeyboard(telegramId)
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        bot.sendMessage(chatId, "ይቅርታ፣ በመመዝገብ ላይ ችግር ተፈጥሯል። እባክዎ እንደገና ይሞክሩ።");
    }
});

// Handle Check Balance button
bot.onText(/💰 Check Balance/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    
    try {
        const result = await pool.query(
            'SELECT w.balance FROM users u JOIN wallets w ON u.id = w.user_id WHERE u.telegram_id = $1',
            [telegramId]
        );
        
        if (result.rows.length > 0) {
            const balance = parseFloat(result.rows[0].balance).toFixed(2);
            bot.sendMessage(chatId, `💰 የእርስዎ ቀሪ ሒሳብ: ${balance} ብር`);
        } else {
            bot.sendMessage(chatId, "እባክዎ መጀመሪያ ይመዝገቡ። /start ይላኩ።");
        }
    } catch (error) {
        console.error('Balance check error:', error);
        bot.sendMessage(chatId, "ይቅርታ፣ ሒሳብዎን ማግኘት አልተቻለም።");
    }
});

// Handle Referral button
bot.onText(/🔗 ሪፈራል/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    
    try {
        const result = await pool.query(
            'SELECT referral_code FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (result.rows.length > 0 && result.rows[0].referral_code) {
            const referralCode = result.rows[0].referral_code;
            const referralLink = generateReferralLink(referralCode);
            
            let message;
            if (referralLink) {
                message = `🔗 <b>የእርስዎ ሪፈራል ሊንክ:</b>\n\n${referralLink}\n\n` +
                    `📋 ይህንን ሊንክ ለጓደኞችዎ ያጋሩ!\n` +
                    `🎁 አንድ ጓደኛ ሲመዘገብ 2 ብር ቦነስ ያገኛሉ!`;
            } else {
                message = `🔗 <b>የእርስዎ ሪፈራል ኮድ:</b>\n\n${referralCode}\n\n` +
                    `📋 ይህንን ኮድ ለጓደኞችዎ ያጋሩ!\n` +
                    `🎁 አንድ ጓደኛ ሲመዘገብ 2 ብር ቦነስ ያገኛሉ!`;
            }
            
            await bot.sendMessage(chatId, message,
                { parse_mode: 'HTML', reply_markup: getMainKeyboard(telegramId) }
            );
        } else {
            await bot.sendMessage(chatId, "እባክዎ መጀመሪያ ይመዝገቡ። /start ይላኩ።");
        }
    } catch (error) {
        console.error('Referral link error:', error);
        await bot.sendMessage(chatId, "ይቅርታ፣ ሪፈራል ሊንክ ማግኘት አልተቻለም።");
    }
});

// Handle Withdraw button - redirect to mini-app
bot.onText(/💸 Withdraw/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    
    await bot.sendMessage(chatId, 
        "💸 ገንዘብ ለማውጣት 'Play' ቁልፍን ተጭነው 'Wallet' ታብ ውስጥ ይግቡ።\n\nበWallet ታብ ውስጥ ዲፖዚትና ማውጣት በቀላሉ ማድረግ ይችላሉ!",
        { reply_markup: getMainKeyboard(telegramId) }
    );
});

// Handle Deposit button - redirect to mini-app
bot.onText(/💳 Deposit/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    
    await bot.sendMessage(chatId, 
        "💳 ገንዘብ ለማስገባት 'Play' ቁልፍን ተጭነው 'Wallet' ታብ ውስጥ ይግቡ።\n\nበWallet ታብ ውስጥ ዲፖዚትና ማውጣት በቀላሉ ማድረግ ይችላሉ!",
        { reply_markup: getMainKeyboard(telegramId) }
    );
});

// Handle Telebirr selection
bot.onText(/📱 Telebirr/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const state = userStates.get(telegramId);
    
    if (state?.action === 'deposit' && state?.step === 'method') {
        state.paymentMethod = 'telebirr';
        state.step = 'amount';
        userStates.set(telegramId, state);
        
        await bot.sendMessage(chatId, 
            '📱 Telebirr ተመርጧል\n\n💵 ማስገባት የሚፈልጉትን መጠን (ብር) ያስገቡ:',
            { reply_markup: { keyboard: [[{ text: "❌ ሰርዝ" }]], resize_keyboard: true } }
        );
    }
});

// Handle CBE Birr selection
bot.onText(/🏦 CBE Birr/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const state = userStates.get(telegramId);
    
    if (state?.action === 'deposit' && state?.step === 'method') {
        state.paymentMethod = 'cbe_birr';
        state.step = 'amount';
        userStates.set(telegramId, state);
        
        await bot.sendMessage(chatId, 
            '🏦 CBE Birr ተመርጧል\n\n💵 ማስገባት የሚፈልጉትን መጠን (ብር) ያስገቡ:',
            { reply_markup: { keyboard: [[{ text: "❌ ሰርዝ" }]], resize_keyboard: true } }
        );
    }
});

// Handle Cancel
bot.onText(/❌ ሰርዝ/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    
    userStates.delete(telegramId);
    await bot.sendMessage(chatId, '❌ ተሰርዟል።', { reply_markup: getMainKeyboard(telegramId) });
});

// Handle general text messages for conversation flow
bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/') || 
        msg.text.includes('💰') || msg.text.includes('💸') || 
        msg.text.includes('💳') || msg.text.includes('📱 Telebirr') || 
        msg.text.includes('🏦 CBE Birr') || msg.text.includes('❌') ||
        msg.text.includes('▶️') || msg.text.includes('📱 Register') ||
        msg.text.includes('🔗 ሪፈራል')) {
        return;
    }
    
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const text = msg.text.trim();
    const state = userStates.get(telegramId);
    
    if (!state) return;
    
    // Handle Withdraw flow
    if (state.action === 'withdraw') {
        if (state.step === 'amount') {
            const amount = parseFloat(text);
            if (isNaN(amount) || amount < 50) {
                await bot.sendMessage(chatId, '❌ ዝቅተኛው የማውጣት መጠን 50 ብር ነው።');
                return;
            }
            
            const balanceResult = await pool.query(
                'SELECT w.balance FROM wallets w JOIN users u ON w.user_id = u.id WHERE u.telegram_id = $1',
                [telegramId]
            );
            const balance = parseFloat(balanceResult.rows[0]?.balance || 0);
            
            if (amount > balance) {
                await bot.sendMessage(chatId, `❌ በቂ ሒሳብ የለም። ቀሪ: ${balance.toFixed(2)} ብር`);
                return;
            }
            
            state.amount = amount;
            state.step = 'phone';
            userStates.set(telegramId, state);
            
            await bot.sendMessage(chatId, '📞 ገንዘቡ የሚላክበትን ስልክ ቁጥር ያስገቡ:');
        } else if (state.step === 'phone') {
            state.phone = text;
            state.step = 'name';
            userStates.set(telegramId, state);
            
            await bot.sendMessage(chatId, '👤 የአካውንት ባለቤት ስም ያስገቡ:');
        } else if (state.step === 'name') {
            state.accountName = text;
            
            try {
                await pool.query(
                    'INSERT INTO withdrawals (user_id, amount, phone_number, account_name, status) VALUES ($1, $2, $3, $4, $5)',
                    [state.userId, state.amount, state.phone, state.accountName, 'pending']
                );
                
                const userResult = await pool.query(
                    'SELECT username FROM users WHERE id = $1',
                    [state.userId]
                );
                const username = userResult.rows[0]?.username || 'Unknown';
                
                await notifyAdmin(
                    `🔔 <b>አዲስ የገንዘብ ማውጣት ጥያቄ</b>\n\n` +
                    `👤 ተጠቃሚ: ${username}\n` +
                    `💵 መጠን: ${state.amount} ብር\n` +
                    `📞 ስልክ: ${state.phone}\n` +
                    `🏷 ስም: ${state.accountName}\n` +
                    `📅 ቀን: ${new Date().toLocaleString('am-ET')}`
                );
                
                userStates.delete(telegramId);
                await bot.sendMessage(chatId, 
                    `✅ የገንዘብ ማውጣት ጥያቄዎ ተልኳል!\n\n` +
                    `💵 መጠን: ${state.amount} ብር\n` +
                    `📞 ስልክ: ${state.phone}\n` +
                    `🏷 ስም: ${state.accountName}\n\n` +
                    `⏳ በቅርቡ ይፈጸማል።`,
                    { reply_markup: getMainKeyboard(telegramId) }
                );
            } catch (error) {
                console.error('Withdrawal request error:', error);
                await bot.sendMessage(chatId, 'ይቅርታ፣ ስህተት ተፈጥሯል።');
            }
        }
    }
    
    // Handle Deposit flow
    if (state.action === 'deposit') {
        if (state.step === 'amount') {
            const amount = parseFloat(text);
            if (isNaN(amount) || amount < 50) {
                await bot.sendMessage(chatId, '❌ ዝቅተኛው የዲፖዚት መጠን 50 ብር ነው።');
                return;
            }
            
            state.amount = amount;
            state.step = 'confirmation_code';
            userStates.set(telegramId, state);
            
            const paymentInfo = state.paymentMethod === 'telebirr' 
                ? '📱 Telebirr: 0980682889' 
                : '🏦 CBE: 1000123456789';
            
            await bot.sendMessage(chatId, 
                `💵 መጠን: ${amount} ብር\n\n` +
                `${paymentInfo}\n\n` +
                `ገንዘቡን ከላኩ በኋላ የማረጋገጫ ኮድዎን ያስገቡ:`
            );
        } else if (state.step === 'confirmation_code') {
            state.confirmationCode = text;
            
            try {
                await pool.query(
                    'INSERT INTO deposits (user_id, amount, payment_method, confirmation_code, status) VALUES ($1, $2, $3, $4, $5)',
                    [state.userId, state.amount, state.paymentMethod, state.confirmationCode, 'pending']
                );
                
                const userResult = await pool.query(
                    'SELECT username FROM users WHERE id = $1',
                    [state.userId]
                );
                const username = userResult.rows[0]?.username || 'Unknown';
                
                await notifyAdmin(
                    `🔔 <b>አዲስ ዲፖዚት ጥያቄ</b>\n\n` +
                    `👤 ተጠቃሚ: ${username}\n` +
                    `💵 መጠን: ${state.amount} ብር\n` +
                    `💳 ዘዴ: ${state.paymentMethod === 'telebirr' ? 'Telebirr' : 'CBE Birr'}\n` +
                    `🔑 ኮድ: ${state.confirmationCode}\n` +
                    `📅 ቀን: ${new Date().toLocaleString('am-ET')}`
                );
                
                userStates.delete(telegramId);
                await bot.sendMessage(chatId, 
                    `✅ የዲፖዚት ጥያቄዎ ተልኳል!\n\n` +
                    `💵 መጠን: ${state.amount} ብር\n` +
                    `💳 ዘዴ: ${state.paymentMethod === 'telebirr' ? 'Telebirr' : 'CBE Birr'}\n` +
                    `🔑 ኮድ: ${state.confirmationCode}\n\n` +
                    `⏳ ከተረጋገጠ በኋላ ሒሳብዎ ይጨምራል።`,
                    { reply_markup: getMainKeyboard(telegramId) }
                );
            } catch (error) {
                console.error('Deposit request error:', error);
                await bot.sendMessage(chatId, 'ይቅርታ፣ ስህተት ተፈጥሯል።');
            }
        }
    }
});

// Admin command to set admin
bot.onText(/\/setadmin/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    
    try {
        await pool.query(
            'INSERT INTO admin_users (telegram_id, username) VALUES ($1, $2) ON CONFLICT (telegram_id) DO UPDATE SET is_active = true',
            [telegramId, msg.from.username || 'Admin']
        );
        
        await bot.sendMessage(chatId, 
            `✅ እርስዎ አድሚን ሆነዋል!\n\nChat ID: ${chatId}\n\nይህን Chat ID ወደ ADMIN_CHAT_ID environment variable ያስገቡ።`
        );
    } catch (error) {
        console.error('Set admin error:', error);
    }
});

// Admin command to view pending transactions
bot.onText(/\/pending/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    
    try {
        const adminCheck = await pool.query(
            'SELECT * FROM admin_users WHERE telegram_id = $1 AND is_active = true',
            [telegramId]
        );
        
        if (adminCheck.rows.length === 0 && chatId.toString() !== ADMIN_CHAT_ID) {
            await bot.sendMessage(chatId, '❌ የአድሚን መብት የለዎትም።');
            return;
        }
        
        const pendingDeposits = await pool.query(`
            SELECT d.id, d.amount, d.payment_method, d.confirmation_code, d.created_at, u.username
            FROM deposits d
            JOIN users u ON d.user_id = u.id
            WHERE d.status = 'pending'
            ORDER BY d.created_at DESC
            LIMIT 10
        `);
        
        const pendingWithdrawals = await pool.query(`
            SELECT w.id, w.amount, w.phone_number, w.account_name, w.created_at, u.username
            FROM withdrawals w
            JOIN users u ON w.user_id = u.id
            WHERE w.status = 'pending'
            ORDER BY w.created_at DESC
            LIMIT 10
        `);
        
        let message = '📋 <b>በመጠባበቅ ላይ ያሉ ግብይቶች</b>\n\n';
        
        if (pendingDeposits.rows.length > 0) {
            message += '💳 <b>ዲፖዚቶች:</b>\n';
            for (const d of pendingDeposits.rows) {
                message += `ID:${d.id} | ${d.username} | ${d.amount}ብር | ${d.payment_method} | ኮድ:${d.confirmation_code}\n`;
            }
            message += '\n';
        } else {
            message += '💳 ዲፖዚቶች የሉም\n\n';
        }
        
        if (pendingWithdrawals.rows.length > 0) {
            message += '💸 <b>ማውጣቶች:</b>\n';
            for (const w of pendingWithdrawals.rows) {
                message += `ID:${w.id} | ${w.username} | ${w.amount}ብር | ${w.phone_number} | ${w.account_name}\n`;
            }
        } else {
            message += '💸 ማውጣቶች የሉም';
        }
        
        message += '\n\n<b>Commands:</b>\n/approve_deposit [ID]\n/reject_deposit [ID]\n/approve_withdraw [ID]\n/reject_withdraw [ID]';
        
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('Pending check error:', error);
        await bot.sendMessage(chatId, 'ስህተት ተፈጥሯል።');
    }
});

// Approve deposit
bot.onText(/\/approve_deposit (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    const depositId = parseInt(match[1]);
    
    try {
        const adminCheck = await pool.query(
            'SELECT * FROM admin_users WHERE telegram_id = $1 AND is_active = true',
            [telegramId]
        );
        
        if (adminCheck.rows.length === 0 && chatId.toString() !== ADMIN_CHAT_ID) {
            await bot.sendMessage(chatId, '❌ የአድሚን መብት የለዎትም።');
            return;
        }
        
        const deposit = await pool.query(
            'SELECT d.*, u.telegram_id as user_telegram_id FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.id = $1',
            [depositId]
        );
        
        if (deposit.rows.length === 0) {
            await bot.sendMessage(chatId, '❌ ዲፖዚት አልተገኘም።');
            return;
        }
        
        const d = deposit.rows[0];
        
        if (d.status !== 'pending') {
            await bot.sendMessage(chatId, '❌ ይህ ዲፖዚት ቀድሞ ተፈጽሟል።');
            return;
        }
        
        await pool.query('UPDATE deposits SET status = $1, confirmed_at = NOW() WHERE id = $2', ['confirmed', depositId]);
        
        // First ensure wallet exists, then update balance
        await pool.query(
            'INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING',
            [d.user_id]
        );
        
        await pool.query(
            'UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2',
            [d.amount, d.user_id]
        );
        
        await pool.query(
            'INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)',
            [d.user_id, 'deposit', d.amount, `Deposit via ${d.payment_method}`]
        );
        
        await bot.sendMessage(chatId, `✅ ዲፖዚት #${depositId} ተፈቅዷል! ${d.amount} ብር ወደ ሒሳብ ተጨምሯል።`);
        
        if (d.user_telegram_id) {
            await bot.sendMessage(d.user_telegram_id, 
                `✅ ዲፖዚትዎ ተረጋግጧል!\n\n💵 ${d.amount} ብር ወደ ሒሳብዎ ተጨምሯል።`
            );
        }
    } catch (error) {
        console.error('Approve deposit error:', error);
        await bot.sendMessage(chatId, 'ስህተት ተፈጥሯል።');
    }
});

// Reject deposit
bot.onText(/\/reject_deposit (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    const depositId = parseInt(match[1]);
    
    try {
        const adminCheck = await pool.query(
            'SELECT * FROM admin_users WHERE telegram_id = $1 AND is_active = true',
            [telegramId]
        );
        
        if (adminCheck.rows.length === 0 && chatId.toString() !== ADMIN_CHAT_ID) {
            await bot.sendMessage(chatId, '❌ የአድሚን መብት የለዎትም።');
            return;
        }
        
        const deposit = await pool.query(
            'SELECT d.*, u.telegram_id as user_telegram_id FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.id = $1',
            [depositId]
        );
        
        if (deposit.rows.length === 0) {
            await bot.sendMessage(chatId, '❌ ዲፖዚት አልተገኘም።');
            return;
        }
        
        const d = deposit.rows[0];
        
        await pool.query('UPDATE deposits SET status = $1 WHERE id = $2', ['rejected', depositId]);
        
        await bot.sendMessage(chatId, `❌ ዲፖዚት #${depositId} ተቀባይነት አላገኘም።`);
        
        if (d.user_telegram_id) {
            await bot.sendMessage(d.user_telegram_id, 
                `❌ ዲፖዚትዎ ተቀባይነት አላገኘም።\n\nእባክዎ ትክክለኛ መረጃ ይላኩ ወይም ድጋሚ ይሞክሩ።`
            );
        }
    } catch (error) {
        console.error('Reject deposit error:', error);
        await bot.sendMessage(chatId, 'ስህተት ተፈጥሯል።');
    }
});

// Approve withdrawal
bot.onText(/\/approve_withdraw (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    const withdrawalId = parseInt(match[1]);
    
    try {
        const adminCheck = await pool.query(
            'SELECT * FROM admin_users WHERE telegram_id = $1 AND is_active = true',
            [telegramId]
        );
        
        if (adminCheck.rows.length === 0 && chatId.toString() !== ADMIN_CHAT_ID) {
            await bot.sendMessage(chatId, '❌ የአድሚን መብት የለዎትም።');
            return;
        }
        
        const withdrawal = await pool.query(
            'SELECT w.*, u.telegram_id as user_telegram_id FROM withdrawals w JOIN users u ON w.user_id = u.id WHERE w.id = $1',
            [withdrawalId]
        );
        
        if (withdrawal.rows.length === 0) {
            await bot.sendMessage(chatId, '❌ ማውጣት ጥያቄ አልተገኘም።');
            return;
        }
        
        const w = withdrawal.rows[0];
        
        if (w.status !== 'pending') {
            await bot.sendMessage(chatId, '❌ ይህ ጥያቄ ቀድሞ ተፈጽሟል።');
            return;
        }
        
        const balanceCheck = await pool.query(
            'SELECT balance FROM wallets WHERE user_id = $1',
            [w.user_id]
        );
        
        if (parseFloat(balanceCheck.rows[0]?.balance || 0) < w.amount) {
            await bot.sendMessage(chatId, '❌ ተጠቃሚው በቂ ሒሳብ የለውም።');
            return;
        }
        
        await pool.query('UPDATE withdrawals SET status = $1, processed_at = NOW() WHERE id = $2', ['approved', withdrawalId]);
        
        await pool.query(
            'UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2',
            [w.amount, w.user_id]
        );
        
        await pool.query(
            'INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)',
            [w.user_id, 'withdrawal', w.amount, `Withdrawal to ${w.phone_number}`]
        );
        
        await bot.sendMessage(chatId, `✅ ማውጣት #${withdrawalId} ተፈቅዷል! ${w.amount} ብር ወደ ${w.phone_number} ይላካል።`);
        
        if (w.user_telegram_id) {
            await bot.sendMessage(w.user_telegram_id, 
                `✅ የገንዘብ ማውጣት ጥያቄዎ ተፈቅዷል!\n\n💵 ${w.amount} ብር ወደ ${w.phone_number} ተልኳል።`
            );
        }
    } catch (error) {
        console.error('Approve withdrawal error:', error);
        await bot.sendMessage(chatId, 'ስህተት ተፈጥሯል።');
    }
});

// Reject withdrawal
bot.onText(/\/reject_withdraw (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    const withdrawalId = parseInt(match[1]);
    
    try {
        const adminCheck = await pool.query(
            'SELECT * FROM admin_users WHERE telegram_id = $1 AND is_active = true',
            [telegramId]
        );
        
        if (adminCheck.rows.length === 0 && chatId.toString() !== ADMIN_CHAT_ID) {
            await bot.sendMessage(chatId, '❌ የአድሚን መብት የለዎትም።');
            return;
        }
        
        const withdrawal = await pool.query(
            'SELECT w.*, u.telegram_id as user_telegram_id FROM withdrawals w JOIN users u ON w.user_id = u.id WHERE w.id = $1',
            [withdrawalId]
        );
        
        if (withdrawal.rows.length === 0) {
            await bot.sendMessage(chatId, '❌ ማውጣት ጥያቄ አልተገኘም።');
            return;
        }
        
        const w = withdrawal.rows[0];
        
        await pool.query('UPDATE withdrawals SET status = $1, processed_at = NOW() WHERE id = $2', ['rejected', withdrawalId]);
        
        await bot.sendMessage(chatId, `❌ ማውጣት #${withdrawalId} ተቀባይነት አላገኘም።`);
        
        if (w.user_telegram_id) {
            await bot.sendMessage(w.user_telegram_id, 
                `❌ የገንዘብ ማውጣት ጥያቄዎ ተቀባይነት አላገኘም።\n\nለበለጠ መረጃ እባክዎ ያግኙን።`
            );
        }
    } catch (error) {
        console.error('Reject withdrawal error:', error);
        await bot.sendMessage(chatId, 'ስህተት ተፈጥሯል።');
    }
});

bot.on('polling_error', (error) => {
    console.error("Polling error:", error.code, error.message);
});

bot.on('error', (error) => {
    console.error("Bot error:", error.message);
});

} // End of if (bot) block

// --- End of Telegram Bot Logic ---

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const JWT_SECRET = process.env.JWT_SECRET || 'chewatabingo-secret-key-change-in-production';
const SELECTION_TIME = 45;
const WINNER_DISPLAY_TIME = 5;

let currentGameId = null;
let gameState = {
    phase: 'selection',
    timeLeft: SELECTION_TIME,
    calledNumbers: [],
    masterNumbers: [],
    winner: null,
    players: new Map(),
    stakeAmount: 10
};

let playerIdCounter = 0;

function initializeMasterNumbers() {
    gameState.masterNumbers = [];
    for (let i = 1; i <= 75; i++) {
        gameState.masterNumbers.push(i);
    }
    gameState.calledNumbers = [];
}

function getLetterForNumber(num) {
    if (num >= 1 && num <= 15) return 'B';
    if (num >= 16 && num <= 30) return 'I';
    if (num >= 31 && num <= 45) return 'N';
    if (num >= 46 && num <= 60) return 'G';
    if (num >= 61 && num <= 75) return 'O';
    return '';
}

function callNumber() {
    const uncalledNumbers = gameState.masterNumbers.filter(
        num => !gameState.calledNumbers.includes(num)
    );
    
    if (uncalledNumbers.length === 0) {
        return null;
    }
    
    const randomIndex = Math.floor(Math.random() * uncalledNumbers.length);
    const calledNumber = uncalledNumbers[randomIndex];
    gameState.calledNumbers.push(calledNumber);
    
    return {
        number: calledNumber,
        letter: getLetterForNumber(calledNumber)
    };
}

function broadcast(message) {
    const data = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

function getConfirmedPlayersCount() {
    let count = 0;
    gameState.players.forEach((player) => {
        if (player.isCardConfirmed) {
            count++;
        }
    });
    return count;
}

async function startSelectionPhase() {
    gameState.phase = 'selection';
    gameState.timeLeft = SELECTION_TIME;
    gameState.winner = null;
    gameState.calledNumbers = [];
    
    gameState.players.forEach((player, id) => {
        player.selectedCardId = null;
        player.isCardConfirmed = false;
    });
    
    try {
        const game = await Game.create(gameState.stakeAmount);
        currentGameId = game.id;
        console.log(`New game created: #${currentGameId}`);
    } catch (err) {
        console.error('Error creating game:', err);
    }
    
    broadcast({
        type: 'phase_change',
        phase: 'selection',
        timeLeft: gameState.timeLeft,
        gameId: currentGameId
    });
}

function startGamePhase() {
    gameState.phase = 'game';
    gameState.timeLeft = -1;
    initializeMasterNumbers();
    
    broadcast({
        type: 'phase_change',
        phase: 'game',
        timeLeft: -1,
        players: getPlayersInfo()
    });
}

async function startWinnerDisplay(winnerInfo) {
    stopNumberCalling();
    gameState.phase = 'winner';
    gameState.timeLeft = WINNER_DISPLAY_TIME;
    gameState.winner = winnerInfo;
    
    try {
        if (currentGameId && winnerInfo.userId) {
            const game = await Game.setWinner(
                currentGameId, 
                winnerInfo.userId, 
                winnerInfo.cardId,
                gameState.calledNumbers
            );
            
            if (game && game.total_pot > 0) {
                await Wallet.win(winnerInfo.userId, game.total_pot, currentGameId);
                winnerInfo.prize = game.total_pot;
                
                // Send real-time balance update to the winner
                const newBalance = await Wallet.getBalance(winnerInfo.userId);
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        const player = gameState.players.get(client.playerId);
                        if (player && player.userId === winnerInfo.userId) {
                            client.send(JSON.stringify({
                                type: 'balance_update',
                                balance: parseFloat(newBalance),
                                prize: game.total_pot
                            }));
                        }
                    }
                });
            }
        }
    } catch (err) {
        console.error('Error recording winner:', err);
    }
    
    broadcast({
        type: 'phase_change',
        phase: 'winner',
        timeLeft: gameState.timeLeft,
        winner: winnerInfo
    });
}

function getPlayersInfo() {
    const players = [];
    gameState.players.forEach((player, id) => {
        if (player.isCardConfirmed) {
            players.push({
                id: id,
                username: player.username,
                cardId: player.selectedCardId
            });
        }
    });
    return players;
}

let numberCallInterval = null;

function startNumberCalling() {
    if (numberCallInterval) clearInterval(numberCallInterval);
    
    numberCallInterval = setInterval(() => {
        if (gameState.phase === 'game') {
            const call = callNumber();
            if (call) {
                broadcast({
                    type: 'number_called',
                    number: call.number,
                    letter: call.letter,
                    calledNumbers: gameState.calledNumbers
                });
            } else {
                stopNumberCalling();
                broadcast({
                    type: 'all_numbers_called'
                });
                setTimeout(() => {
                    if (gameState.phase === 'game') {
                        startSelectionPhase();
                    }
                }, 5000);
            }
        }
    }, 3000);
}

function stopNumberCalling() {
    if (numberCallInterval) {
        clearInterval(numberCallInterval);
        numberCallInterval = null;
    }
}

async function gameLoop() {
    if (gameState.phase === 'game') {
        return;
    }
    
    gameState.timeLeft--;
    
    broadcast({
        type: 'timer_update',
        phase: gameState.phase,
        timeLeft: gameState.timeLeft
    });
    
    if (gameState.timeLeft <= 0) {
        if (gameState.phase === 'selection') {
            const confirmedPlayers = getConfirmedPlayersCount();
            
            if (confirmedPlayers >= 1) {
                startGamePhase();
                startNumberCalling();
            } else {
                await startSelectionPhase();
            }
        } else if (gameState.phase === 'winner') {
            await startSelectionPhase();
        }
    }
}

wss.on('connection', (ws) => {
    const playerId = ++playerIdCounter;
    const player = {
        id: playerId,
        userId: null,
        username: 'Guest_' + playerId,
        selectedCardId: null,
        isCardConfirmed: false,
        balance: 0
    };
    gameState.players.set(playerId, player);
    
    ws.playerId = playerId;
    
    ws.send(JSON.stringify({
        type: 'init',
        playerId: playerId,
        phase: gameState.phase,
        timeLeft: gameState.timeLeft,
        calledNumbers: gameState.calledNumbers,
        winner: gameState.winner,
        gameId: currentGameId
    }));
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const player = gameState.players.get(playerId);
            
            switch (data.type) {
                case 'auth_telegram':
                    try {
                        const user = await User.findOrCreateByTelegram(
                            data.telegramId,
                            data.username
                        );
                        player.userId = user.id;
                        player.username = user.username;
                        player.balance = parseFloat(user.balance || 0);
                        
                        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
                        
                        ws.send(JSON.stringify({
                            type: 'auth_success',
                            token: token,
                            user: {
                                id: user.id,
                                username: user.username,
                                balance: player.balance
                            }
                        }));
                    } catch (err) {
                        console.error('Auth error:', err);
                        ws.send(JSON.stringify({ type: 'auth_error', error: 'Authentication failed' }));
                    }
                    break;

                case 'auth_token':
                    try {
                        const decoded = jwt.verify(data.token, JWT_SECRET);
                        const user = await User.findById(decoded.userId);
                        
                        if (user) {
                            player.userId = user.id;
                            player.username = user.username;
                            player.balance = parseFloat(user.balance || 0);
                            
                            ws.send(JSON.stringify({
                                type: 'auth_success',
                                user: {
                                    id: user.id,
                                    username: user.username,
                                    balance: player.balance
                                }
                            }));
                        }
                    } catch (err) {
                        ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid token' }));
                    }
                    break;

                case 'register':
                    try {
                        const existingUser = await User.findByUsername(data.username);
                        if (existingUser) {
                            ws.send(JSON.stringify({ type: 'register_error', error: 'Username taken' }));
                            break;
                        }
                        
                        const newUser = await User.create(data.username, data.password);
                        player.userId = newUser.id;
                        player.username = newUser.username;
                        player.balance = 0;
                        
                        const token = jwt.sign({ userId: newUser.id }, JWT_SECRET, { expiresIn: '7d' });
                        
                        ws.send(JSON.stringify({
                            type: 'register_success',
                            token: token,
                            user: {
                                id: newUser.id,
                                username: newUser.username,
                                balance: 0
                            }
                        }));
                    } catch (err) {
                        console.error('Register error:', err);
                        ws.send(JSON.stringify({ type: 'register_error', error: 'Registration failed' }));
                    }
                    break;

                case 'login':
                    try {
                        const user = await User.findByUsername(data.username);
                        if (!user || !(await User.verifyPassword(user, data.password))) {
                            ws.send(JSON.stringify({ type: 'login_error', error: 'Invalid credentials' }));
                            break;
                        }
                        
                        player.userId = user.id;
                        player.username = user.username;
                        player.balance = parseFloat(user.balance || 0);
                        await User.updateLastLogin(user.id);
                        
                        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
                        
                        ws.send(JSON.stringify({
                            type: 'login_success',
                            token: token,
                            user: {
                                id: user.id,
                                username: user.username,
                                balance: player.balance
                            }
                        }));
                    } catch (err) {
                        console.error('Login error:', err);
                        ws.send(JSON.stringify({ type: 'login_error', error: 'Login failed' }));
                    }
                    break;
                    
                case 'set_username':
                    if (gameState.players.has(playerId)) {
                        gameState.players.get(playerId).username = data.username;
                    }
                    break;
                    
                case 'select_card':
                    if (gameState.phase === 'selection' && gameState.players.has(playerId)) {
                        gameState.players.get(playerId).selectedCardId = data.cardId;
                    }
                    break;
                    
                case 'confirm_card':
                    if (gameState.phase === 'selection' && player) {
                        if (!player.userId) {
                            ws.send(JSON.stringify({ 
                                type: 'error', 
                                error: 'Please login first' 
                            }));
                            break;
                        }
                        
                        // Use cardId from message data if player hasn't selected yet
                        const cardIdToConfirm = data.cardId || player.selectedCardId;
                        
                        if (cardIdToConfirm) {
                            player.selectedCardId = cardIdToConfirm;
                            
                            // Note: Stake is already deducted via /api/bet, just confirm the card
                            player.isCardConfirmed = true;
                            
                            try {
                                await Game.addParticipant(
                                    currentGameId,
                                    player.userId,
                                    cardIdToConfirm,
                                    gameState.stakeAmount
                                );
                            } catch (err) {
                                console.error('Error adding participant:', err);
                            }
                            
                            // Get updated balance
                            const balance = await Wallet.getBalance(player.userId);
                            player.balance = parseFloat(balance);
                            
                            ws.send(JSON.stringify({
                                type: 'card_confirmed',
                                cardId: cardIdToConfirm,
                                balance: player.balance
                            }));
                        }
                    }
                    break;
                    
                case 'claim_bingo':
                    if (gameState.phase === 'game' && player) {
                        if (player.isCardConfirmed && player.selectedCardId) {
                            // Server-side validation - don't trust client isValid
                            const isValidBingo = validateBingo(player.selectedCardId, gameState.calledNumbers);
                            
                            if (isValidBingo) {
                                startWinnerDisplay({
                                    userId: player.userId,
                                    username: player.username,
                                    cardId: player.selectedCardId
                                });
                            } else {
                                ws.send(JSON.stringify({
                                    type: 'bingo_rejected',
                                    error: 'ቢንጎ ትክክል አይደለም'
                                }));
                            }
                        }
                    }
                    break;

                case 'get_balance':
                    if (player.userId) {
                        try {
                            const balance = await Wallet.getBalance(player.userId);
                            player.balance = parseFloat(balance);
                            ws.send(JSON.stringify({
                                type: 'balance_update',
                                balance: player.balance
                            }));
                        } catch (err) {
                            console.error('Balance error:', err);
                        }
                    }
                    break;

                case 'get_transactions':
                    if (player.userId) {
                        try {
                            const transactions = await Wallet.getTransactionHistory(player.userId);
                            ws.send(JSON.stringify({
                                type: 'transactions',
                                transactions: transactions
                            }));
                        } catch (err) {
                            console.error('Transactions error:', err);
                        }
                    }
                    break;

                case 'get_game_history':
                    if (player.userId) {
                        try {
                            const history = await Game.getUserGameHistory(player.userId);
                            const stats = await Game.getUserStats(player.userId);
                            ws.send(JSON.stringify({
                                type: 'game_history',
                                history: history,
                                stats: stats
                            }));
                        } catch (err) {
                            console.error('Game history error:', err);
                        }
                    }
                    break;

                case 'deposit':
                    if (player.userId && data.amount > 0) {
                        try {
                            const result = await Wallet.deposit(player.userId, data.amount);
                            if (result.success) {
                                player.balance = result.balance;
                                ws.send(JSON.stringify({
                                    type: 'deposit_success',
                                    balance: result.balance
                                }));
                            }
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'deposit_error', error: 'Deposit failed' }));
                        }
                    }
                    break;
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });
    
    ws.on('close', () => {
        gameState.players.delete(playerId);
    });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const existingUser = await User.findByUsername(username);
        if (existingUser) {
            return res.status(400).json({ error: 'Username already taken' });
        }
        
        const user = await User.create(username, password);
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({ 
            token, 
            user: { id: user.id, username: user.username, balance: 0 } 
        });
    } catch (err) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const user = await User.findByUsername(username);
        if (!user || !(await User.verifyPassword(user, password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        await User.updateLastLogin(user.id);
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({ 
            token, 
            user: { id: user.id, username: user.username, balance: user.balance } 
        });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/register', async (req, res) => {
    try {
        const { userId, phoneNumber } = req.body;
        
        if (!userId || !phoneNumber) {
            return res.status(400).json({ success: false, message: 'userId and phoneNumber are required' });
        }

        const telegramId = parseInt(userId) || 0;
        
        const existingUser = await pool.query(
            'SELECT * FROM users WHERE telegram_id = $1',
            [telegramId]
        );

        if (existingUser.rows.length > 0) {
            return res.json({ success: false, message: 'User already registered.' });
        }

        const username = 'Player_' + telegramId;
        const userResult = await pool.query(
            `INSERT INTO users (telegram_id, username, phone_number, is_registered) 
             VALUES ($1, $2, $3, TRUE) RETURNING id`,
            [telegramId, username, phoneNumber]
        );

        const newUserId = userResult.rows[0].id;
        
        await pool.query(
            `INSERT INTO wallets (user_id, balance, currency) 
             VALUES ($1, 10.00, 'ETB')`,
            [newUserId]
        );

        res.json({ success: true, message: 'Registration successful. 10 ETB welcome bonus added.' });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ success: false, message: 'Registration failed' });
    }
});

app.get('/api/check-registration/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const tgId = parseInt(telegramId) || 0;
        
        const result = await pool.query(
            'SELECT id, is_registered FROM users WHERE telegram_id = $1',
            [tgId]
        );

        if (result.rows.length === 0) {
            return res.json({ registered: false });
        }

        res.json({ registered: result.rows[0].is_registered || false });
    } catch (err) {
        console.error('Check registration error:', err);
        res.json({ registered: false });
    }
});

app.get('/api/check-admin/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const tgId = telegramId.toString();
        
        const result = await pool.query(
            'SELECT * FROM admin_users WHERE telegram_id = $1 AND is_active = true',
            [tgId]
        );

        const isEnvAdmin = ADMIN_CHAT_ID && tgId === ADMIN_CHAT_ID.toString();

        res.json({ isAdmin: result.rows.length > 0 || isEnvAdmin });
    } catch (err) {
        console.error('Check admin error:', err);
        res.json({ isAdmin: false });
    }
});

app.get('/api/profile/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const tgId = parseInt(telegramId) || 0;
        
        const userResult = await pool.query(
            `SELECT u.id, u.username, u.telegram_id, u.phone_number, u.is_registered, u.created_at, u.referral_code, w.balance 
             FROM users u 
             LEFT JOIN wallets w ON u.id = w.user_id 
             WHERE u.telegram_id = $1`,
            [tgId]
        );

        if (userResult.rows.length === 0) {
            return res.json({ success: false, message: 'User not found' });
        }

        const user = userResult.rows[0];
        
        const gamesResult = await pool.query(
            `SELECT COUNT(*) as total_games FROM game_participants WHERE user_id = $1`,
            [user.id]
        );
        
        const winsResult = await pool.query(
            `SELECT COUNT(*) as wins FROM games WHERE winner_id = $1`,
            [user.id]
        );

        res.json({
            success: true,
            profile: {
                username: user.username || 'Player',
                telegramId: user.telegram_id,
                phoneNumber: user.phone_number || '---',
                balance: parseFloat(user.balance) || 0,
                totalGames: parseInt(gamesResult.rows[0].total_games) || 0,
                wins: parseInt(winsResult.rows[0].wins) || 0,
                memberSince: user.created_at,
                referralCode: user.referral_code || null,
                referralLink: user.referral_code ? generateReferralLink(user.referral_code) : null
            }
        });
    } catch (err) {
        console.error('Profile error:', err);
        res.status(500).json({ success: false, message: 'Failed to load profile' });
    }
});

app.get('/api/wallet/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const telegramId = parseInt(userId) || 0;
        
        console.log('Wallet API called for telegram_id:', telegramId);
        
        const result = await pool.query(
            `SELECT u.id, u.is_registered, COALESCE(w.balance, 0) as balance 
             FROM users u 
             LEFT JOIN wallets w ON u.id = w.user_id 
             WHERE u.telegram_id = $1`,
            [telegramId]
        );

        if (result.rows.length === 0) {
            console.log('No user found for telegram_id:', telegramId);
            return res.json({ 
                success: false,
                balance: 0, 
                is_registered: false,
                stake: 10,
                totalGames: 0,
                wins: 0,
                totalWinnings: 0,
                history: []
            });
        }

        const user = result.rows[0];
        const internalUserId = user.id;
        
        console.log('Wallet user found:', { internalUserId, balance: user.balance, is_registered: user.is_registered });
        
        const gamesResult = await pool.query(
            `SELECT COUNT(*) as total_games FROM game_participants WHERE user_id = $1`,
            [internalUserId]
        );
        
        const winsResult = await pool.query(
            `SELECT COUNT(*) as wins FROM games WHERE winner_id = $1`,
            [internalUserId]
        );
        
        const winningsResult = await pool.query(
            `SELECT COALESCE(SUM(prize_amount), 0) as total_winnings FROM games WHERE winner_id = $1`,
            [internalUserId]
        );
        
        const historyResult = await pool.query(`
            SELECT 'deposit' as type, amount, status, created_at FROM deposits WHERE user_id = $1
            UNION ALL
            SELECT 'withdraw' as type, amount, status, created_at FROM withdrawals WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 20
        `, [internalUserId]);
        
        const balanceValue = parseFloat(user.balance) || 0;
        console.log('Returning wallet balance:', balanceValue);
        
        res.json({ 
            success: true,
            balance: balanceValue, 
            is_registered: user.is_registered || false,
            stake: 10,
            totalGames: parseInt(gamesResult.rows[0].total_games) || 0,
            wins: parseInt(winsResult.rows[0].wins) || 0,
            totalWinnings: parseFloat(winningsResult.rows[0].total_winnings) || 0,
            history: historyResult.rows
        });
    } catch (err) {
        console.error('Wallet error:', err);
        res.status(500).json({ success: false, balance: 0, is_registered: false, stake: 10, history: [] });
    }
});

// Deposit request from mini-app
app.post('/api/deposits', async (req, res) => {
    try {
        const { telegram_id, amount, reference } = req.body;
        
        if (!telegram_id || !amount || !reference) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        
        const userResult = await pool.query(
            'SELECT id, username FROM users WHERE telegram_id = $1',
            [parseInt(telegram_id)]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const userId = userResult.rows[0].id;
        const username = userResult.rows[0].username || 'Unknown';
        
        await pool.query(
            'INSERT INTO deposits (user_id, amount, payment_method, confirmation_code, status, created_at) VALUES ($1, $2, $3, $4, $5, NOW())',
            [userId, amount, 'telebirr', reference, 'pending']
        );
        
        const adminMessage = `🔔 <b>አዲስ ዲፖዚት ጥያቄ</b>\n\n` +
            `👤 ተጠቃሚ: ${username}\n` +
            `💵 መጠን: ${amount} ብር\n` +
            `🔑 ኮድ: ${reference}\n` +
            `📅 ቀን: ${new Date().toLocaleString('am-ET')}`;
        
        await notifyAdmin(adminMessage);
        
        res.json({ success: true, message: 'Deposit request submitted' });
    } catch (err) {
        console.error('Deposit error:', err);
        res.status(500).json({ success: false, message: 'Failed to submit deposit' });
    }
});

// Withdrawal request from mini-app
app.post('/api/withdrawals', async (req, res) => {
    try {
        const { telegram_id, amount, phone_number } = req.body;
        
        if (!telegram_id || !amount || !phone_number) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        
        const userResult = await pool.query(
            'SELECT u.id, w.balance FROM users u JOIN wallets w ON u.id = w.user_id WHERE u.telegram_id = $1',
            [parseInt(telegram_id)]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const userId = userResult.rows[0].id;
        const balance = parseFloat(userResult.rows[0].balance) || 0;
        
        if (balance < amount) {
            return res.json({ success: false, message: 'ቀሪ ሒሳብዎ በቂ አይደለም' });
        }
        
        // Check eligibility (includes min 50 birr balance check and other requirements)
        const eligibility = await checkWithdrawEligibility(parseInt(telegram_id));
        if (!eligibility.eligible) {
            const message = eligibility.message || 'ማውጣት አይችሉም';
            return res.json({ success: false, message });
        }
        
        await pool.query(
            'INSERT INTO withdrawals (user_id, amount, phone_number, status, created_at) VALUES ($1, $2, $3, $4, NOW())',
            [userId, amount, phone_number, 'pending']
        );
        
        await notifyAdmin(`💸 <b>New Withdrawal Request</b>\nAmount: ${amount} ETB\nPhone: ${phone_number}\nUser ID: ${telegram_id}`);
        
        res.json({ success: true, message: 'Withdrawal request submitted' });
    } catch (err) {
        console.error('Withdrawal error:', err);
        res.status(500).json({ success: false, message: 'Failed to submit withdrawal' });
    }
});

app.post('/api/bet', async (req, res) => {
    try {
        const { userId, stakeAmount } = req.body;
        
        if (!userId || !stakeAmount) {
            return res.status(400).json({ success: false, message: 'userId and stakeAmount are required' });
        }

        const telegramId = parseInt(userId) || 0;

        const userResult = await pool.query(
            'SELECT u.id, w.balance FROM users u JOIN wallets w ON u.id = w.user_id WHERE u.telegram_id = $1',
            [telegramId]
        );

        if (userResult.rows.length === 0) {
            return res.json({ success: false, message: 'User not found' });
        }

        const internalUserId = userResult.rows[0].id;
        const currentBalance = parseFloat(userResult.rows[0].balance) || 0;
        
        if (currentBalance < stakeAmount) {
            return res.json({ success: false, message: 'Insufficient balance' });
        }

        const newBalance = currentBalance - stakeAmount;
        
        await pool.query(
            'UPDATE wallets SET balance = $1 WHERE user_id = $2',
            [newBalance, internalUserId]
        );

        res.json({ success: true, balance: newBalance });
    } catch (err) {
        console.error('Bet error:', err);
        res.status(500).json({ success: false, message: 'Bet failed' });
    }
});

// ================== Admin API Routes ==================

// Admin Stats
app.get('/api/admin/stats', async (req, res) => {
    try {
        const totalUsers = await pool.query('SELECT COUNT(*) as count FROM users');
        const pendingDeposits = await pool.query('SELECT COUNT(*) as count FROM deposits WHERE status = $1', ['pending']);
        const pendingWithdrawals = await pool.query('SELECT COUNT(*) as count FROM withdrawals WHERE status = $1', ['pending']);
        const todayGames = await pool.query(
            "SELECT COUNT(*) as count FROM games WHERE started_at >= CURRENT_DATE"
        );
        
        res.json({
            totalUsers: parseInt(totalUsers.rows[0].count),
            pendingDeposits: parseInt(pendingDeposits.rows[0].count),
            pendingWithdrawals: parseInt(pendingWithdrawals.rows[0].count),
            todayGames: parseInt(todayGames.rows[0].count)
        });
    } catch (err) {
        console.error('Admin stats error:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Get all deposits
app.get('/api/admin/deposits', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT d.*, u.username 
            FROM deposits d 
            JOIN users u ON d.user_id = u.id 
            ORDER BY d.created_at DESC 
            LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Admin deposits error:', err);
        res.status(500).json({ error: 'Failed to fetch deposits' });
    }
});

// Get all withdrawals
app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT w.*, u.username 
            FROM withdrawals w 
            JOIN users u ON w.user_id = u.id 
            ORDER BY w.created_at DESC 
            LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Admin withdrawals error:', err);
        res.status(500).json({ error: 'Failed to fetch withdrawals' });
    }
});

// Get all users
app.get('/api/admin/users', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.phone_number, u.created_at, w.balance 
            FROM users u 
            LEFT JOIN wallets w ON u.id = w.user_id 
            ORDER BY u.created_at DESC 
            LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Admin users error:', err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Get transactions
app.get('/api/admin/transactions', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, u.username 
            FROM transactions t 
            JOIN users u ON t.user_id = u.id 
            ORDER BY t.created_at DESC 
            LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Admin transactions error:', err);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// Approve deposit via API
app.post('/api/admin/deposits/:id/approve', async (req, res) => {
    try {
        const depositId = parseInt(req.params.id);
        
        const deposit = await pool.query(
            'SELECT d.*, u.telegram_id as user_telegram_id FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.id = $1',
            [depositId]
        );
        
        if (deposit.rows.length === 0) {
            return res.status(404).json({ error: 'Deposit not found' });
        }
        
        const d = deposit.rows[0];
        
        if (d.status !== 'pending') {
            return res.status(400).json({ error: 'Deposit already processed' });
        }
        
        await pool.query('UPDATE deposits SET status = $1, confirmed_at = NOW() WHERE id = $2', ['confirmed', depositId]);
        
        // First ensure wallet exists, then update balance
        await pool.query(
            'INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING',
            [d.user_id]
        );
        
        await pool.query(
            'UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2',
            [d.amount, d.user_id]
        );
        
        await pool.query(
            'INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)',
            [d.user_id, 'deposit', d.amount, `Deposit via ${d.payment_method}`]
        );
        
        if (d.user_telegram_id && bot) {
            bot.sendMessage(d.user_telegram_id, 
                `✅ ዲፖዚትዎ ተረጋግጧል!\n\n💵 ${d.amount} ብር ወደ ሒሳብዎ ተጨምሯል።`
            ).catch(err => console.error('Telegram notify error:', err));
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Approve deposit error:', err);
        res.status(500).json({ error: 'Failed to approve deposit' });
    }
});

// Reject deposit via API
app.post('/api/admin/deposits/:id/reject', async (req, res) => {
    try {
        const depositId = parseInt(req.params.id);
        
        const deposit = await pool.query(
            'SELECT d.*, u.telegram_id as user_telegram_id FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.id = $1',
            [depositId]
        );
        
        if (deposit.rows.length === 0) {
            return res.status(404).json({ error: 'Deposit not found' });
        }
        
        const d = deposit.rows[0];
        
        await pool.query('UPDATE deposits SET status = $1 WHERE id = $2', ['rejected', depositId]);
        
        if (d.user_telegram_id && bot) {
            bot.sendMessage(d.user_telegram_id, 
                `❌ ዲፖዚትዎ ተቀባይነት አላገኘም።\n\nእባክዎ ትክክለኛ መረጃ ይላኩ ወይም ድጋሚ ይሞክሩ።`
            ).catch(err => console.error('Telegram notify error:', err));
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Reject deposit error:', err);
        res.status(500).json({ error: 'Failed to reject deposit' });
    }
});

// Approve withdrawal via API
app.post('/api/admin/withdrawals/:id/approve', async (req, res) => {
    try {
        const withdrawalId = parseInt(req.params.id);
        
        const withdrawal = await pool.query(
            'SELECT w.*, u.telegram_id as user_telegram_id FROM withdrawals w JOIN users u ON w.user_id = u.id WHERE w.id = $1',
            [withdrawalId]
        );
        
        if (withdrawal.rows.length === 0) {
            return res.status(404).json({ error: 'Withdrawal not found' });
        }
        
        const w = withdrawal.rows[0];
        
        if (w.status !== 'pending') {
            return res.status(400).json({ error: 'Withdrawal already processed' });
        }
        
        const balanceCheck = await pool.query(
            'SELECT balance FROM wallets WHERE user_id = $1',
            [w.user_id]
        );
        
        if (parseFloat(balanceCheck.rows[0]?.balance || 0) < w.amount) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }
        
        await pool.query('UPDATE withdrawals SET status = $1, processed_at = NOW() WHERE id = $2', ['approved', withdrawalId]);
        
        await pool.query(
            'UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2',
            [w.amount, w.user_id]
        );
        
        await pool.query(
            'INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)',
            [w.user_id, 'withdrawal', w.amount, `Withdrawal to ${w.phone_number}`]
        );
        
        if (w.user_telegram_id && bot) {
            bot.sendMessage(w.user_telegram_id, 
                `✅ የገንዘብ ማውጣት ጥያቄዎ ተፈቅዷል!\n\n💵 ${w.amount} ብር ወደ ${w.phone_number} ተልኳል።`
            ).catch(err => console.error('Telegram notify error:', err));
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Approve withdrawal error:', err);
        res.status(500).json({ error: 'Failed to approve withdrawal' });
    }
});

// Reject withdrawal via API
app.post('/api/admin/withdrawals/:id/reject', async (req, res) => {
    try {
        const withdrawalId = parseInt(req.params.id);
        
        const withdrawal = await pool.query(
            'SELECT w.*, u.telegram_id as user_telegram_id FROM withdrawals w JOIN users u ON w.user_id = u.id WHERE w.id = $1',
            [withdrawalId]
        );
        
        if (withdrawal.rows.length === 0) {
            return res.status(404).json({ error: 'Withdrawal not found' });
        }
        
        const w = withdrawal.rows[0];
        
        await pool.query('UPDATE withdrawals SET status = $1, processed_at = NOW() WHERE id = $2', ['rejected', withdrawalId]);
        
        if (w.user_telegram_id && bot) {
            bot.sendMessage(w.user_telegram_id, 
                `❌ የገንዘብ ማውጣት ጥያቄዎ ተቀባይነት አላገኘም።\n\nለበለጠ መረጃ እባክዎ ያግኙን።`
            ).catch(err => console.error('Telegram notify error:', err));
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Reject withdrawal error:', err);
        res.status(500).json({ error: 'Failed to reject withdrawal' });
    }
});

// ================== End Admin API Routes ==================

const PORT = process.env.PORT || 5000;

async function startServer() {
    try {
        await db.initializeDatabase();
        console.log('Database initialized');
        
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running on port ${PORT}`);
            console.log('WebSocket server ready');
            
            initializeMasterNumbers();
            startSelectionPhase();
            setInterval(gameLoop, 1000);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        
        // Fallback to start server without database connection logic
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running on port ${PORT} (without database)`);
            console.log('WebSocket server ready');
            
            initializeMasterNumbers();
            startSelectionPhase();
            setInterval(gameLoop, 1000);
        });
    }
}

startServer();
