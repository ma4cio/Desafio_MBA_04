import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { CreateUsersAndChannels1775687773260 } from './migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from './migrations/1777579850478-CreateAuthTokens';
import { createTestDataSource } from '../test/create-test-data-source';
import { Video } from '../videos/entities/video.entity';
import { CreateVideos1786848000000 } from './migrations/1786848000000-CreateVideos';

const MANAGED_TABLES = [
  'users',
  'channels',
  'refresh_tokens',
  'verification_tokens',
  'videos',
];

const MANAGED_ENUMS = ['verification_tokens_type_enum', 'videos_status_enum'];

describe('Database migrations (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource(
      [User, Channel, RefreshToken, VerificationToken, Video],
      {
        synchronize: false,
        migrations: [
          CreateUsersAndChannels1775687773260,
          CreateAuthTokens1777579850478,
          CreateVideos1786848000000,
        ],
      },
    );

    await dataSource.initialize();

    // Use one query flow per connection. Besides avoiding concurrent pg queries,
    // explicitly remove PostgreSQL enum types left behind by synchronize-based
    // integration suites; dropping their tables alone does not remove the types.
    for (const table of [...MANAGED_TABLES, 'migrations']) {
      await dataSource.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
    for (const enumName of MANAGED_ENUMS) {
      await dataSource.query(
        `DROP TYPE IF EXISTS "public"."${enumName}" CASCADE`,
      );
    }
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;

    try {
      // The second test undoes the last migration, leaving videos missing.
      // Re-apply so the shared DB is fully migrated when subsequent suites run.
      await dataSource.runMigrations();
    } finally {
      // A migration assertion must never leak the PostgreSQL pool and keep Jest
      // alive until the CI job timeout.
      await dataSource.destroy();
    }
  });

  it('should apply all migrations and create all five domain tables', async () => {
    const ranMigrations = await dataSource.runMigrations();

    expect(ranMigrations).toHaveLength(3);

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [MANAGED_TABLES],
    );
    const tableNames = result.map((r) => r.table_name);
    expect(tableNames).toEqual([
      'channels',
      'refresh_tokens',
      'users',
      'verification_tokens',
      'videos',
    ]);
  });

  it('should revert the last migration and remove the videos table', async () => {
    await dataSource.undoLastMigration();

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = $1`,
      ['videos'],
    );
    expect(result).toHaveLength(0);
  });
});
