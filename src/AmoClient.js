const { Client } = require('amocrm-js');
const fs = require('fs');
const path = require('path');

// экземпляр Client
global.client = new Client({
    // логин пользователя в портале, где адрес портала domain.amocrm.ru
    domain: process.env.AMO_DOMAIN, // может быть указан полный домен вида domain.amocrm.ru, domain.amocrm.com
    /* 
      Информация об интеграции (подробности подключения 
      описаны на https://www.amocrm.ru/developers/content/oauth/step-by-step)
    */
    auth: {
      client_id: process.env.AMO_CLIENT_ID, // ID интеграции
      client_secret: process.env.AMO_CLIENT_SECRET, // Секретный ключ
      redirect_uri: process.env.AMO_REDIRECT_URL, // Ссылка для перенаправления'
      code: process.env.AMO_CODE, // Код авторизации
    },
});

(async () => {
    await new Promise(r => setTimeout(r, 2000));
    // принудительное обновление токена (если ранее не было запросов)
    const updateConnection = async () => {
        if (client.token.getValue() && !client.connection.isTokenExpired()) {
            return;
        }
        await client.connection.update();
    }

    const filePath = path.resolve(__dirname, '../config/token.json');
    let renewTimeout;

    client.token.on('change', () => {
        const token = client.token.getValue();
        fs.writeFileSync(filePath, JSON.stringify(token));

        // обновление токена по истечению
        const expiresIn = token.expires_in * 1000;

        clearTimeout(renewTimeout);
        renewTimeout = setTimeout(updateConnection, token.expires_at - Date.now() + 5000);
    });

    try {
        const json = fs.readFileSync(filePath).toString();
        const currentToken = JSON.parse(json);
        client.token.setValue(currentToken);
    } catch (e) {
        // Файл не найден, некорректный JSON-токен
    }

    await updateConnection();
})();

exports.createLead = async ({ name, email }) => {
    const newContact = new client.Contact
    newContact.custom_fields_values = [{ field_id: 220515, values: [{value: email }] }]

    newContact.first_name = name
    await newContact.save()

    // Contact id  30300479



    const lead = new client.Lead({
        name,
        pipeline_id: 4537429,
        custom_fields_values: [
            {
                field_id: 790317,
                values: [
                    {
                        value: '2206'
                    }
                ]
            },
            {
                field_id: 790693,
                values: [
                    {
                        value: '10'
                    }
                ]
            },
            {
                field_id: 222207,
                values: [
                    {
                        value: "BESTBOTEVER"
                    }
                ]
            },
            {
                field_id: 794299,
                values: [
                    {
                        value: 'Английский для IT специалистов'
                    }
                ]
            }
        ]
    })
    lead.embeddedContacts.add([
        newContact
    ]);

    await lead.save()
};