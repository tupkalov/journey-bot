const { TelegramBot } = require('./lib/Telegram');
const { AI } = require('./lib/AI');
const { createLead } = require('./AmoClient')
const MESSAGES = require('../config/messages.js');
const RemindersController = require('./RemindersController');

const telegramBot = new TelegramBot;

const COUNT_BY_THEME = parseInt(process.env.COUNT_BY_THEME) || 3;
const LIMIT_BY_USER = parseInt(process.env.LIMIT_BY_USER) || 50;
const TIMEOUT_FOR_USER_ANSWER = parseInt(process.env.TIMEOUT_FOR_USER_ANSWER) || 1000 * 60 * 60 * 2;

// Настройки работы напоминаний
const REMINDERS_SEND_INTERVAL = parseInt(process.env.REMINDERS_SEND_INTERVAL) || 3 * 24 * 60 * 60 * 1000;
const REMINDERS_CHECK_INTERVAL = parseInt(process.env.REMINDERS_CHECK_INTERVAL) || Math.round(REMINDERS_SEND_INTERVAL / 100); 

const messageHandler = async (event, msg, chat) => {
    try {
        if (msg.text === '/resetChatCounter') {
            event.stopPropagation();
            chat.resetCounter();
            chat.sendMessage('Счетчик сброшен');
            return;
        }

        // if (msg.text === '/resetReminders') {
        //     event.stopPropagation();
        //     chat.cacheData.reminderEnds = false;
        //     chat.cacheData.nextReminder = 0;
        //     chat.saveCache();
        //     chat.sendMessage('Напоминания сброшены');
        //     return;
        // }

        if (msg.text === "/resetJoin") {
            event.stopPropagation();
            chat.cacheData.joined = false;
            chat.saveCache();
            chat.sendMessage('Можно присоедениться заново');
            return;
        }

        if (msg.text === '/join') {
            event.stopPropagation();
            if (chat.cacheData.joined) {
                return;
            }

            chat.createThread("join", async ({ isStopped }) => {
                // EMAIL
                chat.sendMessage(MESSAGES.joinEmail)
                let email, name;
                while (true) {
                    const answerEmail = await chat.waitForMessage();
                    if (/^[\w-+_\.]+@([\w-_]+\.)+[\w-]{2,4}$/.test(email = answerEmail.text.trim())) break;
                    
                    await chat.sendMessage(MESSAGES.joinWrongEmail);
                };
                // NAME
                const namePromise = new Promise(async resolve => {
                    // NAME
                    await chat.sendMessage(MESSAGES.joinName);
                    const answerName = await chat.waitForMessage();
                    const name = answerName.text.trim().slice(0, 512);
                    resolve(name);
                });
                const timeoutPromise = new Promise(resolve => setTimeout(() => resolve("Unknown name"), 60000 * 2)); // 2 min

                name = await Promise.race([namePromise, timeoutPromise]);

                await chat.sendMessage(MESSAGES.joinEnd);

                await createLead({ name, email })

                chat.cacheData.joined = true;
            });

            return;
        }

        // ограничение на количество сообщений
        if (chat.messageCounter >= LIMIT_BY_USER && (!chat.thread || chat.thread === "main")) {
            await chat.sendMessage(MESSAGES.limit, chat.cacheData.joined ? {} : {
                reply_markup: {
                    inline_keyboard: [
                        [{
                            text: MESSAGES.joinMessage,
                            callback_data: "/join"
                        }]
                    ]
                }
            });
            event.stopPropagation();
            return;
        }

        // Если пользователь еще не писал ничего, то приветствуем его
        if (msg.text !== '/start' && chat.thread && !(chat.thread === "main" && !chat._mainThreadStarted)) {
            return;
        }  
        chat._mainThreadStarted = false;

        // Закрываем предыдущую беседу
        event.stopPropagation();
        chat.createThread("main", async ({ isStopped }) => {
            const ai = new AI(msg.from.id);
            chat.setHistoryReducer(ai.historyReducer);
            chat.clearHistory();
            
            // Первое сообщение которое не отправляем пользователю
            const startMessage = { role: 'system', content: MESSAGES.context, important: true };
            chat.saveToHistory(startMessage);
            
            // Отправляем выбор темы и ждем выбора
            const choose = await chat.sendChooses(MESSAGES.chooseFromList, MESSAGES.themes.map(({ label }) => label));

            const fullChooseItem = MESSAGES.themes.find(({ label }) => label === choose);
            const fullChoose = fullChooseItem.fullname || fullChooseItem.label;

            chat._mainThreadStarted = true;
            // Формируем выбор темы пользователя для ИИ
            var answerFromUser = { role: "user", content: MESSAGES.Ichose + fullChoose + MESSAGES.IchoseEnd, important: true };
            chat.saveToHistory(answerFromUser);
            // Отправляем ответ от ИИ
            var answerFromAssistant = await chat.sendBusy(ai.sendHistory(chat.history, { gpt4: true }));
            chat.saveToHistory(answerFromAssistant);
            await chat.sendMessage(answerFromAssistant.content);

            // Ждем ответа от пользователя
            answerFromUser = await chat.waitForMessage().then(msg => {
                return msg && { role: "user", content: msg.text, dialog: true };
            });

            let index = 1;
            do {
                try {
                    // Ждем ответа от ИИ
                    chat.saveToHistory(answerFromUser);

                    const thisIsEnd = index > COUNT_BY_THEME;
                    const exactlyEnd = index === COUNT_BY_THEME + 1;
                    
                    // Пока идет диалог говорим что отвечать асистенту
                    // if (!thisIsEnd && theme.addToAI) {
                    //     chat.saveToHistory({ role: "system", content: theme.addToAI });
                    // }

                    // Если последнее сообщение от юзера то просим оценить АИ
                    if (exactlyEnd) {
                        chat.saveToHistory({ role: "user", content: MESSAGES.end, dialog: true });
                        const filteredHistory = chat.history.filter(msg => msg.dialog);
                        ai.historyReducer(filteredHistory, { maxTokenLength: 4000 })
                        answerFromAssistant = await chat.sendBusy(ai.sendHistory(filteredHistory/* , { gpt4: true } */));
                    } else {
                        answerFromAssistant = await chat.sendBusy(ai.sendHistory(chat.history));
                    }
                    if (isStopped()) return;

                    // Сохраняем ответ от ИИ в историю
                    answerFromAssistant.dialog = true;
                    chat.saveToHistory(answerFromAssistant);
                    if (thisIsEnd) answerFromAssistant.content += MESSAGES.AIEnd;

                    // Отправляем ответ от ИИ
                    let sendToUser = answerFromAssistant.content;
                    if (!thisIsEnd) sendToUser = `${index}/${COUNT_BY_THEME}: ${sendToUser}`
                    
                    await chat.sendMessage(sendToUser, !chat.cacheData.joined && thisIsEnd ? {
                        reply_markup: {
                            inline_keyboard: [
                                [{
                                    text: MESSAGES.joinMessage,
                                    callback_data: "/join"
                                }]
                            ]
                        }
                    } : {});

                    // Ждем ответа от пользователя
                    const anwerFromUserPromise = chat.waitForMessage().then(msg => {
                        return msg && { role: "user", content: msg.text, dialog: true };
                    })

                    // Таймаут если пользователь не ответил за 2 часа 
                    let timeout;
                    try {
                        timeout = setTimeout(() => {
                            if (chat.messageCounter < LIMIT_BY_USER && !thisIsEnd)
                                chat.sendMessage(MESSAGES.timeout);
                        }, TIMEOUT_FOR_USER_ANSWER);

                        answerFromUser = await anwerFromUserPromise;
                    } finally {
                        clearTimeout(timeout);
                    }

                    index++;
                } catch (error) {
                    if (error?.message?.endsWith('ChatEnded:Handled')) return;
                    console.error(error.message)
                }
                
            // Если ответ пустой значит пользователь закончил
            } while (answerFromUser);
        });
    } catch (error) {
        console.error(error.message);
    }
};
telegramBot.onMessage(messageHandler)


// Конвертируем нажатия на кнопку (присоедениться в запрос /join)
telegramBot.botInstance.on('callback_query', (query) => {
    if (query.data !== "/join") return;
    const joinMessage = { ...query.message, text: "/join" };
    messageHandler({ stopPropagation: () => {} }, joinMessage, telegramBot.getChat(query.message));
});

new RemindersController
(telegramBot, {
    sendInterval: REMINDERS_SEND_INTERVAL,
    checkInterval: REMINDERS_CHECK_INTERVAL,
    MESSAGES
});