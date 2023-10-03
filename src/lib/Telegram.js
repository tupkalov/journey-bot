const MESSAGES = require('../messages');

const EventEmitter = require('node:events');
const http = require('http');
const JSONdb = require('simple-json-db');
const db = new JSONdb('/app/data/storage.json');
const chatsCache = db.get('chatsCache') || {};
const updateJSON = () => {
    db.set('chatsCache', chatsCache);
}

const REMINDERS_SEND_INTERVAL = parseInt(process.env.REMINDERS_SEND_INTERVAL) || 3 * 24 * 60 * 60 * 1000;
const REMINDERS_CHECK_INTERVAL = Math.round(REMINDERS_SEND_INTERVAL / 100); 

const { EQB_BOT_TOKEN } = process.env;
if (!EQB_BOT_TOKEN) throw new Error('EQB_BOT_TOKEN is missing!');

function debounce(func, wait) {
    var timeout;
    return function() {
        var context = this, args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

const TelegramBotApi = require('node-telegram-bot-api');
const botInstance = new TelegramBotApi(EQB_BOT_TOKEN, { polling: true });
console.log("Telegram bot started");

process.on('SIGTERM', () => {
    console.log("Telegram bot stopped");
    botInstance.stopPolling();
    process.exit(0);
});

// healthcheck server

const requestHandler = (req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
        // Здесь мы проверяем состояние бота
        botInstance.getMe()
            .then(me => {
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end('ok');
            })
            .catch(error => {
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end('error');
            });
    } else {
        res.writeHead(404, {'Content-Type': 'text/plain'});
        res.end('Not Found');
    }
};

const hcserver = http.createServer(requestHandler);

hcserver.listen(3003, () => {
    console.log(`hc server running on http://localhost:3003/`);
});

class Chat extends EventEmitter {
    constructor(bot, id, cacheData) {
        super();

        this.bot = bot;
        if (this.bot.chats[id]) this.bot.chats[id].endConversation();
        this.bot.chats[id] = this;
        this.id = parseInt(id);
        this.messageCounter = 0;
        this.cacheData = cacheData || { createDt: Date.now() };
        Object.assign(this, cacheData);

        this.saveCache = debounce(this._saveCache.bind(this), 1000);
        this.on('message', (event, msg) => {
            this.lastMessageDt = Date.now();
            this.saveCache();
        })
    }

    async sendChooses(header, chooses) {
        const inlineKeyboardMessage = await this.sendMessage(header, {
            reply_markup: {
                inline_keyboard: Object.entries(chooses).map(([key, value]) => ([{
                    text: value,
                    callback_data: key
                }]))
            }
        })

        const id = await new Promise((resolve, reject) => {
            const handler = (query) => {
                if (query.message.message_id !== inlineKeyboardMessage.message_id) return;
                botInstance.removeListener('callback_query', handler);
                resolve(query.data);
            };
            botInstance.on('callback_query', handler);
        });

        return chooses[id];
    }

    async sendBusy(promise) {
        if (typeof promise === 'function') promise = promise();

        var ended = false;
        // Не отправляем сообщение сразу, а ждем 1 секунду
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (ended) return; // Если ответ уже получен, то не отправляем сообщение
        
        botInstance.sendChatAction(this.id, 'typing');
        
        const timer = setInterval(() => {
            botInstance.sendChatAction(this.id, 'typing');
        }, 4500)

        return promise.finally(() => {
            ended = true;
            clearInterval(timer);
        });
    }

    async waitForMessage({ endPromise } = {}) {
        const promise = new Promise((resolve, reject) => {
            const handler = (event, msg) => {
                if (msg.chat.id !== this.id) return;
                event.stopPropagation()
                this.bot.offMessage(handler);
                delete this.waiting;
                resolve(msg);
            };
            this.bot.onMessage(handler);
            endPromise?.then(() => {
                this.bot.offMessage(handler);
                reject(new Error('ChatEnded:Handled'));
            });
        });
        
        return promise;
    }

    async sendMessage(text, options) {
        return botInstance.sendMessage(this.id, text, {
            parse_mode: 'Markdown',
            ...options
        });
    }

    setHistoryReducer(reducer) {
        this.historyReducer = reducer;
    }

    clearHistory() {
        this.history = [];
    }

    saveToHistory(message) {
        this.history = this.history || this.clearHistory();
        this.history.push(message);
        this.messageCounter++;
        this.historyReducer?.(this.history);
        this.saveCache();
    }

    _saveCache() {
        this.cacheData = chatsCache[this.id] = {
            nextReminder: 0,
            lastMessageDt: this.lastMessageDt,
            ...this.cacheData,
            messageCounter: this.messageCounter
        };

        updateJSON();
    }

    async remind() {
        try {
            const reminder = MESSAGES.reminders?.[this.cacheData.nextReminder]?.text
            if (!reminder) {
                this.cacheData.reminderEnds = true;
            } else {
                this.cacheData.nextReminder++;
                await this.sendMessage(reminder);
                this.lastMessageDt = Date.now();
            }
        } finally {
            this.saveCache();
        }
    }

    resetCounter() {
        this.messageCounter = 0;
        this.saveCache();
    }
}

class TelegramBot {
    constructor() {
        this.handlers = [];
        this.chats = {};
        botInstance.on('message', (msg) => {
            const chat = this.chats[msg.chat.id] || new Chat(this, msg.chat.id, chatsCache[msg.chat.id]);

            const event = {
                propagationStopped: false,
                stopPropagation() {
                    this.propagationStopped = true;
                }
            }

            for (const handler of this.handlers) {
                chat.emit('message', event, msg);
                if (event.propagationStopped) return;
                if (handler(event, msg, chat) === false) return;
                if (event.propagationStopped) return;
            }
        })

        this.loadChatsFromCache();

        this.startReminders();
    }
    
    onMessage (handler) {
        this.handlers.push(handler);
    }

    offMessage (handler) {
        this.handlers = this.handlers.filter(x => x !== handler);
    }

    loadChatsFromCache() {
        for (const id in chatsCache) {
            new Chat(this, id, chatsCache[id]);
        }
    }

    startReminders() {
        setInterval(() => {
            // После понедельника не шлём напоминания
            if (Date.now() > 1695589254227) return;
            for (const id in this.chats) {
                try {
                    const chat = this.chats[id];
                    if (chat.lastMessageDt && Date.now() - chat.lastMessageDt > REMINDERS_SEND_INTERVAL) {
                        if (chat.cacheData.reminderEnds) continue;
                        chat.remind().catch((e) => {
                            console.error(e.message, 'remindError');
                        })
                    }
                } catch (e) {
                    console.error(e);
                }
            }
        }, REMINDERS_CHECK_INTERVAL);

        // send schedule
        setInterval(() => {
            try {
                const { schedule = [] } = MESSAGES;
                for (const scheduleItem of schedule) {
                    for (const id in this.chats) {
                        let chat;
                        try {
                            chat = this.chats[id];
                            chat.cacheData.scheduledSended = chat.cacheData.scheduledSended || [];
                            // Провверяем, что сообщение ещё не отправлено
                            if (chat.cacheData.scheduledSended.includes(scheduleItem.name)) return;
                            // Проверяем, что время пришло
                            if (Date.now() < scheduleItem.dt) continue;
                            // Сохраняем что сообщение было отправлено
                            chat.cacheData.scheduledSended.push(scheduleItem.name);
                            // Проверяем что пользователь не свежесозданный
                            if (chat.cacheData.createDt && chat.cacheData.createDt > scheduleItem.dt) continue;

                            chat.sendMessage(scheduleItem.text).catch((e) => {
                                console.error(e.message, 'scheduleError');
                            });
                        } catch (e) {
                            console.error(e);
                        } finally {
                            chat?.saveCache();
                        }
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }, REMINDERS_CHECK_INTERVAL);
    }
}

module.exports = { TelegramBot, Chat };