module.exports = class RemindersController {
    constructor(telegramBot, options) {
        this.telegramBot = telegramBot;
        this.options = options;

        const { sendInterval, checkInterval, MESSAGES } = this.options;

        // Старт работы напоминаний
        setInterval(() => {
            const { chats } = telegramBot;
            const { schedule = [] } = MESSAGES;
            for (const id in chats) {

                // reminder
                try {
                    const chat = chats[id];
                    if (chat.lastMessageDt && Date.now() - chat.lastMessageDt > sendInterval) {
                        if (chat.cacheData.reminderEnds) continue;
                        this.chatRemind(chat).catch((e) => {
                            console.error(e.message, 'remindError');
                        })
                    }
                } catch (e) {
                    console.error(e);
                }

                // send schedule
                try {
                    const { chats } = telegramBot;
                    for (const scheduleItem of schedule) {
                        try {
                            chat.cacheData.scheduledSended = chat.cacheData.scheduledSended || [];
                            // Провверяем, что сообщение ещё не отправлено
                            if (chat.cacheData.scheduledSended.includes(scheduleItem.name)) return;
                            // Проверяем, что время пришло
                            if (Date.now() < scheduleItem.dt) continue;
                            // Сохраняем что сообщение было отправлено
                            chat.cacheData.scheduledSended.push(scheduleItem.name);
                            // Проверяем что пользователь не свежесозданный
                            if (chat.cacheData.createDt && chat.cacheData.createDt > scheduleItem.dt) continue;

                            chat.sendMessage(scheduleItem.text, !chat.cacheData.joined ? {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{
                                            text: MESSAGES.joinMessage,
                                            callback_data: "/join"
                                        }]
                                    ]
                                }
                            } : {}).catch((e) => {
                                console.error(e.message, 'scheduleError');
                            });
                        } catch (e) {
                            console.error(e);
                        } finally {
                            chat?.saveCache();
                        }
                    }
                } catch (e) {
                    console.error(e);
                }
            }
        }, checkInterval);
    }

    async chatRemind(chat) {
        try {
            const { MESSAGES } = this.options;
            if (chat.cacheData.nextReminder == null) chat.cacheData.nextReminder = 0;

            const reminder = MESSAGES.reminders?.[chat.cacheData.nextReminder]?.text
            if (!reminder) {
                chat.cacheData.reminderEnds = true;
            } else {
                chat.cacheData.nextReminder++;
                await chat.sendMessage(reminder, !chat.cacheData.joined ? {
                    reply_markup: {
                        inline_keyboard: [
                            [{
                                text: MESSAGES.joinMessage,
                                callback_data: "/join"
                            }]
                        ]
                    }
                } : {});
                chat.lastMessageDt = Date.now();
            }
        } catch (e) {
            console.error(e);
        } finally {
            chat?.saveCache();
        }
    }
}