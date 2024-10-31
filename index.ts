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

const zodToBson = (zodSchema: z.ZodTypeAny): TMongoSchema => {
  // NOTE: Unwrap optional and nullable field effect to get underlying schema
  if (zodSchema instanceof z.ZodOptional) {
    return zodToBson(zodSchema.unwrap());
  }
  if (zodSchema instanceof z.ZodNullable) {
    return zodToBson(zodSchema.unwrap());
  }

  // NOTE: Handle objects
  if (zodSchema instanceof z.ZodObject) {
    const shape = zodSchema._def.shape();
    const properties: Record<string, TMongoSchema> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToBson(value as z.ZodTypeAny);
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

  // NOTE: Handle arrays
  if (zodSchema instanceof z.ZodArray) {
    const arraySchema: TMongoSchemaArray = {
      bsonType: 'array',
      items: zodToBson(zodSchema.element),
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

  // NOTE: Handle numbers
  if (zodSchema instanceof z.ZodNumber) {
    const numberSchema: TMongoSchemaNumber = {
      bsonType: 'double',
    };

    const isInt = zodSchema._def.checks.some(
      (check: any) => check.kind === 'int'
    );
    if (isInt) {
      numberSchema.bsonType = 'int';
    }

    const checks = zodSchema._def.checks;
    checks.forEach((check: any) => {
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
  if (zodSchema instanceof z.ZodBoolean) {
    return {
      bsonType: 'bool',
    } as TMongoSchemaBoolean;
  }

  // NOTE: Handle dates
  if (zodSchema instanceof z.ZodDate) {
    return {
      bsonType: 'date',
    } as TMongoSchemaDate;
  }

  // NOTE: Handle enums
  if (zodSchema instanceof z.ZodEnum) {
    return {
      bsonType: 'string',
      enum: zodSchema._def.values,
    } as TMongoSchemaString;
  }

  // NOTE: Handle any
  if (zodSchema instanceof z.ZodAny) {
    return {} as TMongoSchema;
  }

  throw new Error(`Unsupported Zod type: ${zodSchema.constructor.name}`);
};

const createMongoValidator = (zodSchema: z.ZodTypeAny) => {
  return {
    $jsonSchema: zodToBson(zodSchema),
  };
};

const bsonToZod = (mongoSchema: TMongoSchema): z.ZodTypeAny => {
  if (mongoSchema.bsonType === 'array') {
    let elementSchema;

    // NOTE: Union type if mongo accepts multiple types of data in the array
    if (Array.isArray(mongoSchema.items)) {
      elementSchema =
        mongoSchema.items.length === 1
          ? bsonToZod(mongoSchema.items[0])
          : z.union(
              mongoSchema.items.map(bsonToZod) as [
                z.ZodTypeAny,
                z.ZodTypeAny,
                ...z.ZodTypeAny[]
              ]
            );
    } else {
      elementSchema = bsonToZod(mongoSchema.items);
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
      const fieldSchema = bsonToZod(value);
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
    return z.string().regex(/^[0-9a-fA-F]{24}$/);
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

export {
  zodToBson as zodToBsonSchema,
  createMongoValidator,
  bsonToZod as mongoSchemaToZod,
};
