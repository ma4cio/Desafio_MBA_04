import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1786848000000 implements MigrationInterface {
  name = 'CreateVideos1786848000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('draft', 'processing', 'ready', 'error')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "channel_id" uuid NOT NULL,
        "title" character varying(120) NOT NULL,
        "original_filename" character varying(255) NOT NULL,
        "mime_type" character varying(100) NOT NULL,
        "size_bytes" bigint NOT NULL,
        "status" "public"."videos_status_enum" NOT NULL DEFAULT 'draft',
        "public_id" character varying(64) NOT NULL,
        "source_object_key" text NOT NULL,
        "thumbnail_object_key" text,
        "multipart_upload_id" character varying(255),
        "duration_seconds" integer,
        "metadata" jsonb,
        "processing_error" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_videos_public_id" UNIQUE ("public_id"),
        CONSTRAINT "UQ_videos_source_object_key" UNIQUE ("source_object_key"),
        CONSTRAINT "CHK_videos_size" CHECK ("size_bytes" > 0 AND "size_bytes" <= 10737418240),
        CONSTRAINT "CHK_videos_duration" CHECK ("duration_seconds" IS NULL OR "duration_seconds" > 0),
        CONSTRAINT "PK_videos" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_status" ON "videos" ("channel_id", "status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_videos_channel" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_videos_channel"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_channel_status"`);
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}
