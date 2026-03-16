import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    downloadContentFromMessage,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import QRCode from 'qrcode';

let currentQR = null;
let botStatus = 'starting';
let reconnectTimer = null;
let currentPairingCode = null;   // 8-digit pairing code for new number
let pairingPhoneTarget = null;   // phone number requested for pairing
let activeSock = null;           // reference to active socket for reset

export function getQR() { return currentQR; }
export function getBotStatus() { return botStatus; }
export function getPairingCode() { return currentPairingCode; }

// ─── Owner constant ───────────────────────────────────────────────────────
const OWNER_NUM = '780948255';

// ─── Reset session: clear auth and restart with optional phone number ─────
export async function resetAndReconnect(phoneNum = null) {
    pairingPhoneTarget = phoneNum;
    currentPairingCode = null;
    currentQR = null;
    botStatus = 'restarting';
    try {
        if (activeSock) {
            activeSock.ev.removeAllListeners();
            try { activeSock.end(); } catch {}
            activeSock = null;
        }
    } catch {}
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    // Delete auth folder to force fresh login
    try { fs.rmSync('./auth_info_baileys', { recursive: true, force: true }); } catch {}
    setTimeout(() => startBot(), 2000);
}

// ─── Warning system (3 warnings then kick) ──────────────────────────────
const warnings = new Map();
const getWarnings = (groupId, userId) => warnings.get(`${groupId}_${userId}`) || 0;
const addWarning = (groupId, userId) => {
    const key = `${groupId}_${userId}`;
    const count = (warnings.get(key) || 0) + 1;
    warnings.set(key, count);
    return count;
};
const resetWarnings = (groupId, userId) => warnings.delete(`${groupId}_${userId}`);

// ─── Link blocking (ON by default for ALL groups) ────────────────────────
const linkAllowedGroups = new Set();
const hasLink = (text) =>
    /https?:\/\/[^\s]+|www\.[^\s]+|bit\.ly\/[^\s]+|t\.me\/[^\s]+/i.test(text);

// ─── Anti-Spam system ────────────────────────────────────────────────────
// Key: `${groupId}_${userId}` → { times: [timestamps], lastText: string, sameCount: number }
const spamTracker = new Map();
const SPAM_WINDOW_MS = 10000;    // 10 seconds window
const SPAM_MAX_MSGS = 6;         // max 6 messages in 10s
const SPAM_SAME_MAX = 3;         // max 3 identical messages

const checkSpam = (groupId, userId, text) => {
    const key = `${groupId}_${userId}`;
    const now = Date.now();
    const entry = spamTracker.get(key) || { times: [], lastText: '', sameCount: 0 };
    entry.times = entry.times.filter(t => now - t < SPAM_WINDOW_MS);
    entry.times.push(now);
    if (text === entry.lastText) {
        entry.sameCount++;
    } else {
        entry.sameCount = 1;
        entry.lastText = text;
    }
    spamTracker.set(key, entry);
    if (entry.times.length >= SPAM_MAX_MSGS) return 'flood';
    if (entry.sameCount >= SPAM_SAME_MAX) return 'repeat';
    return null;
};
const resetSpam = (groupId, userId) => spamTracker.delete(`${groupId}_${userId}`);

// ─── Channel forward detection ───────────────────────────────────────────
const isChannelForward = (msg) => {
    const ctx = msg.message?.extendedTextMessage?.contextInfo ||
                msg.message?.imageMessage?.contextInfo ||
                msg.message?.videoMessage?.contextInfo ||
                msg.message?.documentMessage?.contextInfo ||
                msg.message?.audioMessage?.contextInfo;
    if (!ctx) return false;
    if (ctx.forwardedNewsletterMessageInfo) return true;
    if (ctx.isForwarded && (ctx.forwardingScore || 0) >= 5) return true;
    return false;
};

// ─── Economy system ──────────────────────────────────────────────────────
// Key: userId → balance
const balances = new Map();
const workCooldowns = new Map(); // userId → last work timestamp
const WORK_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown

const getBalance = (userId) => balances.get(userId) || 0;
const addBalance = (userId, amount) => {
    const current = getBalance(userId);
    balances.set(userId, current + amount);
    return current + amount;
};
const setBalance = (userId, amount) => balances.set(userId, amount);

// ─── Level system ────────────────────────────────────────────────────────
// Key: `${groupId}_${userId}` → message count
const messageCounts = new Map();
const addMessageCount = (groupId, userId) => {
    const key = `${groupId}_${userId}`;
    const count = (messageCounts.get(key) || 0) + 1;
    messageCounts.set(key, count);
    return count;
};
const getMessageCount = (groupId, userId) => messageCounts.get(`${groupId}_${userId}`) || 0;
const getLevel = (count) => Math.floor(Math.sqrt(count / 10)) + 1;

// Get leaderboard for a group
const getGroupLeaderboard = (groupId) => {
    const entries = [];
    for (const [key, count] of messageCounts.entries()) {
        if (key.startsWith(`${groupId}_`)) {
            const userId = key.slice(groupId.length + 1);
            entries.push({ userId, count });
        }
    }
    return entries.sort((a, b) => b.count - a.count);
};

// ─── Custom titles ───────────────────────────────────────────────────────
const customTitles = new Map(); // userId → title

// ─── Bad words list ──────────────────────────────────────────────────────
const badWords = [
    'كلب', 'حمار', 'غبي', 'احمق', 'اهبل', 'تافه', 'وسخ', 'خنزير',
    'لعين', 'ملعون', 'زبالة', 'زبل', 'نيك', 'شرموط', 'عاهر', 'قحبة',
    'كس', 'طيز', 'خول', 'بعير', 'فاشل', 'معفن', 'نذل', 'منحل'
];
const containsBadWord = (text) => badWords.some(w => text.includes(w));

// ─── Bot call responses (feminine style) ────────────────────────────────
const botCallResponses = [
    'نعم؟ أنا هنا معكم 😊',
    'لبيكم! كيف أقدر أساعد؟ 🌸',
    'أيوه؟ تفضل! 😊',
    'نعم نعم، أنا هنا، وش تريد؟ 💫',
    'هلا! Alqartha dia Bot في الخدمة 😊',
    'آلو! معكم البوت، تفضل! 🌸',
    'نعم سيدي، أوامرك! 💫',
];

// ─── Content arrays ──────────────────────────────────────────────────────
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const jokes = [
    'ليش السمك يسبح في الملح؟ عشان ما يصدى! 😂',
    'قالوا له: كيف حالك؟ قال: أتمنى لو أعرف! 😂',
    'دخل رجل المكتبة وقال: أعطني برجر! قالوا: هذا مكتبة! قال بصوت خافت: أعطني برجر! 😂',
    'سألوه: ليش تنام في الشغل؟ قال: لأني ما أقدر أشتغل في البيت! 😂',
    'كيف تسمي سمكة بدون عيون؟ سمكه! 😂',
    'قال الطبيب: أنت بحاجة لعملية. قال: كم تكلف؟ قال: عشرة آلاف. قال: عندي تسعة آلاف. قال: حسناً، ننجح عضو واحد! 😂',
    'ما الفرق بين الحديد والإنسان؟ الحديد يمكن صهره والإنسان يمكن صهيانه! 😂',
    'دخل رجل على الطبيب وقال: دكتور أنا أحس إني حصان! قال: منذ متى؟ قال: منذ ثلاثة أسابيع. قال: ليش ما جيت قبل؟ قال: كنت في السباق! 😂',
    'قيل لرجل: ما مهنتك؟ قال: أنا مُعلّم. قيل: وين تشتغل؟ قال: في البيت! يعلم أولاده أدب 😂',
    'واحد طلب من الطبيب يكتب له إجازة مرضية. قال الطبيب: أنت بصحة جيدة! قال: أكتب لي إجازة بسبب الصحة الجيدة، الكل في الشغل عيان! 😂',
];

const compliments = [
    'أنت إنسان رائع! 🌟',
    'الجروب محظوظ بوجودك! 💫',
    'ما شاء الله عليك، نجم! ⭐',
    'أنت من أحسن الناس هنا! 🌸',
    'Alqartha dia Bot يقول: أنت مميز! 💎',
    'قلبك أبيض والله! ❤️',
    'أنت كنز هذا الجروب! 🌟',
];

const roasts = [
    'ذكاؤك مثل النت في الريف، ضعيف بس موجود! 😂',
    'أنت مثل الكهرباء، تجيب وتروح بدون ما تحذر! 😂',
    'لو الغباء نعمة، أنت أغنى واحد هنا! 😂',
    'مثل الساعة المعطلة، صح مرتين في اليوم! 😂',
    'لو كان الذكاء بالسعر، أنت رخيص! 😂',
    'تكلم ببطء عشان أفهمك، تكلم بسرعة عشان أتجاهلك! 😂',
];

const truthQuestions = [
    'ما أكثر شيء تكذب فيه؟',
    'من أول شخص خطر ببالك الآن؟',
    'ما أحرج موقف مررت فيه؟',
    'هل سبق أن بكيت بسبب فيلم كرتون؟',
    'ما أغرب عادة عندك؟',
    'من الشخص الذي تتمنى أن تعتذر منه؟',
    'ما أكبر خطأ ارتكبته وما اعترفت به؟',
    'هل تنام وأنت خايف من الظلام أحياناً؟',
    'ما أكثر تطبيق تستخدمه يومياً؟',
    'ما الشيء الذي تحبه ولا تعترف به أمام الناس؟',
];

const dares = [
    'قل "أنا أحب البصل" بصوت عالٍ الآن!',
    'اكتب رسالة للشخص الأول في محادثاتك الآن!',
    'غيّر اسمك في الجروب لـ "البطل الخفي" لمدة ساعة!',
    'ابعث ستيكر محرج!',
    'اكتب "مرحبا" لشخص ما ترد عليه من زمان!',
    'قل ثلاثة أشياء تحبها في هذا الجروب!',
    'اعتذر من آخر شخص تشاجرت معه!',
    'ابعث أقدم صورة في هاتفك!',
];

const guessWords = [
    { word: 'قمر', hint: 'يضيء في الليل ويدور حول الأرض 🌙' },
    { word: 'نملة', hint: 'حشرة صغيرة تحمل أثقالاً أكبر منها 🐜' },
    { word: 'برتقال', hint: 'فاكهة برتقالية اللون حلوة وحامضة 🍊' },
    { word: 'كتاب', hint: 'مصدر للمعرفة وفيه أوراق 📚' },
    { word: 'سيارة', hint: 'تسير بالبنزين على أربع عجلات 🚗' },
    { word: 'مطر', hint: 'يسقط من السماء ويسقي الأرض 🌧️' },
    { word: 'قطة', hint: 'حيوان يموء ويحب الأسماك 🐱' },
    { word: 'شمس', hint: 'نجم يضيء النهار ويعطي الدفء ☀️' },
    { word: 'جبل', hint: 'تصعده وترى من قمته كل شيء ⛰️' },
    { word: 'بحر', hint: 'ماء ملح واسع فيه أسماك 🌊' },
];

// Active guessing games: groupId → { word, hint, endTime }
const activeGuessGames = new Map();

// ─── Store items ─────────────────────────────────────────────────────────
const storeItems = [
    { id: 'title', name: 'لقب مميز', price: 500, description: 'أضف لقباً مميزاً بجانب اسمك في الجروب' },
    { id: 'mention_all', name: 'منشن الكل', price: 200, description: 'استخدام أمر منشن الكل مرة واحدة' },
    { id: 'clr_warn', name: 'حذف إنذار', price: 300, description: 'احذف إنذاراً واحداً من سجلك' },
    { id: 'vip', name: 'عضو VIP', price: 1000, description: 'لقب VIP لمدة يوم' },
];

// VIP members: userId → expiry timestamp
const vipMembers = new Map();

// ─── Work responses ───────────────────────────────────────────────────────
const workJobs = [
    { text: '💼 ذهبت للعمل وأتممت مهمة!', coins: () => Math.floor(Math.random() * 150) + 50 },
    { text: '🚗 عملت سائق أوبر لساعة!', coins: () => Math.floor(Math.random() * 100) + 80 },
    { text: '👨‍🍳 طبخت وجبة في مطعم!', coins: () => Math.floor(Math.random() * 120) + 60 },
    { text: '💻 أنجزت مشروع برمجي صغير!', coins: () => Math.floor(Math.random() * 200) + 100 },
    { text: '📦 وزّعت طلبيات للزبائن!', coins: () => Math.floor(Math.random() * 90) + 70 },
    { text: '🧹 نظّفت مكتباً كبيراً!', coins: () => Math.floor(Math.random() * 80) + 50 },
    { text: '📱 بعت هاتف مستعمل بالبازار!', coins: () => Math.floor(Math.random() * 300) + 150 },
    { text: '🎮 فزت في بطولة ألعاب!', coins: () => Math.floor(Math.random() * 400) + 200 },
];

// ─── AI responses ─────────────────────────────────────────────────────────
const aiResponses = [
    'سؤال رائع! 🤔 بناءً على معلوماتي، {q} هو موضوع شيق يستحق البحث فيه أكثر!',
    'هممم 🧠 هذا سؤال مثير للاهتمام عن {q}! أنصحك تبحث أكثر في جوجل للحصول على معلومات دقيقة.',
    '💡 بخصوص {q}: هذا موضوع واسع ومتعدد الجوانب! أنا أساعدك في الأسئلة البسيطة.',
];

// Simple AI knowledge base
const knowledgeBase = {
    'الذكاء الاصطناعي': 'الذكاء الاصطناعي (AI) هو محاكاة الذكاء البشري في الآلات، يشمل التعلم الآلي ومعالجة اللغة الطبيعية والرؤية الحاسوبية.',
    'ما هو الذكاء الاصطناعي': 'الذكاء الاصطناعي هو فرع من علوم الحاسوب يهدف إلى إنشاء أنظمة قادرة على أداء مهام تتطلب ذكاءً بشرياً.',
    'python': 'Python هي لغة برمجة عالية المستوى، سهلة التعلم، تستخدم في الذكاء الاصطناعي، تطوير الويب، وتحليل البيانات.',
    'واتساب': 'واتساب هو تطبيق مراسلة فوري مملوك لشركة Meta، يتيح إرسال الرسائل والمكالمات الصوتية والمرئية.',
    'السعودية': 'المملكة العربية السعودية دولة خليجية كبرى، عاصمتها الرياض، أكبر مصدر للنفط في العالم.',
    'العراق': 'العراق دولة عربية في غرب آسيا، عاصمتها بغداد، تشتهر بحضارتها القديمة ومواردها النفطية.',
    'كيف أتعلم البرمجة': 'ابدأ بلغة Python أو JavaScript، خذ دورات مجانية على YouTube أو Coursera، وتدرب يومياً بكتابة كود بسيط!',
};

export async function startBot() {
    try {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

        botStatus = 'connecting';
        currentQR = null;
        currentPairingCode = null;

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ['Alqartha dia Bot', 'Chrome', '3.0'],
        });

        activeSock = sock;

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                // If owner requested pairing code for a specific number, use it
                if (pairingPhoneTarget) {
                    botStatus = 'waiting_pairing';
                    currentQR = null;
                    try {
                        const code = await sock.requestPairingCode(pairingPhoneTarget);
                        currentPairingCode = code;
                        console.log(`\n══ Pairing Code for ${pairingPhoneTarget}: ${code} ══\n`);
                    } catch (err) {
                        console.error('Pairing code error:', err);
                        // Fall back to QR mode
                        currentQR = qr;
                        botStatus = 'waiting_qr';
                        pairingPhoneTarget = null;
                    }
                } else {
                    currentQR = qr;
                    botStatus = 'waiting_qr';
                    console.log('\n══ Alqartha dia Bot - امسح رمز QR ══\n');
                    import('qrcode-terminal').then(m => m.default.generate(qr, { small: true })).catch(() => {});
                }
            }

            if (connection === 'close') {
                currentQR = null;
                const code = lastDisconnect?.error?.output?.statusCode;
                if (code === DisconnectReason.loggedOut) {
                    botStatus = 'logged_out';
                    console.log('تم تسجيل الخروج.');
                } else if (botStatus !== 'restarting') {
                    botStatus = 'disconnected';
                    if (reconnectTimer) clearTimeout(reconnectTimer);
                    reconnectTimer = setTimeout(() => startBot(), 5000);
                }
            } else if (connection === 'open') {
                currentQR = null;
                currentPairingCode = null;
                pairingPhoneTarget = null;
                botStatus = 'connected';
                console.log('\nAlqartha dia Bot متصل الآن!\n');
            }
        });

        // ─── Get group members excluding bot ────────────────────────────
        const getRandomMember = async (remoteJid) => {
            try {
                const meta = await sock.groupMetadata(remoteJid);
                const botNum = getBotNum();
                const members = meta.participants
                    .map(p => typeof p === 'string' ? p : p.id)
                    .filter(id => id && jidNum(id) !== botNum);
                return members.length ? pick(members) : null;
            } catch { return null; }
        };

        const getAllMembers = async (remoteJid) => {
            try {
                const meta = await sock.groupMetadata(remoteJid);
                const botNum = getBotNum();
                return meta.participants
                    .map(p => typeof p === 'string' ? p : p.id)
                    .filter(id => id && jidNum(id) !== botNum);
            } catch { return []; }
        };

        const send = (jid, content, quoted) =>
            sock.sendMessage(jid, content, quoted ? { quoted } : undefined);

        // ─── Helper: مقارنة JID بشكل موثوق (يتعامل مع :0 :10 ...etc) ──
        const getBotNum = () => (sock.user?.id || '').split(':')[0].split('@')[0];
        const jidNum = (jid) => (jid || '').split(':')[0].split('@')[0];
        const isBotAdmin = (admins) => {
            const botNum = getBotNum();
            return admins.some(a => jidNum(a) === botNum);
        };
        const isSenderBot = (jid) => jidNum(jid) === getBotNum();
        const isAdminJid = (jid, admins) => admins.some(a => jidNum(a) === jidNum(jid));

        // ─── Messages handler ────────────────────────────────────────────
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg?.message || msg.key.fromMe) return;

            const remoteJid = msg.key.remoteJid;
            const isGroup = remoteJid.endsWith('@g.us');

            // ════════════════════════════════════════════════════════════
            //  رفض الرسائل الخاصة
            // ════════════════════════════════════════════════════════════
            if (!isGroup) {
                return send(remoteJid, {
                    text: `عذراً 👋\nأنا لا أعمل في الرسائل الخاصة.\nاستخدمني داخل الجروب فقط.\n\n- Alqartha dia Bot 🤖`
                });
            }

            // Extract text properly
            const msgContent = msg.message;
            const text = (
                msgContent.conversation ||
                msgContent.extendedTextMessage?.text ||
                msgContent.imageMessage?.caption ||
                msgContent.videoMessage?.caption ||
                ''
            ).trim();

            if (!text) return;

            const t = text;
            const lower = text.toLowerCase();
            const senderJid = msg.key.participant || msg.key.remoteJid;
            const senderNum = senderJid.split('@')[0];

            // ─── Track message count for levels ─────────────────────────
            if (isGroup) addMessageCount(remoteJid, senderJid);

            // ════════════════════════════════════════════════════════════
            //  0-A) منع تحويل الرسائل من القنوات
            // ════════════════════════════════════════════════════════════
            if (isGroup && isChannelForward(msg)) {
                try {
                    const meta = await sock.groupMetadata(remoteJid);
                    const admins = meta.participants
                        .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                        .map(p => typeof p === 'string' ? p : p.id);
                    if (!isAdminJid(senderJid, admins) && !isSenderBot(senderJid)) {
                        try { await sock.sendMessage(remoteJid, { delete: msg.key }); } catch {}
                        await send(remoteJid, {
                            text: `📵 @${senderNum} تم حذف رسالتك!\nتحويل الرسائل من القنوات ممنوع في هذا الجروب.\n- Alqartha dia Bot 🌸`,
                            mentions: [senderJid]
                        });
                        return;
                    }
                } catch (err) { console.error('Channel forward block error:', err); }
            }

            // ════════════════════════════════════════════════════════════
            //  0-B) منع الإزعاج والرسائل المتكررة (Anti Spam)
            // ════════════════════════════════════════════════════════════
            if (isGroup && text) {
                try {
                    const meta = await sock.groupMetadata(remoteJid);
                    const admins = meta.participants
                        .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                        .map(p => typeof p === 'string' ? p : p.id);
                    if (!isAdminJid(senderJid, admins) && !isSenderBot(senderJid)) {
                        const spamType = checkSpam(remoteJid, senderJid, text);
                        if (spamType) {
                            const spamMsg = spamType === 'flood'
                                ? `🚨 @${senderNum} توقف! أنت ترسل رسائل بسرعة كبيرة.\nتحذير Anti-Spam - Alqartha dia Bot`
                                : `🔁 @${senderNum} توقف عن تكرار نفس الرسالة!\nتحذير Anti-Spam - Alqartha dia Bot`;
                            await send(remoteJid, { text: spamMsg, mentions: [senderJid] });
                            resetSpam(remoteJid, senderJid);
                            return;
                        }
                    }
                } catch (err) { console.error('Anti-spam error:', err); }
            }

            // ════════════════════════════════════════════════════════════
            //  0) حجب الروابط في الجروب
            // ════════════════════════════════════════════════════════════
            if (isGroup && !linkAllowedGroups.has(remoteJid) && hasLink(text)) {
                try {
                    const meta = await sock.groupMetadata(remoteJid);
                    const admins = meta.participants
                        .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                        .map(p => typeof p === 'string' ? p : p.id);

                    // لا نحجب روابط المشرفين أو البوت
                    if (!isAdminJid(senderJid, admins) && !isSenderBot(senderJid)) {
                        // محاولة حذف الرسالة
                        try { await sock.sendMessage(remoteJid, { delete: msg.key }); } catch {}
                        // البوت مشرف → إزالة فورية دائماً
                        await send(remoteJid, {
                            text: `🚫 @${senderNum} تم إزالتك من المجموعة لإرسال رابط!\nالروابط ممنوعة في هذا الجروب.\n- Alqartha dia Bot 🌸`,
                            mentions: [senderJid]
                        });
                        try {
                            await sock.groupParticipantsUpdate(remoteJid, [senderJid], 'remove');
                        } catch (removeErr) {
                            console.error('Remove failed (bot may not be admin):', removeErr?.message);
                        }
                        return;
                    }
                } catch (err) { console.error('Link block error:', err); }
            }

            // ════════════════════════════════════════════════════════════
            //  1) "بوت" trigger - يرد بعبارات لطيفة
            // ════════════════════════════════════════════════════════════
            if (lower === 'بوت' || lower === 'بووت' || lower === 'يا بوت' || lower === 'هي بوت' || lower === 'بوت بوت') {
                return send(remoteJid, { text: pick(botCallResponses) }, msg);
            }

            // ════════════════════════════════════════════════════════════
            //  2) نظام الإنذارات للسب (في الجروب فقط)
            // ════════════════════════════════════════════════════════════
            if (isGroup && containsBadWord(lower)) {
                try {
                    const meta = await sock.groupMetadata(remoteJid);
                    const admins = meta.participants
                        .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                        .map(p => typeof p === 'string' ? p : p.id);

                    // لا نعطي إنذار للمشرفين أو البوت
                    if (!isAdminJid(senderJid, admins) && !isSenderBot(senderJid)) {
                        const count = addWarning(remoteJid, senderJid);

                        if (count === 1) {
                            await send(remoteJid, {
                                text: `⚠️ *إنذار أول* ⚠️\n@${senderNum} تجنب السب والشتم!\nتبقى لك إنذاران قبل الطرد.\n- Alqartha dia Bot`,
                                mentions: [senderJid]
                            });
                        } else if (count === 2) {
                            await send(remoteJid, {
                                text: `🚨 *إنذار ثاني* 🚨\n@${senderNum} هذا إنذارك الثاني!\nإنذار واحد أخير قبل الطرد.\n- Alqartha dia Bot`,
                                mentions: [senderJid]
                            });
                        } else if (count >= 3) {
                            resetWarnings(remoteJid, senderJid);
                            await send(remoteJid, {
                                text: `🔨 *تم الطرد* 🔨\n@${senderNum} وصل للإنذار الثالث وتم طرده من المجموعة!\n- Alqartha dia Bot`,
                                mentions: [senderJid]
                            });
                            try {
                                await sock.groupParticipantsUpdate(remoteJid, [senderJid], 'remove');
                            } catch (removeErr) {
                                console.error('Remove failed (bot may not be admin):', removeErr?.message);
                            }
                        }
                        return;
                    }
                } catch (err) {
                    console.error('Warning system error:', err);
                }
            }

            // ─── Helper: send mention message ────────────────────────────
            const mentionSend = async (targetJid, message) => {
                const user = targetJid.split('@')[0];
                return send(remoteJid, {
                    text: message.replace('{user}', `@${user}`).replace('{name}', user),
                    mentions: [targetJid]
                }, msg);
            };

            // ════════════════════════════════════════════════════════════
            //  AUTO REPLIES (تعمل في كل مكان)
            // ════════════════════════════════════════════════════════════

            // التحيات
            if (lower === 'مرحبا' || lower === 'هلا' || lower === 'هلو' || lower === 'hi' || lower === 'hello' || lower === 'مرحبا بكم' || lower === 'مرحبا يا بوت') {
                return send(remoteJid, { text: 'أهلاً وسهلاً بك 🌸\nكيف يمكنني مساعدتك اليوم؟' }, msg);
            }

            if (lower === 'السلام عليكم' || lower === 'السلام' || lower === 'سلام') {
                return send(remoteJid, { text: 'وعليكم السلام ورحمة الله وبركاته 🌸\nأهلاً وسهلاً!' }, msg);
            }

            if (lower === 'ping' || lower === 'بينج') {
                return send(remoteJid, { text: '🏓 بونج! Alqartha dia Bot شغال وجاهز!' }, msg);
            }

            if (lower === 'كيف حالك' || lower === 'كيفك' || lower === 'شلونك' || lower === 'كيف الحال') {
                return send(remoteJid, { text: 'أنا بخير الحمدلله، وأنت؟ 😊' }, msg);
            }

            if (lower === 'الوقت' || lower === 'كم الساعة' || lower === 'الساعة كم') {
                const now = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', hour12: true });
                return send(remoteJid, { text: `🕐 الساعة الآن: ${now}` }, msg);
            }

            if (lower === 'التاريخ' || lower === 'اليوم كم' || lower === 'كم اليوم') {
                const now = new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                return send(remoteJid, { text: `📅 اليوم: ${now}` }, msg);
            }

            if (lower === 'احبك' || lower === 'احبك يا بوت' || lower === 'يسلمو') {
                return send(remoteJid, { text: 'وأنا أحبك أكثر! 💕 من Alqartha dia Bot' }, msg);
            }

            if (lower === 'شكرا' || lower === 'شكراً' || lower === 'مشكور' || lower === 'شكراً جزيلاً' || lower === 'شكرا يا بوت') {
                return send(remoteJid, { text: 'العفو، يسعدني مساعدتك 💫' }, msg);
            }

            // ─── ردود خاصة بالأسماء ──────────────────────────────────
            if (lower === 'ضياء' || lower === 'يا ضياء' || lower.includes('يا ضياء')) {
                const diyaReplies = [
                    'ها يا ضياء! شو تبي؟ 😂',
                    'ضياء ضياء ضياء، عيل ما هدأ! 😂',
                    'يا ضياء روح نام! 😂',
                    'ها نور الدنيا، إيش عندك؟ 😂',
                    'ضياء وش فيك؟ تكلم! 😂',
                ];
                return send(remoteJid, { text: pick(diyaReplies) }, msg);
            }

            if (lower === 'تف' || lower === 'تفو' || lower === 'تفف' || lower === 'تفوو') {
                const tufReplies = [
                    'اخخخ تفوو عليك!! 🤧😂',
                    'تف؟ تف تف تف عليك أنت!! 😂',
                    'يا وسخ! اخخ تفو! 😂😂',
                    'تفووو والله ما تستاهل أقل! 😂',
                ];
                return send(remoteJid, { text: pick(tufReplies) }, msg);
            }

            if (lower === 'حمود' || lower === 'يا حمود' || lower.includes('يا حمود')) {
                const hamoodReplies = [
                    'ها قلبي ❤️😂',
                    'حمود؟ قلبي يرفرف! ❤️😂',
                    'يا حمود يا نور العيون! ❤️',
                    'ها حبيبي حمود! ❤️😂',
                    'قلبي على حمود دايماً! ❤️',
                ];
                return send(remoteJid, { text: pick(hamoodReplies) }, msg);
            }

            // ─── كلمات الغزل والحب ──────────────────────────────────
            const loveWords = [
                'تحبني', 'تحبني؟', 'تحبني يا بوت', 'تعشقني', 'تعشقني؟',
                'تشتاق لي', 'تشتاقلي', 'وحشتك', 'وحشتني', 'تفتكرني',
                'تفكر فيني', 'انا حبيبك', 'انا عشقك', 'ابغيك',
                'ابي اعيشك', 'انت حياتي', 'انت كل شي', 'ابوسك',
                'انت حلو', 'انت حلوه', 'غرامك', 'هيامك', 'قلبي معك',
                'عشقتك', 'حبيتك', 'اموت فيك', 'بموت فيك',
            ];
            const loveReplies = [
                'وأنا أحبك وأعشقك وأكثر! 💕',
                'قلبي معك دايماً! 🌸',
                'أنت نور عيوني وأنا أحبك! ❤️',
                'والله اشتقتلك أنا كمان! 💫',
                'أعشقك يا حياتي! 🌹',
                'أنت حبيبي رقم 1 في الجروب! ❤️',
                'يا لطيف، قلبي يرفرف! 🌸',
                'بحبك بحبك بحبك 🌹',
            ];
            if (loveWords.some(w => lower === w || lower.startsWith(w))) {
                return send(remoteJid, { text: pick(loveReplies) }, msg);
            }

            // ════════════════════════════════════════════════════════════
            //  GROUP COMMANDS (تعمل في الجروبات فقط)
            // ════════════════════════════════════════════════════════════

            // مزه / نكتة
            if (['مزه', 'مزة', 'نكتة', 'نكته', 'ابغي مزه', 'قول مزه', 'قول نكتة', 'نكتة تعال', 'ضحكني'].includes(lower)) {
                const joke = pick(jokes);
                const target = await getRandomMember(remoteJid);
                if (target) {
                    return mentionSend(target, `{user} سمعت هذي المزه؟ 😂\n\n${joke}\n\n- Alqartha dia Bot`);
                }
                return send(remoteJid, { text: `${joke}\n\n- Alqartha dia Bot` }, msg);
            }

            // منشن عشوائي
            if (['منشن عشوائي', 'منشن احد', 'منشن شخص', 'اختار شخص', 'شخص عشوائي', 'tag random', 'منشن'].includes(lower)) {
                const target = await getRandomMember(remoteJid);
                if (!target) return send(remoteJid, { text: 'ما في أعضاء في الجروب!' }, msg);
                const phrases = [
                    '{user} Alqartha dia Bot يسلم عليك! 🌸',
                    '{user} تم اختيارك عشوائياً! 🎯',
                    '{user} أنت المختار اليوم! ⭐',
                    '{user} البوت يبيك تتكلم! 😊',
                    '{user} وين أنت؟ البوت يناديك! 📢',
                ];
                return mentionSend(target, pick(phrases));
            }

            // مدح عشوائي
            if (['مدح', 'مدح شخص', 'اثني على احد', 'مدح عشوائي'].includes(lower)) {
                const target = await getRandomMember(remoteJid);
                if (!target) return;
                const c = pick(compliments);
                return mentionSend(target, `{user} ${c}`);
            }

            // روست عشوائي (مزح)
            if (['روست', 'سالف', 'هجوم عشوائي', 'نكز', 'نكز شخص'].includes(lower)) {
                const target = await getRandomMember(remoteJid);
                if (!target) return;
                const r = pick(roasts);
                return mentionSend(target, `{user} ${r} (مزحة! Alqartha dia Bot يحبك 🌸)`);
            }

            // من الغبي / من الذكي / من يستاهل
            if (['من الغبي', 'من الاغبى', 'مين الغبي'].includes(lower)) {
                const target = await getRandomMember(remoteJid);
                if (!target) return;
                return mentionSend(target, '🤔 {user} هو الأذكى في الجروب اليوم! (وش تتوقع يقول البوت 😂) - Alqartha dia Bot');
            }

            if (['من الذكي', 'من الافضل', 'اختار الافضل', 'من يستاهل', 'من الكول'].includes(lower)) {
                const target = await getRandomMember(remoteJid);
                if (!target) return;
                return mentionSend(target, '⭐ {user} هو أفضل شخص في الجروب اليوم! اختيار Alqartha dia Bot 🌸');
            }

            // مزه
            if (lower === 'مزه' || lower === 'مزة') {
                const target = await getRandomMember(remoteJid);
                if (target) {
                    return mentionSend(target, `{user} هذه مزتك 😏\n\n${pick(jokes)}\n\n- Alqartha dia Bot`);
                }
            }

            // تحدي
            if (lower.startsWith('تحدي ')) {
                const challenge = t.slice(5).trim();
                if (!challenge) return;
                const target = await getRandomMember(remoteJid);
                if (!target) return;
                return mentionSend(target, `🎯 {user} Alqartha dia Bot يتحداك:\n"${challenge}"`);
            }

            // منشن الكل
            if (['منشن الكل', 'تاق الكل', 'كلكم'].includes(lower)) {
                const members = await getAllMembers(remoteJid);
                if (!members.length) return;
                const mentions = members.map(m => `@${m.split('@')[0]}`).join(' ');
                return send(remoteJid, {
                    text: `📢 Alqartha dia Bot ينادي الكل:\n${mentions}`,
                    mentions: members
                }, msg);
            }

            // رولت (من سيخسر)
            if (['رولت', 'روليت', 'من الضحية', 'اختار ضحية'].includes(lower)) {
                const target = await getRandomMember(remoteJid);
                if (!target) return;
                return mentionSend(target, '🎰 Alqartha dia Bot اختار: {user} هو ضحية اليوم! 😂');
            }

            // ─── تشغيل الأغاني ──────────────────────────────────────────
            if (lower.startsWith('شغل ')) {
                const songName = t.slice(4).trim();
                if (!songName) return send(remoteJid, { text: 'اكتب اسم الأغنية: شغل [اسم الأغنية]' }, msg);
                await send(remoteJid, { text: `🎵 جاري البحث عن: "${songName}" ...\n- Alqartha dia Bot` }, msg);
                try {
                    const ytSearch = (await import('yt-search')).default;
                    const results = await ytSearch(songName);
                    if (!results.videos || results.videos.length === 0) {
                        return send(remoteJid, { text: `❌ ما وجدت نتائج لـ "${songName}"\n- Alqartha dia Bot` }, msg);
                    }
                    const video = results.videos[0];
                    return send(remoteJid, {
                        text: `🎵 *${video.title}*\n👤 القناة: ${video.author?.name || 'غير معروف'}\n⏱️ المدة: ${video.timestamp || 'غير معروفة'}\n\n🔗 الرابط:\n${video.url}\n\n- Alqartha dia Bot`
                    }, msg);
                } catch (err) {
                    console.error('Song search error:', err);
                    return send(remoteJid, { text: '❌ حدث خطأ أثناء البحث عن الأغنية.\n- Alqartha dia Bot' }, msg);
                }
            }

            // ════════════════════════════════════════════════════════════
            //  ! PREFIX COMMANDS
            // ════════════════════════════════════════════════════════════
            if (text.startsWith('!')) {
                const args = t.slice(1).trim().split(/ +/);
                const cmd = args.shift();

                // ════════════════════════════════════════════════════════
                //  تسجيل رقم جديد (للمالك فقط)
                // ════════════════════════════════════════════════════════
                if (cmd === 'تسجيل_رقم_جديد' || cmd === 'رقم_جديد') {
                    // Verify owner
                    if (senderNum !== OWNER_NUM) {
                        return send(remoteJid, {
                            text: `🚫 عذراً، هذا الأمر متاح للمالك فقط.\n- Alqartha dia Bot 🔐`
                        }, msg);
                    }

                    const phoneArg = args[0] ? args[0].replace(/[^0-9]/g, '') : null;

                    if (phoneArg) {
                        // Pairing code mode with specific phone number
                        await send(remoteJid, {
                            text: `🔄 *تسجيل رقم جديد*\n\n📱 الرقم المستهدف: ${phoneArg}\n\n⏳ جاري إنشاء كود الربط...\nافتح لوحة التحكم بعد ثوان لرؤية الكود.\n\n⚠️ البوت سيعيد الاتصال خلال 5 ثوان.\n- Alqartha dia Bot 🌸`
                        }, msg);
                        setTimeout(() => resetAndReconnect(phoneArg), 5000);
                    } else {
                        // QR mode - no phone number provided
                        await send(remoteJid, {
                            text: `🔄 *تسجيل رقم جديد بـ QR Code*\n\n⏳ جاري إعادة تشغيل الجلسة...\nافتح لوحة التحكم بعد ثوان وامسح الـ QR Code بالرقم الجديد.\n\n💡 لاستخدام كود مكوّن من 8 أرقام:\n!تسجيل_رقم_جديد [رقم الهاتف]\nمثال: !تسجيل_رقم_جديد 9647809XXXXX\n\n⚠️ البوت سيعيد الاتصال خلال 5 ثوان.\n- Alqartha dia Bot 🌸`
                        }, msg);
                        setTimeout(() => resetAndReconnect(null), 5000);
                    }
                    return;
                }

                // لعبة حجر ورقة مقص
                if (cmd === 'لعبة') {
                    const choices = ['حجر', 'ورقة', 'مقص'];
                    const botChoice = pick(choices);
                    const playerChoice = args[0];
                    let result = '';
                    if (playerChoice && choices.includes(playerChoice)) {
                        const wins = { 'حجر': 'مقص', 'ورقة': 'حجر', 'مقص': 'ورقة' };
                        if (playerChoice === botChoice) result = '\nالنتيجة: تعادل! 🤝';
                        else if (wins[playerChoice] === botChoice) result = '\nالنتيجة: أنت الفائز! مبروك! 🏆';
                        else result = '\nالنتيجة: Alqartha dia Bot يفوز! 😏';
                    } else {
                        result = '\nاكتب: !لعبة حجر (أو ورقة أو مقص)';
                    }
                    return send(remoteJid, { text: `🎮 Alqartha dia Bot اختار: ${botChoice}${result}` }, msg);
                }

                // عدد الأعضاء
                if (cmd === 'عدد' && isGroup) {
                    const members = await getAllMembers(remoteJid);
                    return send(remoteJid, { text: `👥 عدد أعضاء الجروب: ${members.length + 1} (شامل البوت)\n- Alqartha dia Bot` }, msg);
                }

                // تشغيل/إيقاف حجب الروابط
                if (cmd === 'سكر' || cmd === 'فتح') {
                    if (!isGroup) return;
                    try {
                        const meta = await sock.groupMetadata(remoteJid);
                        const admins = meta.participants
                            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                            .map(p => typeof p === 'string' ? p : p.id);
                        if (!isAdminJid(senderJid, admins)) return send(remoteJid, { text: '🚫 هذا الأمر للمشرفين فقط.' });

                        if (cmd === 'سكر') {
                            linkAllowedGroups.delete(remoteJid);
                            return send(remoteJid, { text: '🔒 تم تفعيل حجب الروابط!\nأي رابط سيُحذف فوراً وصاحبه يُزال.\n- Alqartha dia Bot' });
                        } else {
                            linkAllowedGroups.add(remoteJid);
                            return send(remoteJid, { text: '🔓 تم السماح بالروابط في هذا الجروب.\nلإعادة الحجب اكتب !سكر\n- Alqartha dia Bot' });
                        }
                    } catch (err) { console.error('Link block toggle error:', err); }
                }

                // إنذار يدوي
                if (cmd === 'انذار' || cmd === 'warn') {
                    if (!isGroup) return;
                    try {
                        const meta = await sock.groupMetadata(remoteJid);
                        const admins = meta.participants
                            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                            .map(p => typeof p === 'string' ? p : p.id);
                        if (!isAdminJid(senderJid, admins)) return send(remoteJid, { text: '🚫 هذا الأمر للمشرفين فقط.' });

                        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                        if (!mentioned.length) return send(remoteJid, { text: 'منشن الشخص: !انذار @منشن' }, msg);

                        const target = mentioned[0];
                        const targetNum = target.split('@')[0];
                        const count = addWarning(remoteJid, target);

                        if (count >= 3) {
                            resetWarnings(remoteJid, target);
                            await send(remoteJid, {
                                text: `🔨 *تم الطرد* 🔨\n@${targetNum} وصل للإنذار الثالث وتم طرده!\n- Alqartha dia Bot`,
                                mentions: [target]
                            });
                            try {
                                await sock.groupParticipantsUpdate(remoteJid, [target], 'remove');
                            } catch (removeErr) {
                                console.error('Remove failed:', removeErr?.message);
                            }
                        } else {
                            const emoji = count === 1 ? '⚠️' : '🚨';
                            const ord = count === 1 ? 'أول' : 'ثاني';
                            await send(remoteJid, {
                                text: `${emoji} *إنذار ${ord}* ${emoji}\n@${targetNum} تم إعطاؤك إنذاراً من المشرف.\nإنذاراتك الحالية: ${count}/3\n- Alqartha dia Bot`,
                                mentions: [target]
                            });
                        }
                        return;
                    } catch (err) { console.error('Manual warn error:', err); }
                }

                // مسح الانذارات
                if (cmd === 'مسح' || cmd === 'clrwarn') {
                    if (!isGroup) return;
                    try {
                        const meta = await sock.groupMetadata(remoteJid);
                        const admins = meta.participants
                            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                            .map(p => typeof p === 'string' ? p : p.id);
                        if (!isAdminJid(senderJid, admins)) return send(remoteJid, { text: '🚫 هذا الأمر للمشرفين فقط.' });

                        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                        if (!mentioned.length) return send(remoteJid, { text: 'منشن الشخص: !مسح @منشن' }, msg);

                        const target = mentioned[0];
                        const targetNum = target.split('@')[0];
                        resetWarnings(remoteJid, target);
                        return send(remoteJid, {
                            text: `✅ تم مسح إنذارات @${targetNum}\n- Alqartha dia Bot`,
                            mentions: [target]
                        });
                    } catch (err) { console.error('Clear warn error:', err); }
                }

                // عرض الانذارات
                if (cmd === 'انذاراتي' || cmd === 'كم انذار') {
                    if (!isGroup) return;
                    const count = getWarnings(remoteJid, senderJid);
                    return send(remoteJid, {
                        text: `@${senderNum} إنذاراتك الحالية: ${count}/3${count === 0 ? ' ✅' : count >= 3 ? ' 🚨' : ' ⚠️'}\n- Alqartha dia Bot`,
                        mentions: [senderJid]
                    }, msg);
                }

                // Group admin commands
                if (isGroup && ['طرد', 'ترقية', 'تنزيل'].includes(cmd)) {
                    try {
                        const meta = await sock.groupMetadata(remoteJid);
                        const admins = meta.participants
                            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                            .map(p => typeof p === 'string' ? p : p.id);

                        if (!isAdminJid(senderJid, admins)) return send(remoteJid, { text: '🚫 هذا الأمر للمشرفين فقط.' });

                        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                        if (!mentioned.length) return send(remoteJid, { text: 'يرجى منشنة الشخص.' });

                        const actions = { 'طرد': 'remove', 'ترقية': 'promote', 'تنزيل': 'demote' };
                        const replies = { 'طرد': '🚫 تم الطرد', 'ترقية': '⬆️ تمت الترقية', 'تنزيل': '⬇️ تم التنزيل' };
                        await sock.groupParticipantsUpdate(remoteJid, mentioned, actions[cmd]);
                        return send(remoteJid, { text: `${replies[cmd]} بواسطة Alqartha dia Bot` });
                    } catch (err) {
                        console.error('Admin cmd error:', err);
                    }
                }

                // ─── تثبيت / الغاء_تثبيت ─────────────────────────────
                if ((cmd === 'تثبيت' || cmd === 'pin') && isGroup) {
                    try {
                        const meta = await sock.groupMetadata(remoteJid);
                        const admins = meta.participants
                            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                            .map(p => typeof p === 'string' ? p : p.id);
                        if (!isAdminJid(senderJid, admins)) return send(remoteJid, { text: '🚫 هذا الأمر للمشرفين فقط.' });
                        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
                        if (!quotedMsg) return send(remoteJid, { text: '📌 رد على الرسالة التي تريد تثبيتها مع !تثبيت' }, msg);
                        const pinnedText = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
                            msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text || '...';
                        return send(remoteJid, {
                            text: `📌 *رسالة مثبتة*\n\n${pinnedText}\n\n- Alqartha dia Bot 🌸`
                        });
                    } catch (err) { console.error('Pin error:', err); }
                }

                if ((cmd === 'الغاء_تثبيت' || cmd === 'unpin') && isGroup) {
                    try {
                        const meta = await sock.groupMetadata(remoteJid);
                        const admins = meta.participants
                            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                            .map(p => typeof p === 'string' ? p : p.id);
                        if (!isAdminJid(senderJid, admins)) return send(remoteJid, { text: '🚫 هذا الأمر للمشرفين فقط.' });
                        return send(remoteJid, { text: '📌 تم إلغاء تثبيت الرسالة.\n- Alqartha dia Bot 🌸' });
                    } catch (err) { console.error('Unpin error:', err); }
                }

                // ─── منشن الكل (نسخة !) ──────────────────────────────
                if (cmd === 'منشن' && isGroup) {
                    try {
                        const meta = await sock.groupMetadata(remoteJid);
                        const admins = meta.participants
                            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                            .map(p => typeof p === 'string' ? p : p.id);
                        if (!isAdminJid(senderJid, admins)) return send(remoteJid, { text: '🚫 هذا الأمر للمشرفين فقط.' });
                        const members = await getAllMembers(remoteJid);
                        if (!members.length) return;
                        const customMsg = args.join(' ') || '📢 انتبهوا جميعاً!';
                        const mentions = members.map(m => `@${m.split('@')[0]}`).join(' ');
                        return send(remoteJid, {
                            text: `📢 *${customMsg}*\n\n${mentions}\n\n- Alqartha dia Bot 🌸`,
                            mentions: members
                        });
                    } catch (err) { console.error('Mention all error:', err); }
                }

                // ─── المتصلين / الحالة ───────────────────────────────
                if ((cmd === 'المتصلين' || cmd === 'الحالة') && isGroup) {
                    const members = await getAllMembers(remoteJid);
                    return send(remoteJid, {
                        text: `📊 *معلومات المجموعة*\n\n👥 إجمالي الأعضاء: ${members.length + 1}\n🤖 البوت: نشط ومتصل ✅\n\n📝 ملاحظة: واتساب لا يسمح بمعرفة من هو متصل الآن.\n\n- Alqartha dia Bot 🌸`
                    }, msg);
                }

                // ─── أوامر التفاعل ───────────────────────────────────
                const loveMessages = [
                    '💕 قلبي يرفرف عند ذكرك!',
                    '❤️ الحب شعور جميل يملأ الروح!',
                    '🌹 من لا يحب لا يعيش!',
                    '💖 الحب هو الحياة والحياة هي الحب!',
                    '🌸 قلبي ممتلئ بالمحبة لكل أعضاء الجروب!',
                ];
                const ghazalMessages = [
                    '🌹 عيناكِ مثل النجوم في ليلٍ بهيم.',
                    '💫 ابتسامتكِ تضيء الدنيا من حولي.',
                    '🌺 في قلبي بيت وأنتِ ساكنته.',
                    '🌙 أنتِ قمري في ليل الغياب.',
                    '💐 كالأزهار جمالكِ لا يوصف!',
                ];
                const mashaaerMessages = [
                    '😊 الفرح يسكن قلبي عندما أرى أعضاء الجروب نشطين!',
                    '🤗 أشعر بالسعادة لأنكم هنا!',
                    '💫 مشاعري تجاهكم كلها محبة واحترام!',
                    '🌸 أنتم تملؤون حياتي بالبهجة!',
                    '✨ أسعد لحظاتي حين أكون معكم!',
                ];
                const hikamMessages = [
                    '📖 "من جدّ وجد، ومن زرع حصد."',
                    '💡 "العلم في الصغر كالنقش في الحجر."',
                    '🌟 "أعظم انتصار هو الانتصار على النفس."',
                    '🔑 "باب السعادة يفتح من الداخل."',
                    '⭐ "الصبر مفتاح الفرج."',
                    '🌿 "اللسان الطيب يكسب القلوب."',
                    '🌙 "بعد العسر يسر، وبعد الظلام نور."',
                ];

                if (cmd === 'حب') return send(remoteJid, { text: pick(loveMessages) }, msg);
                if (cmd === 'غزل') return send(remoteJid, { text: pick(ghazalMessages) }, msg);
                if (cmd === 'مشاعر') return send(remoteJid, { text: pick(mashaaerMessages) }, msg);
                if (cmd === 'حكمة') return send(remoteJid, { text: pick(hikamMessages) }, msg);
                if (cmd === 'نكتة') {
                    return send(remoteJid, { text: `😂 ${pick(jokes)}\n\n- Alqartha dia Bot 🌸` }, msg);
                }
            }

            // ════════════════════════════════════════════════════════════
            //  . PREFIX COMMANDS
            // ════════════════════════════════════════════════════════════
            if (text.startsWith('.')) {
                const args = t.slice(1).trim().split(/ +/);
                const cmd = args.shift();

                // ملصق
                if (cmd === 'sticker' || cmd === 'ملصق') {
                    const imageMsg = msg.message.imageMessage ||
                        msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                    if (!imageMsg) return send(remoteJid, { text: '🖼️ أرسل أو رد على صورة مع .ملصق' }, msg);
                    try {
                        const stream = await downloadContentFromMessage(imageMsg, 'image');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        const sharp = (await import('sharp')).default;
                        const webpBuffer = await sharp(buffer)
                            .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                            .webp({ lossless: true })
                            .toBuffer();
                        return send(remoteJid, { sticker: webpBuffer }, msg);
                    } catch (err) {
                        console.error('Sticker error:', err);
                        return send(remoteJid, { text: '❌ حدث خطأ أثناء إنشاء الملصق.' }, msg);
                    }
                }

                // tts
                if (cmd === 'tts') {
                    const ttsText = args.join(' ');
                    if (!ttsText) return send(remoteJid, { text: '🎤 اكتب النص: .tts مرحبا' }, msg);
                    try {
                        const gtts = (await import('node-gtts')).default;
                        const tts = gtts('ar');
                        const tempAudio = `./tts_${Date.now()}.mp3`;
                        tts.save(tempAudio, ttsText, async () => {
                            if (fs.existsSync(tempAudio)) {
                                await send(remoteJid, { audio: fs.readFileSync(tempAudio), mimetype: 'audio/mp4', ptt: true }, msg);
                                fs.unlinkSync(tempAudio);
                            }
                        });
                    } catch (err) { console.error('TTS error:', err); }
                }

                // ─── نظام الفلوس ─────────────────────────────────────
                // فلوسي
                if (cmd === 'فلوسي' || cmd === 'رصيدي') {
                    const balance = getBalance(senderNum);
                    const title = customTitles.get(senderNum) ? `[${customTitles.get(senderNum)}] ` : '';
                    const isVip = vipMembers.has(senderNum) && vipMembers.get(senderNum) > Date.now();
                    const vipBadge = isVip ? ' 👑 VIP' : '';
                    return send(remoteJid, {
                        text: `💰 *رصيدك يا ${title}@${senderNum}${vipBadge}*\n\n💵 الرصيد: ${balance.toLocaleString()} عملة\n\n- Alqartha dia Bot 🌸`,
                        mentions: [senderJid]
                    }, msg);
                }

                // عمل - كسب فلوس
                if (cmd === 'عمل') {
                    const now = Date.now();
                    const lastWork = workCooldowns.get(senderNum) || 0;
                    const remaining = WORK_COOLDOWN_MS - (now - lastWork);

                    if (remaining > 0) {
                        const mins = Math.ceil(remaining / 60000);
                        return send(remoteJid, {
                            text: `⏳ @${senderNum} تعبت! استرح وارجع بعد ${mins} دقيقة 😅\n- Alqartha dia Bot`,
                            mentions: [senderJid]
                        }, msg);
                    }

                    const job = pick(workJobs);
                    const earned = job.coins();
                    workCooldowns.set(senderNum, now);
                    const newBalance = addBalance(senderNum, earned);

                    return send(remoteJid, {
                        text: `💼 *عمل @${senderNum}*\n\n${job.text}\n\n💵 ربحت: +${earned} عملة\n💰 رصيدك الآن: ${newBalance.toLocaleString()} عملة\n\n- Alqartha dia Bot 🌸`,
                        mentions: [senderJid]
                    }, msg);
                }

                // تحويل
                if (cmd === 'تحويل') {
                    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    const amount = parseInt(args[args.length - 1]);
                    if (!mentioned.length || isNaN(amount) || amount <= 0) {
                        return send(remoteJid, {
                            text: '💸 الاستخدام: .تحويل @شخص المبلغ\nمثال: .تحويل @احمد 100',
                        }, msg);
                    }
                    const targetJid = mentioned[0];
                    const targetNum = targetJid.split('@')[0];
                    const senderBalance = getBalance(senderNum);

                    if (senderBalance < amount) {
                        return send(remoteJid, {
                            text: `❌ @${senderNum} رصيدك غير كافٍ!\nرصيدك: ${senderBalance} عملة\n- Alqartha dia Bot`,
                            mentions: [senderJid]
                        }, msg);
                    }

                    setBalance(senderNum, senderBalance - amount);
                    addBalance(targetNum, amount);

                    return send(remoteJid, {
                        text: `💸 *تحويل ناجح!*\n\n@${senderNum} حوّل ${amount} عملة لـ @${targetNum}\n\n💰 رصيد @${senderNum}: ${getBalance(senderNum).toLocaleString()} عملة\n💰 رصيد @${targetNum}: ${getBalance(targetNum).toLocaleString()} عملة\n\n- Alqartha dia Bot 🌸`,
                        mentions: [senderJid, targetJid]
                    }, msg);
                }

                // متجر
                if (cmd === 'متجر') {
                    const itemsList = storeItems.map((item, i) =>
                        `${i + 1}. *${item.name}*\n   💵 السعر: ${item.price} عملة\n   📝 ${item.description}`
                    ).join('\n\n');

                    return send(remoteJid, {
                        text: `🏪 *متجر Alqartha dia Bot*\n\n${itemsList}\n\n💡 للشراء: .شراء [رقم المنتج]\n- Alqartha dia Bot 🌸`
                    }, msg);
                }

                // شراء
                if (cmd === 'شراء') {
                    const itemNum = parseInt(args[0]) - 1;
                    if (isNaN(itemNum) || itemNum < 0 || itemNum >= storeItems.length) {
                        return send(remoteJid, { text: '❌ رقم منتج غير صحيح. اكتب .متجر لرؤية القائمة' }, msg);
                    }

                    const item = storeItems[itemNum];
                    const balance = getBalance(senderNum);

                    if (balance < item.price) {
                        return send(remoteJid, {
                            text: `❌ @${senderNum} رصيدك غير كافٍ!\nتحتاج: ${item.price} عملة\nرصيدك: ${balance} عملة\n- Alqartha dia Bot`,
                            mentions: [senderJid]
                        }, msg);
                    }

                    setBalance(senderNum, balance - item.price);

                    if (item.id === 'title') {
                        const newTitle = args.slice(1).join(' ') || 'عضو مميز';
                        customTitles.set(senderNum, newTitle.slice(0, 20));
                        return send(remoteJid, {
                            text: `✅ *تم الشراء!*\n@${senderNum} حصل على لقب: [${customTitles.get(senderNum)}]\n💰 رصيدك: ${getBalance(senderNum)} عملة\n- Alqartha dia Bot 🌸`,
                            mentions: [senderJid]
                        }, msg);
                    } else if (item.id === 'clr_warn') {
                        const warnKey = `${remoteJid}_${senderJid}`;
                        warnings.delete(warnKey);
                        return send(remoteJid, {
                            text: `✅ *تم الشراء!*\n@${senderNum} تم حذف إنذاراتك!\n💰 رصيدك: ${getBalance(senderNum)} عملة\n- Alqartha dia Bot 🌸`,
                            mentions: [senderJid]
                        }, msg);
                    } else if (item.id === 'vip') {
                        vipMembers.set(senderNum, Date.now() + 24 * 60 * 60 * 1000);
                        return send(remoteJid, {
                            text: `✅ 👑 *تم الشراء!*\n@${senderNum} أصبح عضو VIP لمدة 24 ساعة!\n💰 رصيدك: ${getBalance(senderNum)} عملة\n- Alqartha dia Bot 🌸`,
                            mentions: [senderJid]
                        }, msg);
                    } else if (item.id === 'mention_all') {
                        const members = await getAllMembers(remoteJid);
                        const mentions = members.map(m => `@${m.split('@')[0]}`).join(' ');
                        await send(remoteJid, {
                            text: `✅ *تم الشراء!*\n@${senderNum} استخدم منشن الكل:\n\n📢 ${mentions}`,
                            mentions: [senderJid, ...members]
                        }, msg);
                        return;
                    }
                }

                // ─── نظام المستويات ──────────────────────────────────
                // مستواي
                if (cmd === 'مستواي') {
                    const count = getMessageCount(remoteJid, senderJid);
                    const level = getLevel(count);
                    const nextLevel = level + 1;
                    const nextLevelMessages = Math.pow(nextLevel - 1, 2) * 10;
                    const progress = Math.min(100, Math.floor((count / nextLevelMessages) * 100)) || 0;
                    const progressBar = '█'.repeat(Math.floor(progress / 10)) + '░'.repeat(10 - Math.floor(progress / 10));

                    return send(remoteJid, {
                        text: `📊 *مستوى @${senderNum}*\n\n⭐ المستوى: ${level}\n💬 الرسائل: ${count}\n📈 التقدم: [${progressBar}] ${progress}%\n\n- Alqartha dia Bot 🌸`,
                        mentions: [senderJid]
                    }, msg);
                }

                // ترتيبي
                if (cmd === 'ترتيبي') {
                    const leaderboard = getGroupLeaderboard(remoteJid);
                    const myRank = leaderboard.findIndex(e => e.userId === senderJid) + 1;
                    const myCount = getMessageCount(remoteJid, senderJid);
                    const level = getLevel(myCount);
                    return send(remoteJid, {
                        text: `🏆 *ترتيب @${senderNum}*\n\n🥇 ترتيبك: #${myRank || '---'} من ${leaderboard.length}\n⭐ المستوى: ${level}\n💬 الرسائل: ${myCount}\n\n- Alqartha dia Bot 🌸`,
                        mentions: [senderJid]
                    }, msg);
                }

                // الأكثر تفاعل
                if (cmd === 'الأكثر تفاعل' || cmd === 'الاكثر تفاعل' || (cmd === 'الأكثر' && args[0] === 'تفاعل')) {
                    const leaderboard = getGroupLeaderboard(remoteJid).slice(0, 10);
                    if (!leaderboard.length) {
                        return send(remoteJid, { text: '📊 لا توجد بيانات بعد!\n- Alqartha dia Bot' }, msg);
                    }
                    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
                    const list = leaderboard.map((e, i) => {
                        const num = e.userId.split('@')[0];
                        const level = getLevel(e.count);
                        return `${medals[i]} @${num} - المستوى ${level} (${e.count} رسالة)`;
                    }).join('\n');
                    const mentions = leaderboard.map(e => e.userId);
                    return send(remoteJid, {
                        text: `🏆 *أكثر الأعضاء تفاعلاً*\n\n${list}\n\n- Alqartha dia Bot 🌸`,
                        mentions
                    }, msg);
                }

                // ─── الألعاب ──────────────────────────────────────────
                // حجر ورقة مقص
                if (cmd === 'حجر' || cmd === 'ورقة' || cmd === 'مقص') {
                    const choices = ['حجر', 'ورقة', 'مقص'];
                    const botChoice = pick(choices);
                    const playerChoice = cmd;
                    const wins = { 'حجر': 'مقص', 'ورقة': 'حجر', 'مقص': 'ورقة' };
                    let result = '';
                    if (playerChoice === botChoice) result = 'تعادل! 🤝';
                    else if (wins[playerChoice] === botChoice) {
                        result = 'أنت الفائز! 🏆';
                        addBalance(senderNum, 10);
                    } else {
                        result = 'Alqartha dia Bot يفوز! 😏';
                    }
                    return send(remoteJid, {
                        text: `🎮 *حجر ورقة مقص*\n\n@${senderNum}: ${playerChoice}\n🤖 البوت: ${botChoice}\n\n${result}\n- Alqartha dia Bot 🌸`,
                        mentions: [senderJid]
                    }, msg);
                }

                // حقيقة
                if (cmd === 'حقيقة') {
                    const target = await getRandomMember(remoteJid);
                    const question = pick(truthQuestions);
                    if (target) {
                        return mentionSend(target, `🎯 *سؤال حقيقة*\n\n{user} اجب بصدق:\n"${question}"\n\n- Alqartha dia Bot 🌸`);
                    }
                    return send(remoteJid, { text: `🎯 سؤال حقيقة:\n"${question}"\n\n- Alqartha dia Bot 🌸` }, msg);
                }

                // سؤال
                if (cmd === 'سؤال') {
                    const questions = [
                        'ما أجمل ذكرى عندك؟',
                        'لو عندك يوم إضافي في الأسبوع ماذا ستفعل؟',
                        'ما الشيء الذي تتمنى تعلمه؟',
                        'من أكثر شخص أثر فيك في حياتك؟',
                        'ما هو حلمك الكبير؟',
                        'لو كنت تستطيع السفر لأي مكان، أين ستذهب؟',
                        'ما أكثر شيء تحبه في نفسك؟',
                        'لو استطعت تغيير شيء في العالم، ماذا ستغير؟',
                    ];
                    const target = await getRandomMember(remoteJid);
                    const q = pick(questions);
                    if (target) {
                        return mentionSend(target, `❓ *سؤال لـ {user}*\n\n"${q}"\n\n- Alqartha dia Bot 🌸`);
                    }
                    return send(remoteJid, { text: `❓ *سؤال:*\n"${q}"\n\n- Alqartha dia Bot 🌸` }, msg);
                }

                // احزر
                if (cmd === 'احزر') {
                    const existing = activeGuessGames.get(remoteJid);
                    if (existing && existing.endTime > Date.now()) {
                        return send(remoteJid, {
                            text: `🎮 هناك لعبة احزر قائمة!\nالتلميح: ${existing.hint}\n\nاكتب إجابتك الآن! 💭`
                        }, msg);
                    }
                    const game = pick(guessWords);
                    activeGuessGames.set(remoteJid, {
                        word: game.word,
                        hint: game.hint,
                        endTime: Date.now() + 2 * 60 * 1000
                    });
                    return send(remoteJid, {
                        text: `🎮 *لعبة احزر الكلمة!*\n\n💡 التلميح: ${game.hint}\n\n⏰ لديكم دقيقتان للإجابة!\nاكتب الإجابة في الجروب 💭\n\n- Alqartha dia Bot 🌸`
                    }, msg);
                }

                // ─── صورة ────────────────────────────────────────────
                if (cmd === 'صورة') {
                    const query = args.join(' ');
                    if (!query) return send(remoteJid, { text: '🖼️ اكتب ما تريد: .صورة قطة' }, msg);
                    try {
                        await send(remoteJid, { text: `🔍 جاري البحث عن صورة: "${query}" ...\n- Alqartha dia Bot 🌸` }, msg);
                        const encodedQuery = encodeURIComponent(query);
                        const imageUrl = `https://loremflickr.com/640/480/${encodedQuery}`;
                        const response = await fetch(imageUrl, { redirect: 'follow' });
                        if (response.ok) {
                            const arrayBuffer = await response.arrayBuffer();
                            const imageBuffer = Buffer.from(arrayBuffer);
                            return send(remoteJid, {
                                image: imageBuffer,
                                caption: `🖼️ صورة: ${query}\n- Alqartha dia Bot 🌸`
                            }, msg);
                        } else {
                            return send(remoteJid, { text: `❌ ما وجدت صورة لـ "${query}"\n- Alqartha dia Bot` }, msg);
                        }
                    } catch (err) {
                        console.error('Image search error:', err);
                        return send(remoteJid, { text: '❌ حدث خطأ في البحث عن الصورة.\n- Alqartha dia Bot' }, msg);
                    }
                }

                // ─── ذكاء اصطناعي ─────────────────────────────────
                if (cmd === 'ذكاء') {
                    const question = args.join(' ');
                    if (!question) return send(remoteJid, { text: '🤖 اكتب سؤالك: .ذكاء ما هو الذكاء الاصطناعي' }, msg);

                    // ابحث في قاعدة المعرفة أولاً
                    const knowledgeKey = Object.keys(knowledgeBase).find(k =>
                        question.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(question.toLowerCase())
                    );

                    if (knowledgeKey) {
                        return send(remoteJid, {
                            text: `🤖 *Alqartha dia Bot - ذكاء اصطناعي*\n\n💡 ${knowledgeBase[knowledgeKey]}\n\n- Alqartha dia Bot 🌸`
                        }, msg);
                    }

                    // حاول استخدام API مجاني
                    try {
                        const res = await fetch(`https://api.wikimedia.org/core/v1/wikipedia/ar/search/article?q=${encodeURIComponent(question)}&limit=1`, {
                            headers: { 'User-Agent': 'AlqarthaDiaBot/1.0' }
                        });
                        if (res.ok) {
                            const data = await res.json();
                            if (data.pages && data.pages.length > 0) {
                                const page = data.pages[0];
                                const excerpt = page.excerpt?.replace(/<[^>]*>/g, '').slice(0, 300) || '';
                                if (excerpt) {
                                    return send(remoteJid, {
                                        text: `🤖 *Alqartha dia Bot - ذكاء اصطناعي*\n\n📚 *${page.title}*\n${excerpt}...\n\n- Alqartha dia Bot 🌸`
                                    }, msg);
                                }
                            }
                        }
                    } catch (err) {
                        console.error('AI search error:', err);
                    }

                    return send(remoteJid, {
                        text: `🤖 *Alqartha dia Bot - ذكاء اصطناعي*\n\n🧠 سؤالك عن: "${question}"\n\nهذا سؤال مثير للاهتمام! للحصول على إجابة دقيقة، جرّب البحث في:\n🔍 google.com\n📚 wikipedia.org\n\n- Alqartha dia Bot 🌸`
                    }, msg);
                }

                // مساعدة
                if (cmd === 'مساعدة' || cmd === 'help' || cmd === 'اوامر' || cmd === 'الاوامر') {
                    return send(remoteJid, {
                        text: `*🤖 Alqartha dia Bot - الأوامر*\n\n` +
                            `*✨ ردود تلقائية:*\n` +
                            `بوت / مرحبا / السلام عليكم\n` +
                            `كيف حالك / شكرا / احبك\n` +
                            `الوقت / التاريخ / ping\n\n` +
                            `*👥 أوامر الجروب (بدون بادئة):*\n` +
                            `مزه / نكتة - نكتة مع منشن\n` +
                            `منشن / منشن عشوائي\n` +
                            `منشن الكل / مدح / روست\n` +
                            `من الغبي / من الذكي / من يستاهل\n` +
                            `رولت / تحدي [نص]\n` +
                            `شغل [اسم أغنية]\n\n` +
                            `*💰 نظام الفلوس (.):*\n` +
                            `.فلوسي - رصيدك\n` +
                            `.عمل - اكسب فلوس\n` +
                            `.تحويل @شخص المبلغ\n` +
                            `.متجر - عرض المتجر\n` +
                            `.شراء [رقم]\n\n` +
                            `*📊 نظام المستويات (.):*\n` +
                            `.مستواي - مستواك\n` +
                            `.ترتيبي - ترتيبك\n` +
                            `.الأكثر تفاعل - الترتيب\n\n` +
                            `*🎮 الألعاب (.):*\n` +
                            `.حجر / .ورقة / .مقص\n` +
                            `.حقيقة - سؤال حقيقة عشوائي\n` +
                            `.سؤال - سؤال عشوائي\n` +
                            `.احزر - لعبة تخمين\n\n` +
                            `*🎨 الوسائط (.):*\n` +
                            `.ملصق - تحويل صورة لملصق\n` +
                            `.tts نص - تحويل نص لصوت\n` +
                            `.صورة كلمة - بحث صورة\n\n` +
                            `*🤖 ذكاء اصطناعي (.):*\n` +
                            `.ذكاء [سؤال]\n\n` +
                            `*👑 أوامر المشرفين (!):*\n` +
                            `!انذار @منشن\n` +
                            `!مسح @منشن\n` +
                            `!طرد / !ترقية / !تنزيل\n` +
                            `!عدد - عدد الأعضاء\n` +
                            `!سكر / !فتح - حجب الروابط\n\n` +
                            `*🛡️ الحماية التلقائية:*\n` +
                            `⚠️ 3 إنذارات ثم طرد للسب\n` +
                            `🚫 حجب الروابط (بأمر المشرف)\n\n` +
                            `- Alqartha dia Bot 🌸`
                    }, msg);
                }
            }

            // ─── التحقق من إجابات لعبة احزر ─────────────────────────
            const activeGame = activeGuessGames.get(remoteJid);
            if (activeGame && activeGame.endTime > Date.now()) {
                if (text.trim() === activeGame.word) {
                    activeGuessGames.delete(remoteJid);
                    const reward = 50;
                    addBalance(senderNum, reward);
                    return send(remoteJid, {
                        text: `🎉 *صح!*\n@${senderNum} أجاب صح!\nالإجابة: ${activeGame.word}\n\n💰 ربحت ${reward} عملة!\n\n- Alqartha dia Bot 🌸`,
                        mentions: [senderJid]
                    }, msg);
                }
            }

        });

        // ─── Welcome / Goodbye ───────────────────────────────────────────
        sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
            for (const participant of participants) {
                const jid = typeof participant === 'string' ? participant : participant.id;
                if (!jid) continue;
                const user = jid.split('@')[0];
                if (action === 'add') {
                    await sock.sendMessage(id, {
                        text: `🌸 *أهلاً وسهلاً بك!*\n@${user} انضم إلى المجموعة!\nنتمنى لك وقتاً ممتعاً ومفيداً 😊\n\nاكتب .مساعدة لرؤية الأوامر\n- Alqartha dia Bot`,
                        mentions: [jid]
                    });
                } else if (action === 'remove') {
                    await sock.sendMessage(id, {
                        text: `👋 وداعاً @${user}\nنتمنى أن نراك مجدداً في المجموعة!\n- Alqartha dia Bot 🌸`,
                        mentions: [jid]
                    });
                }
            }
        });

    } catch (err) {
        console.error('Bot error:', err);
        botStatus = 'error';
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => startBot(), 8000);
    }
}
