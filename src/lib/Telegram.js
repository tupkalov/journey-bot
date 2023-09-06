const MESSAGES = require('../messages');

const JSONdb = require('simple-json-db');
const db = new JSONdb('/app/data/storage.json');
const chatsCache = db.get('chatsCache') || {};
const updateJSON = () => {
    db.set('chatsCache', chatsCache);
}

const { EQB_BOT_TOKEN } = process.env;
if (!EQB_BOT_TOKEN) throw new Error('EQB_BOT_TOKEN is missing!');

const TelegramBotApi = require('node-telegram-bot-api');
const botInstance = new TelegramBotApi(EQB_BOT_TOKEN, { polling: true });
console.log("Telegram bot started");

class Chat {
    constructor(bot, id) {
        this.bot = bot;
        if (this.bot.chats[id]) this.bot.chats[id].endConversation();
        this.bot.chats[id] = this;
        this.id = id;
        this.messageCounter = chatsCache[id]?.messageCounter || 0;
        this.history = chatsCache[id]?.history || [];
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
        return new Promise((resolve, reject) => {
            const handler = (event, msg) => {
                if (msg.chat.id !== this.id) return;
                event.stopPropagation()
                this.bot.offMessage(handler);
                resolve(msg);
            };
            this.bot.onMessage(handler);
            endPromise?.then(() => {
                this.bot.offMessage(handler);
                reject(new Error('ChatEnded:Handled'));
            });
        });
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

    saveCache() {
        chatsCache[this.id] = {
            messageCounter: this.messageCounter
        };
        updateJSON();
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
            const chat = this.chats[msg.chat.id] || new Chat(this, msg.chat.id);

            const event = {
                propagationStopped: false,
                stopPropagation() {
                    this.propagationStopped = true;
                }
            }

            for (const handler of this.handlers) {
                if (handler(event, msg, chat) === false) return;
                if (event.propagationStopped) return;
            }
        })
    }
    
    onMessage (handler) {
        this.handlers.push(handler);
    }

    offMessage (handler) {
        this.handlers = this.handlers.filter(x => x !== handler);
    }
}

module.exports = { TelegramBot, Chat };