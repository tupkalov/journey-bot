const EventEmitter = require('node:events');
const http = require('http');
const JSONdb = require('simple-json-db');
const db = new JSONdb('/app/data/storage.json');
const chatsCache = db.get('chatsCache') || {};
const updateJSON = () => {
    db.set('chatsCache', chatsCache);
}

const { BOT_TOKEN } = process.env;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is missing!');

function debounce(func, wait) {
    var timeout;
    return function() {
        var context = this, args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

const TelegramBotApi = require('node-telegram-bot-api');
const botInstance = new TelegramBotApi(BOT_TOKEN, { polling: true });
console.log("Telegram bot started");

process.on('SIGTERM', () => {
    console.log("Telegram bot stopped");
    botInstance.stopPolling();
    process.exit(0);
});

// healthcheck server
botInstance.on('polling_error', () => {
    botInstance._pollingError = Date.now();
});

const requestHandler = (req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
        // Здесь мы проверяем состояние бота
        botInstance.getMe()
            .then(me => {
                // если ошибка свежее
                if (botInstance._polling._lastUpdate < botInstance._pollingError) throw new Error('Polling error');
                else res.writeHead(200, {'Content-Type': 'application/json'});
                res.end('ok');
            })
            .catch(error => {
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end(error.message);
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
        this.bot.chats[id]?.endConversation?.();
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

    async waitForMessage() {
        const promise = new Promise((resolve, reject) => {
            const handler = (event, msg) => {
                if (msg.chat.id !== this.id) return;
                event.stopPropagation()
                this.bot.offMessage(handler);
                resolve(msg);
            };
            this.bot.onMessage(handler);
            this.endPromise?.then(() => {
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
        }).catch(error => {
            console.error(`error send message to ${this.id}: ${text}`, options);   
        })
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
        if (message.role !== "system") 
            this.messageCounter++;
        
        this.historyReducer?.(this.history);
        this.saveCache();
    }

    _saveCache() {
        this.cacheData = chatsCache[this.id] = {
            ...this.cacheData,
            lastMessageDt: this.lastMessageDt,
            messageCounter: this.messageCounter
        };

        updateJSON();
    }

    resetCounter() {
        this.messageCounter = 0;
        this.saveCache();
    }

    async createThread(thread, handler) {
        this.thread = thread;
        this.endConversation?.();
        let endConversation;
        const endPromise = this.endPromise = new Promise(resolve => endConversation = this.endConversation = resolve);
        const isStopped = () => endPromise !== this.endPromise || !this.thread;
        try {
            await handler({ isStopped });
        } catch(error) {
            if (error?.message?.endsWith('ChatEnded:Handled')) return;
            console.error(error.message);
        } finally {
            if (endPromise === this.endPromise) this.thread = null;
            endConversation();
        }
    }
}

class TelegramBot {
    constructor() {
        this.botInstance = botInstance;
        this.handlers = [];
        this.chats = {};
        botInstance.on('message', (msg) => {
            const chat = this.getChat(msg); 

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
    }

    getChat (msg) {
        return this.chats[msg.chat.id] || new Chat(this, msg.chat.id, chatsCache[msg.chat.id]);
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
}

module.exports = { TelegramBot, Chat };