import { z } from 'zod';
import {
  TMongoSchema,
  TMongoSchemaArray,
  TMongoSchemaDate,
  TMongoSchemaBoolean,
  TMongoSchemaNumber,
  TMongoSchemaObject,
  TMongoSchemaObjectId,
  TMongoSchemaString,
} from './types';

const objectIdPattern = '^[0-9a-fA-F]{24}$';
export const zodObjectId = z.string().regex(new RegExp(objectIdPattern));

const zodToBsonSchema = (zodSchema: z.ZodTypeAny): TMongoSchema => {
  // NOTE: Unwrap optional and nullable field effect to get underlying schema
  if (zodSchema instanceof z.ZodOptional) {
    return zodToBsonSchema(zodSchema.unwrap());
  }
  if (zodSchema instanceof z.ZodNullable) {
    const innerSchema = zodToBsonSchema(zodSchema.unwrap());
    return {
      oneOf: [{ bsonType: 'null' } as TMongoSchema, innerSchema],
    };
  }
  if (zodSchema instanceof z.ZodUndefined) {
    // NOTE: Return empty schema for undefined fields - they won't be included in validation
    return {} as TMongoSchema;
  }

  if (zodSchema instanceof z.ZodUnion) {
    const options = zodSchema._def.options;
    return {
      oneOf: options.map((option: z.ZodTypeAny) => zodToBsonSchema(option)),
    };
  }

  if (zodSchema instanceof z.ZodObject) {
    const shape = zodSchema._def.shape();
    const properties: Record<string, TMongoSchema> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToBsonSchema(value as z.ZodTypeAny);
      if (!(value instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      bsonType: 'object',
      properties,
      ...(required.length > 0 && { required }),
    } as TMongoSchemaObject;
  }

  if (zodSchema instanceof z.ZodRecord) {
    return {
      bsonType: 'object',
      additionalProperties: zodToBsonSchema(zodSchema._def.valueType),
    } as TMongoSchemaObject;
  }

  if (zodSchema instanceof z.ZodArray) {
    const arraySchema: TMongoSchemaArray = {
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

  if (zodSchema instanceof z.ZodString) {
    // NOTE: Return early if ObjectId pattern is detected
    const checks = zodSchema._def.checks;
    if (
      checks.some(
        (check: any) =>
          check.kind === 'regex' && check.regex.source === objectIdPattern
      )
    ) {
      return {
        bsonType: 'objectId',
      } as TMongoSchemaObjectId;
    }

    const stringSchema: TMongoSchemaString = {
      bsonType: 'string',
    };
    checks.forEach((check: any) => {
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

  if (zodSchema instanceof z.ZodNumber) {
    const numbers: TMongoSchemaNumber[] = [
      { bsonType: 'int' },
      { bsonType: 'long' },
      { bsonType: 'double' },
      { bsonType: 'decimal' },
    ];

    const numberSchema = {
      oneOf: numbers,
    };

    const checks = zodSchema._def.checks;
    checks.forEach((check: any) => {
      switch (check.kind) {
        case 'min':
          numberSchema.oneOf = numberSchema.oneOf.map((type) => ({
            ...type,
            minimum: check.value,
          }));
          break;
        case 'max':
          numberSchema.oneOf = numberSchema.oneOf.map((type) => ({
            ...type,
            maximum: check.value,
          }));
          break;
        case 'int':
          numberSchema.oneOf = numberSchema.oneOf.filter(
            (type) => type.bsonType === 'int' || type.bsonType === 'long'
          );
          break;
      }
    });

    return numberSchema;
  }

  if (zodSchema instanceof z.ZodBoolean) {
    return {
      bsonType: 'bool',
    } as TMongoSchemaBoolean;
  }

  if (zodSchema instanceof z.ZodDate) {
    return {
      bsonType: 'date',
    } as TMongoSchemaDate;
  }

  if (zodSchema instanceof z.ZodEnum) {
    return {
      bsonType: 'string',
      enum: zodSchema._def.values,
    } as TMongoSchemaString;
  }

  if (zodSchema instanceof z.ZodNativeEnum) {
    return {
      bsonType: 'string',
      enum: Object.values(zodSchema._def.values) as string[],
    } as TMongoSchemaString;
  }

  if (zodSchema instanceof z.ZodAny) {
    return {} as TMongoSchema;
  }

  throw new Error(`Unsupported Zod type: ${zodSchema.constructor.name}`);
};

const createMongoValidator = (zodSchema: z.ZodTypeAny) => {
  return {
    $jsonSchema: zodToBsonSchema(zodSchema),
  };
};

const mongoSchemaToZod = (mongoSchema: TMongoSchema): z.ZodTypeAny => {
  if ('oneOf' in mongoSchema) {
    const schemas = mongoSchema.oneOf.map((schema) => mongoSchemaToZod(schema));
    return z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }

  if (mongoSchema.bsonType === 'array') {
    let elementSchema;

    // NOTE: Union type if mongo accepts multiple types of data in the array
    if (Array.isArray(mongoSchema.items)) {
      elementSchema =
        mongoSchema.items.length === 1
          ? mongoSchemaToZod(mongoSchema.items[0])
          : z.union(
              mongoSchema.items.map(mongoSchemaToZod) as [
                z.ZodTypeAny,
                z.ZodTypeAny,
                ...z.ZodTypeAny[]
              ]
            );
    } else {
      elementSchema = mongoSchemaToZod(mongoSchema.items);
    }

    const constraints = {
      min: mongoSchema.minItems,
      max: mongoSchema.maxItems,
      unique: mongoSchema.uniqueItems,
    };

    let arraySchema = z.array(elementSchema);

    if (constraints.min !== undefined) {
      arraySchema = arraySchema.min(constraints.min);
    }
    if (constraints.max !== undefined) {
      arraySchema = arraySchema.max(constraints.max);
    }

    if (constraints.unique) {
      return arraySchema.refine(
        (items) => new Set(items).size === items.length,
        { message: 'Array items must be unique' }
      );
    }

    return arraySchema;
  }

  if (mongoSchema.bsonType === 'object') {
    const shape: Record<string, z.ZodTypeAny> = {};
    const required = new Set(mongoSchema.required || []);

    for (const [key, value] of Object.entries(mongoSchema.properties)) {
      const fieldSchema = mongoSchemaToZod(value);
      shape[key] = required.has(key) ? fieldSchema : fieldSchema.optional();
    }

    const baseSchema =
      mongoSchema.additionalProperties === false
        ? z.object(shape).strict()
        : z.object(shape).passthrough();

    if (
      mongoSchema.minProperties === undefined &&
      mongoSchema.maxProperties === undefined
    ) {
      return baseSchema;
    }

    //  NOTE: Handle min/max properties
    const validateProperties = (obj: object) => {
      const count = Object.keys(obj).length;
      const minOk =
        mongoSchema.minProperties === undefined ||
        count >= mongoSchema.minProperties;
      const maxOk =
        mongoSchema.maxProperties === undefined ||
        count <= mongoSchema.maxProperties;
      return minOk && maxOk;
    };

    return baseSchema.superRefine((data, ctx) => {
      if (!validateProperties(data)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Object must have ${mongoSchema.minProperties ?? 0} to ${
            mongoSchema.maxProperties ?? 'unlimited'
          } properties`,
        });
      }
    });
  }

  if (mongoSchema.bsonType === 'string') {
    let stringSchema = z.string();

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
      return z.enum(mongoSchema.enum as [string, ...string[]]);
    }

    return stringSchema;
  }

  if (mongoSchema.bsonType === 'bool') {
    return z.boolean();
  }

  if (mongoSchema.bsonType === 'objectId') {
    return zodObjectId;
  }

  if (mongoSchema.bsonType === 'date') {
    return z.date();
  }

  if (mongoSchema.bsonType === 'uuid') {
    return z.string().uuid();
  }

  //  NOTE: Handle binary types. Accept strings that can be converted to Buffer
  if (mongoSchema.bsonType === 'binData') {
    return z.string().transform((val) => Buffer.from(val, 'base64'));
  }

  //  NOTE: Handle number types
  if (
    ['number', 'double', 'int', 'long', 'decimal'].includes(
      mongoSchema.bsonType
    )
  ) {
    let numberSchema = z.number();

    if (['int', 'long'].includes(mongoSchema.bsonType)) {
      numberSchema = numberSchema.int();
    }

    if ('minimum' in mongoSchema && mongoSchema.minimum !== undefined) {
      numberSchema = numberSchema.min(mongoSchema.minimum);
    }
    if ('maximum' in mongoSchema && mongoSchema.maximum !== undefined) {
      numberSchema = numberSchema.max(mongoSchema.maximum);
    }
    if ('multipleOf' in mongoSchema && mongoSchema.multipleOf !== undefined) {
      numberSchema = numberSchema.multipleOf(mongoSchema.multipleOf);
    }

    return numberSchema;
  }

  throw new Error(`Unsupported BSON type: ${mongoSchema.bsonType}`);
};

export { zodToBsonSchema, createMongoValidator, mongoSchemaToZod };
