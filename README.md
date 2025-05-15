# Zodson

A TypeScript utility library to seamlessly sync Zod validation schemas with MongoDB BSON schema validation.

## Description

Zodson bridges the gap between [Zod](https://github.com/colinhacks/zod) validation schemas and MongoDB's native schema validation. Define your data models once with Zod's powerful TypeScript-first validation library and automatically generate compatible MongoDB schema validators.

## Features

- 🔄 **Bidirectional conversion**: Transform Zod schemas to MongoDB JSON Schema and vice versa
- 🧩 **Type safety**: Full TypeScript support with comprehensive type definitions
- 🛡️ **Validation parity**: Ensure consistent validation rules between your application and database
- 🧪 **Support for complex types**: Handle arrays, objects, unions, nullable/optional fields, and more

## Installation

```bash
npm install zodson
```

## Usage

### Convert Zod schema to MongoDB schema

```typescript
import { z } from 'zod';
import { zodToBsonSchema } from 'zodson';

// Define your schema with Zod
const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  age: z.number().int().positive(),
  isActive: z.boolean(),
  tags: z.array(z.string()).optional(),
});

// Convert to MongoDB schema
const mongoSchema = zodToBsonSchema(userSchema);
```

### Create MongoDB validator from Zod schema

```typescript
import { createMongoValidator } from 'zodson';

// Create a MongoDB validator configuration
const validator = createMongoValidator(userSchema);

// Use with MongoDB
await db.createCollection('users', {
  validator: validator,
});
```

### Convert MongoDB schema to Zod schema

```typescript
import { mongoSchemaToZod } from 'zodson';

// Convert from MongoDB schema back to Zod
const regeneratedZodSchema = mongoSchemaToZod(mongoSchema);
```

## Why Zodson?

Maintaining separate validation logic between your application and database is error-prone and time-consuming. Zodson lets you define your validation rules once with Zod's expressive API and seamlessly apply them in MongoDB, ensuring consistent data integrity across your stack.
