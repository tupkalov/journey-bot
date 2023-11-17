const { Configuration, OpenAIApi } = require('openai');
const { encode } = require("gpt-3-encoder");
const EventEmitter = require('node:events');

// Создайте экземпляр OpenAI
if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing!')
}
if (!process.env.OPENAI_ORG) {
    throw new Error('OPENAI_ORG is missing!')
}

const openAIConfig = new Configuration({
  apiKey        : process.env.OPENAI_API_KEY,
  organization  : process.env.OPENAI_ORG
});
const openai = new OpenAIApi(openAIConfig);

module.exports.AI = class AI extends EventEmitter{
    constructor (userId) {
        super();
    }
    
    // TODO: requestList
    // async getThemes () {
    //     try {
    //         const response = await openai.createChatCompletion({
    //             model: "gpt-4",
    //             messages: [{role: "user", content: `${MESSAGES.context}. Get list of themes in 5 items with just a title of theme for conversation:\n\n` }],
    //             max_tokens: 500,
    //             temperature: 0.8,
    //             stop: ["\n\n\n"]
    //         });
    //         //this.saveToHistory({ role: 'assistant', content: MESSAGES.context, important: true });
    //         return response.data.choices[0].message.content.split('\n');
    //     } catch (err) {
    //         console.log(err.message)
    //     }
    // }

    async sendHistory (history, { gpt4 = false } = {}) {
        var answer;
        try {
            const response = await openai.createChatCompletion({
                //model: "gpt-4-0613",
                model: gpt4 ? "gpt-4-1106-preview" : "gpt-3.5-turbo-1106",
                messages: history.map(({ role, content }) => ({ role, content })),
                max_tokens: 500,
                temperature: .8
            });
            answer = response.data.choices[0].message;
        } catch (err) {
            console.error(err)
            throw new Error('OpenAI error')
        }
        return answer;
    } 

    // Удаляет сообщения из контекста, пока его длина не станет меньше 2048
    historyReducer (history, { maxTokenLength = 10000 } = {}) {
        // Возвращает длину всех сообщений в местных попугаях
        function getTokenLength() {
            return encode(history.map(val => val.content).join(' ')).length
        }

        label:
        while (getTokenLength(history) > maxTokenLength) {
            for (const msg of history) {
                if (msg.important) continue;
                history.splice(history.indexOf(msg), 1);
                continue label;
            }
            break;
        }

        return history;
    }
}