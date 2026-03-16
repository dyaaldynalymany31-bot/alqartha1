# Alqartha dia Bot - WhatsApp Bot

## Overview
A full-featured WhatsApp group management bot built with Baileys (WhatsApp Web API), Express backend, and React frontend dashboard.

**Developer:** المهندس ضياء – 780948255

## Tech Stack
- **Bot Engine:** @whiskeysockets/baileys
- **Backend:** Node.js + Express (TypeScript via tsx)
- **Frontend:** React + Vite + Tailwind CSS + shadcn/ui
- **Database:** PostgreSQL (Drizzle ORM)
- **Media:** sharp (stickers), node-gtts (TTS), ffmpeg (media)
- **Search:** yt-search (YouTube song search)

## Architecture
- `bot.js` – Main WhatsApp bot logic (all features)
- `server/index.ts` – Express server entry point
- `server/routes.ts` – API routes (/api/qr, /api/status)
- `server/storage.ts` – Database layer
- `shared/schema.ts` – Drizzle schema
- `client/` – React dashboard frontend
- `auth_info_baileys/` – WhatsApp session files (persistent)

## Bot Features

### Auto Replies (everywhere)
- Greetings: مرحبا, السلام عليكم → "أهلاً وسهلاً بك 🌸"
- كيف حالك → "أنا بخير الحمدلله، وأنت؟"
- شكرا → "العفو، يسعدني مساعدتك 💫"
- بوت → responds with feminine/polite phrases
- Ping, time, date, love words, name triggers (ضياء, حمود, تف)

### Privacy
- **DM Rejection:** Bot auto-replies in private chats telling users to use it in groups only

### Group Commands (no prefix)
- مزه / نكتة – Joke + random mention
- منشن / منشن عشوائي – Random mention
- منشن الكل – Mention all members
- مدح – Random compliment
- روست – Funny roast (with 😊)
- من الغبي / من الذكي / من يستاهل – Random member pick
- رولت – Random victim
- تحدي [text] – Challenge a random member
- شغل [song] – YouTube song search (sends link)

### Economy System (`.` prefix)
- `.فلوسي` – Check balance
- `.عمل` – Earn coins (1 hour cooldown)
- `.تحويل @member amount` – Transfer coins
- `.متجر` – View store
- `.شراء [number]` – Buy item from store

### Store Items
- لقب مميز (500 coins) – Custom title
- منشن الكل (200 coins) – One-time mention all
- حذف إنذار (300 coins) – Delete a warning
- عضو VIP (1000 coins) – VIP status for 24h

### Level System (`.` prefix)
- `.مستواي` – Show your level and progress
- `.ترتيبي` – Your rank in the group
- `.الأكثر تفاعل` – Top 10 most active members

### Games (`.` prefix)
- `.حجر` / `.ورقة` / `.مقص` – Rock paper scissors (win = +10 coins)
- `.حقيقة` – Truth question for random member
- `.سؤال` – Random question for member
- `.احزر` – Word guessing game (win = +50 coins, 2 min timer)

### Media (`.` prefix)
- `.ملصق` – Convert image to sticker
- `.tts [text]` – Text to speech (Arabic)
- `.صورة [word]` – Image search

### AI System (`.` prefix)
- `.ذكاء [question]` – AI answers using knowledge base + Wikipedia API

### Protection System (automatic)
- **Bad Word Filter:** 3 warnings → auto kick
- **Link Blocking:** `!سكر` to enable, `!فتح` to disable (admins only)

### Admin Commands (`!` prefix)
- `!انذار @member` – Manual warning
- `!مسح @member` – Clear warnings
- `!انذاراتي` – Check your warnings
- `!طرد / !ترقية / !تنزيل @member`
- `!عدد` – Member count
- `!سكر / !فتح` – Toggle link blocking

### Welcome/Goodbye
- Auto welcomes new members with help hint
- Auto goodbye message when member leaves

## In-Memory Storage
- `warnings` Map – Warning counts per group/user
- `balances` Map – Coin balances per user
- `messageCounts` Map – Message counts per group/user (for levels)
- `customTitles` Map – Custom titles per user
- `vipMembers` Map – VIP status with expiry
- `linkBlockedGroups` Set – Groups with link blocking enabled
- `activeGuessGames` Map – Active guessing games per group

## Running
- `npm run dev` – Starts both Express backend (port 5000) and Vite frontend
- Bot auto-connects using saved session in `auth_info_baileys/`
- If not connected, shows QR code on dashboard to scan
