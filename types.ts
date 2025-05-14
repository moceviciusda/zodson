export type TBsonTypes =
  | 'double'
  | 'string'
  | 'object'
  | 'array'
  | 'objectId'
  | 'bool'
  | 'date'
  | 'null'
  | 'regex'
  | 'int'
  | 'timestamp'
  | 'long'
  | 'decimal'
  | 'uuid'
  | 'binData'
  | 'mixed';

export type TMongoSchema =
  | TMongoSchemaArray
  | TMongoSchemaBoolean
  | TMongoSchemaNumber
  | TMongoSchemaObject
  | TMongoSchemaObjectId
  | TMongoSchemaString
  | TMongoSchemaUUID
  | TMongoSchemaBinData
  | TMongoSchemaDate
  | TMongoSchemaNull
  | TMongoSchemaOneOf;

export type TMongoSchemaOneOf = {
  oneOf: TMongoSchema[];
};

export type TMongoSchemaBase = {
  bsonType: TBsonTypes;
  enum?: any[];
  description?: string;
  title?: string;
};

export type TMongoSchemaArray = TMongoSchemaBase & {
  bsonType: 'array';
  items: TMongoSchema | TMongoSchema[];
  additionalItems?: boolean;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
};

export type TMongoSchemaBoolean = TMongoSchemaBase & {
  bsonType: 'bool';
};

export type TMongoSchemaNumber = TMongoSchemaBase & {
  bsonType: 'number' | 'double' | 'int' | 'long' | 'decimal';
  multipleOf?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: boolean;
  exclusiveMaximum?: boolean;
};

export type TMongoSchemaObject = TMongoSchemaBase & {
  bsonType: 'object';
  required?: string[];
  properties: Record<string, TMongoSchema>;
  minProperties?: number;
  maxProperties?: number;
  patternProperties?: Record<string, TMongoSchema>;
  additionalProperties?: boolean | TMongoSchema;
  dependencies?: Record<string, string[] | TMongoSchema>;
};

export type TMongoSchemaObjectId = TMongoSchemaBase & {
  bsonType: 'objectId';
};

export type TMongoSchemaString = TMongoSchemaBase & {
  bsonType: 'string';
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

export type TMongoSchemaUUID = TMongoSchemaBase & {
  bsonType: 'uuid';
};

export type TMongoSchemaBinData = TMongoSchemaBase & {
  bsonType: 'binData';
  binaryType?: 'generic' | 'function' | 'old';
};

export type TMongoSchemaDate = TMongoSchemaBase & {
  bsonType: 'date';
};

export type TMongoSchemaNull = TMongoSchemaBase & {
  bsonType: 'null';
};
