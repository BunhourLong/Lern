// Entry point for the TypeORM CLI only (see the migration:* scripts); the app and tests use createDataSource
import { parseEnv } from './config';
import { createDataSource } from './database';

export default createDataSource(parseEnv(process.env).DATABASE_URL);
