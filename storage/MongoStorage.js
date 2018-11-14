var Mongo = require_robinbase('mongo:service:db:Mongo');
var Debug = require_robinbase('Debug').prefix("Mongo Storage");
const _ = require('lodash');

var MongoStorage = function({connectionString})
{
    this.connectionString = connectionString;
    this.Mon = null;
}

MongoStorage.prototype.idTypeName = 'objectid';


/**
 * The init function will be called when the application starts.
 *
 * It should initialize any required connections, etc that are required
 * for the storage to operate.
 *
 * @param callback
 */
MongoStorage.prototype.init = function(callback)
{
    var self = this;
    self.Mon = new Mongo().connect(self.connectionString, function(err, db)
    {
        Debug.log("connected to " + self.connectionString);
        callback(err);
    });
}

/**
 * Prepare collection class.
 *
 * The most important thing this function does is set the storage on the class.
 * It may also do things such as ensuring indexes if need be.
 *
 * It is expected that this function will set a default useId for the collection
 * that is standard for the storage, but NEVER do this if the useId is already set.
 *
 * @param myClass
 * @param callback
 */
MongoStorage.prototype.prepareCollection = function(myClass, callback)
{
    const self = this;
    const config = require_robinbase('config');
    myClass.storage = self;

    myClass.generateId = function (...args)
    {
        return new Mongo.ObjectID(...args);
    }

    // TODO: migrate the indexes based off the schema, etc.
    if (typeof myClass.ensureIndex === 'function')
    {
        myClass.ensureIndex(self.Mon);
    }
    if (Array.isArray(myClass.indexes) && config.RB_MONGO_MIGRATE_INDEXES == 1)
    {
        self.Mon.go(myClass.collection, 'indexes', function(err, indexes)
        {
            // Debug.debug('existing indexes for ', myClass.name, indexes);

            indexes = indexes || [];

            myClass.indexes.forEach(function(indexDef)
            {
                if (!indexDef.options || !indexDef.options.name)
                {
                    Debug.warn(`You must give your index a name for it to be automatically migrated (in class ${myClass.name})`);
                    return;
                }

                for (let i = 0; i < indexes.length; i++)
                {
                    if (indexes[i].name === indexDef.options.name)
                    {
                        return self.migrateIndex(myClass, indexes[i], indexDef);
                    }
                }

                // doesn't exist so create it
                self.Mon.go(myClass.collection, 'createIndex', indexDef.fields, indexDef.options, function(err, result)
                {
                    if (err)
                    {
                        return Debug.warn(`Failed to create index ${indexDef.options.name} for class ${myClass.name}`, err);
                    }

                    Debug.log(`Successfully created index ${indexDef.options.name} for class ${myClass.name}`);
                });


            });

            // TODO: should we remove indexes that are not defined, or keep them?

        });
    }

    return callback(null);
}

/**
 * Fetch records based on a query.
 *
 * It should callback with an array of records.
 *
 * Options is required to have a pageNum, count and sort value
 *
 * @param myClass
 * @param query
 * @param options
 * @param callback
 */
MongoStorage.prototype.get = function(myClass, query, options, callback)
{
    var doAggregate = false;
    var didResort = false;
    var joinsIn = [];
    var lookups = [];
    var lookupRewindKeys = [];

   // options.limit = 50;
    var joinProjection = {};
    // Debug.log('options', JSON.stringify(options, null, '\t'));
    if (Array.isArray(options.joins))
    {
        if (typeof myClass.joins != 'undefined')
        {
            for (var i=0; i<options.joins.length; i++)
            {
                var joinKey = options.joins[i];



                if (typeof myClass.joins[joinKey] != 'undefined')
                {
                    doAggregate = true;

                    let defaultLookup = {
                        '$lookup': {
                            from: myClass.joins[joinKey].collection,
                            localField: myClass.joins[joinKey].localKey,
                            foreignField: myClass.joins[joinKey].foreignKey,
                            'as': myClass.joins[joinKey].asKey || joinKey
                        }
                    };
                    joinsIn.push(defaultLookup);

                    //Debug.log('myClass.joins[joinKey]', myClass.joins[joinKey])
                    Debug.debug('query[k]', query);

                    let useQuery = myClass.joins[joinKey].query;

                   // let innerQKey = null;
                    for (var k in query)
                    {
                        Debug.debug('query[k]', k, query);
                        if (k.indexOf(joinKey+".") == 0)
                        {
                            //joinsIn.push({'$match': query[k]});
                            useQuery = Object.assign(useQuery || {}, {[k]: query[k]});
                            delete query[k];
                        }
                        //joinsIn.push({'$match': query[joinKey]});
                    }

                    if (useQuery)
                    {
                        var lookupKey = myClass.joins[joinKey].asKey || joinKey;

                        joinsIn.push({'$unwind': {
                            path: '$' + lookupKey,
                            preserveNullAndEmptyArrays: true
                        }});


                            joinsIn.push({'$match': useQuery});



                        var jKeys = Object.keys(Object.assign({}, myClass.schema.props));
                        jKeys = jKeys.concat(Object.keys(myClass.joins));
                        var group = {};
                        for (var k=0; k<jKeys.length; k++)
                        {
                            if (jKeys[k] == '_id')
                            {
                                group[jKeys[k]] = `$${jKeys[k]}`;
                            }
                            else
                            {
                                group[jKeys[k]] = {'$first':`$${jKeys[k]}`};
                            }
                        }
                        group[lookupKey] = {'$push':`$${lookupKey}`};
                        joinsIn.push({'$group':group});
                    }

                    if (typeof myClass.joins[joinKey].sortKey == 'string')
                    {
                        didResort = true;
                        var lookupKey = myClass.joins[joinKey].asKey || joinKey;

                        joinsIn.push({'$unwind': {
                            path: '$' + lookupKey,
                            preserveNullAndEmptyArrays: true
                        }});
                        var sortDir = myClass.joins[joinKey].sortDir;
                        var sortVal = 1;

                        if (sortDir == 'desc')
                        {
                            sortVal = -1;
                        }

                        if (typeof options.sort.searchResultScore != 'undefined')
                        {
                            joinsIn.push({'$sort':{score:options.sort.searchResultScore}});
                        }
                        else
                        {
                            joinsIn.push({'$sort':{[`${lookupKey}.${myClass.joins[joinKey].sortKey}`]: sortVal}});
                        }

                        var jKeys = Object.keys(Object.assign({}, myClass.schema.props));
                        jKeys = jKeys.concat(Object.keys(myClass.joins));
                        var group = {};
                        for (var k=0; k<jKeys.length; k++)
                        {
                            if (jKeys[k] == '_id')
                            {
                                group[jKeys[k]] = `$${jKeys[k]}`;
                            }
                            else
                            {
                                group[jKeys[k]] = {'$first':`$${jKeys[k]}`};
                            }
                        }
                        group[lookupKey] = {'$push':`$${lookupKey}`};
                        joinsIn.push({'$group':group});
                    }

                    if (Array.isArray(myClass.joins[joinKey].lookups))
                    {
                        var lookupKey = myClass.joins[joinKey].asKey || joinKey;
                        lookupRewindKeys.push(lookupKey);
                        for (var d=0; d<myClass.joins[joinKey].lookups.length; d++)
                        {
                            joinsIn.push({'$unwind':{path: '$'+lookupKey, preserveNullAndEmptyArrays: true}});
                            joinsIn.push({'$lookup': {
                                from:myClass.joins[joinKey].lookups[d].collection,
                                localField:myClass.joins[joinKey].lookups[d].localKey,
                                foreignField:myClass.joins[joinKey].lookups[d].foreignKey,
                                'as':lookupKey
                            }});
                            joinsIn.push({'$unwind': {
                                path: '$' + lookupKey,
                                preserveNullAndEmptyArrays: true
                            }});


                            var jKeys = Object.keys(Object.assign({}, myClass.schema.props));
                            jKeys = jKeys.concat(Object.keys(myClass.joins));
                            var group = {};
                            for (var k=0; k<jKeys.length; k++)
                            {
                                if (jKeys[k] == '_id')
                                {
                                    group[jKeys[k]] = `$${jKeys[k]}`;
                                }
                                else
                                {
                                    group[jKeys[k]] = {'$first':`$${jKeys[k]}`};
                                }
                            }
                            group[lookupKey] = {'$addToSet':`$${lookupKey}`};
                            joinsIn.push({'$group':group});

                        }
                    }
                    if (typeof myClass.joins[joinKey].projection != 'undefined')
                    {
                        joinProjection[joinKey] = myClass.joins[joinKey].projection;
                        continue;
                    }
                }
            }
        }
    }

    if (Array.isArray(options.groups))
    {
        var joins = [];
        joins.push({'$match': query });
        if (joinsIn.length > 0)
        {
            joins = joins.concat(joinsIn);
        }

        var projection = Object.assign({}, myClass.schema.props);

        for (var key in projection)
        {
            if (Array.isArray(options.deniedKeys))
            {
                if (options.deniedKeys.indexOf(key) == -1)
                {
                    projection[key] = 1;
                }
                else
                {
                    delete projection[key];
                    continue;
                }
            }
            else
            {
                projection[key] = 1;
            }
        }

        if (joinsIn.length > 0)
        {
            for (var key in joinProjection)
            {
                projection[key] = joinProjection[key];
            }
            if (typeof options.sort.searchResultScore != 'undefined')
            {
                projection['searchResultScore'] = {'$meta':'textScore'};
            }
            joins.push({'$project': projection});
        }

        for (var i=0; i<options.groups.length; i++)
        {
            joins.push({'$group': options.groups[i]});
        }

        var sortObj = {};

        if (options.sort.length == 2)
        {
            if (options.sort[1] == 'desc')
            {
                sortObj[options.sort[0]] = -1;
            }
            else
            {
                sortObj[options.sort[0]] = 1;
            }
            joins.push({'$sort': sortObj});
        }
        else if (typeof options.sort.searchResultScore != 'undefined')
        {
            joins.push({'$sort':{score:options.sort.searchResultScore}});
        }
        else if (typeof options.sort == 'object')
        {
            joins.push({'$sort':options.sort});
        }
        Debug.debug('query3', joins);
        this.Mon.go(myClass.collection, 'aggregate', joins, {'allowDiskUse':true, 'maxTimeMS':10000}, function(err, result) {
            callback(err, result);
        });

        return;
    }

    if ((doAggregate == true) && (joinsIn.length > 0))
    {
        var joins = [];

        joins.push(processGeoAggregations(query, options));

        var sortObj = {};

        Debug.debug('sort options', options.sort);
        if (options.sort.length == 2)
        {
            if (options.sort[1] == 'desc')
            {
                sortObj[options.sort[0]] = -1;
            }
            else
            {
                sortObj[options.sort[0]] = 1;
            }
            joins.push({'$sort': sortObj});
        }
        else if (typeof options.sort.searchResultScore != 'undefined')
        {
            sortObj = {score:options.sort.searchResultScore};
            for (var sKey in options.sort)
            {
                if (sKey != 'searchResultScore')
                {
                    sortObj[sKey] = options.sort[sKey];
                }
            }
            joins.push({'$sort':sortObj});
        }
        else if (typeof options.sort == 'object')
        {
            sortObj = options.sort;
            joins.push({'$sort':sortObj});
        }

       //


        joins = joins.concat(joinsIn);

        if (options.doCount != true)
        {
            joins.push({'$skip': options.skip || 0});// options.pageNum*options.count});
            joins.push({'$limit': Math.max(1, parseInt(options.limit || 50))});
        }


        var projection = Object.assign({}, myClass.schema.props);

        for (var key in projection)
        {
            projection[key] = 1;
        }
        for (var key in joinProjection)
        {
            projection[key] = joinProjection[key];
        }

        // if (nearQ != null)
        // {
        projection['dist.calculated'] = 1;
        //}

        if (options.sort.length == 2)
        {
          //  if (didResort == true)
         //   {
                Debug.debug('override');
                joins.push({'$sort': sortObj});
          //  }
        }

        if (typeof options.sort.searchResultScore != 'undefined')
        {
            projection['searchResultScore'] = {'$meta':'textScore'};
        }

        joins.push({'$project': projection});

        function getTimeMSFloat() {
            var hrtime = process.hrtime();
            return ( hrtime[0] * 1000000 + hrtime[1] / 1000 ) / 1000;
        }

        //  Debug.log('joins', JSON.stringify(joins, null, '\t'));
        var mTime = getTimeMSFloat();
        if (options.doCount == true)
        {
            joins.push({$count:"nextSet"});
        }

        Debug.debug('query2', JSON.stringify(joins, null, '\t'));
        this.Mon.go(myClass.collection, 'aggregate', joins, {'allowDiskUse':true, 'maxTimeMS':10000})
            .toArray(function (err, result) {
                if (err)
                {
                    Debug.error('bad aggregation call', err);
                    return callback(err, null);
                }
                if (options.doCount == true)
                {
                    if ((typeof result[0] != 'undefined') && (typeof result[0].nextSet != 'undefined'))
                    {
                        return callback(err, result[0].nextSet);
                    }
                }
                var splicers = [];
                Debug.log('result length', result.length);
                //Debug.debug('results', JSON.stringify(result, null, '\t'));
                // Debug.log('lookupRewindKeys', lookupRewindKeys);

                Debug.log('time = ', getTimeMSFloat() - mTime);

                callback(err, result);
            });

        return;
    }


    /*
     var resultArr
     for (var i=0;
     */

    var self = this;

    Debug.debug('query1', query);
    var _process = self.Mon.go(myClass.collection, 'find', query);
    if (typeof options.limit === 'number' && options.limit > 0)
    {
        _process = _process.limit(options.limit);
    }
    if (typeof options.skip === 'number')
    {
        _process = _process.skip(options.skip);
    }
    if (options.sort)
    {
        _process = _process.sort(options.sort);
    }
    if (options.fields)
    {
        _process.project(options.fields);
    }

    _process.toArray(function(err, result){
        callback(err, result);
    });
}


// We need to avoid modifying references that may be held
// outside of this function
function processGeoAggregations(query, options)
{
    let nearQGeo = null;
    let nearQ = null;
    let nearMax = null;
    let nearMin = null;

    query = _.cloneDeep(query);

    let limitValue = Math.max(1, parseInt(options.limit || 50)+(options.skip || 0));

    for (let queryKey in query)
    {
        if (query[queryKey].hasOwnProperty('$near'))
        {
            nearQGeo = query[queryKey]['$near'];
            if (nearQGeo.hasOwnProperty('$maxDistance'))
            {
                nearMax = nearQGeo['$maxDistance'];
                delete nearQGeo['$maxDistance'];
            }
            if (nearQGeo.hasOwnProperty('$minDistance'))
            {
                nearMin = nearQGeo['$minDistance'];
                delete nearQGeo['$minDistance'];
            }
            delete query[queryKey];//['$near'];
            nearQ = query;
            break;
        }
        if (query[queryKey].hasOwnProperty('$geoWithin'))
        {
            nearQGeo = query[queryKey]['$geoWithin'];
            delete query[queryKey];//['$geoWithin'];
            nearQ = query;
            break;
        }
    }


    if (nearQ != null)
    {
        let nearGeoQ = {'$geoNear':{
            near: nearQGeo['$geometry'],
            distanceField: "dist__.calculated",
            query: query,
            num:limitValue,
            includeLocs: "dist__.location",
            spherical: true
        }};
        if (nearMin != null)
        {
            nearGeoQ['$geoNear']['minDistance'] = nearMin;
        }
        if (nearMax != null)
        {
            nearGeoQ['$geoNear']['maxDistance'] = nearMax;
        }
        return nearGeoQ;
    }
    else
    {
        return {'$match': query };
    }
}

/**
 * Counts items that match a query.
 *
 * It MUST call back with an integer that is greater than one.
 *
 * @param myClass
 * @param query
 * @param callback
 */
MongoStorage.prototype.count = function(myClass, query, callback)
{
    query = query || {};
    // MWARDLE
    // TODO: Map any returned errors to a standard error type
    this.Mon.go(myClass.collection, 'count', query, callback);
}

/**
 * Internal function
 *
 * @param myClass
 * @param object
 * @param query
 * @param update
 * @param options
 * @param callback
 */
MongoStorage.prototype.updateWithOptions = function(myClass, object, query, update, options, callback)
{
    if (typeof query === 'string')
    {
        query = new Mongo.ObjectID(query);
    }

    if (query instanceof Mongo.ObjectID)
    {
        query = {_id: query};
    }

    if (typeof options.returnNewDocument === 'undefined')
    {
        options.returnNewDocument = true;
    }

    this.Mon.go(myClass.collection, 'findOneAndUpdate', query, update, options || {}, function(err, result){
        if (err)
        {
            // MWARDLE
            // TODO: Map this to a standard error object
            return callback(err, null);
        }

        if (!result.value)
        {
            // MWARDLE
            // should this be a specific type of error object
            // I sort of think we should create a "NotFoundError"
            // that should be consistently used by all storage
            // as a requirement.
            // In fact, all errors should be standardized this way
            // and each storage should be responsible for mapping
            // the internal error type to an error type that is
            // defined as part of the storage interface
            return callback(new Error("Could not find the object"), null);
        }

        // MWARDLE
        // TODO: make sure result.value is not the ORIGINAL document
        // rather than the updated one
        // UPDATE: it looks like it is returning the original from the database, not the updated version
        // so I changed it back to the original object
        return callback(null, object);
    });
}

/**
 * Updates a SINGLE object in the storage.
 *
 * The function MUST call back with an updated record or the given
 * object value if that is not possible.
 *
 * The setter is a list of values that should be updated.
 * The object is a full representation of the item if the full item is required
 * for the update and as a possible return value if an updated record is not
 * convenient for the storage to return.
 *
 * Query may be an id or a query object.
 *
 * @param collectionName
 * @param object
 * @param query
 * @param setter
 * @param callback
 */
MongoStorage.prototype.update = function(myClass, object, query, setter, callback)
{
    return this.updateWithOptions(myClass, object, query, {$set: setter}, {upsert:false}, callback);
}

/**
 * Updates a SINGLE object in the storage or CREATES it if it does not exist.
 *
 * The function MUST call back with an updated record or the given
 * object value if that is not possible.
 *
 * The setter is a list of values that should be updated.
 * The object is a full representation of the item if the full item is required
 * for the update and as a possible return value if an updated record is not
 * convenient for the storage to return.
 *
 * Query may be an id or a query object.
 *
 * @param collectionName
 * @param object
 * @param query
 * @param update
 * @param callback
 */
MongoStorage.prototype.updateOrCreate = function(myClass, object, query, update, callback)
{
    return this.updateWithOptions(myClass, object, query, update, {upsert:true}, callback);
}

/**
 * Deletes a SINGLE object in the storage.
 *
 * The function MUST call back with the original record or the version
 * of the record that existed in the storage before the delete was called.
 *
 * @param collectionName
 * @param object
 * @param query
 */
MongoStorage.prototype.delete = function(myClass, object, query, callback)
{
    this.Mon.go(myClass.collection, 'findOneAndDelete', query, function(err, result){

        if (err)
        {
            // MWARDLE
            // TODO: map this error to a standard error
            return callback(err, null);
        }

        if (!result || !result.value)
        {
            // MWARDLE
            // TODO: use a standard error
            return callback("Could not find the record to delete it.", null);
        }

        callback(null, result.value);
    });
}

/**
 * Deletes SEVERAL objects in the storage.
 *
 * The function MUST call back with the original record or the version
 * of the record that existed in the storage before the delete was called.
 *
 * @param collectionName
 * @param object
 * @param query
 */
MongoStorage.prototype.deleteMany = function(myClass, objects, query, callback)
{
    this.Mon.go(myClass.collection, 'deleteMany', query, function(err, result) {

        if (err)
        {
            // MWARDLE
            // TODO: map this error to a standard error
            return callback(err, null);
        }

        callback(null, objects);
    });
}

/**
 * Saves a deleted object in the storages trash.
 *
 * The collection name will be the original collection name
 *
 * @param collectionName
 * @param object
 * @param callback
 */
MongoStorage.prototype.saveTrash = function(myClass, object, expireAt, callback)
{
    var self = this;
    var useCollection = myClass.collection + '_trash';

    self.Mon.client.ensureIndex(useCollection, {expireAt: 1}, {
        expireAfterSeconds:0,
        background: true,
        name: myClass.collection + 'TrashExpire'
    }, function(err, result){
        if (err)
        {
            // MWARDLE
            // TODO: return a standardized error
            return callback("could not create the trash index", null);
        }

        object.expireAt = expireAt;
        self.Mon.go(useCollection, 'insertOne', object, function(err, result) {
            // MWARDLE
            // TODO: Map this to a standard error type
            callback(err, object);
        });
    })
}


/**
 * Insert a SINGLE object in the storage.
 *
 * The function MUST call back with an updated version of the record
 * or with the original record if this is no updated version is convenient.
 *
 * @param collectionName
 * @param object
 * @param callback
 */
MongoStorage.prototype.create = function(myClass, record, callback)
{
    // Do not allow null ids
    if (record._id == null)
    {
        record._id = myClass.generateId();
    }

    this.Mon.go(myClass.collection, 'insertOne', record, function(err, result)
    {
        if (err)
        {
            // MWARDLE
            // TODO: map this error to a standard error class
            return callback(err, null);
        }

        if (!result || !result.ops || !result.ops.length)
        {
            return callback("Creation failed", null);
        }

        callback(null, result.ops[0]);

    });
}

MongoStorage.prototype.getExporter = function()
{
    const config = require_robinbase('config')
    const MongoExporter = require_robinbase('mongo:service:export:MongoExporter');
    return MongoExporter.fromConfig(config);
}

MongoStorage.prototype.migrateIndex = function(myClass, existingDef, targetDef)
{
    const _ = require('lodash');
    const self = this;
    // copy it so we con't mutate the original
    targetDef = Object.assign({}, targetDef);
    if (typeof targetDef.options !== 'object')
    {
        targetDef.options = {};
    }
    if (typeof targetDef.fields === "string")
    {
        targetDef.fields === {[targetDef.fields]: 1};
    }

    var normalizedExistingDef = {};
    normalizedExistingDef.fields = typeof existingDef.key === "string" ? {[existingDef.key]: 1} : Object.assign({}, existingDef.key);
    normalizedExistingDef.options = {};

    if (existingDef.name)
    {
        normalizedExistingDef.options.name = existingDef.name;
    }

    normalizedExistingDef.options.sparse = Boolean(existingDef.sparse);
    targetDef.options.sparse = Boolean(targetDef.options.sparse);

    if (existingDef.weights || targetDef.options.weights)
    {
        var existingWeights = {};
        for (let key in (existingDef.weights || {}))
        {
            if (key === '$**')
            {
                normalizedExistingDef.fields['$**'] = 'text';
                delete normalizedExistingDef.fields._fts;
                delete normalizedExistingDef.fields._ftsx;
            }
            else
            {
                existingWeights[key] = existingDef.weights[key];
            }
        }

        normalizedExistingDef.options.weights = existingWeights;
    }

    if (existingDef.expireAfterSeconds || targetDef.options.expireAfterSeconds)
    {
        normalizedExistingDef.options.expireAfterSeconds = existingDef.expireAfterSeconds;
    }

    if (existingDef.min || targetDef.options.min)
    {
        normalizedExistingDef.options.min = existingDef.min;
    }

    if (existingDef.max || targetDef.options.max)
    {
        normalizedExistingDef.options.max = existingDef.max;
    }

    if (existingDef.partialFilterExpression || targetDef.options.partialFilterExpression)
    {
        normalizedExistingDef.options.partialFilterExpression = existingDef.partialFilterExpression;
    }

    normalizedExistingDef.options.name = existingDef.name;

    targetDef.options.unique = Boolean(targetDef.options.unique);
    normalizedExistingDef.options.unique = Boolean(existingDef.unique);

    targetDef.options.background = Boolean(targetDef.options.background);
    normalizedExistingDef.options.background = Boolean(existingDef.background);

    const same = _.isEqual(targetDef, normalizedExistingDef) && _.isEqual(Object.keys(targetDef.fields), Object.keys(normalizedExistingDef.fields));

    if (!same)
    {
        self.Mon.go(myClass.collection, 'dropIndex', targetDef.options.name, function(err, dropResult)
        {
            if (err)
            {
                return Debug.warn(`Failed to remove out of date index ${targetDef.options.name} for class ${myClass.name}. Index migration not completed`, err);
            }

            self.Mon.go(myClass.collection, 'createIndex', targetDef.fields, targetDef.options, function(err, createResult)
            {
                if (err)
                {
                    // TODO: is this critical?
                    return Debug.warn(`Failed to create migrated index ${targetDef.options.name} for class ${myClass.name}. The original has already been dropped.`, err);
                }

                Debug.log(`Successfully migrated index ${targetDef.options.name} for class ${myClass.name}.`)
            });
        })
    }
    else
    {
        Debug.log(`Index ${targetDef.options.name} is up to date for class ${myClass.name}.`)
    }

}

module.exports = MongoStorage;
