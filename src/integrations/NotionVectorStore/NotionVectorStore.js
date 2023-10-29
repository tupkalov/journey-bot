const { NotionAPILoader } = require("langchain/document_loaders/web/notionapi");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { OpenAIEmbeddings } = require("langchain/embeddings/openai");

const {
  RunnablePassthrough,
  RunnableSequence,
} = require("langchain/schema/runnable");
const { StringOutputParser } = require("langchain/schema/output_parser");
const {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  SystemMessagePromptTemplate,
} = require("langchain/prompts");
const { ChatOpenAI } = require("langchain/chat_models/openai");
const { formatDocumentsAsString } = require("langchain/util/document");

module.exports = class NotionVectorStore {
    constructor({ apiKey, pageId, systemMessage }) {
        this.options = { apiKey, pageId, systemMessage };
        
        // Лоадер загружающий данные из Notion
        this.pageLoader = new NotionAPILoader({
            clientOptions: {
                auth: apiKey,
            },
            id: pageId,
            type: "page",
        });

        this.splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 100,
            separators: ["#", "##"],
          });

        this.load();
    }

    load() {
        return this.loading = this._load();
    }

    async _load() {
        console.log("[NotionVectorStore] Loading docs...")
        const loadedDocs = await this.pageLoader.load();
        console.log("[NotionVectorStore] ...Docs loaded. Split...")
        const splittedDocs = await this.splitter.splitDocuments(loadedDocs);
        console.log("[NotionVectorStore] ...Docs splitted. Create vector store...")
        const vectorStore = await MemoryVectorStore.fromDocuments(
            splittedDocs,
            new OpenAIEmbeddings()
        );
        this.vectorStoreRetriever = vectorStore.asRetriever();
        console.log("[NotionVectorStore] ...Vector store created. Loading complete")
    }

    async request(question, { history } = {}) {
        await this.loading;
        const model = new ChatOpenAI({
            temperature: 0
        });
        const SYSTEM_TEMPLATE = 
        `${this.options.systemMessage}
        ----------------
        {context}`;

        const messages = [
          SystemMessagePromptTemplate.fromTemplate(SYSTEM_TEMPLATE),
        ];

        // Если есть история вставляем её сначала
        if (history) {
            messages.push(
                SystemMessagePromptTemplate.fromTemplate(`История вопросов и ответов пользователя:\n${history}`)
            );
        }
        
        // Вставляем вопрос пользователя
        messages.push(
            HumanMessagePromptTemplate.fromTemplate("{question}")
        );

        const prompt = ChatPromptTemplate.fromMessages(messages);
        
        const chain = RunnableSequence.from([
          {
            context: this.vectorStoreRetriever.pipe(formatDocumentsAsString),
            question: new RunnablePassthrough()
          },
          prompt,
          model,
          new StringOutputParser(),
        ]);
        
        const answer = await chain.invoke(
            question
        )
        
        return answer;
    }
}