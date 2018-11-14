(function(){

    var Debug = require_robinbase('Debug').prefix("Mongo Connection");
    var MongoClient = require('mongodb').MongoClient;
    var MongoCursor = require('mongodb').Cursor;
    var ObjectID = require('mongodb').ObjectID;

// Connection URL

// Use connect method to connect to the Server
    var Mongo = function Mongo()
    {
        var self = this;
        self.client = null;
        self.queue = [];
        self.connect = function connect(url, callback)
        {
            MongoClient.connect(url, function(err, db) {
                if (err != null)
                {
                    Debug.error("Could not connect to the server at "+url);
                    return callback(err, db);

                }

                Debug.log("Connected correctly to server at "+url);
                self.client = db;

                for (var i=0; i<self.queue.length; i++)
                {
                    self.go.apply(self, self.queue[i]);
                }
                self.queue = [];

                callback(err, db);
                //db.close();
            });

            return self;
        }

        self.go = function go()
        {
            if (self.client == null)
            {
                self.queue.push(arguments);
                Debug.log("The client is not connected.  Perhaps it is not ready.");
                return new mError('mongo client is not ready to process commands');//new MongoCursor(null, null, 'null', {}, {}, {});//.CommandCursor();
            }
            var collectionStr = [].shift.apply(arguments);
            var method = [].shift.apply(arguments);
           // Debug.log("Mongo collection call", collectionStr);
           // Debug.log("Mongo method call", method);
            try
            {
                var collection = self.client.collection(collectionStr);

                return collection[method].apply(collection, arguments);
                //collection.find({}).toArray(arguments[arguments.length - 1]);
            }
            catch(e)
            {
                Debug.error("Mongo Go", e);
                return new mError(e);
            }
            return new mError('unknown issue running mon.go');
        }

        self.command = function command()
        {
            if (self.client == null)
            {
                self.queue.push(arguments);
                Debug.log("The client is not connected.  Perhaps it is not ready.");
                return new mError('mongo client is not ready to process commands');//new MongoCursor(null, null, 'null', {}, {}, {});//.CommandCursor();
            }
            try
            {
                var admin = self.client.admin();
                return admin.command.apply(admin, arguments);
            }
            catch(e)
            {
                Debug.error("Mongo Command", e);
                return new mError(e);
            }
            return new mError('unknown issue running mon.command');
        }

    }

    Mongo.ObjectID = ObjectID;

    var mError = function mError(errMsg)
    {
        this.addCursorFlag =
        this.addQueryModifier =
        this.batchSize =
        this.clone =
        this.close =
        this.comment =
        this.count =
        this.each =
        this.explain =
        this.filter =
        this.forEach =
        this.hasNext =
        this.hint =
        this.isClosed =
        this.limit =
        this.map =
        this.max =
        this.maxAwaitTimeMS =
        this.maxScan =
        this.maxTimeMS =
        this.min =
        this.next =
        this.nextObject =
        this.pause =
        this.pipe =
        this.project =
        this.read =
        this.resume =
        this.returnKey =
        this.rewind =
        this.setCursorOption =
        this.setEncoding =
        this.setReadPreference =
        this.showRecordId =
        this.skip =
        this.snapshot =
        this.sort =
        this.stream =
        this.toArray =
        this.unpipe =
        this.unshift =
        this.wrap = function(cb) { cb(errMsg, null); };
    }


    module.exports = Mongo;

}).call(this);
