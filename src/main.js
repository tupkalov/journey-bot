const { TelegramBot } = require('./lib/Telegram');
const { AI } = require('./lib/AI');
const MESSAGES = require('./messages.js');

const telegramBot = new TelegramBot;

const COUNT_BY_THEME = parseInt(process.env.SOFTSKILLS_COUNT_BY_THEME) || 4;
const LIMIT_BY_USER = parseInt(process.env.SOFTSKILLS_LIMIT_BY_USER) || 50;

telegramBot.onMessage(async (event, msg, chat) => {
    if (msg.text === '/resetChatCounter') {
        event.stopPropagation();
        chat.resetCounter();
        chat.sendMessage('Счетчик сброшен');
        return;
    }

    if (msg.text === '/resetReminders') {
        event.stopPropagation();
        chat.cacheData.reminderEnds = false;
        chat.cacheData.nextReminder = 0;
        chat.saveCache();
        chat.sendMessage('Напоминания сброшены');
        return;
    }

    // ограничение на количество сообщений
    if (chat.messageCounter >= LIMIT_BY_USER) {
        chat.sendMessage(MESSAGES.limit);
        event.stopPropagation();
        return;
    }

    // Если пользователь еще не писал ничего, то приветствуем его
    if (msg.text !== '/start' && chat.inProcess) {
        return;
    }
    chat.inProcess = true;

    chat.endConversation?.(); // Закрываем предыдущую беседу
    var endConversation;
    const endPromise = new Promise(resolve => endConversation = chat.endConversation = resolve);

    event.stopPropagation();
    try {
        const ai = new AI(msg.from.id);
        chat.setHistoryReducer(ai.historyReducer);
        chat.clearHistory();
        

        // Первое сообщение которое не отправляем пользователю
        const startMessage = { role: 'system', content: MESSAGES.context, important: true };
        chat.saveToHistory(startMessage);
        
        // Отправляем выбор темы и ждем выбора
        const choose = await chat.sendChooses(MESSAGES.chooseFromList, MESSAGES.themes.map(({ label }) => label));
        const theme = MESSAGES.themes.find(({ label }) => label === choose);;
        // Формируем выбор темы пользователя для ИИ
        var answerFromUser = { role: "user", content: MESSAGES.Ichose + choose, important: true };
        chat.saveToHistory(answerFromUser);
        // Отправляем ответ от ИИ
        var answerFromAssistant = { role: "assistant", content: theme.start, important: true };
        chat.saveToHistory(answerFromAssistant);
        await chat.sendMessage(answerFromAssistant.content);

        // Ждем ответа от пользователя
        answerFromUser = await chat.waitForMessage({ endPromise }).then(msg => {
            return msg && { role: "user", content: msg.text };
        });

        let index = 1;
        do {
            try {
                const thisIsEnd = index > COUNT_BY_THEME;

                if (thisIsEnd)  answerFromUser.content += MESSAGES.end;
                else if (theme.addToAI) answerFromUser.content += theme.addToAI;
                
                // Ждем ответа от ИИ
                chat.saveToHistory(answerFromUser);
                answerFromAssistant = await chat.sendBusy(ai.sendHistory(chat.history));
                // Сохраняем ответ от ИИ в историю
                if (!thisIsEnd) chat.saveToHistory(answerFromAssistant);
                else answerFromAssistant.content += MESSAGES.AIEnd;

                // Отправляем ответ от ИИ
                let sendToUser = answerFromAssistant.content;
                if (!thisIsEnd) sendToUser = `${index}/${COUNT_BY_THEME}: ${sendToUser}`
                await chat.sendMessage(sendToUser);

                // Ждем ответа от пользователя
                anwerFromUserPromise = chat.waitForMessage({ endPromise }).then(msg => {
                    return msg && { role: "user", content: msg.text };
                })

                // Таймаут если пользователь не ответил за 2 часа 
                let timeout;
                timeout = setTimeout(() => {
                    if (chat.messageCounter < LIMIT_BY_USER && !thisIsEnd)
                        chat.sendMessage(MESSAGES.timeout);
                }, 1000 * 60 * 60 * 2);

                answerFromUser = await anwerFromUserPromise;
                clearTimeout(timeout);

                index++;
            } catch (error) {
                if (error?.message?.endsWith('ChatEnded:Handled')) return;
                console.error(error)
            }
            
        // Если ответ пустой значит пользователь закончил
        } while (answerFromUser);
    } catch (error) {
        console.error(error);
    } finally {
        endConversation()
    }
})