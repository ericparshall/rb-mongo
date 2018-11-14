# Robinbase MongoDB Services

This module adds integration with mongodb for Robinbase.

## Usage

This module is installed by default in new Robinbase projects.
If it has been removed, you can add it back into your project by installing the npm module.

```sh
npm install --save @robinsage/rb-mongo
```

And then adding it to your extensions.js file.

```javascript
module.exports = {
    // .. other extensions
    require("@robinsage/rb-mongo")
}
```

## What it provides

### Property types

This module provides an objectid property type.

```javascript
const objectidProp = Schema.guid;
```

### Storages

This module provides a mongodb storage engine.

```javascript
// In config.js

// this should run after you have called "DefaultConfig.compileEnvironment(Config);"
var MongoStorage = require_robinbase('mongo:storage:MongoStorage');
Config.storages = {
    'default': new MongoStorage({connectionString: Config.RB_MONGO_CONNECTION}),
}

```

### Services

This module provides the Mongo service which is a utility for interacting directly with mongodb.

In general, if you want to use this service, you should retrieve the service from your storage.

```javascript
const mongoStorage = require_robinbase("config").storages.default;
const Mon = mongoStorage.Mon;

Mon.go("find", "collection", {some: query}, function(err, result)
{

});
```