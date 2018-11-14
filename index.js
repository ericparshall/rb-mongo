module.exports = {
    path: __dirname,
    name: "MongoDB",
    namespace: "mongo",
    env: {
        RB_MONGO_CONNECTION: "",
        RB_MONGO_LOCATION: "localhost:27017",
        RB_MONGO_HOST: "localhost",
        RB_MONGO_PORT: '27017',
        RB_MONGO_PASSWORD: "",
        RB_MONGO_USERNAME: "admin",
        RB_MONGO_DB_NAME: "",
    },
    compileEnv: function(config)
    {
        if (config.RB_MONGO_CONNECTION)
        {
            const parsedConnection = require('url').parse(config.RB_MONGO_CONNECTION);
            config.RB_MONGO_HOST = parsedConnection.hostname;
            config.RB_MONGO_PORT = parsedConnection.port;
            config.RB_MONGO_LOCATION = `${config.RB_MONGO_HOST}:${config.RB_MONGO_PORT}`;
            config.RB_MONGO_USERNAME = parsedConnection.auth && parsedConnection.auth.split(':')[0];
            config.RB_MONGO_PASSWORD = parsedConnection.auth && parsedConnection.auth.split(':')[1];
            config.RB_MONGO_DB_NAME = parsedConnection.pathname.substr(1);
        }
        else
        {
            config.RB_MONGO_DB_NAME = config.RB_MONGO_DB_NAME || config.RB_PROJECT_TITLE.toLowerCase().replace(/[^a-z]/g, '');
            config.RB_MONGO_CONNECTION = config.RB_MONGO_CONNECTION ||
                'mongodb://' + config.RB_MONGO_LOCATION + '/' + config.RB_MONGO_DB_NAME; //mongoConnection

            if (config.RB_MONGO_PASSWORD != '')
            {
                config.RB_MONGO_CONNECTION = config.RB_MONGO_CONNECTION ||
                    'mongodb://' +Config.RB_MONGO_USERNAME+':'+Config.RB_MONGO_PASSWORD+'@' +
                    config.RB_MONGO_LOCATION + '/' + config.RB_MONGO_DB_NAME;
                //+'?authMechanism=SCRAM-SHA-1&authSource=admin'; //mongoConnection
            }
        }

        if (typeof config.RB_MONGO_MIGRATE_INDEXES === 'undefined')
        {
            config.RB_MONGO_MIGRATE_INDEXES = config.RB_ADMIN == 1 ? 1 : 0;
        }

    }
}
