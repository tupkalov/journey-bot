const { EQB_BOT_TOKEN } = process.env;
if (!EQB_BOT_TOKEN) throw new Error('EQB_BOT_TOKEN is missing!');

const TelegramBot = require('node-telegram-bot-api');
const botInstance = new TelegramBot(EQB_BOT_TOKEN, { polling: true });

class Bot {
    constructor() {
        this.handlers = [];
        botInstance.on('message', (msg) => {
            const event = {
                propagationStopped: false,
                stopPropagation() {
                    this.propagationStopped = true;
                }
            }

            for (const handler of this.handlers) {
                if (handler(event, msg) === false) return;
                if (event.propagationStopped) return;
            }
        })
    }
    async sendBusy(chatId, promise) {
        if (typeof promise === 'function') promise = promise();

        var ended = false;
        promise.finally(() => {
            ended = true;
        });

        // Не отправляем сообщение сразу, а ждем 1 секунду
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (ended) return; // Если ответ уже получен, то не отправляем сообщение
        
        botInstance.sendChatAction(chatId, 'typing');
        
        const timer = setInterval(() => {
            botInstance.sendChatAction(chatId, 'typing');
        }, 4500)

        return promise.finally(() => {
            clearInterval(timer);
        });
    }

    on() {
        return botInstance.on.apply(botInstance, arguments);
    }
    
    onMessage (handler) {
        this.handlers.push(handler);
    }
    offMessage (handler) {
        this.handlers = this.handlers.filter(x => x !== handler);
    }

    sendMessage() {
        return botInstance.sendMessage.apply(botInstance, arguments);
    }

    async waitForChoose(msg) {
        return new Promise((resolve, reject) => {
            const handler = (query) => {
                if (query.message.message_id !== msg.message_id) return;
                botInstance.removeListener('callback_query', handler);
                resolve(query.data);
            };
            botInstance.on('callback_query', handler);
        });
    }

    waitForMessage(chatId, { endPromise } = {}) {
        return new Promise((resolve) => {
            const handler = (event, msg) => {
                if (msg.chat.id !== chatId) return;
                event.stopPropagation()
                this.offMessage(handler);
                resolve(msg);
            };
            this.onMessage(handler);
            endPromise?.then(() => {
                this.offMessage(handler);
                resolve();
            });
        });
    }
}

module.exports = Bot;