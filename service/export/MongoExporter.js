var Debug = require_robinbase('Debug').prefix('Mongo Exporter');
var Schema = require_robinbase('Schema');
var exec = require('child_process').exec;

function MongoExporter(options)
{
    this.host = options.host || options.RB_MONGO_HOST;
    this.port = options.port || options.RB_MONGO_PORT;
    this.db = options.db || options.RB_MONGO_DB_NAME;
    this.username = options.username || options.RB_MONGO_USERNAME;
    this.password = options.password || options.RB_MONGO_PASSWORD;
    this.uploader = options.uploader || null;
    this.tempDir = options.tempDir || './tmp';
    this.fileName = '';
    this.url = '';
    this.key = '';
    this.status = "initializing";

    if (!this.uploader && options.uploaders && options.uploaders.default)
    {
        this.uploader = options.uploaders.default;
    }
}

MongoExporter.prototype.export = function(myModel, fields, query, format)
{
    query = query || {};
    format = format || 'csv';

    if (!myModel)
    {
        throw new Error('MongoExporter requires a model class to run');
    }

    // var fields = myModel.exportFields;

    if (!Array.isArray(fields))
    {
        throw new Error('MongoExporter requires a model class that has an array of export fields');
    }

    var key = Schema.utils.randomId(8);
    var fileName = myModel.collection + '-' + Date().replace(/\W|:/g, '_') + '-' + key + '.' + format;

    this.key = key;
    this.fileName = fileName;

    this._beginUpload(query, format, myModel.collection, fields, fileName);

    return [key, fileName];
}

MongoExporter.prototype.isCompleted = function() {
    return this.status === "completed" || this.status === "errored";
}

MongoExporter.prototype._beginUpload = function(query, format, collection, fields, fileName) {
    var self = this;

    var destPath = require('path').resolve(self.tempDir, fileName);

    var command = [
        "mongoexport",
        "--type="+format,
        "--fields="+fields.join(','),
        "--db "+this.db,
        "--host "+this.host,
        "--port "+this.port,
        "--collection "+collection,
        "--out "+destPath
    ];


    if (self.password && self.username) {
        command.push('--username ' + this.username);
        command.push('--password ', this.password);
    }

    query = JSON.stringify(query).replace(/'/g, "\\'");
    command.push("--query '" + query + "'");

    command = command.join(' ');

    self.status = "running";
    exec(command, function(error, stdout, stderr) {
        // TODO: need better error handling here
        if (error) {
            self.status = "errored";
            self.error = error;
            Debug.warn('Error during mongo export', error, stdout, stderr);
            return;
        }

        self.status = "uploading";

        // upload
        var fileInformation = {
            fieldname: 'export',
            originalname: self.fileName,
            path: destPath,
            mimetype: 'text/csv',
            //size: '??'
            filename: self.fileName
        }

        var options = {
            path: 'exports',
            hostProperty: 'hostname'
        }

        self.uploader.upload(fileInformation, options, "export", function(err, resultData)
        {
            if (err)
            {
                self.status = 'errored';
                self.error = err;
                return;
            }

            Debug.log('EXPORT UPLOAD RESULT DATA: ', resultData);

            var url = resultData.hostname + resultData.export;
            Debug.log('FINAL UPLOAD URL: ', url);

            self.status = 'completed';
            self.url = url;
        });
    });
}

MongoExporter.fromConfig = function(Config)
{
    var locationData = Config.RB_MONGO_LOCATION.split(':');
    var uploader = null;
    if (Config.uploaders && Config.uploaders.default) {
        uploader = Config.uploaders.default;
    }
    var options = {
        host: locationData[0],
        port: locationData[1],
        db: Config.RB_MONGO_DB_NAME,
        username: Config.RB_MONGO_USERNAME,
        password: Config.RB_MONGO_PASSWORD,
        uploader: uploader,
        tempDir: Config.RB_TEMP_DIR || './tmp'
    }

    return new MongoExporter(options);
}

module.exports = MongoExporter;
