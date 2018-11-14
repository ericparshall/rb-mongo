const ObjectID = require_robinbase('mongo:service:db:Mongo').ObjectID;
const common = require_robinbase('base:propertyType:common');

function ObjectIDProperty()
{
    const self = this;

    self.meta = common.extendMeta({
        'default': null,
        type: 'objectid',
        storageType: 'objectid'
    });

    common.initializeProperty(self);

    self.onSet(function(input)
    {
        if (self.meta.nullable && input === null)
        {
            return input;
        }

        if (typeof input === 'string')
        {
            try
            {
                input = new ObjectID(input);
            }
            catch(e)
            {
                // nothing
            }
        }

        if (!(input instanceof ObjectID))
        {
            input = self.meta.default;
        }

        return input;
    });
}

common.extendPrototype(ObjectIDProperty, {
    'default': function(defaultValue)
    {
        var self = this;

        if (!(defaultValue instanceof ObjectID) && defaultValue !== null)
        {
            if (!self.meta.nullable || defaultValue !== null)
            {
                throw new Error("Object ID property's default value must be an instance of ObjectID");
            }
        }

        self.meta.default = defaultValue;

        return self;
    },

    test: function(value, object)
    {
        var self = this;

        if (this.meta.nullable && value === null)
        {
            return "";
        }

        if (!(value instanceof ObjectID))
        {
            return "not a valid object id";
        }

        return common.runTestsForProperty(self, value, object);
    },

    generate: function()
    {
        return new ObjectID();
    },

    isEqual(left, right)
    {
        return String(this.set(left)) === String(this.set(right));
    },
});

module.exports = function(Schema)
{
    Schema.registerPropertyType('objectid', function ObjectIDPropertyFactory() {
        return new ObjectIDProperty();
    }, ObjectIDProperty);
};
