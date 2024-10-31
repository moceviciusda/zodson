"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mongoSchemaToZod = exports.createMongoValidator = exports.zodToBsonSchema = exports.zodObjectId = void 0;
const zod_1 = require("zod");
const objectIdPattern = '^[0-9a-fA-F]{24}$';
exports.zodObjectId = zod_1.z.string().regex(new RegExp(objectIdPattern));
const zodToBsonSchema = (zodSchema) => {
    // NOTE: Unwrap optional and nullable field effect to get underlying schema
    if (zodSchema instanceof zod_1.z.ZodOptional) {
        return zodToBsonSchema(zodSchema.unwrap());
    }
    if (zodSchema instanceof zod_1.z.ZodNullable) {
        return zodToBsonSchema(zodSchema.unwrap());
    }
    // NOTE: Handle objects
    if (zodSchema instanceof zod_1.z.ZodObject) {
        const shape = zodSchema._def.shape();
        const properties = {};
        const required = [];
        for (const [key, value] of Object.entries(shape)) {
            properties[key] = zodToBsonSchema(value);
            if (!(value instanceof zod_1.z.ZodOptional)) {
                required.push(key);
            }
        }
        return Object.assign({ bsonType: 'object', properties }, (required.length > 0 && { required }));
    }
    // NOTE: Handle arrays
    if (zodSchema instanceof zod_1.z.ZodArray) {
        const arraySchema = {
            bsonType: 'array',
            items: zodToBsonSchema(zodSchema.element),
        };
        if (zodSchema._def.minLength !== null) {
            arraySchema.minItems = zodSchema._def.minLength.value;
        }
        if (zodSchema._def.maxLength !== null) {
            arraySchema.maxItems = zodSchema._def.maxLength.value;
        }
        return arraySchema;
    }
    // NOTE: Handle strings
    if (zodSchema instanceof zod_1.z.ZodString) {
        // NOTE: Return early if ObjectId pattern is detected
        const checks = zodSchema._def.checks;
        if (checks.some((check) => check.kind === 'regex' && check.regex.source === objectIdPattern)) {
            return {
                bsonType: 'objectId',
            };
        }
        const stringSchema = {
            bsonType: 'string',
        };
        checks.forEach((check) => {
            switch (check.kind) {
                case 'min':
                    stringSchema.minLength = check.value;
                    break;
                case 'max':
                    stringSchema.maxLength = check.value;
                    break;
                case 'regex':
                    stringSchema.pattern = check.regex.source;
                    break;
                case 'email':
                    stringSchema.pattern =
                        '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$';
                    break;
            }
        });
        return stringSchema;
    }
    // NOTE: Handle numbers
    if (zodSchema instanceof zod_1.z.ZodNumber) {
        const numberSchema = {
            bsonType: 'double',
        };
        const isInt = zodSchema._def.checks.some((check) => check.kind === 'int');
        if (isInt) {
            numberSchema.bsonType = 'int';
        }
        const checks = zodSchema._def.checks;
        checks.forEach((check) => {
            switch (check.kind) {
                case 'min':
                    numberSchema.minimum = check.value;
                    break;
                case 'max':
                    numberSchema.maximum = check.value;
                    break;
                case 'multipleOf':
                    numberSchema.multipleOf = check.value;
                    break;
            }
        });
        return numberSchema;
    }
    // NOTE: Handle booleans
    if (zodSchema instanceof zod_1.z.ZodBoolean) {
        return {
            bsonType: 'bool',
        };
    }
    // NOTE: Handle dates
    if (zodSchema instanceof zod_1.z.ZodDate) {
        return {
            bsonType: 'date',
        };
    }
    // NOTE: Handle enums
    if (zodSchema instanceof zod_1.z.ZodEnum) {
        return {
            bsonType: 'string',
            enum: zodSchema._def.values,
        };
    }
    // NOTE: Handle any
    if (zodSchema instanceof zod_1.z.ZodAny) {
        return {};
    }
    throw new Error(`Unsupported Zod type: ${zodSchema.constructor.name}`);
};
exports.zodToBsonSchema = zodToBsonSchema;
const createMongoValidator = (zodSchema) => {
    return {
        $jsonSchema: zodToBsonSchema(zodSchema),
    };
};
exports.createMongoValidator = createMongoValidator;
const mongoSchemaToZod = (mongoSchema) => {
    if (mongoSchema.bsonType === 'array') {
        let elementSchema;
        // NOTE: Union type if mongo accepts multiple types of data in the array
        if (Array.isArray(mongoSchema.items)) {
            elementSchema =
                mongoSchema.items.length === 1
                    ? mongoSchemaToZod(mongoSchema.items[0])
                    : zod_1.z.union(mongoSchema.items.map(mongoSchemaToZod));
        }
        else {
            elementSchema = mongoSchemaToZod(mongoSchema.items);
        }
        const constraints = {
            min: mongoSchema.minItems,
            max: mongoSchema.maxItems,
            unique: mongoSchema.uniqueItems,
        };
        let arraySchema = zod_1.z.array(elementSchema);
        if (constraints.min !== undefined) {
            arraySchema = arraySchema.min(constraints.min);
        }
        if (constraints.max !== undefined) {
            arraySchema = arraySchema.max(constraints.max);
        }
        if (constraints.unique) {
            return arraySchema.refine((items) => new Set(items).size === items.length, { message: 'Array items must be unique' });
        }
        return arraySchema;
    }
    if (mongoSchema.bsonType === 'object') {
        const shape = {};
        const required = new Set(mongoSchema.required || []);
        for (const [key, value] of Object.entries(mongoSchema.properties)) {
            const fieldSchema = mongoSchemaToZod(value);
            shape[key] = required.has(key) ? fieldSchema : fieldSchema.optional();
        }
        const baseSchema = mongoSchema.additionalProperties === false
            ? zod_1.z.object(shape).strict()
            : zod_1.z.object(shape).passthrough();
        if (mongoSchema.minProperties === undefined &&
            mongoSchema.maxProperties === undefined) {
            return baseSchema;
        }
        //  NOTE: Handle min/max properties
        const validateProperties = (obj) => {
            const count = Object.keys(obj).length;
            const minOk = mongoSchema.minProperties === undefined ||
                count >= mongoSchema.minProperties;
            const maxOk = mongoSchema.maxProperties === undefined ||
                count <= mongoSchema.maxProperties;
            return minOk && maxOk;
        };
        return baseSchema.superRefine((data, ctx) => {
            var _a, _b;
            if (!validateProperties(data)) {
                ctx.addIssue({
                    code: zod_1.z.ZodIssueCode.custom,
                    message: `Object must have ${(_a = mongoSchema.minProperties) !== null && _a !== void 0 ? _a : 0} to ${(_b = mongoSchema.maxProperties) !== null && _b !== void 0 ? _b : 'unlimited'} properties`,
                });
            }
        });
    }
    if (mongoSchema.bsonType === 'string') {
        let stringSchema = zod_1.z.string();
        if (mongoSchema.minLength !== undefined) {
            stringSchema = stringSchema.min(mongoSchema.minLength);
        }
        if (mongoSchema.maxLength !== undefined) {
            stringSchema = stringSchema.max(mongoSchema.maxLength);
        }
        if (mongoSchema.pattern !== undefined) {
            stringSchema = stringSchema.regex(new RegExp(mongoSchema.pattern));
        }
        if (mongoSchema.enum !== undefined) {
            return zod_1.z.enum(mongoSchema.enum);
        }
        return stringSchema;
    }
    if (mongoSchema.bsonType === 'bool') {
        return zod_1.z.boolean();
    }
    if (mongoSchema.bsonType === 'objectId') {
        return zod_1.z.string().regex(/^[0-9a-fA-F]{24}$/);
    }
    if (mongoSchema.bsonType === 'date') {
        return zod_1.z.date();
    }
    if (mongoSchema.bsonType === 'uuid') {
        return zod_1.z.string().uuid();
    }
    //  NOTE: Handle binary types. Accept strings that can be converted to Buffer
    if (mongoSchema.bsonType === 'binData') {
        return zod_1.z.string().transform((val) => Buffer.from(val, 'base64'));
    }
    //  NOTE: Handle number types
    if (['number', 'double', 'int', 'long', 'decimal'].includes(mongoSchema.bsonType)) {
        let numberSchema = zod_1.z.number();
        if (['int', 'long'].includes(mongoSchema.bsonType)) {
            numberSchema = numberSchema.int();
        }
        if (mongoSchema.minimum !== undefined) {
            numberSchema = numberSchema.min(mongoSchema.minimum);
        }
        if (mongoSchema.maximum !== undefined) {
            numberSchema = numberSchema.max(mongoSchema.maximum);
        }
        if (mongoSchema.multipleOf !== undefined) {
            numberSchema = numberSchema.multipleOf(mongoSchema.multipleOf);
        }
        return numberSchema;
    }
    throw new Error(`Unsupported BSON type: ${mongoSchema.bsonType}`);
};
exports.mongoSchemaToZod = mongoSchemaToZod;
