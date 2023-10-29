const { TelegramBot } = require('./lib/Telegram');
// const { AI } = require('./lib/AI');
const MESSAGES = require('../config/messages.js');

const NotionVectorStore = require('./integrations/NotionVectorStore');
const NOTION_API_KEY = process.env.NOTION_API_KEY;
if (!NOTION_API_KEY) throw new Error("NOTION_API_KEY is required");

const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;
if (!NOTION_PAGE_ID) throw new Error("NOTION_PAGE_ID is required");

const notion = new NotionVectorStore({
    apiKey: NOTION_API_KEY,
    pageId: NOTION_PAGE_ID,
    systemMessage: MESSAGES.systemMessage
})

const telegramBot = new TelegramBot;
const TIMEOUT_FOR_USER_ANSWER = 1000 * 60 * 2; // 2 min

const MAX_MESSAGES_PAIRS = 2;
const historyReducer = (history) => {
    if (history.length <= MAX_MESSAGES_PAIRS) return;
    history.splice(0, history.length - MAX_MESSAGES_PAIRS);
};

const messageHandler = async (event, msg, chat) => {
    try {
        // Если сообщение не текстовое то кидаем ошибку пользователю
        if (!msg.text) {
            chat.sendMessage(MESSAGES.onlyText);
            event.stopPropagation();
            return;
        }

        if (msg.text === "/updateNotion") {
            event.stopPropagation();
            chat.sendMessage("Обновляю данные");
            await notion.load();
            chat.sendMessage("Данные обновлены");
            return;
        }

        // Если в тексте команда то кидаем предложение задать вопрос
        if (msg.text.startsWith('/')) {
            chat.sendMessage(MESSAGES.askQuestion);
            event.stopPropagation();
            return;
        }
        // Если пользователь еще не писал ничего, то приветствуем его
        if (chat.thread) {
            return;
        }

        // Закрываем предыдущую беседу
        event.stopPropagation();
        chat.createThread("main", async ({ isStopped }) => {
            chat.setHistoryReducer(historyReducer);
            chat.clearHistory();
            while (msg) {
                console.log(`Запрос: ${msg.text}, от пользователя: ${msg.from.id}`)
                // Соединяем все вопросы и ответы в список в строку
                const historyForAI = chat.history.reduce((acc, msg) => {
                    return acc + "- " + msg.content + "\n";
                }, "")
                
                // Отправляем запрос в ИИ
                const promise = notion.request(msg.text + MESSAGES.addToUserRequest, { history: historyForAI });
                let answer; // Ждем ответ
                promise.then(msg => (answer = msg));

                // Таймаут если ИИ не ответил за 2 минуты
                let timeout;
                const timeoutPromise = new Promise(resolve => {
                    timeout = setTimeout(() => {
                        chat.sendMessage(MESSAGES.timeout);
                    }, TIMEOUT_FOR_USER_ANSWER);
                });
                const commonPromise = Promise.race([promise, timeoutPromise]);

                // Отправляем сообщение пользователю что ИИ думает
                chat.sendBusy(commonPromise);
                await commonPromise;
                clearTimeout(timeout);

                if (answer) {
                    // Сохраняем ответ от ИИ в историю
                    console.log(`Ответ: ${answer} для пользователя: ${msg.from.id}`)
                    chat.saveToHistory({ role: "user", content: msg.text }, { role: "assistant", content: answer });
                    // Отправляем ответ от ИИ
                    chat.sendMessage(answer);
                }

                // Ждем ответа от пользователя
                msg = await chat.waitForMessage()
            }
        });
    } catch (error) {
        console.error(error);
    }
};

/*const messageHandler = async (event, msg, chat) => {
    try {
        if (msg.text === '/resetChatCounter') {
            event.stopPropagation();
            chat.resetCounter();
            chat.sendMessage('Счетчик сброшен');
            return;
        }

        // ограничение на количество сообщений
        if (chat.messageCounter >= LIMIT_BY_USER && (!chat.thread || chat.thread === "main")) {
            chat.sendMessage(MESSAGES.limit);
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
            chat._mainThreadStarted = true;
            const theme = MESSAGES.themes.find(({ label }) => label === choose);
            // Формируем выбор темы пользователя для ИИ
            var answerFromUser = { role: "user", content: MESSAGES.Ichose + choose, important: true };
            chat.saveToHistory(answerFromUser);
            // Отправляем ответ от ИИ
            var answerFromAssistant = { role: "assistant", content: theme.start, important: true };
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
                    if (!thisIsEnd && theme.addToAI) {
                        chat.saveToHistory({ role: "system", content: theme.addToAI });
                    }

                    // Если последнее сообщение от юзера то просим оценить АИ
                    if (exactlyEnd) {
                        chat.saveToHistory({ role: "user", content: MESSAGES.end, dialog: true });
                        const filteredHistory = chat.history.filter(msg => msg.dialog);
                        ai.historyReducer(filteredHistory, { maxTokenLength: 4000 })
                        answerFromAssistant = await chat.sendBusy(ai.sendHistory(filteredHistory, { gpt4: true }));
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
                    console.error(error)
                }
                
            // Если ответ пустой значит пользователь закончил
            } while (answerFromUser);
        });
    } catch (error) {
        console.error(error);
    }
};*/
telegramBot.onMessage(messageHandler)


// // Конвертируем нажатия на кнопку (присоедениться в запрос /join)
// telegramBot.botInstance.on('callback_query', (query) => {
//     if (query.data !== "/join") return;
//     const joinMessage = { ...query.message, text: "/join" };
//     messageHandler({ stopPropagation: () => {} }, joinMessage, telegramBot.getChat(query.message));
// });*/