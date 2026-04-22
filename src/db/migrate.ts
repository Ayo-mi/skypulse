import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { getPool, closePool } from './connection';
import { logger } from '../utils/logger';

async function migrate(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Ensure migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     VARCHAR(50) PRIMARY KEY,
        applied_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const version = file.replace('.sql', '');
      const { rows } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version=$1',
        [version]
      );
      if (rows.length > 0) {
        logger.info(`Migration already applied: ${version}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      logger.info(`Applying migration: ${version}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [version]
        );
        await client.query('COMMIT');
        logger.info(`Migration applied: ${version}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    logger.info('All migrations complete');
  } finally {
    client.release();
    await closePool();
  }
}

migrate().catch((err) => {
  logger.error('Migration failed', { error: String(err) });
  process.exit(1);
});
