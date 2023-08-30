require('./funcs.js')
const { Configuration, OpenAIApi } = require('openai');
const { encode } = require("gpt-3-encoder");
const EventEmitter = require('node:events');

const MESSAGES = require('./messages.js');

// Создайте экземпляр OpenAI
if (!process.env.EQB_OPENAI_API_KEY) {
    throw new Error('EQB_OPENAI_API_KEY is missing!')
}
if (!process.env.EQB_OPENAI_ORG) {
    throw new Error('EQB_OPENAI_ORG is missing!')
}

const openAIConfig = new Configuration({
  apiKey        : process.env.EQB_OPENAI_API_KEY,
  organization  : process.env.EQB_OPENAI_ORG
});
const openai = new OpenAIApi(openAIConfig);

module.exports = class AIChat extends EventEmitter{
    constructor (userId) {
        super();
        
        this.context = [];

        if (!this.constructor.cache) this.constructor.cache = {};
        this.constructor.cache[userId]?.endConversation();
        this.constructor.cache[userId] = this;

        this.endPromise = new Promise((resolve) => {
            this.on('endConversation', resolve);
        });
    }
    
    async getThemes () {
        try {
            const response = await openai.createChatCompletion({
                model: "gpt-4",
                messages: [{role: "user", content: `${MESSAGES.context}. Get list of themes in 5 items with just a title of theme for conversation:\n\n` }],
                max_tokens: 500,
                temperature: 0.8,
                stop: ["\n\n\n"]
            });
            this.cache({ role: 'assistant', content: MESSAGES.context, important: true });
            return response.data.choices[0].message.content.split('\n');
        } catch (err) {
            console.log(err.message)
        }

    }

    async sendWithContext (aiMessage) {
        this.#reduceContextSize()
        var answer;
        try {
            const response = await openai.createChatCompletion({
                model: "gpt-3.5-turbo-0613",
                messages: [...this.context, aiMessage].map(({ role, content }) => ({ role, content })),
                max_tokens: 1000,
                temperature: 0.8
            });
            answer = response.data.choices[0].message;
            this.cache(aiMessage, answer);
        } catch (err) {
            console.log(err.message)
            throw new Error('OpenAI error')
        }
        return answer;
    } 

    // Удаляет сообщения из контекста, пока его длина не станет меньше 2048
    async #reduceContextSize () {
        // Возвращает длину всех сообщений в местных попугаях
        function getTokenLength(context) {
            return encode(context.map(val => val.content).join(' ')).length
        }


        while (getTokenLength(this.context) > 2048) {
            for (const aiMessage of this.context) {
                if (aiMessage.important) continue;
                this.context.splice(this.context.indexOf(aiMessage), 1);
                break;
            }
        }
    }

    cache (...msgs) {
        this.context.push(...msgs);
        this.#reduceContextSize();
    }

    endConversation () {
        this.context = [];
        this.emit('endConversation');
    }
}