# Chewatabingo - Telegram Bingo Game

## Overview
Chewatabingo is a real-time Bingo game built as a Telegram Mini App with integrated payment system (deposits/withdrawals) and admin panel.

## Recent Changes (December 2024)
- Added Withdrawal functionality with eligibility requirements (1+ deposit, 2+ wins)
- Added Deposit system with Telebirr and CBE Birr payment options
- Created Admin notification system for all transactions
- Built Admin Panel web interface for transaction management
- Added new database tables: deposits, withdrawals, admin_users

## Project Architecture

### Backend (Node.js/Express)
- `server.js` - Main server with Express API, WebSocket, and Telegram Bot logic
- `db/database.js` - PostgreSQL database connection and initialization
- `models/` - Data models (User, Wallet, Game)
- `data/cards.js` - Bingo card validation logic

### Frontend
- `public/index.html` - Main game interface
- `public/game.js` - Game client logic
- `public/style.css` - Styling
- `public/admin.html` - Admin panel for transaction management

### Database Tables
- `users` - Player accounts with Telegram ID
- `wallets` - Player balances
- `transactions` - Transaction history
- `games` - Game sessions
- `game_participants` - Players in each game
- `deposits` - Deposit requests (Telebirr/CBE Birr)
- `withdrawals` - Withdrawal requests
- `admin_users` - Admin Telegram accounts

## Bot Commands

### User Commands
- `/start` - Start the bot and show menu
- `💰 Check Balance` - View balance
- `💳 Deposit` - Make a deposit (Telebirr or CBE Birr)
- `💸 Withdraw` - Request withdrawal (requires 1+ deposit and 2+ wins)

### Admin Commands
- `/setadmin` - Register as admin (get your Chat ID)
- `/pending` - View pending deposits/withdrawals
- `/approve_deposit [ID]` - Approve deposit
- `/reject_deposit [ID]` - Reject deposit
- `/approve_withdraw [ID]` - Approve withdrawal
- `/reject_withdraw [ID]` - Reject withdrawal

## Environment Variables
- `TELEGRAM_BOT_TOKEN` - Telegram Bot API token
- `DATABASE_URL` - PostgreSQL connection string
- `ADMIN_CHAT_ID` - Admin Telegram chat ID for notifications (optional)

## Admin Panel

### Integrated Admin (In-App)
The admin panel is now integrated directly into the mini app. Admin users will see an "Admin" tab in the footer navigation after logging in. The admin panel includes:
- **Stats Dashboard**: Total users, pending deposits, pending withdrawals, today's games
- **Deposits Tab**: View and approve/reject deposit requests
- **Withdrawals Tab**: View and approve/reject withdrawal requests  
- **Users Tab**: View all registered users with balances

Admin status is determined by:
1. Being listed in the `admin_users` database table with `is_active = true`
2. OR having the same Telegram ID as `ADMIN_CHAT_ID` environment variable

### Standalone Admin (Legacy)
Access at `/admin.html` - Standalone admin panel for transaction management.

## Withdrawal Eligibility
To withdraw, players must:
1. Have made at least 1 confirmed deposit
2. Have won at least 2 games
