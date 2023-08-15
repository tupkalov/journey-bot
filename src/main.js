const Bot = require('./lib/Bot');
const AIChat = require('./lib/AIChat');
const MESSAGES = require('./lib/messages');

const telegramBot = new Bot;

telegramBot.onMessage(async (event, msg) => {
    if (msg.text === '/start') event.stopPropagation();
    else return;

    const ai = new AIChat(msg.from.id);

    const themesPromise = ai.getThemes()
    telegramBot.sendBusy(msg.chat.id, themesPromise);
    const themes = await themesPromise;
    
    const chooseMsg = await telegramBot.sendMessage(msg.chat.id, MESSAGES.chooseFromList, {
        reply_to_message_id: msg.message_id,
        reply_markup: {
            inline_keyboard: themes.map((theme, index) => {
                // Ограничиваем длину текста чтобы телеграм не ругался
                if (theme.length > 64) theme = theme.slice(0, 61) + '...';
                return [{
                    text: theme,
                    callback_data: theme
                }]
            })
        }
    });

    const choose = await telegramBot.waitForChoose(chooseMsg);
    var answerFromUser = { role: "user", content: MESSAGES.Ichose + choose, important: true };

    var answerFromAssistant;
    try {
        do {
            // Ждем ответа от ИИ
            answerFromAssistant = await telegramBot.sendBusy(msg.chat.id, async () => {
                return ai.sendWithContext(answerFromUser);
            });
            // Отправляем ответ от ИИ
            await telegramBot.sendMessage(msg.chat.id, answerFromAssistant.content);
            // Ждем ответа от пользователя
            answerFromUser = await telegramBot.waitForMessage(msg.chat.id, { endPromise: ai.endPromise }).then(msg => {
                return msg ? { role: "user", content: msg.text, important: true } : false;
            })
            
        // Если ответ пустой значит пользователь закончил
        } while (answerFromUser);
    } catch (error) {
        console.error(error.message)
        ai.endConversation();
    }
    
})